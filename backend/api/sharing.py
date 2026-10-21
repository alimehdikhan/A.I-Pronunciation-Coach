"""Share one attempt with a teacher: a read-only link for 7 days, with text comments and no account needed."""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from backend.api.deps import profile_key
from backend.audio import read_upload, validate_upload
from backend.config import settings
from backend.database import PronunciationRecord, Share, ShareComment, as_utc, get_db, utcnow
from backend.moderation import is_abusive
from backend.repositories import authorize, find_user
from backend.security import RateLimiter, clean_username, client_key

router = APIRouter()
# What a teacher opens from a link: no account needed, the unguessable token is the permission.
public_router = APIRouter()

SHARE_DAYS = 7
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_SNAPSHOT_BYTES = 200_000
MAX_COMMENTS = 50
share_rate_limiter = RateLimiter(settings.rate_limit_per_minute, name="share")
# Comments come from people without an account, so they get a tight budget of their own.
comment_rate_limiter = RateLimiter(5, name="share_comments")

_WORD_KEYS = ("index", "reference", "display", "spoken", "status", "score", "tier", "expected_ipa", "alignment", "misheard", "heard_as")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now():
    return utcnow().replace(tzinfo=None)


def purge_expired(db: Session) -> int:
    """Delete the audio of every expired or revoked share (the comments stay on the attempt)."""
    count = db.execute(
        update(Share)
        .where(Share.audio.is_not(None), (Share.expires_at <= _now()) | Share.revoked.is_(True))
        .values(audio=None, audio_type=None)
        .execution_options(synchronize_session=False)
    ).rowcount
    db.commit()
    return int(count or 0)


def purge_on_startup() -> None:
    """Expired links lose their audio even if nobody opens them again."""
    from backend.database import SessionLocal

    with SessionLocal() as db:
        purge_expired(db)


def _snapshot(record: PronunciationRecord, analysis: dict[str, Any]) -> dict[str, Any]:
    """What the teacher sees: the attempt from the database, plus only the analysis fields listed here. No name."""
    words = analysis.get("words") if isinstance(analysis.get("words"), list) else []
    return {
        "reference_text": record.target_text,
        "transcription": record.transcribed_text,
        "score": record.score,
        "metrics": {k: getattr(record, k) for k in ("pronunciation", "fluency", "completeness", "clarity")},
        "words": [{k: w.get(k) for k in _WORD_KEYS} for w in words[:80] if isinstance(w, dict)],
        "insights": [str(i.get("title", ""))[:200] for i in (analysis.get("insights") or [])[:8] if isinstance(i, dict)],
        "wpm": (analysis.get("speech") or {}).get("wpm") if isinstance(analysis.get("speech"), dict) else None,
        "created_at": as_utc(record.created_at).isoformat() if record.created_at else None,
    }


def _owner(db: Session, username: str, key: str | None):
    user = find_user(db, clean_username(username) or "")
    if user is None or not key:
        raise HTTPException(status_code=404, detail="That attempt was not found.")
    authorize(db, user, key)
    return user


@router.post("/api/shares/{username}")
async def create_share(
    username: str,
    request: Request,
    audio: UploadFile = File(...),
    record_id: int = Form(..., ge=1),
    analysis: str = Form("{}", description="The attempt's analysis as shown to the learner (JSON)"),
    consent: bool = Form(False, description="The learner agreed to store this attempt's audio"),
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Store one attempt's audio (with consent) and return a 7-day read-only link for a teacher."""
    if not consent:
        raise HTTPException(status_code=400, detail="Sharing needs your consent to store this recording.")
    share_rate_limiter.check(client_key(request))
    user = _owner(db, username, key)
    record = db.scalar(select(PronunciationRecord).where(PronunciationRecord.id == record_id, PronunciationRecord.user_id == user.id))
    if record is None:
        raise HTTPException(status_code=404, detail="That attempt was not found.")
    if len(analysis) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(status_code=413, detail="That analysis is too large to share.")
    try:
        parsed = json.loads(analysis)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="The analysis must be JSON.") from exc
    validate_upload(audio)
    data = await read_upload(audio, MAX_AUDIO_BYTES)
    token = secrets.token_urlsafe(24)
    share = Share(
        token_hash=_hash(token),
        user_id=user.id,
        record_id=record.id,
        audio=data,
        audio_type=audio.content_type or "audio/wav",
        snapshot=json.dumps(_snapshot(record, parsed if isinstance(parsed, dict) else {}), ensure_ascii=False),
        consent_at=_now(),
        expires_at=_now() + timedelta(days=SHARE_DAYS),
    )
    db.add(share)
    db.commit()
    return {"token": token, "path": f"/shared/{token}", "expires_at": as_utc(share.expires_at).isoformat(), "id": share.id}


@router.get("/api/shares/{username}")
def list_shares(username: str, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    """The learner's share links: which attempt, until when, and how many comments."""
    user = _owner(db, username, key)
    purge_expired(db)
    shares = db.scalars(select(Share).where(Share.user_id == user.id).order_by(Share.created_at.desc())).all()
    counts = dict(
        db.execute(
            select(ShareComment.share_id, func.count()).where(ShareComment.share_id.in_([s.id for s in shares])).group_by(ShareComment.share_id)
        ).all()
    )
    return {
        "shares": [
            {
                "id": s.id,
                "record_id": s.record_id,
                "expires_at": as_utc(s.expires_at).isoformat(),
                "active": not s.revoked and s.expires_at > _now(),
                "comments": int(counts.get(s.id, 0)),
            }
            for s in shares
        ]
    }


@router.delete("/api/shares/{username}/{share_id}")
def revoke_share(username: str, share_id: int, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Stop a link now and delete its audio. Comments already left stay on the attempt."""
    user = _owner(db, username, key)
    share = db.scalar(select(Share).where(Share.id == share_id, Share.user_id == user.id))
    if share is None:
        raise HTTPException(status_code=404, detail="That link was not found.")
    share.revoked, share.audio, share.audio_type = True, None, None
    db.commit()
    return {"revoked": True}


def _live(db: Session, token: str) -> Share:
    share = db.scalar(select(Share).where(Share.token_hash == _hash(token)))
    if share is None:
        raise HTTPException(status_code=404, detail="This link doesn't exist.")
    if share.revoked or share.expires_at <= _now():
        purge_expired(db)
        raise HTTPException(status_code=410, detail="This link has expired.")
    return share


@public_router.get("/api/shared/{token}")
def view_share(token: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    """The shared attempt, read-only, and the comments left so far."""
    share = _live(db, token)
    comments = db.scalars(select(ShareComment).where(ShareComment.share_id == share.id).order_by(ShareComment.id)).all()
    return {
        "attempt": json.loads(share.snapshot),
        "expires_at": as_utc(share.expires_at).isoformat(),
        "has_audio": share.audio is not None,
        "comments": [{"author": c.author, "text": c.text, "created_at": as_utc(c.created_at).isoformat()} for c in comments],
    }


@public_router.get("/api/shared/{token}/audio")
def share_audio(token: str, db: Session = Depends(get_db)) -> Response:
    share = _live(db, token)
    if share.audio is None:
        raise HTTPException(status_code=404, detail="The recording is no longer available.")
    return Response(content=share.audio, media_type=share.audio_type or "audio/wav", headers={"Cache-Control": "private, no-store"})


class CommentBody(BaseModel):
    author: str | None = Field(default=None, max_length=40)
    text: str = Field(min_length=1, max_length=1000)


@public_router.post("/api/shared/{token}/comments")
def comment_on_share(token: str, body: CommentBody, request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    """A teacher's comment on the shared attempt (no account). Rate-limited and checked for abuse."""
    comment_rate_limiter.check(client_key(request))
    share = _live(db, token)
    text = " ".join(body.text.split())
    author = " ".join((body.author or "").split()) or None
    if not text:
        raise HTTPException(status_code=400, detail="Write a comment first.")
    if is_abusive(text) or (author and is_abusive(author)):
        raise HTTPException(status_code=400, detail="Please keep comments respectful.")
    if db.scalar(select(func.count()).select_from(ShareComment).where(ShareComment.share_id == share.id)) >= MAX_COMMENTS:
        raise HTTPException(status_code=429, detail="This link has reached its comment limit.")
    db.add(ShareComment(share_id=share.id, record_id=share.record_id, author=author, text=text))
    db.commit()
    return {"saved": True}
