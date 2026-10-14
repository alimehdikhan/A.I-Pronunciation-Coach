from backend.phoneme_kb import PHONEMES, list_phonemes
from backend.tutor import DEFAULT_FOCUS, explain_mistake, generate_tutor_card, get_personalized_practice


def test_generate_tutor_card_known_phoneme():
    """A /w/ said as /v/ gets the /w/ guide and a substitution-specific tip."""
    card = generate_tutor_card("wine", "w", "v")

    assert card["word"] == "wine"
    assert card["expected_phoneme"] == "w"
    assert card["actual_phoneme"] == "v"
    assert card["phoneme"]["symbol"] == "w"
    assert card["actual"]["symbol"] == "v"

    tutor_data = card["tutor_data"]
    assert tutor_data["name"] == PHONEMES["w"]["name"]
    assert tutor_data["steps"]
    assert tutor_data["minimal_pairs"][0]["correct"]

    assert card["syllable_info"]["syllable_count"] == 1
    assert card["syllable_info"]["ipa"] == "waɪn"


def test_generate_tutor_card_unknown_phoneme():
    card = generate_tutor_card("hello", "xyz", "abc")

    assert card["word"] == "hello"
    assert card["tutor_data"]["name"] == "Unrecognised sound"
    assert "Listen carefully" in card["tutor_data"]["placement_guide"]


def test_lookup_is_exact_not_substring():
    """'tʃ' must not resolve to the 't' or 'ʃ' entries."""
    assert generate_tutor_card("church", "tʃ", "ʃ")["phoneme"]["symbol"] == "tʃ"
    assert generate_tutor_card("cat", "æ", "ɛ")["phoneme"]["symbol"] == "æ"


def test_explain_mistake_handles_deletions():
    assert explain_mistake("t", "")
    assert explain_mistake("θ", "s") != PHONEMES["θ"]["why_wrong"]


def test_get_personalized_practice_uses_weaknesses():
    practices = get_personalized_practice([("v", 5), ("θ", 2)])

    assert [p["target_phoneme"] for p in practices] == ["v", "θ"]
    assert practices[0]["mistake_count"] == 5
    assert practices[0]["personalized"] is True


def test_get_personalized_practice_defaults_without_history():
    practices = get_personalized_practice([])

    assert [p["target_phoneme"] for p in practices] == DEFAULT_FOCUS
    assert practices[0]["personalized"] is False


def test_phoneme_library_covers_all_english_phonemes():
    summaries = list_phonemes()

    assert len(summaries) == 41
    assert {s["category"] for s in summaries} == {"consonant", "vowel", "diphthong"}
