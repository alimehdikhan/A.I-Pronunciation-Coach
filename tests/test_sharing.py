"""Sharing an attempt with a teacher: consent, a read-only 7-day link, comments that land on the attempt."""

import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from backend.api import sharing
from backend.database import Share
from tests.conftest import OTHER_KEY, PROFILE_KEY, timed_words, wav_bytes

KEY = {"X-Profile-Key": PROFILE_KEY}


@pytest.fixture()
def attempt(client, fake_asr):
    sharing.share_rate_limiter.reset()
    sharing.comment_rate_limiter.reset()
    fake_asr.text, fake_asr.words = "I sink so", timed_words("I sink so")
    body = client.post("/api/evaluate", data={"target_text": "I think so.", "username": "Asha"},
                       files={"audio": ("a.wav", wav_bytes(), "audio/wav")}, headers=KEY).json()
    return body


def share(client, attempt, consent=True, headers=KEY, analysis=None):
    data = {
        "record_id": str(attempt["record_id"]),
        "consent": "true" if consent else "false",
        "analysis": json.dumps(analysis if analysis is not None else attempt),
    }
    return client.post("/api/shares/Asha", data=data, files={"audio": ("a.wav", wav_bytes(), "audio/wav")}, headers=headers)


def test_sharing_needs_consent_and_the_owner(client, attempt):
    assert share(client, attempt, consent=False).status_code == 400
    assert share(client, attempt, headers={"X-Profile-Key": OTHER_KEY}).status_code == 403


def test_the_teacher_sees_the_attempt_read_only_and_no_name(client, attempt, session_factory):
    tampered = {**attempt, "transcription": "I said it perfectly", "username": "Asha"}
    link = share(client, attempt, analysis=tampered).json()
    assert link["path"] == f"/shared/{link['token']}"

    page = client.get(f"/api/shared/{link['token']}").json()
    assert page["attempt"]["transcription"] == "I sink so"  # from the database, not the browser
    assert page["attempt"]["reference_text"] == "I think so." and page["has_audio"] is True
    assert "Asha" not in json.dumps(page)
    assert client.get(f"/api/shared/{link['token']}/audio").content == wav_bytes()
    db = session_factory()
    assert db.scalar(select(Share.token_hash)) != link["token"]  # only a hash is stored
    db.close()


def test_comments_land_on_the_attempt_and_are_moderated_and_rate_limited(client, attempt):
    token = share(client, attempt).json()["token"]
    url = f"/api/shared/{token}/comments"
    assert client.post(url, json={"author": "Ms Rao", "text": "Good effort. Put your tongue between your teeth for think."}).status_code == 200
    assert client.post(url, json={"text": "you are an idiot"}).status_code == 400

    history = client.get("/api/history/Asha", headers=KEY).json()["records"][0]
    assert [(c["author"], c["text"][:11]) for c in history["comments"]] == [("Ms Rao", "Good effort")]
    for _ in range(3):
        client.post(url, json={"text": "One more note."})
    assert client.post(url, json={"text": "Too many."}).status_code == 429


def test_expired_and_revoked_links_stop_and_lose_their_audio(client, attempt, session_factory):
    token = share(client, attempt).json()["token"]
    client.post(f"/api/shared/{token}/comments", json={"text": "Nice work on the vowels."})
    db = session_factory()
    db.execute(update(Share).values(expires_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)))
    db.commit()
    db.close()

    assert client.get(f"/api/shared/{token}").status_code == 410
    db = session_factory()
    assert db.scalar(select(Share.audio)) is None
    db.close()
    assert len(client.get("/api/history/Asha", headers=KEY).json()["records"][0]["comments"]) == 1  # comments stay

    second = share(client, attempt).json()
    listed = client.get("/api/shares/Asha", headers=KEY).json()["shares"]
    assert [s["active"] for s in listed] == [True, False]
    assert client.delete(f"/api/shares/Asha/{second['id']}", headers=KEY).json() == {"revoked": True}
    assert client.get(f"/api/shared/{second['token']}").status_code == 410
