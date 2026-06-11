"""Shared test fixtures for the AI Pronunciation Coach test suite."""

import pytest
from fastapi.testclient import TestClient

from backend import main


class FakeASR:
    """Minimal stub that returns a fixed transcription without loading Whisper."""

    def transcribe(self, audio_path, language="en"):
        assert audio_path
        return {"text": "Hello world", "language": "en"}


class FakeScorer:
    """Minimal stub that returns a fixed score without loading Epitran."""

    def score_pronunciation(self, reference_text, transcribed_text, difficulty="Intermediate"):
        return {
            "score": 98.5,
            "accuracy": 100.0,
            "feedback": "Great work.",
            "phoneme_analysis": {
                "reference_phonemes": "hello world",
                "transcribed_phonemes": "hello world",
                "phoneme_similarity": 100.0,
            },
            "word_level_scores": [
                {
                    "reference_word": reference_text,
                    "transcribed_word": transcribed_text,
                    "score": 100.0,
                    "match": True,
                }
            ],
        }


@pytest.fixture()
def client(monkeypatch):
    """Provide a TestClient with fake models injected."""
    monkeypatch.setattr(main, "LOAD_MODELS_ON_STARTUP", False)
    monkeypatch.setattr(main, "asr_model", FakeASR())
    monkeypatch.setattr(main, "pronunciation_scorer", FakeScorer())
    return TestClient(main.app)
