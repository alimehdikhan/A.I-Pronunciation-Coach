"""Before and after: five sentences recorded at the start and again later, stored only with consent."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend import baseline
from backend.api.deps import profile_key, require_models
from backend.api.speech import audio_rate_limiter, transcribe_upload
from backend.database import BaselineRecording, as_utc, get_db, utcnow
from backend.observability import StageTimer
from backend.repositories import (
    authorize,
    baseline_rows,
    delete_baseline_audio,
    find_or_create_user,
    find_user,
    save_baseline,
)
from backend.security import clean_username, client_key

logger = logging.getLogger("pronunciation_coach.api.baseline")
router = APIRouter()


def _owner(db: Session, username: str, key: str | None):
    if not key:
        raise HTTPException(status_code=400, detail="A profile key is required for stored recordings.")
    user = find_user(db, clean_username(username) or "")
    if user is None:
        raise HTTPException(status_code=404, detail="No recordings for that name.")
    authorize(db, user, key)
    return user


def _status(rows: list[BaselineRecording]) -> dict[str, Any]:
    rounds = baseline.rounds_of(rows)
    upcoming = baseline.next_round(rounds, utcnow().replace(tzinfo=None))

    def stamp(value):
        return as_utc(value).isoformat() if value else None

    return {
        "sentences": list(baseline.SENTENCES),
        "rounds": [
            {
                **r,
                "finished_at": stamp(r["finished_at"]),
                "sentences": {str(i): {**s, "created_at": stamp(s["created_at"])} for i, s in r["sentences"].items()},
            }
            for r in rounds
        ],
        "next": {**upcoming, "due_at": stamp(upcoming["due_at"])},
        "stored_audio": sum(1 for row in rows if row.audio is not None),
    }


@router.get("/api/baseline/{username}")
def baseline_status(username: str, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    """The rounds recorded so far, their scores, and when the next re-recording is due."""
    user = find_user(db, clean_username(username) or "")
    if user is None:
        return _status([])
    authorize(db, user, key)
    return _status(baseline_rows(db, user))


@router.post("/api/baseline/{username}/record")
async def record_baseline(
    username: str,
    request: Request,
    response: Response,
    audio: UploadFile = File(...),
    sentence_index: int = Form(..., ge=0, lt=len(baseline.SENTENCES)),
    consent: bool = Form(False, description="The learner agreed to store this recording"),
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Score one sentence of the current round and store it with its audio."""
    if not consent:
        raise HTTPException(status_code=400, detail="Storing a recording needs your consent.")
    name = clean_username(username)
    if not name or not key:
        raise HTTPException(status_code=400, detail="A name and profile key are required.")
    audio_rate_limiter.check(client_key(request))
    user = find_or_create_user(db, name, key)
    upcoming = baseline.next_round(baseline.rounds_of(baseline_rows(db, user)), utcnow().replace(tzinfo=None))
    if not upcoming["due"]:
        raise HTTPException(status_code=409, detail="The next recording isn't due yet.")
    asr, scorer = require_models()
    timer = StageTimer()
    target = baseline.SENTENCES[sentence_index]
    heard = await transcribe_upload(audio, asr, timer, phonemes=True)
    data, audio_type = heard.pop("_upload")
    heard.pop("_samples", None)
    text = str(heard.get("text", "")).strip()
    if not text:
        raise HTTPException(status_code=422, detail="We didn't hear any speech. Try that sentence again.")
    if len(data) > baseline.MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="That recording is too long to store.")
    result = await run_in_threadpool(
        scorer.score_pronunciation, target, text, "intermediate", heard.get("words"), heard.get("duration"),
        heard.get("phoneme_log_probs"),
    )
    row = save_baseline(db, user, upcoming["round"], sentence_index, result, data, audio_type)
    response.headers["Server-Timing"] = timer.header()
    return {"id": row.id, "round": row.round, "score": row.score, "transcription": text, "status": _status(baseline_rows(db, user))}


@router.get("/api/baseline/{username}/audio/{recording_id}")
def baseline_audio(
    username: str, recording_id: int, key: str | None = Depends(profile_key), db: Session = Depends(get_db)
) -> Response:
    """A stored recording, to its owner only."""
    user = _owner(db, username, key)
    row = db.scalar(select(BaselineRecording).where(BaselineRecording.id == recording_id, BaselineRecording.user_id == user.id))
    if row is None or row.audio is None:
        raise HTTPException(status_code=404, detail="That recording isn't stored.")
    return Response(content=row.audio, media_type=row.audio_type or "audio/wav", headers={"Cache-Control": "private, no-store"})


@router.delete("/api/baseline/{username}/audio")
def delete_stored_audio(username: str, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Delete every stored recording's audio. The scores stay, so progress is still shown."""
    user = _owner(db, username, key)
    return {"deleted": delete_baseline_audio(db, user)}
