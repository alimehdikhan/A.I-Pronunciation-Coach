"""The live voice conversation with the coach (WebSocket). See backend.voice_agent."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket
from starlette.websockets import WebSocketDisconnect

from backend import coach_tools, teaching
from backend.config import settings
from backend.database import get_db
from backend.repositories import ProfileLocked, account_for_key, authorize, find_user, observations
from backend.security import RateLimiter, clean_username
from backend.voice_agent import VoiceSession, loads

logger = logging.getLogger("pronunciation_coach.voice")
router = APIRouter()

voice_rate_limiter = RateLimiter(8, name="voice")
_active = 0
_callers: set[str] = set()  # one conversation at a time per caller
LEVELS = ("beginner", "intermediate", "advanced")
HELLO_TIMEOUT = 10.0
MIN_CALL_SECONDS = 30  # no point starting a call with less talk time than this left


class TalkTime:
    """Seconds each caller has talked today (UTC), in memory and per process like the rate limiters."""

    def __init__(self, max_callers: int = 10_000):
        self.max_callers = max_callers
        self._used: dict[str, tuple[str, float]] = {}

    @staticmethod
    def _today() -> str:
        return time.strftime("%Y-%m-%d", time.gmtime())

    def left(self, caller: str) -> float | None:
        """Seconds left today, or None when there is no daily allowance."""
        allowance = settings.voice_daily_minutes * 60
        if allowance <= 0:
            return None
        day, used = self._used.get(caller, ("", 0.0))
        return max(0.0, allowance - (used if day == self._today() else 0.0))

    def charge(self, caller: str, seconds: float) -> None:
        today = self._today()
        day, used = self._used.get(caller, (today, 0.0))
        self._used[caller] = (today, (used if day == today else 0.0) + max(0.0, seconds))
        if len(self._used) > self.max_callers:
            self._used = {k: v for k, v in self._used.items() if v[0] == today}


talk_time = TalkTime()


def _facts(hello: dict[str, Any], database: Any = None) -> dict[str, Any]:
    """What the coach should know about this learner, from their own history (nothing is invented).

    `database` is the app's session factory (the same dependency the HTTP routes use, so a test or a
    deployment can swap it); a WebSocket outlives a request, so a session is opened only for this lookup.
    """
    level = hello.get("level") if hello.get("level") in LEVELS else "beginner"
    facts: dict[str, Any] = {
        "level": level,
        "native_language": coach_tools.clean_language(hello.get("native_language")),
        "has_history": False,
    }
    name = clean_username(str(hello.get("username") or "")) or ""
    if not name:
        return facts
    generator = (database or get_db)()
    db = next(generator)
    try:
        user = find_user(db, name)
        if user is None:
            return facts
        authorize(db, user, str(hello.get("profile_key") or "") or None)  # raises ProfileLocked for someone else's name
        plan = teaching.build_plan(observations(db, user))
    finally:
        generator.close()
    if plan["has_history"]:
        facts.update(
            has_history=True,
            focus_label=plan["focus"]["label"],
            also=[s["label"] for s in plan["also_work_on"]],
            strong=[s["label"] for s in plan["strengths"]],
        )
    return facts


def _signed_in(hello: dict[str, Any], database: Any = None) -> bool:
    """Whether the profile key in the first message belongs to a signed-in account."""
    generator = (database or get_db)()
    db = next(generator)
    try:
        return account_for_key(db, str(hello.get("profile_key") or "") or None) is not None
    finally:
        generator.close()


@router.websocket("/ws/voice")
async def voice(ws: WebSocket) -> None:
    """A spoken conversation. The first message is JSON; after that audio goes up and audio comes back."""
    global _active
    await ws.accept()

    async def emit(payload: dict[str, Any] | bytes) -> None:
        with contextlib.suppress(Exception):  # the client may already be gone
            if isinstance(payload, bytes):
                await ws.send_bytes(payload)
            else:
                await ws.send_json(payload)

    async def refuse(code: str, message: str) -> None:
        await emit({"type": "error", "code": code, "message": message})
        with contextlib.suppress(Exception):
            await ws.close()

    if not settings.gemini_api_key:
        return await refuse("unavailable", "Voice conversations are not switched on for this app.")
    caller = ws.client.host if ws.client else "unknown"
    try:
        voice_rate_limiter.check(caller)
    except HTTPException:
        return await refuse("rate_limited", "You have started a lot of conversations. Please wait a minute.")
    if caller in _callers:
        return await refuse("already_talking", "You already have a conversation open. End it first, then start a new one.")
    if _active >= settings.voice_max_sessions:
        return await refuse("busy", "The coach is on other calls right now. Please try again in a moment.")
    left = talk_time.left(caller)
    if left is not None and left < MIN_CALL_SECONDS:
        return await refuse(
            "daily_limit",
            f"You have used today's {settings.voice_daily_minutes:g} minutes of conversation. It resets tomorrow; "
            "until then, keep practising with the recorder.",
        )

    _active += 1
    _callers.add(caller)
    try:
        try:
            hello = loads(await asyncio.wait_for(ws.receive_text(), HELLO_TIMEOUT))
        except (asyncio.TimeoutError, WebSocketDisconnect):
            return
        if not hello or hello.get("type") != "start":
            return await refuse("bad_request", "Expected a start message.")
        database = ws.app.dependency_overrides.get(get_db)
        if settings.require_account and not await asyncio.to_thread(_signed_in, hello, database):
            return await refuse("sign_in_required", "Sign in or create an account to talk to your coach.")
        try:
            facts = await asyncio.to_thread(_facts, hello, database)
        except ProfileLocked:
            return await refuse("locked", "This name belongs to another device. Sign in to talk to your coach.")

        async def receive() -> bytes | dict[str, Any] | None:
            try:
                message = await ws.receive()
            except WebSocketDisconnect:
                return None
            if message.get("type") == "websocket.disconnect":
                return None
            if message.get("bytes") is not None:
                return message["bytes"]
            return loads(message.get("text") or "") or {}

        # A call lasts the usual length, or less when that is all of today's allowance that is left.
        limit, reason = float(settings.voice_session_seconds), "time_limit"
        if left is not None and left < limit:
            limit, reason = left, "daily_limit"
        session = VoiceSession(facts=facts, voice=str(hello.get("voice") or ""), emit=emit, limit_seconds=limit, limit_reason=reason)
        started = time.monotonic()
        try:
            await session.run(receive)
        except Exception:
            logger.exception("Voice session failed")
            await emit({"type": "error", "code": "failed", "message": "The conversation was interrupted. Please try again."})
        finally:
            talk_time.charge(caller, time.monotonic() - started)
    finally:
        _active -= 1
        _callers.discard(caller)
        with contextlib.suppress(Exception):
            await ws.close()
