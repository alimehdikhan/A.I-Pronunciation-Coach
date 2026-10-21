"""Shared test fixtures for the Vocaly AI test suite."""

import io
import os
import tempfile
import wave

# Never let tests open the developer's real database: point the app's default
# engine at a throwaway file before any backend module is imported.
os.environ["NEON_DATABASE_URL"] = f"sqlite:///{os.path.join(tempfile.mkdtemp(prefix='pc-tests-'), 'app.db')}"
os.environ.setdefault("PRONUNCIATION_COACH_LOAD_MODELS_ON_STARTUP", "0")
# Tests must never reach a real language model, even when a developer has a key
# in .env (the settings loader would otherwise pick it up and spend quota).
os.environ["GROQ_API_KEY"] = ""

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend import main
from backend.api import coach as coach_api
from backend.api import speech
from backend.database import Base, get_db
from backend.pronunciation import PronunciationScorer
from backend.runtime import runtime

PROFILE_KEY = "test-profile-key-0123456789abcdefghijklmnop"
OTHER_KEY = "other-profile-key-0123456789abcdefghijklmno"


def timed_words(text, probability=0.95, start=0.2, step=0.35):
    """Build Whisper-style word timings for a transcript."""
    words = []
    for i, word in enumerate(text.split()):
        begin = start + i * step
        words.append({"word": word, "start": round(begin, 3), "end": round(begin + step - 0.05, 3), "probability": probability})
    return words


def wav_bytes(seconds=1.0, amplitude=0.1, rate=16000, channels=1):
    """A 16-bit PCM WAV tone (the format the web app uploads)."""
    t = np.arange(int(seconds * rate)) / rate
    tone = amplitude * np.sin(2 * np.pi * 220 * t)
    pcm = (np.repeat(tone[:, None], channels, axis=1) * 32767).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm.tobytes())
    return buffer.getvalue()


class FakeASR:
    """Stub that returns a configurable transcription without loading Whisper."""

    def __init__(self, text="Hello world", words=None):
        self.text = text
        self.words = words if words is not None else timed_words(text)
        self.calls = []
        self.prompts = []

    def transcribe(self, audio, language="en", prompt=None):
        self.prompts.append(prompt)
        assert isinstance(audio, np.ndarray) and audio.dtype == np.float32 and audio.size > 0
        self.calls.append(audio)
        return {"text": self.text, "words": self.words, "language": "en", "duration": round(audio.size / 16000, 2)}


@pytest.fixture()
def fake_asr():
    return FakeASR()


@pytest.fixture()
def session_factory(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, autoflush=False, autocommit=False)
    engine.dispose()


@pytest.fixture()
def client(monkeypatch, fake_asr, session_factory):
    """Provide a TestClient with a fake ASR, the real scorer and an isolated database."""
    monkeypatch.setattr(runtime, "asr", fake_asr)
    monkeypatch.setattr(runtime, "scorer", PronunciationScorer())
    monkeypatch.setattr(speech.audio_rate_limiter, "limit", 1000)
    speech.audio_rate_limiter.reset()
    # The coach endpoints share one per-minute budget; a test must not spend the next test's.
    coach_api.coach_rate_limiter.reset()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    main.app.dependency_overrides[get_db] = override_get_db
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()
