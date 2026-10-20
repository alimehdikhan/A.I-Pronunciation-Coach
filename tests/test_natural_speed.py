"""Natural-speed mode: careful (slow) speech is shown but, when the learner asks, not counted."""

from sqlalchemy import create_engine, inspect, text

from backend.database import init_db
from backend.pronunciation import is_careful
from tests.conftest import PROFILE_KEY, timed_words, wav_bytes

KEY = {"X-Profile-Key": PROFILE_KEY}
SENTENCE = "I think this is fine"


def test_careful_means_slower_than_the_cut_off_with_enough_words():
    assert is_careful({"wpm": 80, "word_count": 5}, 100) is True
    assert is_careful({"wpm": 140, "word_count": 5}, 100) is False
    assert is_careful({"wpm": 40, "word_count": 2}, 100) is False  # too few words to judge a pace
    assert is_careful({"wpm": None, "word_count": 5}, 100) is False


def say(client, fake_asr, step, natural_speed):
    fake_asr.text = SENTENCE
    fake_asr.words = timed_words(SENTENCE, step=step)
    data = {"target_text": SENTENCE + ".", "username": "Asha", "natural_speed": "true" if natural_speed else "false"}
    return client.post("/api/evaluate", data=data, files={"audio": ("a.wav", wav_bytes(), "audio/wav")}, headers=KEY).json()


def test_careful_speech_is_labelled_and_counts_unless_natural_speed_is_on(client, fake_asr):
    slow = say(client, fake_asr, step=1.2, natural_speed=False)  # 50 wpm
    assert slow["speech"]["careful"] is True and slow["speech"]["careful_below"] == 100
    assert slow["counted"] is True  # natural speed off: a careful attempt still counts

    fast = say(client, fake_asr, step=0.35, natural_speed=True)  # about 170 wpm
    assert fast["speech"]["careful"] is False and fast["counted"] is True

    held_back = say(client, fake_asr, step=1.2, natural_speed=True)
    assert held_back["saved"] is True and held_back["counted"] is False


def test_uncounted_attempts_are_shown_but_left_out_of_mastery_streaks_and_goals(client, fake_asr):
    for _ in range(3):
        say(client, fake_asr, step=1.2, natural_speed=True)

    history = client.get("/api/history/Asha", headers=KEY).json()
    assert history["total"] == 3 and all(r["counted"] is False for r in history["records"])
    assert all(r["wpm"] and r["wpm"] < 100 for r in history["records"])
    assert client.get("/api/coach/plan/Asha", headers=KEY).json()["observations"] == 0
    journey = client.get("/api/journey/Asha", headers=KEY).json()
    assert journey["goal"]["done"] == 0 and journey["streak_days"] == 0 and journey["attempts"] == 0

    say(client, fake_asr, step=0.35, natural_speed=True)
    journey = client.get("/api/journey/Asha", headers=KEY).json()
    assert journey["goal"]["done"] == 1 and journey["streak_days"] == 1


def test_the_new_columns_are_added_to_an_existing_database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'before.db'}")
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE pronunciation_records (id INTEGER PRIMARY KEY, user_id INTEGER, target_text TEXT NOT NULL, "
            "transcribed_text TEXT NOT NULL, score FLOAT NOT NULL, accuracy FLOAT NOT NULL, difficulty VARCHAR, created_at DATETIME)"
        ))
    assert init_db(engine)
    assert {"wpm", "counted"} <= {c["name"] for c in inspect(engine).get_columns("pronunciation_records")}
    engine.dispose()
