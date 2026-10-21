"""Accounts are required: a guest gets 401 `sign_in_required`, a signed-in device gets through.

Sign-in itself, health checks and the share links teachers open stay open to everyone.
"""

import pytest

from backend.api import auth as auth_api
from backend.api import voice as voice_api
from backend.config import settings
from tests.conftest import OTHER_KEY, PROFILE_KEY, wav_bytes

PASSWORD = "correct horse battery"


@pytest.fixture(autouse=True)
def accounts_required(monkeypatch):
    monkeypatch.setattr(auth_api.auth_rate_limiter, "limit", 1000)
    auth_api.auth_rate_limiter.reset()
    object.__setattr__(settings, "require_account", True)
    yield
    object.__setattr__(settings, "require_account", False)


def headers(key):
    return {"X-Profile-Key": key}


def sign_up(client, key=PROFILE_KEY):
    response = client.post(
        "/api/auth/register",
        json={"email": "sam@example.com", "password": PASSWORD, "username": "Sam"},
        headers=headers(key),
    )
    assert response.status_code == 200, response.text


def evaluate(client, key):
    return client.post(
        "/api/evaluate",
        files={"audio": ("clip.wav", wav_bytes(), "audio/wav")},
        data={"target_text": "Hello world", "username": "Sam"},
        headers=headers(key),
    )


@pytest.mark.parametrize(
    "path",
    ["/api/pronounce?text=hello", "/api/phonemes", "/api/tts?text=hello", "/api/interview/options", "/api/history/Sam"],
)
def test_a_guest_is_asked_to_sign_in(client, path):
    response = client.get(path, headers=headers(OTHER_KEY))
    assert response.status_code == 401
    assert response.json()["code"] == "sign_in_required"


def test_a_guest_recording_is_not_scored(client, fake_asr):
    response = evaluate(client, OTHER_KEY)
    assert response.status_code == 401 and response.json()["code"] == "sign_in_required"
    assert fake_asr.calls == []  # refused before any work


def test_no_key_at_all_is_a_guest(client):
    assert client.get("/api/phonemes").json()["code"] == "sign_in_required"


def test_a_signed_in_device_gets_through(client):
    sign_up(client)
    assert client.get("/api/phonemes", headers=headers(PROFILE_KEY)).status_code == 200
    assert evaluate(client, PROFILE_KEY).status_code == 200


def test_signing_out_closes_the_app_again(client):
    sign_up(client)
    client.post("/api/auth/logout", headers=headers(PROFILE_KEY))
    assert client.get("/api/phonemes", headers=headers(PROFILE_KEY)).status_code == 401


def test_sign_in_health_and_share_links_stay_open(client):
    assert client.get("/health").status_code == 200
    assert client.get("/api/auth/available?username=someone").status_code == 200
    assert client.get("/api/auth/me", headers=headers(OTHER_KEY)).json() == {"account": False}
    # An unknown share link is "not found", not "sign in": teachers never need an account.
    assert client.get("/api/shared/no-such-token-0123456789").status_code == 404


def test_the_voice_coach_needs_an_account(client):
    voice_api.voice_rate_limiter.reset()
    object.__setattr__(settings, "gemini_api_key", "test-key")
    try:
        with client.websocket_connect("/ws/voice") as ws:
            ws.send_json({"type": "start", "profile_key": OTHER_KEY})
            event = ws.receive_json()
    finally:
        object.__setattr__(settings, "gemini_api_key", "")
    assert event["type"] == "error" and event["code"] == "sign_in_required"


def test_the_requirement_can_be_switched_off(client):
    object.__setattr__(settings, "require_account", False)
    assert client.get("/api/phonemes", headers=headers(OTHER_KEY)).status_code == 200
