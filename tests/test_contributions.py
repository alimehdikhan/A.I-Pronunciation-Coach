"""Help improve Vocaly AI: opt-in, accounts only, the app's own sentences only, clean audio only, and deletable everywhere."""

import json
from dataclasses import replace

import numpy as np
import pytest
from sqlalchemy import select

from backend import contributions, quality
from backend.api import auth as auth_api
from backend.api import disputes as disputes_api
from backend.audio import SAMPLE_RATE
from backend.database import ContributionWithdrawal, PronunciationRecord, User
from backend.repositories import delete_history, find_user
from tests.conftest import PROFILE_KEY, timed_words, wav_bytes

PASSWORD = "correct horse battery staple"
KEY = {"X-Profile-Key": PROFILE_KEY}
SENTENCE = "I think this is the third time."  # one of the app's practice sentences (frontend/src/lib/sentences.ts)


@pytest.fixture()
def spool(client, fake_asr, monkeypatch, tmp_path, session_factory):
    """The feature switched on for this server, an account for Asha, and a clean recording every time."""
    folder = tmp_path / "spool"
    monkeypatch.setattr(contributions, "settings", replace(
        contributions.settings, dataset_repo="me/vocaly-recordings", hf_token="hf_test", contrib_dir=str(folder),
    ))
    monkeypatch.setattr(contributions, "SessionLocal", session_factory)
    monkeypatch.setattr(contributions.quality, "assess", lambda samples, result: {"usable": True, "problems": []})
    monkeypatch.setattr(auth_api.auth_rate_limiter, "limit", 1000)
    auth_api.auth_rate_limiter.reset()
    assert client.post("/api/auth/register", json={"email": "asha@example.com", "password": PASSWORD, "username": "Asha"},
                       headers=KEY).status_code == 200
    fake_asr.text, fake_asr.words = "I think this is the third time", timed_words("I think this is the third time")
    return folder / "pending"


def evaluate(client, text=SENTENCE):
    return client.post("/api/evaluate", data={"target_text": text, "username": "Asha"},
                       files={"audio": ("a.wav", wav_bytes(seconds=1.5), "audio/wav")}, headers=KEY).json()


def kept(folder):
    return sorted(p.name for p in folder.glob("*/*")) if folder.exists() else []


def test_it_is_off_until_the_learner_turns_it_on_and_only_for_accounts(client, spool):
    assert client.get("/api/contribute/Asha", headers=KEY).json() == {"available": True, "on": False, "since": None, "given": 0}
    assert evaluate(client)["contributed"] is False and kept(spool) == []

    guest = client.put("/api/contribute/Nobody", json={"on": True}, headers={"X-Profile-Key": "guest-key-0123456789abcdefghijklmnopq"})
    assert guest.status_code == 403 and guest.json()["code"] == "account_required"


def test_a_clean_recording_of_a_practice_sentence_is_kept_without_any_name(client, spool, session_factory):
    on = client.put("/api/contribute/Asha", json={"on": True}, headers=KEY).json()
    assert on["on"] is True and on["since"]

    result = evaluate(client)

    assert result["contributed"] is True
    files = kept(spool)
    assert len(files) == 2 and any(f.endswith((".flac", ".wav")) for f in files)
    meta_path = next(spool.glob("*/*.json"))
    text = meta_path.read_text(encoding="utf-8")
    assert "Asha" not in text and "asha@example.com" not in text and PROFILE_KEY not in text
    meta = json.loads(text)
    db = session_factory()
    user = find_user(db, "Asha")
    assert meta["contributor"] == user.contributor_id != str(user.id) and meta["text"] == SENTENCE
    assert db.scalar(select(PronunciationRecord.clip_id).where(PronunciationRecord.id == result["record_id"])) == meta["clip"]
    assert client.get("/api/contribute/Asha", headers=KEY).json()["given"] == 1


def test_text_the_learner_typed_and_poor_audio_are_never_kept(client, spool, monkeypatch):
    client.put("/api/contribute/Asha", json={"on": True}, headers=KEY)
    assert evaluate(client, "My name is Asha and I live in Pune.")["contributed"] is False

    monkeypatch.setattr(contributions.quality, "assess", lambda samples, result: {"usable": False, "problems": ["noisy"]})
    assert evaluate(client)["contributed"] is False
    assert kept(spool) == []


def test_one_learner_can_give_only_so_many_a_day(client, spool, monkeypatch):
    monkeypatch.setattr(contributions, "settings", replace(contributions.settings, contrib_daily_limit=1))
    client.put("/api/contribute/Asha", json={"on": True}, headers=KEY)
    assert [evaluate(client)["contributed"] for _ in range(2)] == [True, False]


def test_turning_off_keeps_what_was_given_and_delete_removes_it(client, spool, session_factory):
    client.put("/api/contribute/Asha", json={"on": True}, headers=KEY)
    evaluate(client)
    contributor = find_user(session_factory(), "Asha").contributor_id

    off = client.put("/api/contribute/Asha", json={"on": False}, headers=KEY).json()
    assert off["on"] is False and off["given"] == 1 and len(kept(spool)) == 2
    assert evaluate(client)["contributed"] is False

    deleted = client.delete("/api/contribute/Asha", headers=KEY).json()
    assert deleted["deleted"] == 1 and deleted["given"] == 0 and kept(spool) == []
    db = session_factory()
    assert db.scalar(select(ContributionWithdrawal.contributor_id)) == contributor
    assert find_user(db, "Asha").contributor_id is None
    # Turning it on again starts over under a new random id.
    client.put("/api/contribute/Asha", json={"on": True}, headers=KEY)
    assert find_user(session_factory(), "Asha").contributor_id not in (None, contributor)


def test_deleting_history_also_takes_back_the_recordings(client, spool, session_factory):
    client.put("/api/contribute/Asha", json={"on": True}, headers=KEY)
    evaluate(client)
    db = session_factory()
    user = find_user(db, "Asha")
    contributor = user.contributor_id
    delete_history(db, user)
    assert db.scalar(select(ContributionWithdrawal.contributor_id)) == contributor
    assert db.scalar(select(User.contributor_id).where(User.id == user.id)) is None and kept(spool) == []


def test_a_dispute_on_a_given_recording_travels_with_it(client, spool, fake_asr):
    disputes_api.dispute_rate_limiter.reset()
    client.put("/api/contribute/Asha", json={"on": True}, headers=KEY)
    fake_asr.text, fake_asr.words = "I sink this is the third time", timed_words("I sink this is the third time")
    record_id = evaluate(client)["record_id"]

    body = {"username": "Asha", "record_id": record_id, "word": "think", "expected": "θ", "detected": "s", "reason": "said_correctly"}
    assert client.post("/api/disputes", json=body, headers=KEY).status_code == 200
    dispute = json.loads(next(spool.glob("*/*.dispute-*.json")).read_text(encoding="utf-8"))
    assert dispute["word"] == "think" and dispute["expected"] == "θ" and dispute["reason"] == "said_correctly"


# --- uploading to the dataset ------------------------------------------------------------------------


class FakeHub:
    def __init__(self, private=True, files=()):
        self.private, self.files, self.commits, self.deleted, self.squashed = private, set(files), [], [], 0

    def repo_info(self, repo_id, repo_type=None):
        return type("Info", (), {"private": self.private})()

    def create_repo(self, *args, **kwargs):
        raise AssertionError("the repo exists")

    def list_repo_files(self, repo_id, repo_type=None):
        return sorted(self.files)

    def create_commit(self, repo_id, operations, repo_type=None, commit_message=""):
        self.commits.append([op.path_in_repo for op in operations])
        self.files.update(op.path_in_repo for op in operations)

    def delete_folder(self, path, repo_id, repo_type=None, commit_message=""):
        self.deleted.append(path)
        self.files = {f for f in self.files if not f.startswith(path + "/")}

    def super_squash_history(self, repo_id, repo_type=None, commit_message=""):
        self.squashed += 1


def test_queued_recordings_are_uploaded_in_one_batch_and_only_to_a_private_dataset(client, spool, session_factory, monkeypatch):
    client.put("/api/contribute/Asha", json={"on": True}, headers=KEY)
    evaluate(client)
    evaluate(client)
    contributor = find_user(session_factory(), "Asha").contributor_id

    public = FakeHub(private=False)
    monkeypatch.setattr(contributions, "_api", lambda: public)
    assert contributions.flush(session_factory) == 0 and public.commits == [] and len(kept(spool)) == 4

    hub = FakeHub()
    monkeypatch.setattr(contributions, "_api", lambda: hub)
    assert contributions.flush(session_factory) == 4
    assert len(hub.commits) == 1 and all(path.startswith(f"clips/{contributor}/") for path in hub.commits[0])
    assert kept(spool) == []


def test_a_withdrawal_deletes_the_files_and_the_history_of_the_dataset(client, spool, session_factory, monkeypatch):
    client.put("/api/contribute/Asha", json={"on": True}, headers=KEY)
    evaluate(client)
    hub = FakeHub()
    monkeypatch.setattr(contributions, "_api", lambda: hub)
    contributions.flush(session_factory)
    contributor = find_user(session_factory(), "Asha").contributor_id

    client.delete("/api/contribute/Asha", headers=KEY)
    contributions.flush(session_factory)

    assert hub.deleted == [f"clips/{contributor}"] and hub.squashed == 1 and not hub.files
    db = session_factory()
    assert db.scalar(select(ContributionWithdrawal.done_at)) is not None
    contributions.flush(session_factory)  # done once, not again
    assert hub.squashed == 1


def test_a_recording_queued_just_before_a_withdrawal_is_never_uploaded(client, spool, session_factory, monkeypatch):
    client.put("/api/contribute/Asha", json={"on": True}, headers=KEY)
    contributor = find_user(session_factory(), "Asha").contributor_id
    db = session_factory()
    db.add(ContributionWithdrawal(contributor_id=contributor))
    db.commit()
    (spool / contributor).mkdir(parents=True)
    (spool / contributor / "0123456789abcdef.json").write_text("{}", encoding="utf-8")
    hub = FakeHub()
    monkeypatch.setattr(contributions, "_api", lambda: hub)
    assert contributions.flush(session_factory) == 0 and hub.commits == [] and kept(spool) == []


# --- the quality checks -----------------------------------------------------------------------------


def speech_like(seconds=2.0, level=0.2, noise=0.0005, clip_at=None):
    """Half a second of near-silence, a voiced stretch, and near-silence again."""
    rng = np.random.default_rng(0)
    n = int(seconds * SAMPLE_RATE)
    samples = rng.standard_normal(n).astype(np.float32) * noise
    t = np.arange(n) / SAMPLE_RATE
    voiced = (t > 0.5) & (t < seconds - 0.5)
    samples[voiced] += level * np.sin(2 * np.pi * 180 * t[voiced]).astype(np.float32)
    return np.clip(samples, -clip_at, clip_at) if clip_at else samples


SCORED = {"metrics": {"completeness": 100.0}, "words": [{"reference": "think", "status": "correct", "acoustic": True}]}


def test_a_clean_recording_of_the_sentence_passes():
    checks = quality.assess(speech_like(), SCORED)
    assert checks["usable"] is True and checks["snr_db"] > 40


@pytest.mark.parametrize(
    "samples, result, problem",
    [
        (speech_like(level=0.002), SCORED, "too_quiet"),
        (speech_like(level=1.5, clip_at=1.0), SCORED, "clipped"),
        (speech_like(noise=0.08), SCORED, "noisy"),
        (speech_like(seconds=0.4), SCORED, "length"),
        (speech_like(), {**SCORED, "metrics": {"completeness": 50.0}}, "not_the_sentence"),
        (speech_like(), {**SCORED, "words": [{"reference": "think", "status": "correct"}]}, "no_sound_analysis"),
    ],
)
def test_poor_recordings_are_turned_away(samples, result, problem):
    checks = quality.assess(samples, result)
    assert checks["usable"] is False and problem in checks["problems"]


def test_a_slip_does_not_make_a_recording_unusable():
    slipped = {**SCORED, "score": 35.0, "words": [{"reference": "think", "status": "mispronounced", "acoustic": True}]}
    assert quality.assess(speech_like(), slipped)["usable"] is True


def test_on_a_space_the_dataset_is_named_after_its_owner_and_the_token_has_its_own_name(monkeypatch):
    from backend import config

    monkeypatch.delenv("PRONUNCIATION_COACH_DATASET_REPO", raising=False)
    monkeypatch.setenv("SPACE_AUTHOR_NAME", "Asha")
    assert config._dataset_repo() == "Asha/vocaly-recordings"
    monkeypatch.setenv("PRONUNCIATION_COACH_DATASET_REPO", "team/recordings")
    assert config._dataset_repo() == "team/recordings"
    monkeypatch.delenv("PRONUNCIATION_COACH_DATASET_REPO")
    monkeypatch.delenv("SPACE_AUTHOR_NAME")
    assert config._dataset_repo() == ""

    # A Hugging Face token set for other reasons never turns giving on.
    monkeypatch.setenv("HF_TOKEN", "hf_for_downloads")
    monkeypatch.delenv("PRONUNCIATION_COACH_DATASET_TOKEN", raising=False)
    assert config.Settings().hf_token == ""
