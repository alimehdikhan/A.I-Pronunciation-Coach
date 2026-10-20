"""
Listening drills: high variability phonetic training (HVPT).

A learner who cannot hear the difference between two sounds struggles to say it. HVPT
trains the ear by playing one word of a minimal pair in many different voices and
asking which word it was, with feedback after every answer. Varying voices and words
(not one speaker saying one pair) is what makes the gain carry over to new speech.

Everything here is plain functions: which contrasts to train, and a session of trials.
"""

from __future__ import annotations

import random
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Iterable, Sequence

from backend import phonetics
from backend.phoneme_kb import PHONEMES, get_phoneme
from backend.tutor import DEFAULT_FOCUS

TRIALS = 20
MAX_CONTRASTS = 3
# Fewer voices than this still works, but variety is what makes the training transfer.
MIN_VOICES = 3
# Perception accuracy is only trusted (to decide the coach session) after this many trials.
MIN_PERCEPTION_TRIALS = 10


@dataclass(frozen=True)
class Contrast:
    """Two sounds a learner may not tell apart, and the word pairs that differ only there."""

    phoneme: str  # the sound being trained
    other: str  # the sound it gets confused with
    pairs: tuple[tuple[str, str], ...]  # (word with `phoneme`, word with `other`)

    def as_dict(self) -> dict[str, Any]:
        entry, other = get_phoneme(self.phoneme) or {}, get_phoneme(self.other) or {}
        return {
            "phoneme": self.phoneme,
            "other": self.other,
            "label": entry.get("label", ""),
            "other_label": other.get("label", ""),
            "pairs": [list(p) for p in self.pairs],
        }


def _differs_at(word: str, other_word: str, phoneme: str) -> str | None:
    """The sound `other_word` has where `word` has `phoneme`, when that is the only change."""
    ops = [op for op in phonetics.compare_words(word, other_word).ops if op[0] != "equal"]
    if len(ops) == 1 and ops[0][0] == "replace" and ops[0][1] == phoneme:
        return ops[0][2]
    return None


# More everyday minimal pairs for the contrasts learners (and Hindi, Urdu and other South
# Asian speakers in particular) most often confuse, so a session varies the words and not
# just the voice. Each pair is checked against the dictionary when loaded; one that does
# not differ at exactly that sound is dropped.
EXTRA_PAIRS: dict[tuple[str, str], tuple[str, ...]] = {
    ("θ", "s"): ("thin sin", "thank sank", "thick sick", "mouth mouse", "path pass", "theme seem", "thumb sum", "worth worse"),
    ("θ", "t"): ("thin tin", "thank tank", "thick tick", "theme team", "thought taught", "both boat", "path pat", "three tree"),
    ("θ", "f"): ("thin fin", "three free", "thought fought", "thirst first", "death deaf", "oath oaf"),
    ("ð", "d"): ("they day", "then den", "those doze", "though dough", "there dare", "breathe breed", "worthy wordy"),
    ("ð", "z"): ("then zen", "breathe breeze", "clothing closing", "teethe tease"),
    ("v", "w"): ("vest west", "vine wine", "vet wet", "veil wail", "verse worse", "vent went", "vow wow", "vary wary"),
    ("w", "v"): ("west vest", "wine vine", "wet vet", "went vent", "worse verse", "wail veil"),
    ("v", "b"): ("very berry", "vote boat", "vest best", "van ban", "vow bow", "curve curb", "veil bail"),
    ("f", "p"): ("fan pan", "fork pork", "fine pine", "fill pill", "fast past", "leaf leap", "coffee copy"),
    ("p", "f"): ("pan fan", "pork fork", "pine fine", "pill fill", "past fast", "leap leaf"),
    ("z", "dʒ"): ("zoo jew", "zest jest", "raise rage"),
    ("dʒ", "z"): ("jest zest", "rage raise", "jew zoo"),
    ("ʃ", "s"): ("ship sip", "shell sell", "shine sign", "sheet seat", "she see", "mesh mess", "shore sore"),
    ("s", "ʃ"): ("sip ship", "sell shell", "sign shine", "seat sheet", "see she", "mess mesh"),
    ("tʃ", "ʃ"): ("chip ship", "chop shop", "cheap sheep", "watch wash", "match mash", "chew shoe"),
    ("r", "l"): ("right light", "read lead", "wrong long", "fry fly", "rock lock", "grass glass", "pray play", "rice lice"),
    ("l", "r"): ("light right", "lead read", "long wrong", "fly fry", "lock rock", "glass grass"),
    ("i", "ɪ"): ("sheep ship", "leave live", "seat sit", "feel fill", "heat hit", "beat bit", "green grin", "peel pill"),
    ("ɪ", "i"): ("ship sheep", "live leave", "sit seat", "fill feel", "hit heat", "bit beat"),
    ("æ", "ɛ"): ("bad bed", "man men", "sat set", "pan pen", "had head", "land lend", "track trek"),
    ("ɛ", "æ"): ("bed bad", "men man", "set sat", "pen pan", "head had", "lend land"),
    ("u", "ʊ"): ("pool pull", "fool full", "suit soot", "luke look", "wooed wood"),
    ("ʊ", "u"): ("pull pool", "full fool", "look luke", "wood wooed"),
    ("eɪ", "ɛ"): ("late let", "pain pen", "wait wet", "sale sell", "date debt", "taste test"),
    ("ŋ", "n"): ("sing sin", "thing thin", "wing win", "rang ran", "sung sun", "bang ban"),
    ("ɑ", "ʌ"): ("cot cut", "hot hut", "not nut", "lock luck", "dock duck", "shot shut"),
    ("ʌ", "ɑ"): ("cut cot", "hut hot", "nut not", "luck lock", "duck dock"),
    ("t", "θ"): ("tin thin", "tank thank", "team theme", "tree three"),
    ("d", "ð"): ("day they", "den then", "dough though", "dare there"),
    ("s", "θ"): ("sin thin", "sank thank", "sick thick", "mouse mouth", "pass path"),
    ("k", "g"): ("coat goat", "cold gold", "back bag", "pick pig", "cap gap"),
    ("t", "d"): ("tie die", "ten den", "seat seed", "bat bad", "write ride"),
}


@lru_cache(maxsize=1)
def all_contrasts() -> dict[tuple[str, str], Contrast]:
    """Every contrast the sound library has minimal pairs for, keyed (phoneme, other)."""
    pairs: dict[tuple[str, str], list[tuple[str, str]]] = {}
    for symbol, entry in PHONEMES.items():
        for correct, wrong in entry.get("minimal_pairs", []):
            a, b = correct.lower(), wrong.lower()
            other = _differs_at(a, b, symbol)
            if other:
                pairs.setdefault((symbol, other), []).append((a, b))
    for (symbol, other), extra in EXTRA_PAIRS.items():
        for text in extra:
            a, b = text.split()
            if _differs_at(a, b, symbol) == other:
                found = pairs.setdefault((symbol, other), [])
                if (a, b) not in found:
                    found.append((a, b))
    # A pair heard from either side trains the same contrast: "sink/think" also serves θ vs s.
    for (p, o), found in list(pairs.items()):
        for b, a in pairs.get((o, p), []):
            if (a, b) not in found:
                found.append((a, b))
    return {key: Contrast(key[0], key[1], tuple(found)) for key, found in pairs.items()}


def contrasts_for(phoneme: str) -> list[Contrast]:
    """The contrasts that train `phoneme`, the most word pairs first."""
    found = [c for (p, _o), c in all_contrasts().items() if p == phoneme]
    return sorted(found, key=lambda c: (-len(c.pairs), c.other))


def weakest_contrasts(
    mistakes: Iterable[tuple[str, str]],
    focus: Sequence[str] = (),
    perception: Iterable[dict[str, Any]] = (),
    limit: int = MAX_CONTRASTS,
) -> list[Contrast]:
    """What to train: contrasts the learner actually confused, then their focus sounds, then the hardest sounds.

    `mistakes` are (expected, heard) pairs from their "Fix this" slips; `perception` is their
    accuracy so far per contrast, so a contrast they already hear well drops down the list.
    """
    known = all_contrasts()
    heard_well = {(p["phoneme"], p["other"]) for p in perception if p.get("trials", 0) >= MIN_PERCEPTION_TRIALS and p.get("accuracy", 0) >= 0.9}
    chosen: list[Contrast] = []

    def add(contrast: Contrast | None) -> None:
        if contrast and contrast not in chosen and len(chosen) < limit:
            chosen.append(contrast)

    for (expected, actual), _n in Counter(mistakes).most_common():
        key = (expected, actual)
        if key in known and key not in heard_well:
            add(known[key])
    for phoneme in [*focus, *DEFAULT_FOCUS]:
        for contrast in contrasts_for(phoneme):
            if (contrast.phoneme, contrast.other) not in heard_well:
                add(contrast)
                break
    return chosen


def build_session(
    contrasts: Sequence[Contrast], voices: Sequence[str], trials: int = TRIALS, rng: random.Random | None = None
) -> list[dict[str, Any]]:
    """A run of trials: one word of a pair, in a random voice, never the same voice twice in a row.

    The trials cycle through the contrasts and through each contrast's word pairs, so both
    the words and the voices vary.
    """
    rng = rng or random.Random()
    if not contrasts or not voices:
        return []
    decks = {c: rng.sample(c.pairs, len(c.pairs)) for c in contrasts}
    out: list[dict[str, Any]] = []
    previous_voice = None
    for i in range(trials):
        contrast = contrasts[i % len(contrasts)]
        deck = decks[contrast]
        pair = deck[(i // len(contrasts)) % len(deck)]
        answer = rng.randrange(2)
        choices = [v for v in voices if v != previous_voice] or list(voices)
        voice = rng.choice(choices)
        previous_voice = voice
        out.append({
            "index": i,
            "phoneme": contrast.phoneme,
            "other": contrast.other,
            "words": list(pair),
            "answer": answer,
            "word": pair[answer],
            "voice": voice,
        })
    rng.shuffle(out)
    for i, trial in enumerate(out):
        trial["index"] = i
    return out


def accuracy_for(perception: Iterable[dict[str, Any]], phoneme: str) -> tuple[float | None, int]:
    """(share heard right, trials) over every contrast that trains `phoneme`."""
    rows = [p for p in perception if p["phoneme"] == phoneme]
    total = sum(p["trials"] for p in rows)
    if not total:
        return None, 0
    return sum(p["correct"] for p in rows) / total, total
