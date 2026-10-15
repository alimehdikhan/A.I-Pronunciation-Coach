"""Per-user progress: history, analytics and personalised drills.

Profiles are protected by the browser's profile key (see backend.security).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.api.deps import profile_key
from backend.database import AnalyticsResponse, UserHistoryResponse, get_db
from backend.repositories import (
    ProfileLocked,
    analytics,
    authorize,
    delete_history,
    find_user,
    history,
    history_total,
    weakness_rows,
)
from backend.security import clean_username
from backend.tutor import get_personalized_practice

router = APIRouter()

EMPTY_ANALYTICS: dict[str, Any] = {
    "average_score": 0.0,
    "best_score": 0.0,
    "total_practice_sessions": 0,
    "practice_days": 0,
    "streak_days": 0,
    "sessions_this_week": 0,
    "metric_averages": {},
    "score_trend": [],
    "top_weaknesses": [],
    "improvement": None,
    "daily_activity": [],
    "sound_mastery": [],
    "tricky_words": [],
}


@router.get("/api/history/{username}", response_model=UserHistoryResponse)
def get_history(
    username: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0, le=100_000),
    min_score: float | None = Query(None, ge=0, le=100),
    max_score: float | None = Query(None, ge=0, le=100),
    q: str | None = Query(None, max_length=80, description="Only attempts whose phrase contains this text"),
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
):
    """Fetch past pronunciation records for a user (newest first), optionally filtered and paged."""
    name = clean_username(username) or ""
    user = find_user(db, name)
    if not user:
        return {"username": name, "records": [], "total": 0}
    authorize(db, user, key)
    return {
        "username": name,
        "records": history(db, user, limit, offset, min_score, max_score, q),
        "total": history_total(db, user, min_score, max_score, q),
    }


@router.delete("/api/history/{username}")
def delete_user_history(
    username: str, key: str | None = Depends(profile_key), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Delete a user's practice history (requires the profile's key)."""
    name = clean_username(username) or ""
    if not key:
        raise HTTPException(status_code=400, detail="A profile key is required to delete history.")
    user = find_user(db, name)
    if not user:
        return {"deleted": 0}
    authorize(db, user, key)
    return {"deleted": delete_history(db, user)}


@router.get("/api/analytics/{username}", response_model=AnalyticsResponse)
def get_analytics(
    username: str,
    tz_offset: int = Query(0, ge=-14 * 60, le=14 * 60, description="JS Date.getTimezoneOffset() in minutes"),
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
):
    """Aggregated score trends, streaks and the most frequent phoneme mistakes."""
    user = find_user(db, clean_username(username) or "")
    if not user:
        return EMPTY_ANALYTICS
    authorize(db, user, key)
    return analytics(db, user, tz_offset) or EMPTY_ANALYTICS


@router.get("/api/tutor/personalized-practice/{username}")
def get_personalized_practice_endpoint(
    username: str, key: str | None = Depends(profile_key), db: Session = Depends(get_db)
):
    """Drills for a user's weakest phonemes (common trouble sounds for new users)."""
    name = clean_username(username) or ""
    user = find_user(db, name)
    weaknesses: list[tuple[str, int]] = []
    if user:
        try:
            authorize(db, user, key)
            weaknesses = weakness_rows(db, user, 4)
        except ProfileLocked:
            pass  # Someone else's profile: offer the default drills instead.
    practice = get_personalized_practice(weaknesses)
    return {
        "username": name,
        "personalized": bool(practice and practice[0]["personalized"]),
        "practices": practice,
    }
