"""Real listeners: share a practice recording with other learners (anonymously, with consent), listen to
theirs and type what you hear, and see what real people understood of yours."""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from backend import listeners
from backend.api.deps import profile_key
from backend.audio import read_upload, validate_upload
from backend.config import settings
from backend.database import ListenerAnswer, ListenerClip, PronunciationRecord, as_utc, get_db, utcnow
from backend.errors import CodedHTTPException
from backend.moderation import is_abusive
from backend.repositories import authorize, find_user
from backend.security import RateLimiter, clean_username, client_key

router = APIRouter()
listen_rate_limiter = RateLimiter(settings.rate_limit_per_minute, name="listeners")


def _now():
    return utcnow().replace(tzinfo=None)


def purge_expired(db: Session) -> int:
    """Expired clips lose their audio; the results stay with their owner."""
    count = db.execute(
        update(ListenerClip)
        .where(ListenerClip.audio.is_not(None), ListenerClip.expires_at <= _now())
        .values(audio=None, audio_type=None)
        .execution_options(synchronize_session=False)
    ).rowcount
    db.commit()
    return int(count or 0)


def purge_on_startup() -> None:
    from backend.database import SessionLocal

    with SessionLocal() as db:
        purge_expired(db)


def _account(db: Session, username: str, key: str | None):
    """Only signed-in accounts share or listen: it keeps the pool to real learners."""
    user = find_user(db, clean_username(username) or "")
    if user is None or not key:
        raise CodedHTTPException(403, "Sign in to take part in real-listener tests.", "account_required")
    authorize(db, user, key)
    if user.password_hash is None:
        raise CodedHTTPException(403, "Sign in to take part in real-listener tests.", "account_required")
    return user


def _active(clip: ListenerClip | None) -> bool:
    return clip is not None and not clip.hidden and clip.audio is not None and clip.expires_at > _now()


def _results(db: Session, clip: ListenerClip) -> dict[str, Any]:
    rows = db.scalars(select(ListenerAnswer.words).where(ListenerAnswer.clip_id == clip.id)).all()
    return {
        "id": clip.id,
        "record_id": clip.record_id,
        "text": clip.target_text,
        "created_at": as_utc(clip.created_at).isoformat() if clip.created_at else None,
        "expires_at": as_utc(clip.expires_at).isoformat(),
        "active": _active(clip),
        "hidden": bool(clip.hidden),
        **listeners.summary(clip.target_text, [json.loads(r) for r in rows]),
    }


@router.post("/api/listeners/{username}/clips")
async def share_clip(
    username: str,
    request: Request,
    audio: UploadFile = File(...),
    record_id: int = Form(..., ge=1),
    consent: bool = Form(False, description="The learner agreed to let other learners hear this recording"),
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Store one practice recording (with consent) for other learners to hear, anonymously, for 30 days."""
    if not consent:
        raise HTTPException(status_code=400, detail="Sharing needs your consent.")
    listen_rate_limiter.check(client_key(request))
    user = _account(db, username, key)
    record = db.scalar(select(PronunciationRecord).where(PronunciationRecord.id == record_id, PronunciationRecord.user_id == user.id))
    if record is None or not record.target_text:
        raise HTTPException(status_code=404, detail="That attempt was not found.")
    purge_expired(db)
    mine = db.scalars(select(ListenerClip).where(ListenerClip.user_id == user.id)).all()
    if any(c.record_id == record.id and _active(c) for c in mine):
        raise HTTPException(status_code=409, detail="Real listeners are already hearing this recording.")
    if sum(1 for c in mine if _active(c)) >= listeners.MAX_ACTIVE_CLIPS:
        raise HTTPException(status_code=409, detail=f"You can have {listeners.MAX_ACTIVE_CLIPS} recordings out at once. Delete one first.")
    validate_upload(audio)
    data = await read_upload(audio, listeners.MAX_CLIP_BYTES)
    clip = ListenerClip(
        user_id=user.id, record_id=record.id, target_text=record.target_text[:500], audio=data,
        audio_type=audio.content_type or "audio/wav", consent_at=_now(), expires_at=_now() + timedelta(days=listeners.CLIP_DAYS),
    )
    db.add(clip)
    db.commit()
    return _results(db, clip)


@router.get("/api/listeners/{username}/clips")
def my_clips(username: str, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    """The learner's shared recordings, and what real listeners understood of each."""
    user = _account(db, username, key)
    purge_expired(db)
    clips = db.scalars(select(ListenerClip).where(ListenerClip.user_id == user.id).order_by(ListenerClip.created_at.desc())).all()
    helped = db.scalar(select(func.count()).select_from(ListenerAnswer).where(ListenerAnswer.listener_id == user.id)) or 0
    return {"clips": [_results(db, c) for c in clips], "helped": int(helped)}


@router.delete("/api/listeners/{username}/clips/{clip_id}")
def delete_clip(username: str, clip_id: int, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Stop sharing a recording: its audio and its results are deleted."""
    user = _account(db, username, key)
    clip = db.scalar(select(ListenerClip).where(ListenerClip.id == clip_id, ListenerClip.user_id == user.id))
    if clip is None:
        raise HTTPException(status_code=404, detail="That recording was not found.")
    db.execute(delete(ListenerAnswer).where(ListenerAnswer.clip_id == clip.id))
    db.delete(clip)
    db.commit()
    return {"deleted": True}


@router.get("/api/listeners/{username}/next")
def next_clip(username: str, request: Request, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Someone else's recording this learner hasn't heard yet; the least-heard first."""
    listen_rate_limiter.check(client_key(request))
    user = _account(db, username, key)
    purge_expired(db)
    answered = select(ListenerAnswer.clip_id).where(ListenerAnswer.listener_id == user.id)
    heard = select(func.count()).select_from(ListenerAnswer).where(ListenerAnswer.clip_id == ListenerClip.id).scalar_subquery()
    clip = db.scalar(
        select(ListenerClip)
        .where(
            ListenerClip.user_id != user.id, ListenerClip.hidden.is_(False), ListenerClip.audio.is_not(None),
            ListenerClip.expires_at > _now(), ListenerClip.id.not_in(answered),
        )
        .order_by(heard, ListenerClip.created_at)
        .limit(1)
    )
    helped = db.scalar(select(func.count()).select_from(ListenerAnswer).where(ListenerAnswer.listener_id == user.id)) or 0
    return {"clip": {"id": clip.id, "words": len(listeners.words_of(clip.target_text))} if clip else None, "helped": int(helped)}


@router.get("/api/listeners/{username}/audio/{clip_id}")
def clip_audio(username: str, clip_id: int, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> Response:
    """A shared recording: to its owner, or to a signed-in listener while it is being shared."""
    user = _account(db, username, key)
    clip = db.get(ListenerClip, clip_id)
    if clip is None or clip.audio is None or (clip.user_id != user.id and not _active(clip)):
        raise HTTPException(status_code=404, detail="That recording isn't available.")
    return Response(content=clip.audio, media_type=clip.audio_type or "audio/wav", headers={"Cache-Control": "private, no-store"})


class AnswerBody(BaseModel):
    typed: str = Field(..., min_length=1, max_length=listeners.MAX_TYPED_CHARS)


@router.post("/api/listeners/{username}/answer/{clip_id}")
def answer_clip(
    username: str, clip_id: int, body: AnswerBody, request: Request, key: str | None = Depends(profile_key), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """What this listener heard. The sentence is revealed afterwards, so the listener learns too."""
    listen_rate_limiter.check(client_key(request))
    user = _account(db, username, key)
    clip = db.get(ListenerClip, clip_id)
    if not _active(clip) or clip.user_id == user.id:
        raise HTTPException(status_code=404, detail="That recording isn't available.")
    if db.scalar(select(ListenerAnswer.id).where(ListenerAnswer.clip_id == clip.id, ListenerAnswer.listener_id == user.id)):
        raise HTTPException(status_code=409, detail="You've already listened to this one.")
    typed = " ".join(body.typed.split())
    if not listeners.words_of(typed):
        raise HTTPException(status_code=400, detail="Type the words you heard.")
    words = listeners.safe_words(listeners.compare(clip.target_text, typed), abusive=is_abusive(typed))
    heard = sum(1 for w in words if w["heard"])
    db.add(ListenerAnswer(clip_id=clip.id, listener_id=user.id, words_total=len(words), words_heard=heard, words=json.dumps(words)))
    db.commit()
    return {"text": clip.target_text, "words": words, "heard": heard, "total": len(words)}


@router.post("/api/listeners/{username}/report/{clip_id}")
def report_clip(username: str, clip_id: int, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Something wrong with a recording (not speech, offensive, personal): it stops being played and its audio is deleted."""
    user = _account(db, username, key)
    clip = db.get(ListenerClip, clip_id)
    if clip is None or clip.user_id == user.id:
        raise HTTPException(status_code=404, detail="That recording isn't available.")
    clip.hidden, clip.audio, clip.audio_type = True, None, None
    db.commit()
    return {"reported": True}
