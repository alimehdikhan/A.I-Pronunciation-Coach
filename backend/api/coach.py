"""Personalised coaching text for an attempt (see backend.coach)."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend import coach_tools, teaching
from backend.api.deps import profile_key
from backend.coach import CoachReply, CoachRequest
from backend.config import settings
from backend.database import get_db
from backend.moderation import RESPECT_REPLY, RESPECT_TRY, is_abusive
from backend.phoneme_kb import get_phoneme
from backend.repositories import analytics, authorize, find_user, history, observations
from backend.runtime import get_coach
from backend.security import RateLimiter, clean_username, client_key

router = APIRouter()

# Each uncached call is a paid/quota-limited upstream request, so keep it modest.
coach_rate_limiter = RateLimiter(settings.rate_limit_per_minute, name="coach")


@router.post("/api/coach", response_model=CoachReply)
async def coach_attempt(request: Request, body: CoachRequest) -> CoachReply:
    """Explain an attempt's diagnosed slips in plain language.

    Only the sentence and the diagnosed sounds are used, never audio or names.
    Falls back to knowledge-base tips when the language model is unavailable.
    """
    coach_rate_limiter.check(client_key(request))
    return await get_coach().coach(body)


@router.get("/api/coach/plan/{username}")
async def coaching_plan(
    username: str,
    request: Request,
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """What the learner has mastered, the one sound to work on next, and a short session for it.

    The focus and every number come from the learner's own history; the language
    model only writes the opening note, and a template stands in without it.
    """
    coach_rate_limiter.check(client_key(request))
    name = clean_username(username) or ""
    user = find_user(db, name)
    rows: list = []
    if user is not None:
        authorize(db, user, key)
        rows = observations(db, user)
    plan = teaching.build_plan(rows)

    focus = plan["focus"]
    facts = {
        "has_history": plan["has_history"],
        "focus_sound": focus["phoneme"],
        "why_chosen": focus["reason"],
        "focus_stats": focus["stats"],
        "strengths": [s["phoneme"] for s in plan["strengths"]],
        "also_work_on": [s["phoneme"] for s in plan["also_work_on"]],
    }
    note, source = await get_coach().briefing(facts, teaching.template_briefing(plan))
    plan["briefing"] = {"text": note, "source": source}
    return plan


# --- the model beyond one attempt: chat, fresh practice sentences, a written progress note -------


def _learner(db: Session, username: str, key: str | None):
    """(user or None, observations); a name nobody has used yet simply has no history."""
    user = find_user(db, clean_username(username) or "")
    if user is None:
        return None, []
    authorize(db, user, key)
    return user, observations(db, user)


class ChatTurn(BaseModel):
    role: Literal["learner", "coach"]
    text: str = Field(max_length=700)


class ChatBody(BaseModel):
    username: str = Field(default="", max_length=80)
    message: str = Field(min_length=1, max_length=400)
    native_language: str | None = Field(default=None, max_length=30)
    history: list[ChatTurn] = Field(default_factory=list, max_length=8)


@router.post("/api/coach/chat")
async def chat(
    request: Request,
    body: ChatBody,
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Answer a learner's question, grounded in their own sounds and latest attempts."""
    coach_rate_limiter.check(client_key(request))
    if is_abusive(body.message):
        # Answered here, without the model: it cannot be argued with and costs nothing.
        return {"reply": RESPECT_REPLY, "try_next": RESPECT_TRY, "words": [], "sentences": [], "source": "guard"}
    user, rows = _learner(db, body.username, key)
    plan = teaching.build_plan(rows)
    focus = plan["focus"]
    recent = []
    if user is not None:
        for record in history(db, user, 4):
            recent.append({
                "phrase": record.target_text,
                "score": round(record.score),
                "slips": [
                    {"word": m.word, "expected": m.expected_phoneme, "said": m.actual_phoneme} for m in record.mistakes[:4]
                ],
            })
    facts = {
        "learner": {
            "has_history": plan["has_history"],
            "focus_sound": focus["phoneme"],
            "focus_stats": focus["stats"],
            "strengths": [s["phoneme"] for s in plan["strengths"]],
            "also_work_on": [s["phoneme"] for s in plan["also_work_on"]],
            "recent_attempts": recent,
            "native_language": coach_tools.clean_language(body.native_language),
        },
        "conversation": [t.model_dump() for t in body.history[-6:]],
        "learner_message": " ".join(body.message.split()),
    }
    typed = coach_tools.words_in_message(body.message)
    facts["words_in_message"] = [{k: v for k, v in w.items() if not k.startswith("_")} for w in typed]
    named = coach_tools.sounds_mentioned(body.message)
    wanted = coach_tools.intents(body.message)

    if "compare" in wanted:
        pair = coach_tools.compared_words(body.message)
        typed = [{"word": w, "from_dictionary": True} for w in pair]
        facts["words_in_message"] = []
        facts["comparison"] = {
            "words": coach_tools.compare_facts(pair),
            "sounds_that_differ": coach_tools.differing_sounds(coach_tools.compare_facts(pair)),
        }
        named = [s for s in facts["comparison"]["sounds_that_differ"] if s][:3] or named

    if "progress" in wanted and user is not None:
        data = analytics(db, user, 0)
        if data:
            facts["progress"] = coach_tools.report_facts(data)

    facts["sound_guides"] = coach_tools.sound_guides(focus["phoneme"], typed, named)

    if "sentences" in wanted and "compare" not in wanted:
        # A request for sentences is answered with sentences: written by the model, then checked.
        symbol = named[0] if named else focus["phoneme"]
        level = "intermediate"
        entry = get_phoneme(symbol) or {}
        found, source = await get_coach().generate(
            "sentences",
            coach_tools.PRACTICE_PROMPT,
            {"sound": {"ipa": symbol, "example": (entry.get("examples") or [""])[0], "how": entry.get("placement", "")},
             "level": level, "topic": None, "count": 3},
            lambda data: coach_tools.parse_sentences(data, symbol, level, 3),
            lambda: coach_tools.sentences_fallback(symbol, level, 3),
            cache=False,
        )
        label = entry.get("label") or f"/{symbol}/"
        return {
            "reply": f"Here are a few sentences to try for {label}. Say them slowly first, then at your normal speed.",
            "try_next": "Pick one and say it three times.",
            "words": [],
            "sentences": found,
            "source": source,
        }
    fallback_facts = {"focus_sound": focus["phoneme"]}
    result, source = await get_coach().generate(
        "chat",
        coach_tools.CHAT_PROMPT,
        facts,
        coach_tools.parse_chat,
        lambda: coach_tools.chat_fallback(fallback_facts),
        cache=False,
    )
    words = coach_tools.relevant_words(result.get("words", []), typed, facts["sound_guides"], named)
    return {**result, "words": words, "sentences": [], "source": source}


class PracticeBody(BaseModel):
    username: str = Field(default="", max_length=80)
    phoneme: str | None = Field(default=None, max_length=8)
    level: Literal["beginner", "intermediate", "advanced"] = "intermediate"
    topic: str | None = Field(default=None, max_length=40)
    count: int = Field(default=4, ge=1, le=6)
    native_language: str | None = Field(default=None, max_length=30)


@router.post("/api/coach/practice")
async def practice_sentences(
    request: Request,
    body: PracticeBody,
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Fresh sentences for one sound (the learner's own focus unless one is named), each checked to contain it."""
    coach_rate_limiter.check(client_key(request))
    symbol = body.phoneme
    if not symbol or get_phoneme(symbol) is None:
        _user, rows = _learner(db, body.username, key)
        symbol = teaching.build_plan(rows)["focus"]["phoneme"]
    entry = get_phoneme(symbol) or {}
    topic = " ".join((body.topic or "").split()) or None
    if topic and is_abusive(topic):
        topic = None  # a rude topic is simply not used
    facts = {
        "sound": {
            "ipa": symbol,
            "example": (entry.get("examples") or [""])[0],
            "how": entry.get("placement", ""),
        },
        "level": body.level,
        "topic": topic,
        "count": body.count,
        "native_language": coach_tools.clean_language(body.native_language),
    }
    result, source = await get_coach().generate(
        "sentences",
        coach_tools.PRACTICE_PROMPT,
        facts,
        lambda data: coach_tools.parse_sentences(data, symbol, body.level, body.count),
        lambda: coach_tools.sentences_fallback(symbol, body.level, body.count),
        cache=False,  # a learner who asks again wants different sentences
    )
    return {"phoneme": symbol, "label": entry.get("label", ""), "level": body.level, "sentences": result, "source": source}


@router.get("/api/coach/report/{username}")
async def progress_report(
    username: str,
    request: Request,
    tz_offset: int = Query(0, ge=-14 * 60, le=14 * 60),
    language: str | None = Query(None, max_length=30),
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """A short written read of the learner's progress; nothing to say yet returns `report: null`."""
    coach_rate_limiter.check(client_key(request))
    user = find_user(db, clean_username(username) or "")
    if user is None:
        return {"report": None, "source": "template"}
    authorize(db, user, key)
    data = analytics(db, user, tz_offset)
    if not data:
        return {"report": None, "source": "template"}
    facts = coach_tools.report_facts(data)
    result, source = await get_coach().generate(
        "report",
        coach_tools.REPORT_PROMPT,
        {"facts": facts, "native_language": coach_tools.clean_language(language)},
        coach_tools.parse_report,
        lambda: coach_tools.report_fallback(facts),
    )
    return {"report": result, "source": source}
