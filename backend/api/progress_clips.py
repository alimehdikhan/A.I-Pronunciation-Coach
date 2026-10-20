"""Day 1 vs Day 30: one interview answer recorded now and again a month later (stored only with consent),
measured, and compared side by side. The shareable video is made in the browser."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend import progress_clips
from backend.api.deps import profile_key
from backend.api.speaking import analyse_free_answer
from backend.api.speech import audio_rate_limiter
from backend.config import settings
from backend.database import ProgressClip, as_utc, get_db, utcnow
from backend.observability import StageTimer
from backend.repositories import authorize, find_or_create_user, find_user
from backend.security import clean_username, client_key

router = APIRouter()


def _now():
    return utcnow().replace(tzinfo=None)


def _row_view(row: ProgressClip) -> dict[str, Any]:
    return {
        "round": row.round,
        "prompt": progress_clips.PROMPTS_BY_ID.get(row.prompt_id, {"id": row.prompt_id, "text": ""}),
        "transcript": row.transcript,
        "measures": json.loads(row.measures),
        "has_audio": row.audio is not None,
        "created_at": as_utc(row.created_at).isoformat() if row.created_at else None,
    }


def _status(rows: list[ProgressClip]) -> dict[str, Any]:
    rounds = [{"round": r.round, "created_at": r.created_at} for r in rows]
    upcoming = progress_clips.next_round(rounds, _now(), settings.compare_days)
    views = sorted((_row_view(r) for r in rows), key=lambda v: v["round"])
    return {
        "prompts": progress_clips.PROMPTS,
        "max_seconds": progress_clips.MAX_SECONDS,
        "every_days": settings.compare_days,
        "rounds": views,
        "next": {**upcoming, "due_at": as_utc(upcoming["due_at"]).isoformat() if upcoming["due_at"] else None},
        "comparison": progress_clips.compare(views[0], views[-1]) if len(views) > 1 else None,
    }


def _rows(db: Session, user) -> list[ProgressClip]:
    return list(db.scalars(select(ProgressClip).where(ProgressClip.user_id == user.id)))


def _owner(db: Session, username: str, key: str | None):
    user = find_user(db, clean_username(username) or "")
    if user is None or not key:
        raise HTTPException(status_code=404, detail="No recordings for that name.")
    authorize(db, user, key)
    return user


@router.get("/api/day30/{username}")
def day30_status(username: str, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    """The recordings so far, when the next one is due, and day one against the latest."""
    user = find_user(db, clean_username(username) or "")
    if user is None:
        return _status([])
    authorize(db, user, key)
    return _status(_rows(db, user))


@router.post("/api/day30/{username}/record")
async def day30_record(
    username: str,
    request: Request,
    response: Response,
    audio: UploadFile = File(...),
    prompt_id: str = Form("about", max_length=20),
    consent: bool = Form(False, description="The learner agreed to store this recording to compare later"),
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Record the next round. Day one picks the question; every later round answers the same one."""
    if not consent:
        raise HTTPException(status_code=400, detail="Keeping this recording needs your consent.")
    name = clean_username(username)
    if not name or not key:
        raise HTTPException(status_code=400, detail="A name and profile key are required.")
    audio_rate_limiter.check(client_key(request))
    user = find_or_create_user(db, name, key)
    rows = _rows(db, user)
    upcoming = progress_clips.next_round([{"round": r.round, "created_at": r.created_at} for r in rows], _now(), settings.compare_days)
    if not upcoming["due"]:
        raise HTTPException(status_code=409, detail="The next recording isn't due yet.")
    prompt = rows[0].prompt_id if rows else (prompt_id if prompt_id in progress_clips.PROMPTS_BY_ID else "about")
    db.commit()  # end the read before transcription

    timer = StageTimer()
    analysed = await analyse_free_answer(audio, timer, max_seconds=progress_clips.MAX_SECONDS, endpoint="/api/day30/record")
    if not analysed["text"]:
        raise HTTPException(status_code=422, detail="We didn't hear an answer. Check your microphone and try again.")
    data, audio_type = analysed["upload"]
    if len(data) > progress_clips.MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="That recording is too long to keep.")
    db.add(ProgressClip(
        user_id=user.id, round=upcoming["round"], prompt_id=prompt, audio=data, audio_type=audio_type,
        transcript=analysed["target"][:3000], measures=json.dumps(progress_clips.measures(analysed)), consent_at=_now(),
    ))
    db.commit()
    response.headers["Server-Timing"] = timer.header()
    return _status(_rows(db, user))


@router.get("/api/day30/{username}/audio/{round_number}")
def day30_audio(username: str, round_number: int, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> Response:
    """One round's recording, to its owner only."""
    user = _owner(db, username, key)
    row = db.scalar(select(ProgressClip).where(ProgressClip.user_id == user.id, ProgressClip.round == round_number))
    if row is None or row.audio is None:
        raise HTTPException(status_code=404, detail="That recording isn't stored.")
    return Response(content=row.audio, media_type=row.audio_type or "audio/wav", headers={"Cache-Control": "private, no-store"})


@router.delete("/api/day30/{username}")
def day30_delete(username: str, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Delete every round: the recordings and their measures. Day one can then be recorded again."""
    user = _owner(db, username, key)
    count = db.execute(delete(ProgressClip).where(ProgressClip.user_id == user.id)).rowcount
    db.commit()
    return {"deleted": int(count or 0)}
