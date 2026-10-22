"""
Speech recognition with Groq's hosted Whisper large (whisper-large-v3).

A minute of speech comes back, word by word with timings, in a second or two, and none of the work is done
on this server's CPU. It replaces the local faster-whisper model whenever a Groq key is set
(settings.asr_engine), with the same interface (`transcribe`). Two things the hosted service does not do are
done here:

* Whisper invents words over silence ("Thank you."). Silero's speech detector (shipped with faster-whisper;
  a few milliseconds a second of audio, no Whisper model involved) finds where someone is speaking: a
  recording with no speech is never sent, and a word outside every stretch of speech is dropped.
* It reports no confidence per word, so each word's `probability` is None, and the scorer leaves out what
  depends on it.

When Groq can't answer (its limit is reached, or it is down), the local faster-whisper model takes over:
loaded on first need (runtime.get_local_asr), one transcription at a time, and Groq is left alone for a
while (its Retry-After, or HOSTED_PAUSE_SECONDS) instead of failing on every request.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable

import httpx
import numpy as np

from backend.audio import SAMPLE_RATE
from backend.errors import CodedHTTPException
from backend.quick_transcribe import GROQ_TRANSCRIBE_URL, NO_SPEECH_PROB, wav_bytes

logger = logging.getLogger("pronunciation_coach.groq_asr")

# Below this Whisper hears nothing worth scoring (backend.asr does the same).
MIN_AUDIO_SECONDS = 0.25
# A long answer takes longer to upload and transcribe than a short phrase.
TIMEOUT_SECONDS = 45.0
# Asked again once, after a short wait: rate limits and passing server errors.
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
MAX_RETRY_WAIT_SECONDS = 3.0
# The same speech detection the local Whisper used (backend.asr).
VAD = {"min_silence_duration_ms": 500, "speech_pad_ms": 300}
# After Groq fails, the local Whisper answers alone for this long (a rate limit's Retry-After when longer).
HOSTED_PAUSE_SECONDS = 30.0
MAX_HOSTED_PAUSE_SECONDS = 300.0


class HostedUnavailable(Exception):
    """Groq could not answer; `pause` is how long to leave it alone."""

    def __init__(self, reason: str, pause: float = HOSTED_PAUSE_SECONDS):
        super().__init__(reason)
        self.pause = pause


def speech_spans(audio: np.ndarray) -> list[tuple[float, float]]:
    """Where someone is speaking, in seconds."""
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    return [(s["start"] / SAMPLE_RATE, s["end"] / SAMPLE_RATE) for s in get_speech_timestamps(audio, VadOptions(**VAD))]


def timed_words(data: dict[str, Any], duration: float, speech: list[tuple[float, float]], language: str = "en") -> dict[str, Any]:
    """Groq's verbose JSON in the shape the local Whisper returns: `text`, `words` with their timings,
    `language` and `duration`. A word is kept when it falls inside a stretch of speech and outside every
    segment Whisper itself thinks was silence; the text is made of the kept words."""
    segments = [s for s in data.get("segments") or [] if isinstance(s, dict)]
    silent = [
        (float(s.get("start") or 0), float(s.get("end") or 0)) for s in segments if float(s.get("no_speech_prob") or 0) >= NO_SPEECH_PROB
    ]
    words = []
    for w in data.get("words") or []:
        token = str(w.get("word") or "").strip() if isinstance(w, dict) else ""
        if not token:
            continue
        start, end = float(w.get("start") or 0), float(w.get("end") or 0)
        middle = (start + end) / 2
        if any(a <= middle <= b for a, b in silent) or not any(a <= middle <= b for a, b in speech):
            continue
        words.append({"word": token, "start": round(start, 3), "end": round(end, 3), "probability": None})
    return {"text": " ".join(w["word"] for w in words), "words": words, "language": language, "duration": round(duration, 2)}


class GroqWhisper:
    """The local Whisper's interface, on Groq. `remote`: the work is mostly done elsewhere, so callers need not
    hold the ASR work gate while it runs (the local fallback has a lock of its own). `fallback` returns the
    local Whisper, or None when it isn't available."""

    remote = True

    def __init__(self, model: str, api_key: str, fallback: Callable[[], Any] | None = None):
        self.model_size = model
        self._api_key = api_key
        self._client = httpx.Client(timeout=TIMEOUT_SECONDS)
        self._fallback = fallback
        self._local_lock = threading.Lock()  # this server's CPU: one fallback transcription at a time
        self._paused_until = 0.0

    def warm_up(self) -> None:
        """Load the speech detector, so the first request doesn't wait for it."""
        speech_spans(np.zeros(SAMPLE_RATE, dtype=np.float32))

    def transcribe(self, audio: np.ndarray, language: str = "en", prompt: str | None = None) -> dict[str, Any]:
        """Transcribe 16 kHz mono float32 audio: ``text``, ``words`` (``word``, ``start``, ``end``,
        ``probability`` None), ``language`` and ``duration``. When Groq can't answer, the local Whisper does
        (with its word confidences); a 503 only when neither can."""
        duration = audio.size / SAMPLE_RATE
        empty = {"text": "", "words": [], "language": language, "duration": round(duration, 2)}
        if duration < MIN_AUDIO_SECONDS:
            return empty
        speech = speech_spans(audio)
        if not speech:
            return empty  # silence is never sent
        if time.monotonic() >= self._paused_until:
            try:
                return timed_words(self._request(audio, language, prompt), duration, speech, language)
            except HostedUnavailable as exc:
                pause = min(MAX_HOSTED_PAUSE_SECONDS, exc.pause)
                self._paused_until = time.monotonic() + pause
                # Never log the key or the response body; the status is enough to diagnose.
                logger.warning("Groq speech recognition failed (%s); the local Whisper answers for %.0fs.", exc, pause)
        return self._local(audio, language, prompt)

    def _local(self, audio: np.ndarray, language: str, prompt: str | None) -> dict[str, Any]:
        local = self._fallback() if self._fallback is not None else None
        if local is None:
            raise CodedHTTPException(
                503, "Speech recognition is busy right now. Please try again in a few seconds.", "busy", {"Retry-After": "5"}
            )
        with self._local_lock:
            return local.transcribe(audio, language=language, prompt=prompt)

    def _request(self, audio: np.ndarray, language: str, prompt: str | None) -> dict[str, Any]:
        fields: dict[str, Any] = {
            "model": self.model_size,
            "language": language,
            "temperature": "0",
            "response_format": "verbose_json",
            "timestamp_granularities[]": ["word", "segment"],
        }
        if prompt:
            fields["prompt"] = prompt
        body = wav_bytes(audio)
        reason, pause = "no answer", HOSTED_PAUSE_SECONDS
        for attempt in range(2):
            wait = 0.5
            try:
                response = self._client.post(
                    GROQ_TRANSCRIBE_URL,
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    data=fields,
                    files={"file": ("speech.wav", body, "audio/wav")},
                )
            except httpx.HTTPError as exc:
                reason = type(exc).__name__
            else:
                if response.status_code == 200:
                    return response.json()
                reason = f"HTTP {response.status_code}"
                if response.status_code not in RETRY_STATUSES:
                    break
                try:
                    asked = float(response.headers.get("retry-after") or 1.0)
                except ValueError:
                    asked = 1.0
                wait, pause = min(MAX_RETRY_WAIT_SECONDS, asked), max(HOSTED_PAUSE_SECONDS, asked)
                if asked > MAX_RETRY_WAIT_SECONDS:
                    break  # a limit that lasts: no point asking again now
            if attempt == 0:
                time.sleep(wait)
        raise HostedUnavailable(reason, pause)

    def get_model_info(self) -> dict[str, str]:
        return {"model_size": self.model_size, "device": "groq", "compute_type": "hosted", "framework": "groq"}
