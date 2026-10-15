"""The learning journey: points, levels, badges, the path, review words and the check-up."""

from datetime import datetime, timedelta, timezone

import pytest

from backend import journey, teaching
from tests.conftest import PROFILE_KEY, timed_words, wav_bytes

HEADERS = {"X-Profile-Key": PROFILE_KEY}
NOW = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)


def obs(phoneme, ok, word="think", when=NOW, score=None):
    return (phoneme, ok, score, word, when)


# --- points and levels --------------------------------------------------------------------------


@pytest.mark.parametrize(("score", "xp"), [(0, 10), (55, 15), (99, 19), (100, 20), (-5, 10), (250, 20)])
def test_each_attempt_is_worth_ten_to_twenty_points(score, xp):
    assert journey.attempt_xp(score) == xp


def test_levels_rise_as_points_add_up():
    assert journey.level_for(0)["level"] == 1
    assert journey.level_for(59)["level"] == 1
    assert journey.level_for(60)["level"] == 2
    assert journey.level_for(240)["level"] == 3
    state = journey.level_for(150)
    assert state["level"] == 2 and state["level_floor"] == 60 and state["next_level_at"] == 240
    assert 0 < state["progress"] < 1


def test_only_listed_goals_are_used():
    assert journey.clean_goal(10) == 10
    assert journey.clean_goal(7) == journey.DEFAULT_GOAL
    assert journey.clean_goal(None) == journey.DEFAULT_GOAL
    assert journey.goal_status(2, 5) == {"target": 5, "done": 2, "met": False, "progress": 0.4}
    assert journey.goal_status(9, 5)["met"] is True and journey.goal_status(9, 5)["progress"] == 1.0


# --- badges ------------------------------------------------------------------------------------------


def test_badges_show_what_is_earned_and_how_far_the_rest_are():
    badges = {b["id"]: b for b in journey.badges_for({"attempts": 12, "best_score": 85, "streak": 2, "sounds_mastered": 0, "goal_days": 0})}

    assert badges["first_try"]["earned"] and badges["ten_tries"]["earned"] and not badges["fifty_tries"]["earned"]
    assert badges["score_80"]["earned"] and not badges["score_90"]["earned"]
    assert badges["streak_3"]["earned"] is False and badges["streak_3"]["have"] == 2 and badges["streak_3"]["need"] == 3
    assert all({"title", "text", "icon", "earned"} <= set(b) for b in badges.values())


# --- the path ----------------------------------------------------------------------------------------


def test_the_path_starts_with_the_hardest_sounds_and_marks_the_current_unit():
    stats = teaching.compute_mastery([obs("θ", True, score=90) for _ in range(8)] + [obs("ð", False) for _ in range(5)])

    path = journey.build_path(stats)
    units = {u["phoneme"]: u for u in path["units"]}

    assert path["units"][0]["phoneme"] == "θ"
    assert units["θ"]["status"] == "mastered" and units["ð"]["status"] == "practising" and units["r"]["status"] == "new"
    assert path["current"] == "ð"  # the first unit not yet mastered
    assert path["mastered"] == 1 and path["total"] == len(path["units"])


def test_a_brand_new_learner_starts_at_the_first_unit():
    path = journey.build_path([])
    assert path["current"] == "θ" and path["mastered"] == 0


# --- review ------------------------------------------------------------------------------------------


def test_words_that_keep_going_wrong_come_back_after_a_rest():
    old = NOW - timedelta(days=2)
    rows = (
        [obs("θ", False, "think", old), obs("θ", False, "think", old), obs("θ", True, "think", old)]
        + [obs("r", False, "red", NOW - timedelta(hours=1)), obs("r", False, "red", NOW - timedelta(hours=1))]  # too recent
        + [obs("l", True, "light", old) for _ in range(5)]  # fine
        + [obs("v", False, "very", old)]  # only one miss
    )

    queue = journey.review_queue(rows, now=NOW)

    assert [q["word"] for q in queue] == ["think"]
    assert queue[0]["misses"] == 2 and queue[0]["tries"] == 3


def test_the_review_queue_is_most_missed_first_and_capped():
    old = NOW - timedelta(days=3)
    rows = []
    for i in range(12):
        rows += [obs("θ", False, f"word{i:02d}", old)] * (2 + (i % 3))
    queue = journey.review_queue(rows, now=NOW)
    assert len(queue) == journey.REVIEW_LIMIT
    assert [q["misses"] for q in queue] == sorted((q["misses"] for q in queue), reverse=True)


# --- the check-up ------------------------------------------------------------------------------------


def test_the_checkup_covers_the_trouble_sounds():
    sounds = {s for item in journey.PLACEMENT for s in item["sounds"]}
    assert {"θ", "ð", "r", "l", "v", "w", "ʃ", "tʃ", "dʒ", "ŋ"} <= sounds
    assert len(journey.PLACEMENT) == 6


@pytest.mark.parametrize(("score", "level"), [(30, "beginner"), (59.9, "beginner"), (60, "intermediate"), (79, "intermediate"), (80, "advanced")])
def test_the_suggested_level_follows_the_average_score(score, level):
    assert journey.suggested_level(score) == level


# --- through the API ---------------------------------------------------------------------------------


def attempt(client, fake_asr, said, target="Hello world", username="Sam"):
    fake_asr.text, fake_asr.words = said, timed_words(said)
    response = client.post(
        "/api/evaluate",
        files={"audio": ("clip.wav", wav_bytes(), "audio/wav")},
        data={"target_text": target, "username": username, "difficulty": "beginner"},
        headers=HEADERS,
    )
    assert response.status_code == 200
    return response.json()


def test_the_placement_items_are_public(client):
    body = client.get("/api/journey/placement").json()
    assert len(body["items"]) == 6 and all(i["text"] and i["sounds"] for i in body["items"])


def test_a_new_learner_gets_an_empty_but_complete_journey(client):
    body = client.get("/api/journey/Nobody", headers=HEADERS).json()

    assert body["goal"] == {"target": 5, "done": 0, "met": False, "progress": 0.0}
    assert body["xp"]["level"] == 1 and body["xp"]["xp"] == 0
    assert body["attempts"] == 0 and body["checkup_done"] is False and body["suggested_level"] is None
    assert body["path"]["current"] == "θ" and body["review"] == []
    assert not any(b["earned"] for b in body["badges"])


def test_attempts_earn_points_a_streak_and_progress_towards_the_goal(client, fake_asr):
    for _ in range(3):
        attempt(client, fake_asr, "Hello world")

    body = client.get("/api/journey/Sam", params={"goal": 3}, headers=HEADERS).json()

    assert body["goal"]["done"] == 3 and body["goal"]["met"] is True
    assert body["attempts"] == 3 and body["xp"]["xp"] >= 3 * journey.XP_BASE
    assert body["streak_days"] == 1
    earned = {b["id"] for b in body["badges"] if b["earned"]}
    assert "first_try" in earned and "ten_tries" not in earned
    assert body["suggested_level"] in ("beginner", "intermediate", "advanced")


def test_the_journey_is_private_to_the_learner(client, fake_asr):
    attempt(client, fake_asr, "Hello world")
    assert client.get("/api/journey/Sam", headers={"X-Profile-Key": "q" * 43}).status_code == 403


def test_an_unlisted_goal_falls_back_to_the_default(client):
    assert client.get("/api/journey/Nobody", params={"goal": 7}).json()["goal"]["target"] == journey.DEFAULT_GOAL


def test_a_chosen_sound_replaces_the_coachs_pick(client):
    plan = client.get("/api/coach/plan/Nobody", params={"focus": "ʃ"}).json()

    assert plan["focus"]["phoneme"] == "ʃ" and plan["focus"]["why"] == "chosen"
    assert "You chose" in plan["focus"]["reason"]
    assert plan["focus"]["words"] and plan["session"]  # a complete session is built around it

    ignored = client.get("/api/coach/plan/Nobody", params={"focus": "nonsense"}).json()
    assert ignored["focus"]["phoneme"] == "θ" and ignored["focus"]["why"] == "starter"
