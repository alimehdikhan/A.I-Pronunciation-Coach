"""The learning journey: daily goal, level, badges, the path through the sounds, and what to review."""

from __future__ import annotations

from collections import Counter
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend import journey, teaching
from backend.api.deps import profile_key
from backend.database import PronunciationRecord, as_utc, get_db, utcnow
from backend.repositories import _local_days, _streak, authorize, find_user, observations
from backend.security import clean_username

router = APIRouter()

MAX_ATTEMPTS_COUNTED = 5000


@router.get("/api/journey/placement")
def placement() -> dict[str, Any]:
    """The short check-up: six sentences that between them cover the sounds learners most often miss."""
    return {"items": journey.PLACEMENT}


@router.get("/api/journey/{username}")
def learning_journey(
    username: str,
    goal: int = Query(journey.DEFAULT_GOAL, ge=1, le=50),
    tz_offset: int = Query(0, ge=-14 * 60, le=14 * 60, description="JS Date.getTimezoneOffset() in minutes"),
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Everything the journey screen shows, from the learner's own attempts."""
    target = journey.clean_goal(goal)
    user = find_user(db, clean_username(username) or "")
    scores: list[tuple[Any, float]] = []
    rows: list[Any] = []
    streak = 0
    if user is not None:
        authorize(db, user, key)
        scores = [
            (created, float(score))
            for created, score in db.execute(
                select(PronunciationRecord.created_at, PronunciationRecord.score)
                .where(PronunciationRecord.user_id == user.id)
                .order_by(PronunciationRecord.created_at.desc())
                .limit(MAX_ATTEMPTS_COUNTED)
            ).all()
        ]
        rows = observations(db, user)
        now = utcnow()
        today = (now - timedelta(minutes=tz_offset)).date()
        streak = _streak(_local_days(db, user.id, tz_offset), today)
    else:
        today = (utcnow() - timedelta(minutes=tz_offset)).date()

    offset = timedelta(minutes=tz_offset)
    per_day = Counter((as_utc(created) - offset).date() for created, _score in scores if created is not None)
    stats = teaching.compute_mastery(rows)
    mastered = sum(1 for s in stats if s.status == "solid" and s.attempts >= teaching.MIN_ATTEMPTS)
    xp = sum(journey.attempt_xp(score) for _created, score in scores)
    best = max((score for _created, score in scores), default=0.0)
    totals = {
        "attempts": len(scores),
        "best_score": best,
        "streak": streak,
        "sounds_mastered": mastered,
        "goal_days": sum(1 for count in per_day.values() if count >= target),
    }
    average_recent = sum(score for _c, score in scores[:6]) / min(6, len(scores)) if scores else 0.0
    return {
        "goal": journey.goal_status(per_day.get(today, 0), target),
        "xp": journey.level_for(xp),
        "streak_days": streak,
        "attempts": len(scores),
        "best_score": round(best, 1),
        "badges": journey.badges_for(totals),
        "path": journey.build_path(stats),
        "review": journey.review_queue(rows),
        "checkup_done": len(scores) >= len(journey.PLACEMENT),
        "suggested_level": journey.suggested_level(average_recent) if scores else None,
    }
