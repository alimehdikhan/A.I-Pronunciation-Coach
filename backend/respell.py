"""
A word's pronunciation spelled the way an English reader would sound it out.

IPA (/əˈbaʊt/) is exact but unreadable for most people. This gives the same information in plain
letters: "uh-BOWT". The stressed syllable is in capitals when a word has more than one.

    think      thingk        about     uh-BOWT       the     thuh
    beautiful  BYOO-tuh-fuhl  thorough  THUR-oh
"""

from __future__ import annotations

from backend import phonetics

_LETTERS = {
    # consonants that are not spelled as themselves
    "θ": "th", "ð": "th", "ʃ": "sh", "ʒ": "zh", "tʃ": "ch", "dʒ": "j", "ŋ": "ng", "j": "y",
    # vowels and diphthongs
    "i": "ee", "ɪ": "i", "ɛ": "eh", "æ": "a", "ɑ": "ah", "ɔ": "aw", "ʊ": "oo", "u": "oo",
    "ʌ": "uh", "ə": "uh", "ɚ": "ur", "ɝ": "ur",
    "eɪ": "ay", "aɪ": "y", "ɔɪ": "oy", "aʊ": "ow", "oʊ": "oh",
}


def _syllable(phonemes: list[str]) -> str:
    return "".join(_LETTERS.get(p, p) for p in phonemes)


def respell(word: str) -> str | None:
    """The word in plain letters, or None when the dictionary does not know it."""
    try:
        pron = phonetics.primary_pronunciation(word)
    except Exception:
        return None
    if pron.source == "spelling" or not pron.phonemes:
        return None
    syllables = phonetics.syllabify(pron)
    parts = [_syllable(list(s["phonemes"])) for s in syllables]
    if len(parts) > 1:
        stressed = next((i for i, s in enumerate(syllables) if s["stress"] == 1), None)
        if stressed is not None:
            parts[stressed] = parts[stressed].upper()
    return "-".join(p for p in parts if p)
