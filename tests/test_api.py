"""Tests for the FastAPI pronunciation coach API endpoints."""

from fastapi.testclient import TestClient

from backend import main


def test_health_reports_ready_models(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_evaluate_accepts_multipart_target_text(client):
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


def test_evaluate_requires_target_text(client):
    response = client.post(
        "/api/evaluate",
        files={"audio": ("sample.wav", b"fake audio", "audio/wav")},
    )

    assert response.status_code == 400
    assert "target_text" in response.json()["detail"]


def test_transcribe_rejects_unsupported_file_type(client):
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
