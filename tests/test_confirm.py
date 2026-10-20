"""Saying a "Worth checking" word alone: the verdict, and how it replaces the uncertain one in history."""

import numpy as np
import pytest
from sqlalchemy import func, select

from backend import pronunciation
from backend.database import PhonemeObservation, PronunciationRecord
from backend.repositories import find_user, weakness_rows
from backend.runtime import runtime
from tests.conftest import OTHER_KEY, PROFILE_KEY, timed_words, wav_bytes
from tests.test_tiers import BORDERLINE, CLEAN, SURE, heard

KEY = {"X-Profile-Key": PROFILE_KEY}


class FakePhonemes:
    def log_probs(self, samples):
        return np.zeros((10, 5), dtype=np.float32)


@pytest.fixture()
def acoustic(client, monkeypatch):
    """Acoustic scoring with made-up evidence: `plan[words]` is what the sound model "hears"."""
    plan: dict[tuple[str, ...], list] = {}
    monkeypatch.setattr(runtime, "phonemes", FakePhonemes())
    monkeypatch.setattr(runtime.scorer, "inventory", object())
    monkeypatch.setattr(pronunciation, "analyse_acoustics", lambda tokens, log_probs, inventory: plan[tuple(tokens)])
    return plan


def say(fake_asr, text):
    fake_asr.text = text
    fake_asr.words = timed_words(text) if text else []


def attempt(client, fake_asr, acoustic, think=(BORDERLINE, CLEAN, CLEAN, CLEAN), sentence="I think so"):
    words = sentence.lower().split()
    acoustic[tuple(words)] = [heard(w, list(think) if w == "think" else [CLEAN] * (1 if w == "i" else 2)) for w in words]
    say(fake_asr, sentence)
    body = client.post(
        "/api/evaluate",
        data={"target_text": sentence + ".", "username": "Asha"},
        files={"audio": ("a.wav", wav_bytes(), "audio/wav")},
        headers=KEY,
    ).json()
    assert body["saved"] and any(w["tier"] == "check" for w in body["words"])
    return body["record_id"]


def confirm(client, fake_asr, acoustic, think, record_id=None, headers=KEY, heard_text="think", word="think"):
    acoustic[("think",)] = [heard("think", list(think))]
    say(fake_asr, heard_text)
    data = {"word": word, "phonemes": "θ", "username": "Asha"}
    if record_id is not None:
        data["record_id"] = str(record_id)
    return client.post("/api/evaluate/confirm", data=data, files={"audio": ("w.wav", wav_bytes(), "audio/wav")}, headers=headers)


def think_rows(session_factory):
    db = session_factory()
    rows = db.execute(
        select(PhonemeObservation.ok, PhonemeObservation.tier).where(PhonemeObservation.phoneme == "θ")
    ).all()
    records = db.scalar(select(func.count()).select_from(PronunciationRecord))
    weak = weakness_rows(db, find_user(db, "Asha"), 5)
    db.close()
    return [tuple(r) for r in rows], records, weak


def test_a_slip_confirmed_alone_replaces_the_uncertain_one(client, fake_asr, acoustic, session_factory):
    record_id = attempt(client, fake_asr, acoustic)
    assert think_rows(session_factory)[0] == [(True, "check")]

    body = confirm(client, fake_asr, acoustic, (SURE, CLEAN, CLEAN, CLEAN), record_id).json()

    assert body["verdict"] == "slip" and body["updated"] == 1
    assert body["sounds"] == [
        {"phoneme": "θ", "verdict": "slip", "score": round(100 * SURE, 1), "alternative": "s", "heard_as": None}
    ]
    rows, records, weak = think_rows(session_factory)
    assert rows == [(False, "slip")]  # now counts against mastery
    assert weak == [("θ", 1)]
    assert records == 1  # checking a word is not a new attempt (no streak, no daily goal)


def test_a_sound_that_was_fine_alone_is_cleared(client, fake_asr, acoustic, session_factory):
    record_id = attempt(client, fake_asr, acoustic)
    body = confirm(client, fake_asr, acoustic, (CLEAN, CLEAN, CLEAN, CLEAN), record_id).json()

    assert body["verdict"] == "fine" and body["updated"] == 1
    rows, _records, weak = think_rows(session_factory)
    assert rows == [(True, "fine")] and weak == []


def test_whisper_hearing_a_different_sound_confirms_the_slip(client, fake_asr, acoustic):
    # The sound model is generous with single words; Whisper hearing "sink" settles it.
    body = confirm(client, fake_asr, acoustic, (0.88, CLEAN, CLEAN, CLEAN), heard_text="sink").json()
    assert body["verdict"] == "slip"
    assert body["sounds"][0]["heard_as"] == "s" and body["sounds"][0]["alternative"] == "s"


def test_formatting_and_other_sounds_do_not_count_as_a_slip():
    from backend.pronunciation import said_alone

    entry = {"reference": "third", "spoken": "3rd", "phonemes": [{"phoneme": "θ", "score": 97.0, "alternative": None}]}
    assert said_alone(entry, ["θ"])[0]["verdict"] == "fine"  # "3rd" is how Whisper writes "third"
    entry = {"reference": "think", "spoken": "thing", "phonemes": [{"phoneme": "θ", "score": 97.0, "alternative": None}]}
    assert said_alone(entry, ["θ"])[0]["verdict"] == "fine"  # the difference is in another sound


def test_a_word_said_twice_is_resolved_in_both_places(client, fake_asr, acoustic, session_factory):
    record_id = attempt(client, fake_asr, acoustic, sentence="I think I think so")
    body = confirm(client, fake_asr, acoustic, (SURE, CLEAN, CLEAN, CLEAN), record_id).json()

    assert body["updated"] == 2
    assert think_rows(session_factory)[0] == [(False, "slip"), (False, "slip")]


def test_nothing_heard_changes_nothing(client, fake_asr, acoustic, session_factory):
    record_id = attempt(client, fake_asr, acoustic)
    body = confirm(client, fake_asr, acoustic, (SURE, CLEAN, CLEAN, CLEAN), record_id, heard_text="").json()

    assert body["verdict"] == "unheard" and body["updated"] == 0
    assert think_rows(session_factory)[0] == [(True, "check")]


def test_only_the_owner_can_resolve_an_attempt(client, fake_asr, acoustic, session_factory):
    record_id = attempt(client, fake_asr, acoustic)

    locked = confirm(client, fake_asr, acoustic, (SURE, CLEAN, CLEAN, CLEAN), record_id, headers={"X-Profile-Key": OTHER_KEY})
    assert locked.status_code == 403 and locked.json()["code"] == "profile_locked"
    missing = confirm(client, fake_asr, acoustic, (SURE, CLEAN, CLEAN, CLEAN), record_id + 99)
    assert missing.status_code == 404
    assert think_rows(session_factory)[0] == [(True, "check")]


def test_a_guest_gets_the_verdict_without_saving(client, fake_asr, acoustic):
    body = confirm(client, fake_asr, acoustic, (CLEAN, CLEAN, CLEAN, CLEAN)).json()
    assert body["verdict"] == "fine" and body["updated"] == 0
    assert body["result"]["reference"] == "think"


def test_without_the_sound_model_there_is_nothing_to_confirm(client, fake_asr):
    say(fake_asr, "think")
    body = client.post(
        "/api/evaluate/confirm",
        data={"word": "think", "phonemes": "θ"},
        files={"audio": ("w.wav", wav_bytes(), "audio/wav")},
    ).json()
    assert body["verdict"] == "unavailable" and body["sounds"] == []


@pytest.mark.parametrize("data", [{"word": "two words", "phonemes": "θ"}, {"word": "think", "phonemes": " , "}])
def test_confirm_rejects_anything_but_one_word_and_its_sounds(client, data):
    response = client.post("/api/evaluate/confirm", data=data, files={"audio": ("w.wav", wav_bytes(), "audio/wav")})
    assert response.status_code == 400
