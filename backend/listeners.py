"""
Real listeners: does a person, not just the scorer, understand you?

A learner can share one practice recording (with consent, anonymously, for 30 days). Other
signed-in learners hear it and type what they heard; each word of the sentence is then marked
heard or missed, and the owner sees, per word, how many listeners caught it and what they heard
instead. The typed text itself is never shown to the owner. Everything here is plain functions.
"""

from __future__ import annotations

import re
from collections import Counter
from difflib import SequenceMatcher
from typing import Any

CLIP_DAYS = 30
MAX_CLIP_BYTES = 3 * 1024 * 1024
MAX_ACTIVE_CLIPS = 10
MAX_TYPED_CHARS = 300
_WORD = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")


def words_of(text: str) -> list[str]:
    """Lower-case words, with curly apostrophes made straight ("don’t" and "don't" match)."""
    return _WORD.findall((text or "").lower().replace("’", "'").replace("‘", "'"))


def compare(target: str, typed: str) -> list[dict[str, Any]]:
    """Each word of the sentence: was it heard, and if not, what was typed in its place."""
    wanted, heard = words_of(target), words_of(typed)
    result = [{"word": word, "heard": False, "as": None} for word in wanted]
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, wanted, heard, autojunk=False).get_opcodes():
        if tag == "equal":
            for k in range(i1, i2):
                result[k]["heard"] = True
        elif tag == "replace":
            for k in range(i1, i2):
                j = j1 + (k - i1)
                result[k]["as"] = heard[j] if j < j2 else None
    return result


def safe_words(words: list[dict[str, Any]], abusive: bool) -> list[dict[str, Any]]:
    """What may be shown to the owner: an abusive answer keeps its heard/missed marks, never its words."""
    return [
        {"word": w["word"], "heard": w["heard"], "as": None if abusive or not w["as"] or len(w["as"]) > 20 else w["as"]}
        for w in words
    ]


def summary(target: str, answers: list[list[dict[str, Any]]]) -> dict[str, Any]:
    """Across every listener: how much was understood, and which words were missed and as what."""
    wanted = words_of(target)
    listeners = len(answers)
    per_word = []
    for index, word in enumerate(wanted):
        marks = [a[index] for a in answers if index < len(a)]
        heard = sum(1 for m in marks if m["heard"])
        instead = Counter(m["as"] for m in marks if not m["heard"] and m["as"])
        per_word.append({"word": word, "heard": heard, "of": len(marks), "heard_as": [w for w, _n in instead.most_common(2)]})
    total = sum(w["of"] for w in per_word)
    understood = sum(w["heard"] for w in per_word)
    return {
        "listeners": listeners,
        "understood": round(understood / total * 100) if total else None,
        "words": per_word,
        "missed": [w for w in per_word if w["of"] and w["heard"] < w["of"]],
    }
