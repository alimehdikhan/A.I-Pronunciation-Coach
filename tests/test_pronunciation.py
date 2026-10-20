"""Tests for the pronunciation scoring engine."""

import pytest

from backend.pronunciation import PronunciationScorer, normalize_difficulty
from tests.conftest import timed_words


@pytest.fixture(scope="module")
def scorer():
    return PronunciationScorer()


def statuses(result):
    return [(w["reference"], w["status"]) for w in result["words"]]


def test_exact_match_scores_100(scorer):
    result = scorer.score_pronunciation("Hello, world!", "hello world")

    assert result["score"] == 100.0
    assert result["accuracy"] == 100.0
    assert result["phoneme_analysis"]["backend"] == "cmudict"


def test_skipped_word_does_not_shift_later_words(scorer):
    result = scorer.score_pronunciation("Today is a beautiful day.", "Today is beautiful day")

    assert statuses(result) == [
        ("today", "correct"), ("is", "correct"), ("a", "missing"),
        ("beautiful", "correct"), ("day", "correct"),
    ]
    assert result["metrics"]["completeness"] == 80.0
    assert result["insights"][0]["kind"] == "missing"


def test_extra_word_is_flagged(scorer):
    result = scorer.score_pronunciation("hello world", "hello um world")

    assert [w["status"] for w in result["words"]] == ["correct", "extra", "correct"]
    assert result["metrics"]["completeness"] == 100.0


def test_phoneme_substitution_is_reported(scorer):
    result = scorer.score_pronunciation("The very best wine.", "The wery best vine")

    very = result["words"][1]
    assert very["status"] == "mispronounced"
    assert very["expected_ipa"] == "ˈvɛri"
    assert {"op": "replace", "expected": "v", "actual": "w", "tier": "fix"} in very["alignment"]
    assert very["tier"] == "fix"  # without the audio model, a different word heard is a "fix" slip
    assert set(result["weak_phonemes"]) == {"v", "w"}
    assert very["score"] < 80


def test_numbers_and_homophones_count_as_correct(scorer):
    assert scorer.score_pronunciation("I can count to 10.", "I can count two ten")["accuracy"] == 100.0


def test_score_is_clamped_to_percentage_range(scorer):
    result = scorer.score_pronunciation("hello world", "yellow bird")

    assert 0 <= result["score"] <= 100
    for value in result["metrics"].values():
        assert value is None or 0 <= value <= 100


def test_empty_reference_returns_zero_score(scorer):
    result = scorer.score_pronunciation("", "hello")

    assert result["score"] == 0.0
    assert result["words"] == []


def test_difficulty_aliases_and_strictness(scorer):
    assert normalize_difficulty("Professional") == "advanced"
    assert normalize_difficulty("custom") == "intermediate"
    assert normalize_difficulty(None) == "intermediate"

    lenient = scorer.score_pronunciation("I think so", "I sink so", "beginner")["score"]
    strict = scorer.score_pronunciation("I think so", "I sink so", "professional")["score"]
    assert lenient > strict


def test_low_confidence_word_is_unclear(scorer):
    words = timed_words("Today is a beautiful day.")
    words[3]["probability"] = 0.2

    result = scorer.score_pronunciation("Today is a beautiful day.", "Today is a beautiful day.", words=words)

    assert result["words"][3]["status"] == "unclear"
    assert result["metrics"]["clarity"] < 95
    assert any(i["kind"] == "unclear" for i in result["insights"])


def test_fluency_penalises_long_pauses(scorer):
    smooth = timed_words("We go to school every day")
    paused = timed_words("We go to school every day")
    for word in paused[3:]:
        word["start"] += 2.0
        word["end"] += 2.0

    smooth_result = scorer.score_pronunciation("We go to school every day", "We go to school every day", words=smooth)
    paused_result = scorer.score_pronunciation("We go to school every day", "We go to school every day", words=paused)

    assert paused_result["speech"]["long_pauses"] == 1
    assert paused_result["words"][3]["pause_before"] > 2
    assert paused_result["metrics"]["fluency"] < smooth_result["metrics"]["fluency"]


def test_fluency_is_none_without_timings(scorer):
    result = scorer.score_pronunciation("We go to school every day", "We go to school every day")

    assert result["metrics"]["fluency"] is None
    assert result["metrics"]["clarity"] is None


def test_unrelated_sentence_scores_low(scorer):
    words = timed_words("I think this is the turd time.")
    result = scorer.score_pronunciation("Today is a beautiful day.", "I think this is the turd time.", words=words)

    assert result["metrics"]["completeness"] <= 40
    assert result["score"] < 40


def test_intelligibility_is_the_share_of_target_words_a_listener_caught(scorer):
    result = scorer.score_pronunciation("The very best wine.", "The wery best vine")
    assert result["intelligibility"] == {"score": 50.0, "recovered": 2, "words": 4, "estimate": True}
    very = result["words"][1]
    assert very["misheard"] is True and very["heard_as"] == "wery"
    assert result["words"][0]["misheard"] is False

    # Numbers and homophones are caught; a skipped word is not.
    assert scorer.score_pronunciation("I can count to 10.", "I can count two ten")["intelligibility"]["score"] == 100.0
    skipped = scorer.score_pronunciation("I like green tea", "I like tea")
    assert skipped["intelligibility"]["recovered"] == 3
    assert [w["heard_as"] for w in skipped["words"] if w["misheard"]] == [None]


def test_intelligibility_is_not_part_of_the_score(scorer):
    from backend import pronunciation

    result = scorer.score_pronunciation("The very best wine.", "The wery best vine")
    weights = pronunciation.METRIC_WEIGHTS
    assert "intelligibility" not in weights and "intelligibility" not in result["metrics"]
