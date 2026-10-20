"""Real listeners: consent, anonymity, one listen per person, and an honest per-word result."""

from datetime import timedelta

import pytest
from sqlalchemy import select, update

from backend import listeners
from backend.api import auth as auth_api
from backend.api import listeners as listeners_api
from backend.database import ListenerAnswer, ListenerClip, utcnow
from tests.conftest import OTHER_KEY, PROFILE_KEY, timed_words, wav_bytes

PASSWORD = "correct horse battery staple"
THIRD_KEY = "third-profile-key-0123456789abcdefghijklmn"
ASHA, BEN, CAL = {"X-Profile-Key": PROFILE_KEY}, {"X-Profile-Key": OTHER_KEY}, {"X-Profile-Key": THIRD_KEY}


# --- comparing what was typed with the sentence ---------------------------------------------------


def test_every_word_is_marked_heard_or_missed_with_what_was_heard_instead():
    words = listeners.compare("I think it went well.", "I sink it went well")
    assert [(w["word"], w["heard"], w["as"]) for w in words] == [
        ("i", True, None), ("think", False, "sink"), ("it", True, None), ("went", True, None), ("well", True, None),
    ]
    assert [w["heard"] for w in listeners.compare("Don’t worry about it.", "dont worry about")] == [False, True, True, False]
    assert all(w["heard"] for w in listeners.compare("Don’t stop.", "don't stop!"))


def test_an_abusive_answer_keeps_its_marks_but_never_its_words():
    words = listeners.safe_words(listeners.compare("I think so", "I idiot so"), abusive=True)
    assert words[1] == {"word": "think", "heard": False, "as": None}


def test_the_summary_says_how_much_was_understood_and_which_words_were_missed():
    answers = [listeners.compare("I think so", typed) for typed in ("I sink so", "I think so", "I sink so")]
    summary = listeners.summary("I think so", answers)
    assert summary["listeners"] == 3 and summary["understood"] == round(7 / 9 * 100)
    assert summary["missed"] == [{"word": "think", "heard": 1, "of": 3, "heard_as": ["sink"]}]


# --- the API --------------------------------------------------------------------------------


@pytest.fixture()
def people(client, fake_asr, monkeypatch):
    """Three accounts; Asha has one saved attempt."""
    monkeypatch.setattr(auth_api.auth_rate_limiter, "limit", 1000)
    auth_api.auth_rate_limiter.reset()
    listeners_api.listen_rate_limiter.reset()
    for key, email, name in ((PROFILE_KEY, "asha@example.com", "Asha"), (OTHER_KEY, "ben@example.com", "Ben"), (THIRD_KEY, "cal@example.com", "Cal")):
        assert client.post("/api/auth/register", json={"email": email, "password": PASSWORD, "username": name},
                           headers={"X-Profile-Key": key}).status_code == 200
    fake_asr.text, fake_asr.words = "I sink so", timed_words("I sink so")
    attempt = client.post("/api/evaluate", data={"target_text": "I think so.", "username": "Asha"},
                          files={"audio": ("a.wav", wav_bytes(), "audio/wav")}, headers=ASHA).json()
    return attempt["record_id"]


def share(client, record_id, consent=True, headers=ASHA, username="Asha"):
    return client.post(f"/api/listeners/{username}/clips", data={"record_id": str(record_id), "consent": "true" if consent else "false"},
                       files={"audio": ("a.wav", wav_bytes(seconds=1.5), "audio/wav")}, headers=headers)


def test_sharing_needs_consent_an_account_and_the_attempt_owner(client, people):
    assert share(client, people, consent=False).status_code == 400
    assert share(client, people, headers=BEN, username="Ben").status_code == 404  # not Ben's attempt
    guest = client.get("/api/listeners/Nobody/next", headers={"X-Profile-Key": "guest-key-0123456789abcdefghijklmnopq"})
    assert guest.status_code == 403 and guest.json()["code"] == "account_required"
    clip = share(client, people).json()
    assert clip["text"] == "I think so." and clip["listeners"] == 0 and clip["active"]
    assert share(client, people).status_code == 409  # already out


def test_a_listener_hears_it_once_types_what_they_heard_and_learns_the_sentence(client, people):
    clip_id = share(client, people).json()["id"]
    assert client.get("/api/listeners/Asha/next", headers=ASHA).json()["clip"] is None  # never your own
    task = client.get("/api/listeners/Ben/next", headers=BEN).json()
    assert task["clip"] == {"id": clip_id, "words": 3} and "text" not in task["clip"]  # the sentence stays hidden
    assert client.get(f"/api/listeners/Ben/audio/{clip_id}", headers=BEN).content == wav_bytes(seconds=1.5)

    answer = client.post(f"/api/listeners/Ben/answer/{clip_id}", json={"typed": "I sink so"}, headers=BEN).json()
    assert answer["text"] == "I think so." and answer["heard"] == 2 and answer["total"] == 3
    assert client.post(f"/api/listeners/Ben/answer/{clip_id}", json={"typed": "again"}, headers=BEN).status_code == 409
    assert client.get("/api/listeners/Ben/next", headers=BEN).json() == {"clip": None, "helped": 1}

    client.post(f"/api/listeners/Cal/answer/{clip_id}", json={"typed": "I think so"}, headers=CAL)
    mine = client.get("/api/listeners/Asha/clips", headers=ASHA).json()["clips"][0]
    assert mine["listeners"] == 2 and mine["understood"] == round(5 / 6 * 100)
    assert mine["missed"] == [{"word": "think", "heard": 1, "of": 2, "heard_as": ["sink"]}]
    assert "Ben" not in str(mine) and "Cal" not in str(mine)  # listeners are anonymous


def test_a_reported_clip_stops_being_played_and_loses_its_audio(client, people, session_factory):
    clip_id = share(client, people).json()["id"]
    assert client.post(f"/api/listeners/Ben/report/{clip_id}", headers=BEN).json() == {"reported": True}
    assert client.get("/api/listeners/Cal/next", headers=CAL).json()["clip"] is None
    assert client.get(f"/api/listeners/Cal/audio/{clip_id}", headers=CAL).status_code == 404
    db = session_factory()
    assert db.scalar(select(ListenerClip.audio)) is None
    db.close()


def test_expired_clips_are_not_played_and_their_audio_is_deleted(client, people, session_factory):
    clip_id = share(client, people).json()["id"]
    db = session_factory()
    db.execute(update(ListenerClip).values(expires_at=utcnow().replace(tzinfo=None) - timedelta(minutes=1)))
    db.commit()
    assert client.get("/api/listeners/Ben/next", headers=BEN).json()["clip"] is None
    assert client.post(f"/api/listeners/Ben/answer/{clip_id}", json={"typed": "I think so"}, headers=BEN).status_code == 404
    db.expire_all()
    assert db.scalar(select(ListenerClip.audio)) is None
    db.close()


def test_deleting_a_clip_history_or_account_removes_what_belongs_to_it(client, people, session_factory):
    first = share(client, people).json()["id"]
    client.post(f"/api/listeners/Ben/answer/{first}", json={"typed": "I think so"}, headers=BEN)
    assert client.delete(f"/api/listeners/Asha/clips/{first}", headers=ASHA).json() == {"deleted": True}
    db = session_factory()
    assert db.scalar(select(ListenerAnswer.id)) is None

    second = share(client, people).json()["id"]
    client.post(f"/api/listeners/Ben/answer/{second}", json={"typed": "I think so"}, headers=BEN)
    assert client.delete("/api/history/Asha", headers=ASHA).status_code == 200
    db.expire_all()
    assert db.scalar(select(ListenerClip.id)) is None and db.scalar(select(ListenerAnswer.id)) is None
    db.close()


def test_a_deleted_listener_takes_their_answers_with_them(client, people, session_factory):
    clip_id = share(client, people).json()["id"]
    client.post(f"/api/listeners/Ben/answer/{clip_id}", json={"typed": "I think so"}, headers=BEN)
    assert client.post("/api/auth/delete", json={"password": PASSWORD}, headers=BEN).json() == {"deleted": True}
    db = session_factory()
    assert db.scalar(select(ListenerAnswer.id)) is None and db.scalar(select(ListenerClip.id)) == clip_id
    db.close()
