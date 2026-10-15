"""Personalised coaching text for an attempt (see backend.coach)."""

from __future__ import annotations

from fastapi import APIRouter, Request

from backend.coach import CoachReply, CoachRequest
from backend.config import settings
from backend.runtime import get_coach
from backend.security import RateLimiter, client_key

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
