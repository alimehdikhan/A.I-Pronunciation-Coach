from backend.pronunciation import PronunciationScorer


class FailingEpitran:
    def transliterate(self, text):
        raise KeyError("")


def make_fallback_scorer():
    scorer = PronunciationScorer.__new__(PronunciationScorer)
    scorer.language = "eng-Latn"
    scorer.epi = FailingEpitran()
    scorer.phoneme_backend = "epitran"
    return scorer


def test_exact_match_scores_100_with_fallback_backend():
    scorer = make_fallback_scorer()

    result = scorer.score_pronunciation("Hello, world!", "hello world")

    assert result["score"] == 100.0
    assert result["accuracy"] == 100.0
    assert result["phoneme_analysis"]["backend"] == "text-fallback"


def test_score_is_clamped_to_percentage_range():
    scorer = make_fallback_scorer()

    result = scorer.score_pronunciation("hello world", "yellow bird")

    assert 0 <= result["score"] <= 100
    assert 0 <= result["accuracy"] <= 100
    assert 0 <= result["phoneme_analysis"]["phoneme_similarity"] <= 100


def test_empty_reference_returns_zero_score():
    scorer = make_fallback_scorer()

    result = scorer.score_pronunciation("", "hello")

    assert result["score"] == 0.0
    assert result["accuracy"] == 0.0
    assert result["word_level_scores"] == []
