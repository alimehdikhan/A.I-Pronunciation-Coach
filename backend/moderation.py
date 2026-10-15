"""
A first line of defence against abuse in the coach chat.

This runs before any language model is called, so it cannot be argued around and costs
nothing. It catches clear profanity, slurs (English and common Hindi/Urdu written in Latin
letters) and insults aimed at the coach, including the usual disguises: repeated letters,
digits for letters, spaces and dots between letters. It is deliberately conservative about
short words, so ordinary text that merely contains them is not flagged.

It is not a complete moderation system. The model's own instructions cover the rest.
"""

from __future__ import annotations

import re
import unicodedata

# Long or unambiguous: matched anywhere in the letters of the message.
_SUBSTRING = (
    "fuck", "shit", "bitch", "bastard", "asshole", "motherfucker", "bullshit", "dickhead", "wanker",
    "madarchod", "maderchod", "madrchod", "behenchod", "bhenchod", "benchod", "bhosdi", "bhosadi",
    "chutiya", "chutiye", "chutia", "gandu", "gaandu", "haramzada", "haramzade", "kamina", "kutti",
)
# Short words that appear inside innocent ones ("class", "Scunthorpe"): whole words only.
_WORDS = frozenset(
    "cunt cock dick ass arse twat slut whore nigger nigga fag faggot retard randi harami lund loda lauda "
    "laude kutta kutte bsdk bkl".split()
)
_INSULTS = r"stupid|idiot|dumb|useless|trash|garbage|moron|worthless|shut\s*up|hate\s+you"
_AT_THE_COACH = re.compile(rf"\b(you|u|ur|your|youre|you're)\b.*\b({_INSULTS})\b|\b({_INSULTS})\b.*\b(you|u|coach|bot)\b", re.I)

_LEET = str.maketrans({"@": "a", "$": "s", "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t"})
_BANG_IN_WORD = re.compile(r"(?<=[a-z])!(?=[a-z])")  # "sh!t" but not "shut up!!"

RESPECT_REPLY = (
    "Let's keep things respectful, please. I'm here to help you speak clearly, and I'm happy to work "
    "on any word or sound you like. What would you like to practise?"
)
RESPECT_TRY = "Tell me a word you would like to say clearly."


def _letters(text: str) -> str:
    """Lower-case letters only, with accents folded and look-alike digits and symbols swapped in."""
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z]", "", _BANG_IN_WORD.sub("i", folded.lower()).translate(_LEET))


def _squash(text: str) -> str:
    return re.sub(r"(.)\1+", r"\1", text)


_SQUASHED = tuple(_squash(w) for w in _SUBSTRING)


def is_abusive(text: str) -> bool:
    if not text or not text.strip():
        return False
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()
    lowered = _BANG_IN_WORD.sub("i", folded).translate(_LEET)
    if _AT_THE_COACH.search(lowered) or re.search(r"\bshut\s*up\b", lowered):
        return True
    words = re.findall(r"[a-z]+", lowered)
    if any(word in _WORDS or _squash(word) in _WORDS for word in words if len(_squash(word)) >= 3):
        return True
    joined = _letters(text)  # also catches "f u c k" and "f.u.c.k"
    if any(term in joined for term in _SUBSTRING):
        return True
    squashed = _squash(joined)  # and "fuuuck", "shiiit"
    return any(term in squashed for term in _SQUASHED)
