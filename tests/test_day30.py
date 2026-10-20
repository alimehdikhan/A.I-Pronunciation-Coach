"""Day 1 vs Day 30: one answer now and again later, kept only with consent, compared in numbers."""

from datetime import timedelta

from sqlalchemy import update

from backend import progress_clips
from backend.config import settings
from backend.database import ProgressClip, utcnow
from tests.conftest import OTHER_KEY, PROFILE_KEY, timed_words, wav_bytes

KEY = {"X-Profile-Key": PROFILE_KEY}
DAY1 = "Um, I am, uh, a software engineer and, um, I build, uh, payment systems."
DAY30 = "I'm a software engineer, and I build payment systems that millions of people use every day."


def record(client, consent=True, prompt="hire", headers=KEY):
    return client.post(
        "/api/day30/Asha/record",
        data={"prompt_id": prompt, "consent": "true" if consent else "false"},
        files={"audio": ("a.wav", wav_bytes(seconds=4), "audio/wav")},
        headers=headers,
    )


def test_pace_counts_as_better_when_it_moves_towards_an_easy_pace():
    slow_to_easy = progress_clips._pace(90, 135)
    fast_to_easy = progress_clips._pace(200, 150)
    easy_to_fast = progress_clips._pace(140, 190)
    assert slow_to_easy["better"] and fast_to_easy["better"] and not easy_to_fast["better"]


def test_day_one_needs_consent_and_picks_the_question(client, fake_asr):
    assert record(client, consent=False).status_code == 400
    fake_asr.text, fake_asr.words = DAY1, timed_words(DAY1)
    status = record(client).json()
    assert [r["round"] for r in status["rounds"]] == [0] and status["rounds"][0]["prompt"]["id"] == "hire"
    first = status["rounds"][0]["measures"]
    assert first["fillers"] >= 3 and first["fillers_per_minute"] > 0
    assert status["next"]["round"] == 1 and status["next"]["due"] is False and status["comparison"] is None
    assert record(client).status_code == 409  # not due yet
    assert client.get("/api/day30/Asha/audio/0", headers=KEY).content == wav_bytes(seconds=4)
    assert client.get("/api/day30/Asha/audio/0", headers={"X-Profile-Key": OTHER_KEY}).status_code == 403


def test_a_month_later_the_same_question_is_compared(client, fake_asr, session_factory):
    fake_asr.text, fake_asr.words = DAY1, timed_words(DAY1, step=0.6)
    record(client)
    db = session_factory()
    db.execute(update(ProgressClip).values(created_at=utcnow().replace(tzinfo=None) - timedelta(days=settings.compare_days)))
    db.commit()
    db.close()
    fake_asr.text, fake_asr.words = DAY30, timed_words(DAY30, step=0.42)
    status = record(client, prompt="about").json()
    assert [r["prompt"]["id"] for r in status["rounds"]] == ["hire", "hire"]  # the same question as day one
    change = status["comparison"]
    assert change["fillers_per_minute"]["better"] is True and change["fillers_per_minute"]["after"] == 0
    assert change["wpm"]["better"] is True


def test_silence_is_not_kept_and_everything_can_be_deleted(client, fake_asr):
    fake_asr.text, fake_asr.words = "", []
    assert record(client).status_code == 422
    fake_asr.text, fake_asr.words = DAY1, timed_words(DAY1)
    record(client)
    assert client.delete("/api/day30/Asha", headers=KEY).json() == {"deleted": 1}
    assert client.get("/api/day30/Asha", headers=KEY).json()["rounds"] == []


def test_deleting_history_removes_the_recordings(client, fake_asr):
    fake_asr.text, fake_asr.words = DAY1, timed_words(DAY1)
    record(client)
    assert client.delete("/api/history/Asha", headers=KEY).status_code == 200
    assert client.get("/api/day30/Asha", headers=KEY).json()["rounds"] == []
