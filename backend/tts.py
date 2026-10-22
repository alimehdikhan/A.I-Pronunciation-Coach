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


class ClipCache:
    """Rendered clips kept in memory, least recently used dropped first, bounded by their total size
    (a clip may be a word or a 300-character paragraph, so a count says little about memory)."""

    def __init__(self, max_bytes: int):
        self.max_bytes = max_bytes
        self.size = 0
        self._clips: OrderedDict[tuple, bytes] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: tuple) -> bytes | None:
        with self._lock:
            clip = self._clips.get(key)
            if clip is not None:
                self._clips.move_to_end(key)
            return clip

    def put(self, key: tuple, clip: bytes) -> None:
        if len(clip) > self.max_bytes:
            return
        with self._lock:
            old = self._clips.pop(key, None)
            self.size += len(clip) - (len(old) if old is not None else 0)
            self._clips[key] = clip
            while self.size > self.max_bytes:
                _key, dropped = self._clips.popitem(last=False)
                self.size -= len(dropped)


# Memory for rendered clips: Piper's are 22 kHz, Kokoro's 24 kHz (about 48 KB a second).
PIPER_CACHE_BYTES = 32 * 1024 * 1024
KOKORO_CACHE_BYTES = 64 * 1024 * 1024


class CoachVoice:
    """Thread-safe Piper voice with an LRU cache of rendered WAV audio."""

    def __init__(self, voice_name: str = DEFAULT_VOICE, cache_bytes: int = PIPER_CACHE_BYTES):
        from piper import PiperVoice

        model = ensure_voice_files(voice_name)
        self.voice_name = voice_name
        self.voice = PiperVoice.load(model)
        self._synth_lock = threading.Lock()  # one synthesis at a time per voice
        self._cache = ClipCache(cache_bytes)
        logger.info("Piper voice %s loaded.", voice_name)

    def cached(self, text: str, rate: float = 1.0) -> bytes | None:
        """The clip when it is already rendered; never renders."""
        clip = self._cache.get((text, round(min(MAX_RATE, max(MIN_RATE, rate)), 2)))
        if clip is not None:
            TTS_CACHE.labels("hit").inc()
        return clip

    def synthesize(self, text: str, rate: float = 1.0, keep: bool = True, persist: bool | None = None) -> bytes:
        """Render `text` as 16-bit mono WAV. `rate` > 1 speaks faster. `keep`: cache it (False for one-off text).
        `persist` is accepted for the same interface as KokoroVoice; Piper's cache is in memory only."""
        from piper import SynthesisConfig

        rate = round(min(MAX_RATE, max(MIN_RATE, rate)), 2)
        key = (text, rate)
        cached = self.cached(text, rate)
        if cached is not None:
            return cached

        # Cache hits never wait behind a synthesis in progress, and concurrent
        # requests for the same phrase are rendered once.
        with self._synth_lock:
            cached = self.cached(text, rate)
            if cached is not None:
                return cached
            TTS_CACHE.labels("miss").inc()
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as wav_file:
                self.voice.synthesize_wav(text, wav_file, syn_config=SynthesisConfig(length_scale=1.0 / rate))
            audio = buffer.getvalue()

        if keep:
            self._cache.put(key, audio)
        return audio


# ---------------------------------------------------------------------------
# Kokoro (82M parameters): the more natural voice, but heavy on a small CPU.
# ---------------------------------------------------------------------------

KOKORO_SAMPLE_RATE = 24000
# Largest file first: the full-precision model is usually faster on CPUs than int8.
KOKORO_MODEL_FILES = ("kokoro-v1.0.onnx", "kokoro-v1.0.fp16.onnx", "kokoro-v1.0.int8.onnx")
KOKORO_VOICES_FILE = "voices-v1.0.bin"

# The voices offered in the app: all ship in the Kokoro voice bundle and share one loaded model,
# so choosing another costs nothing until its first clip is rendered. (id, name, accent, gender)
KOKORO_VOICE_CATALOG: tuple[tuple[str, str, str, str], ...] = (
    ("af_heart", "Heart", "American", "female"),
    ("af_bella", "Bella", "American", "female"),
    ("af_nicole", "Nicole", "American", "female"),
    ("af_sarah", "Sarah", "American", "female"),
    ("am_michael", "Michael", "American", "male"),
    ("am_adam", "Adam", "American", "male"),
    ("bf_emma", "Emma", "British", "female"),
    ("bm_george", "George", "British", "male"),
)
KOKORO_VOICE_IDS = frozenset(entry[0] for entry in KOKORO_VOICE_CATALOG)


def kokoro_dir() -> Path:
    configured = os.getenv("PRONUNCIATION_COACH_KOKORO_DIR")
    if configured:
        return Path(configured)
    cache = os.getenv("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(cache) / "pronunciation_coach" / "kokoro"


def kokoro_available(directory: Path | None = None) -> bool:
    directory = directory or kokoro_dir()
    return (directory / KOKORO_VOICES_FILE).is_file() and any((directory / name).is_file() for name in KOKORO_MODEL_FILES)


class KokoroVoice:
    """Same interface as CoachVoice (``synthesize(text, rate) -> WAV bytes``).

    Rendering is slow on a small CPU, so every clip is kept on disk as well as
    in memory, and ``scripts/prerender_voice.py`` can fill that cache ahead of
    time for the fixed phrase library; only unseen text is rendered live.
    """

    def __init__(self, voice_name: str = "af_heart", directory: Path | None = None, cache_dir: Path | None = None,
                 cache_bytes: int = KOKORO_CACHE_BYTES, threads: int = 0):
        import onnxruntime as ort
        from kokoro_onnx import Kokoro

        directory = directory or kokoro_dir()
        model = next((directory / name for name in KOKORO_MODEL_FILES if (directory / name).is_file()), None)
        if model is None or not (directory / KOKORO_VOICES_FILE).is_file():
            raise FileNotFoundError(f"Kokoro model files not found in {directory}")
        options = ort.SessionOptions()
        if threads > 0:
            options.intra_op_num_threads = threads
        session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
        self.engine = Kokoro.from_session(session, str(directory / KOKORO_VOICES_FILE))
        self.voice_name = voice_name
        self.lang = "en-gb" if voice_name[:1] == "b" else "en-us"
        self.model_file = model.name
        self.cache_dir = cache_dir if cache_dir is not None else directory / "clips"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._synth_lock = threading.Lock()
        self._cache = ClipCache(cache_bytes)
        logger.info("Kokoro voice %s loaded (%s).", voice_name, model.name)

    def warm_up(self) -> None:
        """One throwaway render so the first real clip is not the one that pays for session start-up."""
        try:
            self.engine.create("Hello there, welcome back.", voice=self.voice_name, speed=1.0, lang=self.lang)
        except Exception:  # warming is an optimisation, never a reason to fail start-up
            logger.warning("Kokoro warm-up failed", exc_info=True)

    def _voice(self, voice: str | None) -> str:
        """The requested catalog voice, or this engine's default for anything else."""
        return voice if voice in KOKORO_VOICE_IDS else self.voice_name

    def _clip_path(self, text: str, rate: float, voice: str | None = None) -> Path:
        import hashlib

        digest = hashlib.sha1(f"{self._voice(voice)}|{rate:.2f}|{text}".encode("utf-8")).hexdigest()
        return self.cache_dir / f"{digest}.wav"

    def has_clip(self, text: str, rate: float = 1.0, voice: str | None = None) -> bool:
        return self._clip_path(text, round(min(MAX_RATE, max(MIN_RATE, rate)), 2), voice).is_file()

    def cached(self, text: str, rate: float = 1.0, voice: str | None = None) -> bytes | None:
        """The clip when it is already rendered (in memory or on disk); never renders."""
        rate = round(min(MAX_RATE, max(MIN_RATE, rate)), 2)
        name = self._voice(voice)
        clip = self._cache.get((name, text, rate))
        if clip is None:
            path = self._clip_path(text, rate, name)
            if path.is_file():
                clip = path.read_bytes()
                self._cache.put((name, text, rate), clip)
        if clip is not None:
            TTS_CACHE.labels("hit").inc()
        return clip

    def synthesize(
        self, text: str, rate: float = 1.0, voice: str | None = None, keep: bool = True, persist: bool | None = None
    ) -> bytes:
        """`keep`: cache the clip in memory. False for one-off text (an interviewer's live reaction, which
        quotes the candidate): it is rendered for that moment and never stored. `persist` (default: `keep`):
        also keep it on disk, for text any learner may hear again; False keeps it in memory only, for text
        reused within one session (a question worded for one interview)."""
        import numpy as np

        rate = round(min(MAX_RATE, max(MIN_RATE, rate)), 2)
        name = self._voice(voice)
        lang = "en-gb" if name[:1] == "b" else "en-us"
        key = (name, text, rate)
        cached = self.cached(text, rate, name)
        if cached is not None:
            return cached

        path = self._clip_path(text, rate, name)
        with self._synth_lock:
            if path.is_file():
                audio = path.read_bytes()
            else:
                TTS_CACHE.labels("miss").inc()
                samples, sample_rate = self.engine.create(text, voice=name, speed=rate, lang=lang)
                pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
                buffer = io.BytesIO()
                with wave.open(buffer, "wb") as wav_file:
                    wav_file.setnchannels(1)
                    wav_file.setsampwidth(2)
                    wav_file.setframerate(int(sample_rate))
                    wav_file.writeframes(pcm.tobytes())
                audio = buffer.getvalue()
                if keep and (persist is None or persist):
                    tmp = path.with_suffix(f".{threading.get_ident()}.tmp")
                    tmp.write_bytes(audio)
                    tmp.replace(path)  # atomic: a half-written clip is never served

        if keep:
            self._cache.put(key, audio)
        return audio
