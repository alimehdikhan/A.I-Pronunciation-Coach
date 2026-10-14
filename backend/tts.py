"""
Neural text-to-speech for the coach's voice (Piper: offline, CPU).

The browser's speechSynthesis API never exposes its audio, so nothing can
analyse it. Serving the coach's voice as real audio lets the frontend play it
through the Web Audio API, where the orb reacts to the actual signal.
"""

from __future__ import annotations

import io
import logging
import os
import threading
import wave
from collections import OrderedDict
from pathlib import Path

from backend.observability import TTS_CACHE

logger = logging.getLogger("pronunciation_coach.tts")

DEFAULT_VOICE = "en_US-lessac-medium"
MIN_RATE = 0.5
MAX_RATE = 1.6


def voice_dir() -> Path:
    """Where voice models are stored (override with PRONUNCIATION_COACH_TTS_DIR)."""
    configured = os.getenv("PRONUNCIATION_COACH_TTS_DIR")
    if configured:
        return Path(configured)
    cache = os.getenv("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(cache) / "pronunciation_coach" / "piper"


def ensure_voice_files(voice_name: str = DEFAULT_VOICE) -> Path:
    """Download the Piper model (+ config) if it isn't cached; returns the model path."""
    directory = voice_dir()
    directory.mkdir(parents=True, exist_ok=True)
    model = directory / f"{voice_name}.onnx"
    config = directory / f"{voice_name}.onnx.json"
    if not (model.exists() and config.exists()):
        from piper.download_voices import download_voice

        logger.info("Downloading Piper voice %s to %s...", voice_name, directory)
        download_voice(voice_name, directory)
    return model


class CoachVoice:
    """Thread-safe Piper voice with an LRU cache of rendered WAV audio."""

    def __init__(self, voice_name: str = DEFAULT_VOICE, cache_size: int = 256):
        from piper import PiperVoice

        model = ensure_voice_files(voice_name)
        self.voice_name = voice_name
        self.voice = PiperVoice.load(model)
        self._synth_lock = threading.Lock()  # one synthesis at a time per voice
        self._cache_lock = threading.Lock()
        self._cache: OrderedDict[tuple[str, float], bytes] = OrderedDict()
        self._cache_size = cache_size
        logger.info("Piper voice %s loaded.", voice_name)

    def synthesize(self, text: str, rate: float = 1.0) -> bytes:
        """Render `text` as 16-bit mono WAV. `rate` > 1 speaks faster."""
        from piper import SynthesisConfig

        rate = round(min(MAX_RATE, max(MIN_RATE, rate)), 2)
        key = (text, rate)
        cached = self._lookup(key)
        if cached is not None:
            TTS_CACHE.labels("hit").inc()
            return cached

        # Cache hits never wait behind a synthesis in progress, and concurrent
        # requests for the same phrase are rendered once.
        with self._synth_lock:
            cached = self._lookup(key)
            if cached is not None:
                TTS_CACHE.labels("hit").inc()
                return cached
            TTS_CACHE.labels("miss").inc()
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as wav_file:
                self.voice.synthesize_wav(text, wav_file, syn_config=SynthesisConfig(length_scale=1.0 / rate))
            audio = buffer.getvalue()

        with self._cache_lock:
            self._cache[key] = audio
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return audio

    def _lookup(self, key: tuple[str, float]) -> bytes | None:
        with self._cache_lock:
            cached = self._cache.get(key)
            if cached is not None:
                self._cache.move_to_end(key)
            return cached
