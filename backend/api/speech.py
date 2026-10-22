"""Speech endpoints: evaluate, transcribe and the coach's voice."""

from __future__ import annotations

import importlib.util
import logging
import os
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from backend import contributions, learners, phonetics
from backend.api.deps import profile_key, require_models
from backend.audio import SAMPLE_RATE, AudioError, decode_audio, normalize_loudness, read_upload, validate_upload
from backend.config import settings
from backend.database import get_db
from backend.enhance import enhance
from backend.observability import StageTimer
from backend.pronunciation import is_careful, said_alone
from backend.repositories import ProfileLocked, RecordNotFound, authorize, find_user, resolve_checks, save_attempt
from backend.runtime import get_fallback_voice, get_quick_voice, runtime
from backend.security import RateLimiter, clean_username, client_key
from backend.stress import annotate as annotate_stress
from backend.tts import KOKORO_VOICE_CATALOG, KOKORO_VOICE_IDS, MAX_RATE, MIN_RATE

logger = logging.getLogger("pronunciation_coach.api.speech")
router = APIRouter()


class _VoiceChoice:
    """One Kokoro voice picked for a single request (the engine itself is shared)."""

    def __init__(self, engine: Any, voice: str):
        self.engine, self.voice = engine, voice

    def cached(self, text: str, rate: float) -> bytes | None:
        return self.engine.cached(text, rate, self.voice)

    def synthesize(self, text: str, rate: float, keep: bool = True, persist: bool | None = None) -> bytes:
        return self.engine.synthesize(text, rate, self.voice, keep=keep, persist=persist)

audio_rate_limiter = RateLimiter(settings.rate_limit_per_minute, name="audio")
# Speech is cheap to serve (cached) and requested often by listen buttons.
tts_rate_limiter = RateLimiter(settings.rate_limit_per_minute * 4, name="tts")


# Shorter than this cannot hold a word; the browser asks for half a second already.
MIN_AUDIO_SECONDS = 0.3


def _prepare(data: bytes, suffix: str, max_seconds: float | None = None):
    samples = decode_audio(data, suffix, max_seconds or settings.max_audio_seconds)
    if len(samples) < MIN_AUDIO_SECONDS * SAMPLE_RATE:
        raise AudioError(400, "That recording was too short to hold a word. Hold the button for the whole phrase.", "too_short")
    cleanup = None
    if settings.noise_cleanup:
        samples, cleanup = enhance(samples, neural=settings.noise_neural)
    samples, gain_db = normalize_loudness(samples)
    return samples, gain_db, cleanup


def _suffix(audio: UploadFile) -> str:
    return os.path.splitext(audio.filename or "")[1].lower() or ".wav"


def _phoneme_posteriors(samples):
    try:
        return runtime.phonemes.log_probs(samples)  # type: ignore[union-attr]
    except Exception:
        # Scoring still works from Whisper's words alone.
        logger.exception("Phoneme recognition failed; scoring from the transcript only")
        return None


async def transcribe_upload(
    audio: UploadFile,
    asr,
    timer: StageTimer,
    *,
    phonemes: bool = False,
    max_seconds: float | None = None,
    prompt: str | None = None,
    background: bool = False,
) -> dict[str, Any]:
    """Read, decode, level and transcribe an upload inside the ASR work gate.

    With ``phonemes=True`` the acoustic phoneme posteriors are added to the
    result as ``phoneme_log_probs`` (when the recogniser is loaded and speech
    was heard). ``max_seconds`` overrides the recording limit (free speaking only);
    ``prompt`` is passed to Whisper (never the target sentence). ``background`` work (a mock interview's
    answers, scored while the interview goes on) lets the interviewer's voice render first. A hosted
    recogniser (backend.groq_asr) works outside the ASR slot: the slot is only held for this server's own work.
    """
    suffix = validate_upload(audio)
    if background:
        await runtime.voice_first.wait()  # before taking the ASR slot, so nobody else waits on the voice
    async with runtime.asr_gate.slot():
        with timer.stage("upload"):
            data = await read_upload(audio, settings.max_upload_bytes)
        with timer.stage("decode"):
            samples, gain_db, cleanup = await run_in_threadpool(_prepare, data, suffix, max_seconds)
    hosted = getattr(asr, "remote", False)

    async def transcribe() -> dict[str, Any]:
        with timer.stage("asr"):
            return await (run_in_threadpool(asr.transcribe, samples, prompt=prompt) if prompt else run_in_threadpool(asr.transcribe, samples))

    result = await transcribe() if hosted else None
    async with runtime.asr_gate.slot():
        if result is None:
            result = await transcribe()
        if phonemes and runtime.phonemes is not None and str(result.get("text", "")).strip():
            if background:
                await runtime.voice_first.wait()
            with timer.stage("phonemes"):
                result["phoneme_log_probs"] = await run_in_threadpool(_phoneme_posteriors, samples)
    result["input_gain_db"] = gain_db
    result["audio_cleanup"] = cleanup
    result["_samples"] = samples  # for the word-stress check; never sent to the client
    result["_upload"] = (data, audio.content_type or "audio/wav")  # stored only for features the learner opted into
    return result


@router.post("/api/evaluate")
async def evaluate_pronunciation(
    request: Request,
    response: Response,
    background: BackgroundTasks,
    audio: UploadFile = File(...),
    target_text: str | None = Form(None),
    username: str | None = Form(None),
    difficulty: str | None = Form("intermediate"),
    natural_speed: bool = Form(False, description="Careful (slow) speech doesn't count toward mastery or goals"),
    stress: bool = Form(False, description="Experimental: check which syllable of each long word was stressed"),
    accent: str = Form("american", pattern="^(american|british)$", description="Target accent; british also accepts non-rhotic forms"),
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
    learner = find_user(db, name) if name else None
    # Speakers of a language with a trained sound model are judged by it (backend.sound_model).
    model = learners.sound_model_for(learner.first_language if learner else None)
    db.commit()  # end the read before transcription, which can take a while
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
                accent,
                model,
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error processing audio in /api/evaluate")
        raise HTTPException(status_code=500, detail="Error processing audio. See server logs for details.") from exc

    samples = transcription.pop("_samples", None)
    upload = transcription.pop("_upload", None)
    if stress and samples is not None:
        with timer.stage("stress"):
            found = await run_in_threadpool(annotate_stress, score_result["words"], samples)
        score_result["insights"] = (score_result["insights"] + found)[:8]
    careful = is_careful(score_result["speech"], settings.careful_wpm)
    score_result["speech"].update(careful=careful, careful_below=settings.careful_wpm)
    counted = not (natural_speed and careful)
    record_id: int | None = None
    save_error: str | None = None
    # "Help improve Vocaly AI": a clean recording of one of the app's own sentences is kept for training.
    clip: tuple[str, Any, dict[str, Any]] | None = None
    if name and text and contributions.giving(db, learner, reference_text):
        with timer.stage("quality"):
            raw, checks = await run_in_threadpool(contributions.assess_upload, upload, _suffix(audio), score_result)
        if raw is not None and checks["usable"]:
            clip = (contributions.new_clip_id(), raw, checks)
    # Silent or unintelligible clips aren't attempts; keep them out of history.
    if name and text:
        with timer.stage("save"):
            try:
                record_id = await run_in_threadpool(
                    save_attempt, db, name, key, reference_text, text, score_result, counted, clip[0] if clip else None
                )
            except ProfileLocked:
                db.rollback()
                save_error = "profile_locked"
            except Exception:
                # Feedback is still useful when history can't be stored.
                db.rollback()
                save_error = "storage_error"
                logger.exception("Failed to save attempt for user %r", name)

    contributed = clip is not None and record_id is not None and learner is not None
    if contributed:
        meta = contributions.describe(
            clip[0], learner.contributor_id, text=reference_text, transcript=text, first_language=learner.first_language,
            accent=accent, difficulty=score_result.get("difficulty", "intermediate"), result=score_result, checks=clip[2],
            sound_model=model.profile if model else None,
            phoneme_model=runtime.phonemes.description if runtime.phonemes is not None else None,
        )
        background.add_task(contributions.keep, clip[1], meta)  # written after the response is sent

    response.headers["Server-Timing"] = timer.header()
    body: dict[str, Any] = {
        "success": True,
        "transcription": text,
        "reference_text": reference_text,
        "record_id": record_id,
        "saved": record_id is not None,
        # The recording was kept to help improve the scorer (the learner turned this on).
        "contributed": contributed,
        # False when "natural speed" is on and this was careful speech: shown, but not counted.
        "counted": counted,
        # Nothing was heard: the UI explains it (microphone, volume) instead of showing empty results.
        "no_speech": not text,
        "audio_cleanup": transcription.get("audio_cleanup"),
        **score_result,
    }
    if save_error:
        body["save_error"] = save_error
    return body


@router.post("/api/evaluate/confirm")
async def confirm_word(
    request: Request,
    response: Response,
    audio: UploadFile = File(...),
    word: str = Form(..., max_length=40),
    phonemes: str = Form(..., max_length=60, description="Comma-separated borderline sounds to check, e.g. 'θ,ɪ'"),
    record_id: int | None = Form(None),
    username: str | None = Form(None),
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Say one "Worth checking" word alone: is the borderline sound a real slip?

    Scored with the same pipeline as /api/evaluate, with the word as the target. No new
    attempt is saved; when `record_id` is the learner's own attempt, its borderline sounds
    in this word are replaced by the verdict.
    """
    target = " ".join(word.split())
    if len(phonetics.tokenize(target)) != 1:
        raise HTTPException(status_code=400, detail="word must be a single word.")
    sounds = [p.strip() for p in phonemes.split(",") if p.strip()][:6]
    if not sounds or any(len(p) > 8 for p in sounds):
        raise HTTPException(status_code=400, detail="phonemes must list the sounds to check.")
    name = clean_username(username)
    audio_rate_limiter.check(client_key(request))
    asr, scorer = require_models()
    base: dict[str, Any] = {"word": target, "updated": 0}
    if runtime.phonemes is None or scorer.inventory is None:
        # Without the sound model there are no borderline slips to check.
        return {**base, "verdict": "unavailable", "sounds": [], "transcription": "", "result": None}

    timer = StageTimer()
    try:
        transcription = await transcribe_upload(audio, asr, timer, phonemes=True)
        text = str(transcription.get("text", "")).strip()
        with timer.stage("score"):
            scored = await run_in_threadpool(
                scorer.score_pronunciation,
                target,
                text,
                "intermediate",
                transcription.get("words"),
                transcription.get("duration"),
                transcription.get("phoneme_log_probs"),
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error processing audio in /api/evaluate/confirm")
        raise HTTPException(status_code=500, detail="Error processing audio. See server logs for details.") from exc

    entry = next((w for w in scored["words"] if w["reference"]), None)
    spoken = entry is not None and entry["status"] != "missing" and bool(entry.get("phonemes"))
    verdicts = said_alone(entry if spoken else None, sounds)
    kinds = {v["verdict"] for v in verdicts}
    verdict = "slip" if "slip" in kinds else "unheard" if "unheard" in kinds else "fine"

    updated = 0
    if name and record_id is not None and verdict != "unheard":
        user = find_user(db, name)
        if user is None:
            raise HTTPException(status_code=404, detail="That attempt was not found.")
        authorize(db, user, key)
        try:
            with timer.stage("save"):
                updated = await run_in_threadpool(
                    resolve_checks,
                    db,
                    user,
                    record_id,
                    target,
                    {v["phoneme"]: (v["verdict"], v["alternative"] or "") for v in verdicts},
                )
        except RecordNotFound as exc:
            raise HTTPException(status_code=404, detail="That attempt was not found.") from exc
    response.headers["Server-Timing"] = timer.header()
    return {**base, "verdict": verdict, "sounds": verdicts, "updated": updated, "transcription": text, "result": entry}


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
    voices = available_voices()
    return {"engine": runtime.voice_engine, "default": voices[0]["id"] if voices else None, "voices": voices}


def available_voices() -> list[dict[str, str]]:
    """Every voice /api/tts can speak with right now (none when speech is off)."""
    engine = runtime.voice_engine
    voices: list[dict[str, str]] = []
    if runtime.voice is None:
        return voices
    if engine == "kokoro":
        voices = [{"id": i, "name": n, "accent": a, "gender": g, "speed": "natural"} for i, n, a, g in KOKORO_VOICE_CATALOG]
    if engine == "piper" or (engine == "kokoro" and importlib.util.find_spec("piper") is not None):
        voices.append({"id": QUICK_VOICE, "name": "Quick", "accent": "American", "gender": "female", "speed": "instant"})
    return voices


@router.get("/api/tts")
async def text_to_speech(
    request: Request,
    text: str = Query(..., min_length=1, max_length=settings.max_tts_chars),
    rate: float = Query(1.0, ge=MIN_RATE, le=MAX_RATE),
    voice_id: str | None = Query(None, alias="voice", pattern=r"^[a-z0-9_]{2,24}$"),
    once: bool = Query(False, description="One-off text (a live reply): rendered, never cached"),
    store: str = Query("disk", pattern="^(disk|memory|none)$", description="Where the clip may be kept"),
) -> Response:
    """The coach's voice as real audio (WAV), so the UI can analyse what it plays.

    Clips already rendered come straight back. A new one waits its turn to render (runtime.tts_gate,
    503 when the queue is full) and goes before background scoring (runtime.VoiceFirst). Only reusable
    text is kept: `store=disk` (the default) for text any learner may hear again, `store=memory` for text
    reused within one session (an interview's questions, worded for its job), and `store=none` (or `once`)
    for one-off text, which is rendered for that moment and stored nowhere. No clip may be kept by a
    shared cache, since the text can be the learner's own.
    """
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
    if once:
        store = "none"
    keep, persist = store != "none", store == "disk"
    headers = {"Cache-Control": "private, max-age=604800" if keep else "private, no-store"}
    audio = voice.cached(clean, rate)
    if audio is not None:
        return Response(content=audio, media_type="audio/wav", headers=headers)
    try:
        async with runtime.tts_gate.slot(), runtime.voice_first.speaking():
            audio = await run_in_threadpool(voice.synthesize, clean, rate, keep=keep, persist=persist)
    except HTTPException:
        raise  # busy: the browser tries again shortly
    except Exception as exc:
        logger.exception("Speech synthesis failed with the %s voice", runtime.voice_engine)
        fallback = await run_in_threadpool(get_fallback_voice)
        if fallback is None:
            raise HTTPException(status_code=500, detail="Speech synthesis failed.") from exc
        try:
            audio = await run_in_threadpool(fallback.synthesize, clean, rate, keep=keep, persist=persist)
        except Exception as fallback_exc:
            logger.exception("Fallback voice failed too")
            raise HTTPException(status_code=500, detail="Speech synthesis failed.") from fallback_exc
        # Not immutable: the primary voice may work next time and sound better.
        headers = {"Cache-Control": "no-store", "X-Voice-Fallback": "piper"}
    return Response(content=audio, media_type="audio/wav", headers=headers)
