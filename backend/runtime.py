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
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, AsyncIterator

from fastapi import HTTPException

from backend.config import settings
from backend.observability import ASR_REJECTED, ASR_RUNNING, ASR_WAITING

if TYPE_CHECKING:
    from backend.asr import WhisperASR
    from backend.pronunciation import PronunciationScorer
    from backend.tts import CoachVoice

logger = logging.getLogger("pronunciation_coach.runtime")


class WorkGate:
    """Bounded concurrency with a bounded wait queue."""

    def __init__(self, concurrency: int, queue_limit: int):
        self.concurrency = max(1, concurrency)
        self.queue_limit = max(0, queue_limit)
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
            ASR_REJECTED.inc()
            raise HTTPException(
                status_code=503,
                detail="The coach is busy right now. Please try again in a few seconds.",
                headers={"Retry-After": "5"},
            )
        self.waiting += 1
        ASR_WAITING.inc()
        try:
            await semaphore.acquire()
        finally:
            self.waiting -= 1
            ASR_WAITING.dec()
        self.running += 1
        ASR_RUNNING.inc()
        try:
            yield
        finally:
            self.running -= 1
            ASR_RUNNING.dec()
            semaphore.release()


@dataclass
class Runtime:
    asr: WhisperASR | None = None
    scorer: PronunciationScorer | None = None
    voice: CoachVoice | None = None
    db_ready: bool = False
    load_error: str | None = None
    asr_gate: WorkGate = field(default_factory=lambda: WorkGate(settings.asr_concurrency, settings.asr_queue_limit))

    @property
    def models_loaded(self) -> bool:
        return self.asr is not None and self.scorer is not None


runtime = Runtime()


def load_asr() -> None:
    if runtime.asr is not None:
        return
    from backend.asr import WhisperASR

    started = time.perf_counter()
    asr = WhisperASR(
        model_size=settings.whisper_model_size,
        device=settings.asr_device,
        compute_type=settings.asr_compute_type,
        cpu_threads=settings.asr_threads,
        num_workers=settings.asr_concurrency,
        download_root=settings.asr_dir,
        beam_size=settings.asr_beam_size,
    )
    asr.warm_up()
    runtime.asr = asr
    logger.info("Speech recognition ready in %.1fs.", time.perf_counter() - started)


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
    try:
        from backend.tts import CoachVoice

        runtime.voice = CoachVoice(settings.tts_voice)
    except Exception:
        logger.exception("Neural voice unavailable; the frontend will fall back to browser speech.")


async def load_all() -> None:
    """Load models concurrently in worker threads, without blocking the event loop."""
    started = time.perf_counter()
    results = await asyncio.gather(
        asyncio.to_thread(load_asr),
        asyncio.to_thread(load_scorer),
        asyncio.to_thread(load_voice),
        return_exceptions=True,
    )
    errors = [result for result in results if isinstance(result, BaseException)]
    for error in errors:
        logger.error("Model loading failed", exc_info=error)
    runtime.load_error = str(errors[0]) if errors else None
    logger.info("Startup loading finished in %.1fs (models_loaded=%s).", time.perf_counter() - started, runtime.models_loaded)
