""""I think this is wrong": learners dispute a flagged sound, for recalibrating the scorer later."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import profile_key
from backend.config import settings
from backend.database import get_db
from backend.repositories import RecordNotFound, authorize, find_user, save_dispute
from backend.security import RateLimiter, clean_username, client_key

router = APIRouter()

dispute_rate_limiter = RateLimiter(settings.rate_limit_per_minute, name="disputes")


class DisputeBody(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    record_id: int = Field(ge=1)
    word: str = Field(min_length=1, max_length=40)
    expected: str = Field(min_length=1, max_length=8)
    detected: str = Field(default="", max_length=8)
    gop: float | None = Field(default=None, ge=-1000, le=0)
    reason: Literal["said_correctly", "accent_normal"] | None = None


@router.post("/api/disputes")
def dispute_sound(
    request: Request, body: DisputeBody, key: str | None = Depends(profile_key), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Record that the learner thinks one flagged sound in their own saved attempt was wrongly flagged.

    Nothing about the scores changes; the export (`python -m backend.manage disputes`) is
    for recalibration. Sending it again for the same sound updates the reason.
    """
    dispute_rate_limiter.check(client_key(request))
    user = find_user(db, clean_username(body.username) or "")
    if user is None:
        raise HTTPException(status_code=404, detail="That attempt was not found.")
    authorize(db, user, key)
    try:
        dispute = save_dispute(
            db, user, body.record_id, " ".join(body.word.split()), body.expected, body.detected, body.gop, body.reason
        )
    except RecordNotFound as exc:
        raise HTTPException(status_code=404, detail="That sound was not found in your attempt.") from exc
    return {"saved": True, "id": dispute.id, "tier": dispute.tier, "reason": dispute.reason}
