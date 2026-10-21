""""Help improve Vocaly AI": turn giving practice recordings on or off, and take back what was given."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend import contributions
from backend.api.deps import profile_key
from backend.database import PronunciationRecord, User, as_utc, get_db, utcnow
from backend.errors import CodedHTTPException
from backend.repositories import authorize, find_user
from backend.security import clean_username

router = APIRouter()


def _account(db: Session, username: str, key: str | None) -> User:
    """Only accounts can give recordings: a guest who clears the browser could never take them back."""
    user = find_user(db, clean_username(username) or "")
    if user is None or not key:
        raise CodedHTTPException(403, "Sign in to help improve Vocaly AI.", "account_required")
    authorize(db, user, key)
    if user.password_hash is None:
        raise CodedHTTPException(403, "Sign in to help improve Vocaly AI.", "account_required")
    return user


def _given(db: Session, user: User) -> int:
    count = db.scalar(
        select(func.count()).select_from(PronunciationRecord).where(
            PronunciationRecord.user_id == user.id, PronunciationRecord.clip_id.is_not(None)
        )
    )
    return int(count or 0)


def _status(db: Session, user: User | None) -> dict[str, Any]:
    on = bool(user and user.contributor_id and user.contribute_at)
    return {
        "available": contributions.enabled(),
        "on": on,
        "since": as_utc(user.contribute_at).isoformat() if on and user and user.contribute_at else None,
        "given": _given(db, user) if user else 0,
    }


class ContributeBody(BaseModel):
    on: bool


@router.get("/api/contribute/{username}")
def contribute_status(username: str, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Whether the option is offered, whether this learner gives recordings, and how many they gave."""
    user = find_user(db, clean_username(username) or "")
    if user is None or not key or user.password_hash is None:
        return _status(db, None)
    authorize(db, user, key)
    return _status(db, user)


@router.put("/api/contribute/{username}")
def set_contribute(
    username: str, body: ContributeBody, key: str | None = Depends(profile_key), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Start or stop giving practice recordings. Stopping keeps what was given; DELETE removes it."""
    user = _account(db, username, key)
    if body.on:
        if not contributions.enabled():
            raise CodedHTTPException(409, "Giving recordings isn't available on this server.", "contributions_off")
        user.contributor_id = user.contributor_id or contributions.new_contributor_id()
        user.contribute_at = user.contribute_at or utcnow()
    else:
        # The id stays with the recordings already given, so they can still be deleted later.
        user.contribute_at = None
    db.commit()
    return _status(db, user)


@router.delete("/api/contribute/{username}")
def delete_contributions(username: str, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Stop giving recordings and delete every one already given, from this server and the dataset."""
    user = _account(db, username, key)
    deleted = contributions.stop(db, user)
    db.commit()
    return {**_status(db, user), "deleted": deleted}
