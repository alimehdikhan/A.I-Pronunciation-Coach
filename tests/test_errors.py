"""Every way a recording can fail comes back with a machine-readable code, so the UI can say what to do."""

import dataclasses

from fastapi.testclient import TestClient

from backend import main
from backend.api import speech
from backend.runtime import runtime
from tests.conftest import wav_bytes


def evaluate(client, audio=None, filename="a.wav"):
    files = {"audio": (filename, audio if audio is not None else wav_bytes(), "audio/wav")}
    return client.post("/api/evaluate", data={"target_text": "Hello world."}, files=files)


def test_models_loading_is_503_with_a_code_and_retry_after(monkeypatch):
    monkeypatch.setattr(runtime, "asr", None)
    with TestClient(main.app) as client:
        response = evaluate(client)
    assert response.status_code == 503
    assert response.json()["code"] == "models_loading" and response.headers["retry-after"] == "5"


def test_rate_limited_is_429_with_a_code_and_retry_after(client, monkeypatch):
    monkeypatch.setattr(speech.audio_rate_limiter, "limit", 1)
    evaluate(client)
    response = evaluate(client)
    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited" and int(response.headers["retry-after"]) >= 1


def test_too_short_too_long_and_too_large_are_told_apart(client, monkeypatch):
    short = evaluate(client, wav_bytes(seconds=0.1))
    assert short.status_code == 400 and short.json()["code"] == "too_short"

    monkeypatch.setattr(speech, "settings", dataclasses.replace(speech.settings, max_audio_seconds=0.5))
    long = evaluate(client, wav_bytes(seconds=1.0))
    assert long.status_code == 413 and long.json()["code"] == "recording_too_long"

    monkeypatch.setattr(speech, "settings", dataclasses.replace(speech.settings, max_upload_bytes=1000))
    large = evaluate(client, wav_bytes(seconds=1.0))
    assert large.status_code == 413 and large.json()["code"] == "upload_too_large"


def test_unreadable_and_empty_files_have_their_own_codes(client):
    assert evaluate(client, b"not audio at all").json()["code"] == "audio_unreadable"
    assert evaluate(client, b"").json()["code"] == "audio_empty"
    assert evaluate(client, wav_bytes(), filename="a.exe").json()["code"] == "unsupported_audio"


def test_silence_is_reported_as_no_speech(client, fake_asr):
    fake_asr.text, fake_asr.words = "", []
    body = evaluate(client).json()
    assert body["no_speech"] is True and body["transcription"] == ""

    fake_asr.text, fake_asr.words = "Hello world", None
    assert evaluate(client).json()["no_speech"] is False
