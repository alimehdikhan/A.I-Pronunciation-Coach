"""
Process-wide runtime state: the loaded models and the transcription work gate.

Whisper saturates the CPU, so running many transcriptions at once only makes
every request slower. The gate runs a fixed number at a time, queues a few
more, and turns the rest away quickly with 503 + Retry-After instead of
letting latency and memory grow without bound.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, AsyncIterator

from backend.config import settings
from backend.errors import CodedHTTPException
from backend.observability import ASR_REJECTED, ASR_RUNNING, ASR_WAITING

if TYPE_CHECKING:
    from backend.asr import WhisperASR
    from backend.coach import CoachService
    from backend.phoneme_model import PhonemeRecognizer
    from backend.pronunciation import PronunciationScorer
    from backend.tts import CoachVoice

logger = logging.getLogger("pronunciation_coach.runtime")


class WorkGate:
    """Bounded concurrency with a bounded wait queue. `observe`: count it in the ASR metrics."""

    def __init__(self, concurrency: int, queue_limit: int, observe: bool = True):
        self.concurrency = max(1, concurrency)
        self.queue_limit = max(0, queue_limit)
        self.observe = observe
        self.waiting = 0
        self.running = 0
        self._semaphore: asyncio.Semaphore | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def _get_semaphore(self) -> asyncio.Semaphore:
        loop = asyncio.get_running_loop()
        if self._semaphore is None or self._loop is not loop:
            self._semaphore = asyncio.Semaphore(self.concurrency)
            self._loop = loop
        return self._semaphore

    @asynccontextmanager
    async def slot(self) -> AsyncIterator[None]:
        semaphore = self._get_semaphore()
        if self.running >= self.concurrency and self.waiting >= self.queue_limit:
            if self.observe:
                ASR_REJECTED.inc()
            raise CodedHTTPException(
                503, "The coach is busy right now. Please try again in a few seconds.", "busy", {"Retry-After": "5"}
            )
        self.waiting += 1
        if self.observe:
            ASR_WAITING.inc()
        try:
            await semaphore.acquire()
        finally:
            self.waiting -= 1
            if self.observe:
                ASR_WAITING.dec()
        self.running += 1
        if self.observe:
            ASR_RUNNING.inc()
        try:
            yield
        finally:
            self.running -= 1
            if self.observe:
                ASR_RUNNING.dec()
            semaphore.release()


class VoiceFirst:
    """The interviewer's voice goes before background scoring.

    On a small CPU, rendering a line and scoring an answer at the same time makes both about twice as
    slow, and the candidate hears the slowness as a silence. While a line is being rendered, background
    scoring waits before each heavy step (for at most ``max_wait`` seconds: a line takes a second or two).
    """

    def __init__(self, max_wait: float = 4.0):
        self.max_wait = max_wait
        self.rendering = 0
        self._idle: asyncio.Event | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def _event(self) -> asyncio.Event:
        loop = asyncio.get_running_loop()
        if self._idle is None or self._loop is not loop:
            self._idle = asyncio.Event()
            self._loop = loop
            if self.rendering == 0:
                self._idle.set()
        return self._idle

    @asynccontextmanager
    async def speaking(self) -> AsyncIterator[None]:
        """Hold while a line is rendered."""
        idle = self._event()
        self.rendering += 1
        idle.clear()
        try:
            yield
        finally:
            self.rendering -= 1
            if self.rendering == 0:
                idle.set()

    async def wait(self) -> None:
        """Before a heavy step of background work: let any line being rendered finish first."""
        idle = self._event()
        if idle.is_set():
            return
        try:
            await asyncio.wait_for(idle.wait(), self.max_wait)
        except asyncio.TimeoutError:
            pass


@dataclass
class Runtime:
    asr: WhisperASR | None = None
    # The local faster-whisper model: the recogniser without a Groq key, and Groq's fallback (get_local_asr).
    local_asr: WhisperASR | None = None
    scorer: PronunciationScorer | None = None
    voice: CoachVoice | None = None
    voice_engine: str | None = None
    # Piper, created only if the primary voice fails while serving a request.
    fallback_voice: CoachVoice | None = None
    coach: CoachService | None = None
    phonemes: PhonemeRecognizer | None = None
    db_ready: bool = False
    load_error: str | None = None
    asr_gate: WorkGate = field(default_factory=lambda: WorkGate(settings.asr_concurrency, settings.asr_queue_limit))
    voice_first: VoiceFirst = field(default_factory=VoiceFirst)
    # Rendering speech, one clip at a time (the voice renders one at a time anyway); clips already rendered skip it.
    tts_gate: WorkGate = field(default_factory=lambda: WorkGate(1, settings.tts_queue_limit, observe=False))

    @property
    def models_loaded(self) -> bool:
        return self.asr is not None and self.scorer is not None


runtime = Runtime()


def get_coach() -> CoachService:
    """The coaching service (created on first use; templates only when no API key is set)."""
    if runtime.coach is None:
        from backend.coach import CoachService

        runtime.coach = CoachService(
            settings.groq_api_key,
            settings.groq_model,
            timeout=settings.llm_timeout,
            fallback_models=settings.groq_fallback_models,
        )
    return runtime.coach


def asr_engine() -> str:
    """"groq" (hosted Whisper large, nothing loaded here) when a Groq key is set, unless "local" is asked for."""
    if settings.asr_engine == "local" or not settings.groq_api_key or not settings.groq_asr_model:
        return "local"
    return "groq"


def _build_local_asr() -> WhisperASR:
    from backend.asr import WhisperASR

    started = time.perf_counter()
    size = settings.asr_fallback_model if asr_engine() == "groq" else settings.whisper_model_size
    asr = WhisperASR(
        model_size=size,
        device=settings.asr_device,
        compute_type=settings.asr_compute_type,
        cpu_threads=settings.asr_threads,
        num_workers=settings.asr_concurrency,
        download_root=settings.asr_dir,
        beam_size=settings.asr_beam_size,
    )
    asr.warm_up()
    logger.info("Local Whisper %s ready in %.1fs.", size, time.perf_counter() - started)
    return asr


_local_asr_lock = threading.Lock()
_local_asr_missing = False


def get_local_asr() -> WhisperASR | None:
    """The local faster-whisper model, loaded on first use: the recogniser without a Groq key, and the fallback
    when Groq fails or its limit is reached. It takes no memory while Groq works. None when it can't load."""
    global _local_asr_missing
    if runtime.local_asr is not None or _local_asr_missing:
        return runtime.local_asr
    with _local_asr_lock:
        if runtime.local_asr is None and not _local_asr_missing:
            try:
                runtime.local_asr = _build_local_asr()
            except Exception:
                _local_asr_missing = True
                logger.exception("The local Whisper can't load, so nothing can stand in for Groq.")
        return runtime.local_asr


def load_asr() -> None:
    if runtime.asr is not None:
        return
    if asr_engine() == "groq":
        from backend.groq_asr import GroqWhisper

        started = time.perf_counter()
        hosted = GroqWhisper(settings.groq_asr_model, settings.groq_api_key, fallback=get_local_asr)
        hosted.warm_up()
        runtime.asr = hosted
        logger.info(
            "Speech recognition: Groq %s, ready in %.1fs; the local Whisper loads only if Groq fails.",
            settings.groq_asr_model, time.perf_counter() - started,
        )
        return
    runtime.asr = get_local_asr()
    if runtime.asr is None:
        raise RuntimeError("No speech recognition: set GROQ_API_KEY, or install faster-whisper and its model.")


def load_phonemes() -> None:
    """The acoustic phoneme recogniser is optional: without it, scoring uses Whisper's words only."""
    if runtime.phonemes is not None or not settings.phoneme_scoring:
        return
    from backend.phoneme_model import PhonemeRecognizer, model_available

    if not model_available(settings.phoneme_model_dir):
        logger.warning(
            "Phoneme model not found in %s; scoring will use Whisper's words only. "
            "Build it with scripts/export_phoneme_model.py.",
            settings.phoneme_model_dir,
        )
        return
    try:
        recognizer = PhonemeRecognizer(settings.phoneme_model_dir, threads=settings.phoneme_threads)
        recognizer.warm_up()
        runtime.phonemes = recognizer
    except Exception:
        logger.exception("Phoneme model failed to load; scoring will use Whisper's words only.")


_fallback_lock = threading.Lock()


def get_fallback_voice() -> CoachVoice | None:
    """Piper, built on first use. None when it is not installed or the primary already is Piper."""
    if runtime.voice_engine == "piper" or not settings.tts_enabled:
        return None
    with _fallback_lock:
        if runtime.fallback_voice is None:
            try:
                from backend.tts import CoachVoice

                runtime.fallback_voice = CoachVoice(settings.tts_voice)
                logger.warning("Primary voice failed; loaded the Piper fallback.")
            except Exception:
                logger.exception("Piper fallback voice is not available.")
                return None
        return runtime.fallback_voice


def get_quick_voice() -> CoachVoice | None:
    """The Piper voice: the fast option (about a quarter of a second per clip), whatever the primary is."""
    if runtime.voice_engine == "piper":
        return runtime.voice
    return get_fallback_voice()


def load_scorer() -> None:
    if runtime.scorer is not None:
        return
    from backend.pronunciation import PronunciationScorer

    runtime.scorer = PronunciationScorer(language=settings.language)
    logger.info("Pronunciation scorer ready (%s).", settings.language)


def load_voice() -> None:
    """The neural coach voice is optional: the frontend falls back to browser speech."""
    if runtime.voice is not None or not settings.tts_enabled:
        return
    from backend.tts import CoachVoice, KokoroVoice, kokoro_available

    if settings.tts_engine in ("auto", "kokoro") and kokoro_available():
        try:
            runtime.voice = KokoroVoice(settings.kokoro_voice, threads=settings.kokoro_threads)
            runtime.voice_engine = "kokoro"
            runtime.voice.warm_up()
            return
        except Exception:
            logger.exception("Kokoro unavailable; using Piper instead.")
    if settings.tts_engine == "kokoro":
        logger.warning("PRONUNCIATION_COACH_TTS_ENGINE=kokoro but Kokoro could not be loaded; using Piper.")
    try:
        runtime.voice = CoachVoice(settings.tts_voice)
        runtime.voice_engine = "piper"
    except Exception:
        logger.exception("Neural voice unavailable; the frontend will fall back to browser speech.")


async def load_all() -> None:
    """Load models concurrently in worker threads, without blocking the event loop."""
    started = time.perf_counter()
    results = await asyncio.gather(
        asyncio.to_thread(load_asr),
        asyncio.to_thread(load_scorer),
        asyncio.to_thread(load_voice),
        asyncio.to_thread(load_phonemes),
        return_exceptions=True,
    )
    errors = [result for result in results if isinstance(result, BaseException)]
    for error in errors:
        logger.error("Model loading failed", exc_info=error)
    runtime.load_error = str(errors[0]) if errors else None
    if runtime.scorer is not None and runtime.phonemes is not None:
        runtime.scorer.inventory = runtime.phonemes.inventory
    logger.info("Startup loading finished in %.1fs (models_loaded=%s).", time.perf_counter() - started, runtime.models_loaded)
