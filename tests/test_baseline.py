"""Before and after: consent to store, the 14/30-day schedule, owner-only playback, deletion."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy import func, select, update

from backend import baseline
from backend.database import BaselineRecording
from backend.repositories import delete_account, find_user
from tests.conftest import OTHER_KEY, PROFILE_KEY, timed_words, wav_bytes

KEY = {"X-Profile-Key": PROFILE_KEY}
T0 = datetime(2026, 10, 1, 9, 0)


def rows(round_number, count, at=T0):
    return [SimpleNamespace(id=i, round=round_number, sentence_index=i, score=80.0, audio=b"x", created_at=at) for i in range(count)]


def test_the_schedule_is_baseline_then_14_days_then_every_30():
    assert baseline.next_round([], T0) == {"round": 0, "due": True, "due_at": None}
    assert baseline.next_round(baseline.rounds_of(rows(0, 3)), T0)["round"] == 0  # finish the baseline first

    done = baseline.rounds_of(rows(0, 5))
    soon = baseline.next_round(done, T0 + timedelta(days=13))
    assert soon == {"round": 1, "due": False, "due_at": T0 + timedelta(days=14)}
    assert baseline.next_round(done, T0 + timedelta(days=14))["due"] is True

    later = baseline.rounds_of(rows(0, 5) + rows(1, 5, at=T0 + timedelta(days=20)))
    assert baseline.next_round(later, T0)["due_at"] == T0 + timedelta(days=50)


def record(client, index, consent=True, headers=KEY):
    data = {"sentence_index": str(index), "consent": "true" if consent else "false"}
    return client.post("/api/baseline/Asha/record", data=data, files={"audio": ("s.wav", wav_bytes(), "audio/wav")}, headers=headers)


def test_nothing_is_stored_without_consent(client, fake_asr, session_factory):
    fake_asr.text, fake_asr.words = baseline.SENTENCES[0], timed_words(baseline.SENTENCES[0])
    assert record(client, 0, consent=False).status_code == 400
    db = session_factory()
    assert db.scalar(select(func.count()).select_from(BaselineRecording)) == 0
    db.close()


def test_a_full_round_then_waiting_then_hearing_it_back(client, fake_asr, session_factory):
    for i, sentence in enumerate(baseline.SENTENCES):
        fake_asr.text, fake_asr.words = sentence, timed_words(sentence)
        assert record(client, i).status_code == 200
    status = client.get("/api/baseline/Asha", headers=KEY).json()
    assert status["rounds"][0]["complete"] is True and status["stored_audio"] == 5
    assert status["next"]["round"] == 1 and status["next"]["due"] is False
    assert record(client, 0).status_code == 409  # not due for 14 days

    recording_id = status["rounds"][0]["sentences"]["0"]["id"]
    played = client.get(f"/api/baseline/Asha/audio/{recording_id}", headers=KEY)
    assert played.status_code == 200 and played.content == wav_bytes()
    assert client.get(f"/api/baseline/Asha/audio/{recording_id}", headers={"X-Profile-Key": OTHER_KEY}).status_code == 403

    db = session_factory()  # fifteen days later
    db.execute(update(BaselineRecording).values(created_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=15)))
    db.commit()
    db.close()
    assert client.get("/api/baseline/Asha", headers=KEY).json()["next"]["due"] is True
    assert record(client, 0).json()["round"] == 1


def test_deleting_audio_keeps_the_scores_and_account_deletion_removes_everything(client, fake_asr, session_factory):
    fake_asr.text, fake_asr.words = baseline.SENTENCES[0], timed_words(baseline.SENTENCES[0])
    record(client, 0)
    assert client.delete("/api/baseline/Asha/audio", headers=KEY).json() == {"deleted": 1}
    status = client.get("/api/baseline/Asha", headers=KEY).json()
    assert status["stored_audio"] == 0 and status["rounds"][0]["sentences"]["0"]["score"] is not None
    assert client.get(f"/api/baseline/Asha/audio/{status['rounds'][0]['sentences']['0']['id']}", headers=KEY).status_code == 404

    fake_asr.text = baseline.SENTENCES[1]
    record(client, 1)
    db = session_factory()
    delete_account(db, find_user(db, "Asha"))
    assert db.scalar(select(func.count()).select_from(BaselineRecording)) == 0
    db.close()
