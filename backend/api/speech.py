"""Speech endpoints: evaluate, transcribe and the coach's voice."""

from __future__ import annotations

import importlib.util
import logging
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from backend import phonetics
from backend.api.deps import profile_key, require_models
from backend.audio import decode_audio, normalize_loudness, read_upload, validate_upload
from backend.config import settings
from backend.database import get_db
from backend.enhance import enhance
from backend.observability import StageTimer
from backend.repositories import ProfileLocked, save_attempt
from backend.runtime import get_fallback_voice, get_quick_voice, runtime
from backend.security import RateLimiter, clean_username, client_key
from backend.tts import KOKORO_VOICE_CATALOG, KOKORO_VOICE_IDS, MAX_RATE, MIN_RATE

logger = logging.getLogger("pronunciation_coach.api.speech")
router = APIRouter()


class _VoiceChoice:
    """One Kokoro voice picked for a single request (the engine itself is shared)."""

    def __init__(self, engine: Any, voice: str):
        self.engine, self.voice = engine, voice

    def synthesize(self, text: str, rate: float) -> bytes:
        return self.engine.synthesize(text, rate, self.voice)

audio_rate_limiter = RateLimiter(settings.rate_limit_per_minute, name="audio")
# Speech is cheap to serve (cached) and requested often by listen buttons.
tts_rate_limiter = RateLimiter(settings.rate_limit_per_minute * 4, name="tts")


def _prepare(data: bytes, suffix: str):
    samples = decode_audio(data, suffix, settings.max_audio_seconds)
    cleanup = None
    if settings.noise_cleanup:
        samples, cleanup = enhance(samples, neural=settings.noise_neural)
    samples, gain_db = normalize_loudness(samples)
    return samples, gain_db, cleanup


def _phoneme_posteriors(samples):
    try:
        return runtime.phonemes.log_probs(samples)  # type: ignore[union-attr]
    except Exception:
        # Scoring still works from Whisper's words alone.
        logger.exception("Phoneme recognition failed; scoring from the transcript only")
        return None


async def transcribe_upload(audio: UploadFile, asr, timer: StageTimer, *, phonemes: bool = False) -> dict[str, Any]:
    """Read, decode, level and transcribe an upload inside the ASR work gate.

    With ``phonemes=True`` the acoustic phoneme posteriors are added to the
    result as ``phoneme_log_probs`` (when the recogniser is loaded and speech
    was heard).
    """
    suffix = validate_upload(audio)
    async with runtime.asr_gate.slot():
        with timer.stage("upload"):
            data = await read_upload(audio, settings.max_upload_bytes)
        with timer.stage("decode"):
            samples, gain_db, cleanup = await run_in_threadpool(_prepare, data, suffix)
        with timer.stage("asr"):
            result = await run_in_threadpool(asr.transcribe, samples)
        if phonemes and runtime.phonemes is not None and str(result.get("text", "")).strip():
            with timer.stage("phonemes"):
                result["phoneme_log_probs"] = await run_in_threadpool(_phoneme_posteriors, samples)
    result["input_gain_db"] = gain_db
    result["audio_cleanup"] = cleanup
    return result


@router.post("/api/evaluate")
async def evaluate_pronunciation(
    request: Request,
    response: Response,
    audio: UploadFile = File(...),
    target_text: str | None = Form(None),
    username: str | None = Form(None),
    difficulty: str | None = Form("intermediate"),
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Evaluate pronunciation from an audio file against a required target text."""
    reference_text = (target_text or "").strip()
    if not reference_text:
        raise HTTPException(status_code=400, detail="target_text is required for pronunciation evaluation.")
    if len(reference_text) > settings.max_target_chars:
        raise HTTPException(status_code=400, detail=f"target_text must be at most {settings.max_target_chars} characters.")
    if not phonetics.tokenize(reference_text):
        raise HTTPException(status_code=400, detail="target_text must contain at least one word.")
    name = clean_username(username)

    audio_rate_limiter.check(client_key(request))
    asr, scorer = require_models()
    timer = StageTimer()
    try:
        transcription = await transcribe_upload(audio, asr, timer, phonemes=True)
        text = str(transcription.get("text", "")).strip()
        with timer.stage("score"):
            score_result = await run_in_threadpool(
                scorer.score_pronunciation,
                reference_text,
                text,
                difficulty,
                transcription.get("words"),
                transcription.get("duration"),
                transcription.get("phoneme_log_probs"),
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error processing audio in /api/evaluate")
        raise HTTPException(status_code=500, detail="Error processing audio. See server logs for details.") from exc

    record_id: int | None = None
    save_error: str | None = None
    # Silent or unintelligible clips aren't attempts; keep them out of history.
    if name and text:
        with timer.stage("save"):
            try:
                record_id = await run_in_threadpool(save_attempt, db, name, key, reference_text, text, score_result)
            except ProfileLocked:
                db.rollback()
                save_error = "profile_locked"
            except Exception:
                # Feedback is still useful when history can't be stored.
                db.rollback()
                save_error = "storage_error"
                logger.exception("Failed to save attempt for user %r", name)

    response.headers["Server-Timing"] = timer.header()
    body: dict[str, Any] = {
        "success": True,
        "transcription": text,
        "reference_text": reference_text,
        "record_id": record_id,
        "saved": record_id is not None,
        "audio_cleanup": transcription.get("audio_cleanup"),
        **score_result,
    }
    if save_error:
        body["save_error"] = save_error
    return body


@router.post("/api/transcribe")
async def transcribe_audio(request: Request, response: Response, audio: UploadFile = File(...)) -> dict[str, Any]:
    """Transcribe an audio file without pronunciation evaluation."""
    audio_rate_limiter.check(client_key(request))
    asr, _ = require_models()
    timer = StageTimer()
    try:
        result = await transcribe_upload(audio, asr, timer)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error in /api/transcribe")
        raise HTTPException(status_code=500, detail="Error transcribing audio. See server logs for details.") from exc
    response.headers["Server-Timing"] = timer.header()
    return {
        "success": True,
        "transcription": str(result.get("text", "")).strip(),
        "language": result.get("language", "en"),
        "words": result.get("words", []),
        "duration": result.get("duration"),
    }


QUICK_VOICE = "piper"


@router.get("/api/voices")
async def list_voices() -> dict[str, Any]:
    """The coach voices the app offers; the first is the default."""
    engine = runtime.voice_engine
    voices: list[dict[str, str]] = []
    if engine == "kokoro":
        voices = [{"id": i, "name": n, "accent": a, "gender": g, "speed": "natural"} for i, n, a, g in KOKORO_VOICE_CATALOG]
    if engine == "piper" or (engine == "kokoro" and importlib.util.find_spec("piper") is not None):
        voices.append({"id": QUICK_VOICE, "name": "Quick", "accent": "American", "gender": "female", "speed": "instant"})
    return {"engine": engine, "default": voices[0]["id"] if voices else None, "voices": voices}


@router.get("/api/tts")
async def text_to_speech(
    request: Request,
    text: str = Query(..., min_length=1, max_length=settings.max_tts_chars),
    rate: float = Query(1.0, ge=MIN_RATE, le=MAX_RATE),
    voice_id: str | None = Query(None, alias="voice", pattern=r"^[a-z0-9_]{2,24}$"),
) -> Response:
    """The coach's voice as real audio (WAV), so the UI can analyse what it plays."""
    voice = runtime.voice
    if voice is None:
        raise HTTPException(status_code=503, detail="The neural voice is not available.")
    quick = await run_in_threadpool(get_quick_voice) if voice_id == QUICK_VOICE else None  # may load Piper once
    if quick is not None:
        voice = quick
    elif runtime.voice_engine == "kokoro" and voice_id in KOKORO_VOICE_IDS:
        voice = _VoiceChoice(voice, voice_id)
    clean = " ".join(text.split())
    if not phonetics.tokenize(clean):
        raise HTTPException(status_code=400, detail="text must contain at least one word.")
    tts_rate_limiter.check(client_key(request))
    headers = {"Cache-Control": "public, max-age=604800, immutable"}
    try:
        audio = await run_in_threadpool(voice.synthesize, clean, rate)
    except Exception as exc:
        logger.exception("Speech synthesis failed with the %s voice", runtime.voice_engine)
        fallback = await run_in_threadpool(get_fallback_voice)
        if fallback is None:
            raise HTTPException(status_code=500, detail="Speech synthesis failed.") from exc
        try:
            audio = await run_in_threadpool(fallback.synthesize, clean, rate)
        except Exception as fallback_exc:
            logger.exception("Fallback voice failed too")
            raise HTTPException(status_code=500, detail="Speech synthesis failed.") from fallback_exc
        # Not immutable: the primary voice may work next time and sound better.
        headers = {"Cache-Control": "no-store", "X-Voice-Fallback": "piper"}
    return Response(content=audio, media_type="audio/wav", headers=headers)
