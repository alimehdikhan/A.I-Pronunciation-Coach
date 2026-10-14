"""
Educational Tutor Engine
Provides step-by-step guidance, mouth placement, and personalized practice for phoneme mistakes.
"""

from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from backend import phonetics
from backend.phoneme_kb import PHONEMES, deletion_tip, get_phoneme, list_phonemes, substitution_tip

# Sounds that are hard for most learners; suggested before any history exists.
DEFAULT_FOCUS = ["θ", "ð", "r", "v", "æ"]

GENERIC_PHONEME = {
    "symbol": "",
    "name": "Unrecognised sound",
    "label": "",
    "category": "unknown",
    "group": "",
    "placement": "Listen carefully to the reference audio and mimic the exact mouth shape.",
    "steps": [
        "Play the word slowly and listen for each sound.",
        "Say it in slow motion, exaggerating every sound.",
        "Speed up gradually until it feels natural.",
    ],
    "common_substitutions": [],
    "why_wrong": "Your articulation didn't quite match the expected sound. Try slowing down.",
    "minimal_pairs": [],
    "examples": [],
    "practice_sentence": "Practice makes perfect.",
}


def get_syllable_breakdown(word: str) -> Dict[str, Any]:
    """Syllables, stress and IPA for a word (CMUDict when available)."""
    tokens = phonetics.tokenize(word)
    if not tokens:
        return {"word": word, "syllable_count": 0, "stress_index": 0, "ipa": "", "syllables": [], "phonemes": []}
    info = phonetics.describe_word(tokens[0])
    info["word"] = word.lower().strip()
    return info


def phoneme_details(symbol: str) -> Dict[str, Any]:
    """Full knowledge-base entry formatted for the API."""
    entry = get_phoneme(symbol) or {**GENERIC_PHONEME, "symbol": symbol}
    return {
        **{key: value for key, value in entry.items() if key != "minimal_pairs"},
        "minimal_pairs": [{"correct": a, "incorrect": b} for a, b in entry.get("minimal_pairs", [])],
    }


def explain_mistake(expected: str, actual: str) -> str:
    """The most specific explanation available for an expected→actual slip."""
    entry = get_phoneme(expected) or GENERIC_PHONEME
    if actual in ("", "-"):
        return deletion_tip(expected) or f"The /{expected}/ sound was dropped. {entry['why_wrong']}"
    return substitution_tip(expected, actual) or entry["why_wrong"]


def generate_tutor_card(word: str, expected_phoneme: str, actual_phoneme: str) -> Dict[str, Any]:
    """Generate the full educational payload for a mispronounced word."""
    details = phoneme_details(expected_phoneme)
    actual_details = get_phoneme(actual_phoneme)

    return {
        "word": word,
        "expected_phoneme": expected_phoneme,
        "actual_phoneme": actual_phoneme,
        "phoneme": details,
        "actual": {"symbol": actual_phoneme, "name": actual_details["name"], "label": actual_details["label"]}
        if actual_details else None,
        "tutor_data": {
            "name": details["name"],
            "label": details.get("label", ""),
            "placement_guide": details["placement"],
            "steps": details.get("steps", []),
            "why_wrong": explain_mistake(expected_phoneme, actual_phoneme),
            "common_substitutions": details.get("common_substitutions", []),
            "minimal_pairs": details["minimal_pairs"],
            "easier_words": details.get("examples", []),
            "practice_sentence": details["practice_sentence"],
        },
        "syllable_info": get_syllable_breakdown(word),
    }


WeaknessInput = Union[str, Tuple[str, int]]


def get_personalized_practice(weaknesses: Sequence[WeaknessInput]) -> List[Dict[str, Any]]:
    """Build drills for weak phonemes (symbols, or (symbol, mistake_count) pairs)."""
    items: List[Tuple[str, Optional[int]]] = [
        (w, None) if isinstance(w, str) else (w[0], w[1]) for w in weaknesses
    ]
    personalised = any(get_phoneme(symbol) for symbol, _ in items)
    if not personalised:
        items = [(symbol, None) for symbol in DEFAULT_FOCUS]

    practice = []
    for symbol, count in items:
        entry = get_phoneme(symbol)
        if not entry:
            continue
        practice.append({
            "target_phoneme": symbol,
            "focus": entry["label"],
            "name": entry["name"],
            "category": entry["category"],
            "mistake_count": count,
            "personalized": personalised,
            "sentence": entry["practice_sentence"],
            "minimal_pairs": [list(pair) for pair in entry["minimal_pairs"]],
            "examples": entry["examples"],
            "placement": entry["placement"],
            "steps": entry["steps"],
        })
    return practice


__all__ = [
    "PHONEMES",
    "explain_mistake",
    "generate_tutor_card",
    "get_personalized_practice",
    "get_syllable_breakdown",
    "list_phonemes",
    "phoneme_details",
]
