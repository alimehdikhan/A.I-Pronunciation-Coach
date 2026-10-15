"""Personalised coaching text for an attempt (see backend.coach)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from backend import teaching
from backend.api.deps import profile_key
from backend.coach import CoachReply, CoachRequest
from backend.config import settings
from backend.database import get_db
from backend.repositories import authorize, find_user, observations
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
