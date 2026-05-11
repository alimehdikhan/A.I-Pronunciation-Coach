from fastapi.testclient import TestClient

from backend import main


class FakeASR:
    def transcribe(self, audio_path):
        assert audio_path
        return {"text": "Hello world", "language": "en"}


class FakeScorer:
    def score_pronunciation(self, reference_text, transcribed_text):
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


def make_client(monkeypatch):
    monkeypatch.setattr(main, "LOAD_MODELS_ON_STARTUP", False)
    monkeypatch.setattr(main, "asr_model", FakeASR())
    monkeypatch.setattr(main, "pronunciation_scorer", FakeScorer())
    return TestClient(main.app)


def test_health_reports_ready_models(monkeypatch):
    client = make_client(monkeypatch)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_evaluate_accepts_multipart_target_text(monkeypatch):
    client = make_client(monkeypatch)

    response = client.post(
        "/api/evaluate",
        data={"target_text": "Hello world"},
        files={"audio": ("sample.wav", b"fake audio", "audio/wav")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["reference_text"] == "Hello world"
    assert body["transcription"] == "Hello world"
    assert body["score"] == 98.5


def test_evaluate_requires_target_text(monkeypatch):
    client = make_client(monkeypatch)

    response = client.post(
        "/api/evaluate",
        files={"audio": ("sample.wav", b"fake audio", "audio/wav")},
    )

    assert response.status_code == 400
    assert "target_text" in response.json()["detail"]


def test_transcribe_rejects_unsupported_file_type(monkeypatch):
    client = make_client(monkeypatch)

    response = client.post(
        "/api/transcribe",
        files={"audio": ("sample.txt", b"not audio", "text/plain")},
    )

    assert response.status_code == 400
    assert "Unsupported audio file type" in response.json()["detail"]


def test_model_not_ready_returns_503(monkeypatch):
    monkeypatch.setattr(main, "asr_model", None)
    monkeypatch.setattr(main, "pronunciation_scorer", None)
    client = TestClient(main.app)

    response = client.post(
        "/api/transcribe",
        files={"audio": ("sample.wav", b"fake audio", "audio/wav")},
    )

    assert response.status_code == 503
