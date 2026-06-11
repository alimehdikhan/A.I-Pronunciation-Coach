import pytest
from backend.tutor import generate_tutor_card, get_personalized_practice

def test_generate_tutor_card_known_phoneme():
    """Test generating a tutor card for a known confused phoneme like 'v' instead of 'w'."""
    word = "wine"
    expected = "w"
    actual = "v"
    
    card = generate_tutor_card(word, expected, actual)
    
    assert card["word"] == "wine"
    assert card["expected_phoneme"] == "w"
    assert card["actual_phoneme"] == "v"
    
    tutor_data = card["tutor_data"]
    assert tutor_data["name"] == "Voiced labial-velar approximant"
    assert "Round your lips" in tutor_data["placement_guide"]
    
    # Check that 'actual' was correctly replaced in why_wrong
    assert "v" in tutor_data["why_wrong"]
    
    # Check syllable breakdown
    assert "syllable_info" in card
    assert card["syllable_info"]["syllable_count"] > 0
    assert card["syllable_info"]["stress_index"] > 0

def test_generate_tutor_card_unknown_phoneme():
    """Test generating a tutor card for an unmapped phoneme."""
    word = "hello"
    expected = "xyz"
    actual = "abc"
    
    card = generate_tutor_card(word, expected, actual)
    
    assert card["word"] == "hello"
    tutor_data = card["tutor_data"]
    assert tutor_data["name"] == "Unknown Phoneme"
    assert "Listen carefully" in tutor_data["placement_guide"]

def test_get_personalized_practice():
    """Test fetching personalized practice sentences."""
    weaknesses = ["v", "θ"]
    practices = get_personalized_practice(weaknesses)
    
    assert len(practices) > 0
    # The practice targets should match our weaknesses
    targets = [p["target_phoneme"] for p in practices]
    assert "v" in targets
    assert "θ" in targets
