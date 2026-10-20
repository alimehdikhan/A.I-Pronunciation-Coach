"""Listening drills (high variability phonetic training): train the ear on the learner's weakest contrasts."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend import listening
from backend.api.deps import profile_key
from backend.api.speech import QUICK_VOICE, available_voices
from backend.config import settings
from backend.database import get_db
from backend.phoneme_kb import get_phoneme
from backend.repositories import authorize, find_user, mistake_pairs, perception_stats, save_perception
from backend.runtime import get_quick_voice, runtime
from backend.security import RateLimiter, clean_username, client_key

logger = logging.getLogger("pronunciation_coach.api.listening")
router = APIRouter()

listen_rate_limiter = RateLimiter(settings.rate_limit_per_minute, name="listen")


def _warm(clips: list[tuple[str, str]]) -> None:
    """Render the session's clips into the voice cache, in play order, so each trial starts at once."""
    for word, voice in clips:
        try:
            if voice == QUICK_VOICE:
                quick = get_quick_voice()
                if quick is not None:
                    quick.synthesize(word, 1.0)
            elif runtime.voice is not None and runtime.voice_engine == "kokoro":
                runtime.voice.synthesize(word, 1.0, voice)  # type: ignore[call-arg]
        except Exception:
            logger.warning("Could not pre-render %r in %s", word, voice, exc_info=True)
            return


@router.get("/api/listen/session/{username}")
def listening_session(
    username: str,
    request: Request,
    background: BackgroundTasks,
    focus: str | None = Query(None, max_length=8, description="Train this sound instead of the learner's weakest"),
    trials: int = Query(listening.TRIALS, ge=4, le=40),
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """A listening session: one word of a minimal pair per trial, in a different voice each time."""
    listen_rate_limiter.check(client_key(request))
    voices = [v["id"] for v in available_voices()]
    user = find_user(db, clean_username(username) or "")
    mistakes: list[tuple[str, str]] = []
    perception: list[dict[str, Any]] = []
    if user is not None:
        authorize(db, user, key)
        mistakes, perception = mistake_pairs(db, user), perception_stats(db, user)
    if focus and get_phoneme(focus):
        contrasts = listening.contrasts_for(focus)[: listening.MAX_CONTRASTS]
    else:
        contrasts = listening.weakest_contrasts(mistakes, perception=perception)
    session = listening.build_session(contrasts, voices, trials)
    if session:
        background.add_task(_warm, list(dict.fromkeys((t["word"], t["voice"]) for t in session)))
    note = None
    if not voices:
        note = "The app's voices are switched off on this server, so listening drills are not available."
    elif len(voices) < listening.MIN_VOICES:
        note = "Only a few voices are installed. Training works, but hearing more voices helps it carry over to real speech."
    return {
        "contrasts": [c.as_dict() for c in contrasts],
        "trials": session,
        "voices": voices,
        "note": note,
        "perception": perception,
    }


class TrialAnswer(BaseModel):
    phoneme: str = Field(max_length=8)
    other: str = Field(max_length=8)
    word: str = Field(max_length=40)
    chosen: str = Field(max_length=40)
    voice: str | None = Field(default=None, max_length=24)


class ListenResults(BaseModel):
    username: str = Field(default="", max_length=80)
    trials: list[TrialAnswer] = Field(min_length=1, max_length=40)


@router.post("/api/listen/results")
def listening_results(
    request: Request, body: ListenResults, key: str | None = Depends(profile_key), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Store a session's answers (only trials from real minimal pairs) and return per-contrast accuracy."""
    listen_rate_limiter.check(client_key(request))
    known = listening.all_contrasts()
    valid = []
    for t in body.trials:
        contrast = known.get((t.phoneme, t.other))
        if contrast and any({t.word, t.chosen} <= set(pair) for pair in contrast.pairs):
            valid.append(t.model_dump())
    summary: dict[tuple[str, str], list[int]] = {}
    for t in valid:
        tally = summary.setdefault((t["phoneme"], t["other"]), [0, 0])
        tally[0] += 1
        tally[1] += t["word"] == t["chosen"]
    saved = 0
    perception: list[dict[str, Any]] = []
    user = find_user(db, clean_username(body.username) or "") if body.username else None
    if user is not None and valid:
        authorize(db, user, key)
        save_perception(db, user, valid)
        saved = len(valid)
        perception = perception_stats(db, user)
    return {
        "saved": saved,
        "session": [
            {"phoneme": p, "other": o, "trials": n, "correct": c, "accuracy": round(c / n, 3)} for (p, o), (n, c) in summary.items()
        ],
        "perception": perception,
    }
