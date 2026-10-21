"""Fast transcription for the live interviewer: what the candidate just said, in about a second.

The interviewer needs the words of an answer before it can follow up, and the local Whisper on a
small CPU server takes many seconds per answer (and waits behind answers still being scored). So a
turn is transcribed by Groq's hosted Whisper (`whisper-large-v3-turbo`), which returns a minute of
speech in well under a second. Without a Groq key, or when Groq fails, the local Whisper does it.

Only the words are used here. The full scoring of the same answer (pace, pauses, sound slips) still
runs locally, in the background.
"""

from __future__ import annotations

import io
import logging
import wave
from typing import Any

import httpx
import numpy as np

from backend.config import settings

logger = logging.getLogger("pronunciation_coach.quick_transcribe")

GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
SAMPLE_RATE = 16_000
# Whisper invents words over silence ("Thank you."): a segment it thinks is probably not speech is dropped.
NO_SPEECH_PROB = 0.6

_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=15.0)
    return _client


def wav_bytes(samples: np.ndarray) -> bytes:
    """16 kHz mono 16-bit WAV: small, and every speech service reads it."""
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        out.writeframes(pcm.tobytes())
    return buffer.getvalue()


def spoken_text(data: dict[str, Any]) -> str:
    """The transcript without the segments Whisper itself thinks were silence."""
    segments = data.get("segments")
    if not isinstance(segments, list) or not segments:
        return " ".join(str(data.get("text") or "").split())
    kept = [
        str(s.get("text") or "").strip()
        for s in segments
        if isinstance(s, dict) and float(s.get("no_speech_prob") or 0) < NO_SPEECH_PROB
    ]
    return " ".join(" ".join(kept).split())


async def groq_transcribe(samples: np.ndarray) -> str:
    """The words, from Groq's hosted Whisper. Raises on any failure."""
    response = await _http().post(
        GROQ_TRANSCRIBE_URL,
        headers={"Authorization": f"Bearer {settings.groq_api_key}"},
        data={"model": settings.turn_asr_model, "language": "en", "temperature": "0", "response_format": "verbose_json"},
        files={"file": ("answer.wav", wav_bytes(samples), "audio/wav")},
    )
    response.raise_for_status()
    return spoken_text(response.json())


async def transcribe(samples: np.ndarray, local) -> tuple[str, str]:
    """(text, source): Groq when it is set up and answers, the local Whisper (`local(samples)`) otherwise."""
    if settings.groq_api_key and settings.turn_asr_model:
        try:
            return await groq_transcribe(samples), "groq"
        except Exception as exc:
            # Never log the key or the response body; the class name is enough to diagnose.
            logger.warning("Quick transcription unavailable (%s); using the local Whisper.", type(exc).__name__)
    result = await local(samples)
    return " ".join(str(result.get("text") or "").split()), "local"
