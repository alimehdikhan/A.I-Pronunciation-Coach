"""The learner profile: first language, goal and tip language (see backend.learners)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend import learners
from backend.api.deps import profile_key
from backend.config import settings
from backend.database import get_db
from backend.repositories import authorize, find_or_create_user, find_user, learner_profile
from backend.security import RateLimiter, clean_username, client_key

router = APIRouter()
profile_rate_limiter = RateLimiter(settings.rate_limit_per_minute, name="profile")


@router.get("/api/learner/options")
def profile_options() -> dict[str, Any]:
    """The choices the profile offers, and the sounds each first language puts first."""
    return learners.options()


@router.get("/api/learner/{username}")
def get_profile(username: str, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    user = find_user(db, clean_username(username) or "")
    if user is not None:
        authorize(db, user, key)
    return learner_profile(user)


class ProfileBody(BaseModel):
    first_language: str | None = Field(default=None, max_length=30)
    goal: str | None = Field(default=None, max_length=12)
    tip_language: str | None = Field(default=None, max_length=12)


@router.put("/api/learner/{username}")
def put_profile(
    username: str,
    body: ProfileBody,
    request: Request,
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Save the profile. Only listed values are accepted; anything else is cleared to the default."""
    profile_rate_limiter.check(client_key(request))
    name = clean_username(username)
    if not name:
        raise HTTPException(status_code=400, detail="A name is required to save a profile.")
    user = find_or_create_user(db, name, key)
    fields = body.model_fields_set
    if "first_language" in fields:
        user.first_language = learners.clean_first_language(body.first_language)
    if "goal" in fields:
        user.goal = learners.clean_goal(body.goal)
    if "tip_language" in fields:
        user.tip_language = learners.clean_tip_language(body.tip_language)
    db.commit()
    return learner_profile(user)
