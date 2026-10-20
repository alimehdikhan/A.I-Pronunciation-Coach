"""
The learner's profile: first language, goal and the language tips are written in.

First language never changes a score. It decides what is shown first (the sounds that are
usually hard for speakers of that language) and lets the coach explain *why* a slip
happens ("Hindi has one sound between v and w"). The notes below are the commonly
described transfer patterns for each language (as in Swan & Smith, *Learner English*,
and similar teaching references): tendencies, not rules about any one person.
"""

from __future__ import annotations

from typing import Any

from backend.coach_tools import LANGUAGES

GOALS = ("understood", "accent")
DEFAULT_GOAL = "understood"
TIP_LANGUAGES = ("English", "Hindi", "Urdu", "Hinglish")
OTHER_LANGUAGE = "Other"
FIRST_LANGUAGES = (*LANGUAGES, OTHER_LANGUAGE)

# (sound, why it is hard for speakers of this language), most common first.
L1_SOUNDS: dict[str, tuple[tuple[str, str], ...]] = {
    "Hindi": (
        ("v", "Hindi has one sound (व) between English v and w, so “vest” and “west” can sound alike."),
        ("w", "Hindi has one sound (व) between English v and w, so “west” and “vest” can sound alike."),
        ("θ", "Hindi has no th sound; the dental त is the nearest, so “thin” can sound like “tin”."),
        ("ð", "Hindi uses the dental द for this sound, so “they” can sound like “day”."),
        ("z", "ज़ is often said as ज, so “zoo” can sound like “joo”."),
        ("æ", "Hindi has no vowel between ए and आ, so “bad” moves toward “bed”."),
        ("ʒ", "The sound in “measure” is rare in Hindi and often becomes ज."),
    ),
    "Urdu": (
        ("v", "Urdu و covers both English v and w, so “vest” and “west” can sound alike."),
        ("w", "Urdu و covers both English v and w, so “west” and “vest” can sound alike."),
        ("θ", "Urdu has no th sound in speech; the dental ت is the nearest, so “thin” can sound like “tin”."),
        ("ð", "Urdu uses the dental د for this sound, so “they” can sound like “day”."),
        ("æ", "Urdu has no vowel between اے and آ, so “bad” moves toward “bed”."),
        ("ʒ", "ژ is rare in Urdu, so the sound in “measure” often becomes ج."),
    ),
    "Bengali": (
        ("v", "Bengali has no v; it often becomes ভ (bh), so “very” can sound like “berry”."),
        ("z", "Bengali has no z; it often becomes জ, so “zoo” can sound like “joo”."),
        ("s", "Bengali speakers often use শ (sh) for s, so “see” can sound like “she”."),
        ("f", "ফ is said with a puff (ph), so “fan” can sound like “pan”."),
        ("θ", "Bengali has no th sound; থ (th with a puff) is used, which sounds like t."),
        ("ð", "Bengali uses দ for this sound, so “they” can sound like “day”."),
        ("æ", "The vowel in “bad” often moves toward “bed”."),
    ),
    "Tamil": (
        ("f", "Tamil has no f; it often becomes p, so “fan” can sound like “pan”."),
        ("z", "Tamil has no z; it often becomes s, so “zip” can sound like “sip”."),
        ("ʃ", "sh is often said as s or ch, so “ship” can sound like “sip”."),
        ("b", "Tamil writes voiced and voiceless stops with one letter, so b and p, d and t, g and k can swap."),
        ("θ", "Tamil has no th sound; t is the nearest, so “thin” can sound like “tin”."),
        ("ð", "Tamil uses d for this sound, so “they” can sound like “day”."),
        ("v", "Tamil has one sound between v and w, so “vest” and “west” can sound alike."),
    ),
    "Telugu": (
        ("f", "Telugu speakers often say f as p (or ph), so “fan” can sound like “pan”."),
        ("z", "z often becomes j, so “zoo” can sound like “joo”."),
        ("θ", "Telugu has no th sound; the dental t is the nearest, so “thin” can sound like “tin”."),
        ("ð", "Telugu uses d for this sound, so “they” can sound like “day”."),
        ("v", "Telugu has one sound between v and w, so “vest” and “west” can sound alike."),
        ("æ", "The vowel in “bad” often moves toward “bed”."),
    ),
    "Marathi": (
        ("v", "Marathi has one sound (व) between v and w, so “vest” and “west” can sound alike."),
        ("w", "Marathi has one sound (व) between v and w, so “west” and “vest” can sound alike."),
        ("θ", "Marathi has no th sound; the dental त is the nearest, so “thin” can sound like “tin”."),
        ("ð", "Marathi uses the dental द, so “they” can sound like “day”."),
        ("z", "z often becomes ज, so “zoo” can sound like “joo”."),
        ("æ", "The vowel in “bad” often moves toward “bed”."),
    ),
    "Chinese (Mandarin)": (
        ("θ", "Mandarin has no th sound; s is the nearest, so “think” can sound like “sink”."),
        ("ð", "Mandarin has no voiced th; d or z is used, so “they” can sound like “day”."),
        ("v", "Mandarin has no v; it often becomes w, so “vest” can sound like “west”."),
        ("r", "English r and l are one area in Mandarin, so “right” and “light” can sound alike."),
        ("l", "English r and l are one area in Mandarin, so “light” and “right” can sound alike."),
        ("ɪ", "Mandarin has one i vowel, so “ship” and “sheep” can sound alike."),
        ("n", "Some Mandarin speakers swap n and l, so “night” can sound like “light”."),
    ),
    "Arabic": (
        ("p", "Arabic has no p; it often becomes b, so “pin” can sound like “bin”."),
        ("v", "Arabic has no v; it often becomes f, so “van” can sound like “fan”."),
        ("tʃ", "ch is often softened to sh, so “chip” can sound like “ship”."),
        ("ɪ", "Arabic has three short vowels, so “bit”, “bet” and “beat” can blur together."),
        ("ɛ", "Arabic has three short vowels, so “bet” can sound like “bit”."),
        ("ŋ", "Arabic has no ng; a g is often added, so “sing” can sound like “sing-g”."),
    ),
    "Spanish": (
        ("v", "Spanish b and v are one sound, so “very” and “berry” can sound alike."),
        ("ɪ", "Spanish has one i vowel, so “ship” and “sheep” can sound alike."),
        ("z", "Spanish has no z sound; it becomes s, so “zoo” can sound like “sue”."),
        ("ʃ", "Spanish has no sh; ch is used, so “ship” can sound like “chip”."),
        ("dʒ", "j is often said as a y sound, so “jet” can sound like “yet”."),
        ("ʌ", "Spanish has no “uh” vowel; a is used, so “cut” can sound like “cot”."),
    ),
}


def clean_first_language(value: Any) -> str | None:
    text = str(value or "").strip()
    if text.lower() == OTHER_LANGUAGE.lower():
        return OTHER_LANGUAGE
    lowered = {name.lower(): name for name in LANGUAGES}
    return lowered.get(text.lower())


def clean_goal(value: Any) -> str:
    return value if value in GOALS else DEFAULT_GOAL


def clean_tip_language(value: Any) -> str:
    lowered = {name.lower(): name for name in TIP_LANGUAGES}
    return lowered.get(str(value or "").strip().lower(), "English")


def common_sounds(first_language: str | None) -> list[str]:
    """Sounds usually hard for speakers of this language, most common first ([] when unknown)."""
    seen: list[str] = []
    for sound, _why in L1_SOUNDS.get(first_language or "", ()):
        if sound not in seen:
            seen.append(sound)
    return seen


def why_hard(first_language: str | None, sound: str) -> str | None:
    """One sentence on why `sound` is hard for speakers of `first_language`, if known."""
    return next((why for s, why in L1_SOUNDS.get(first_language or "", ()) if s == sound), None)


def options() -> dict[str, Any]:
    """What the profile screen offers, and the sounds each first language puts first."""
    return {
        "first_languages": list(FIRST_LANGUAGES),
        "goals": [
            {"id": "understood", "label": "Be clearly understood", "default": True},
            {"id": "accent", "label": "Reduce my accent", "default": False},
        ],
        "tip_languages": list(TIP_LANGUAGES),
        "common_sounds": {language: common_sounds(language) for language in L1_SOUNDS},
    }
