"""
Phonetic utilities: tokenisation, dictionary lookup, syllables and alignment.

CMUDict (via NLTK) is the primary pronunciation source because it works on
every platform without system binaries. Epitran is tried for words CMUDict
does not know; when neither can produce phonemes we fall back to comparing
spelling so scoring still works, just less precisely.

Phonemes are represented as broad, dictionary-style IPA tokens (``"tʃ"``,
``"aɪ"`` and ``"ɝ"`` are single tokens) so alignment never splits a sound.
"""

from __future__ import annotations

import logging
import math
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Callable, Sequence, TypeVar

logger = logging.getLogger("pronunciation_coach.phonetics")

T = TypeVar("T")

WORD_RE = re.compile(r"[a-z0-9]+(?:'[a-z0-9]+)*")

ARPABET_TO_IPA = {
    "AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ",
    "EH": "ɛ", "ER": "ɝ", "EY": "eɪ", "IH": "ɪ", "IY": "i", "OW": "oʊ",
    "OY": "ɔɪ", "UH": "ʊ", "UW": "u",
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "g", "HH": "h",
    "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p",
    "R": "r", "S": "s", "SH": "ʃ", "T": "t", "TH": "θ", "V": "v", "W": "w",
    "Y": "j", "Z": "z", "ZH": "ʒ",
}
# Unstressed AH/ER are reduced vowels in General American.
UNSTRESSED_IPA = {"AH": "ə", "ER": "ɚ"}

VOWELS = frozenset({
    "i", "ɪ", "ɛ", "æ", "ɑ", "ɔ", "ʊ", "u", "ʌ", "ə", "ɝ", "ɚ",
    "eɪ", "aɪ", "ɔɪ", "aʊ", "oʊ",
})

# Epitran/Flite emit narrower symbols; fold them into our inventory.
EPITRAN_FOLD = {"ɹ": "r", "ɡ": "g", "ɫ": "l", "ɾ": "t", "ʧ": "tʃ", "ʤ": "dʒ"}

# Substitution costs for sounds that are acoustically close, so near-misses
# (ship/sheep, voicing slips) cost less than unrelated substitutions.
_NEAR_COSTS: dict[frozenset[str], float] = {}
for _pair, _cost in [
    (("ʌ", "ə"), 0.2), (("ɝ", "ɚ"), 0.2), (("ə", "ɪ"), 0.4),
    (("i", "ɪ"), 0.5), (("u", "ʊ"), 0.5), (("ɛ", "æ"), 0.5), (("ɑ", "ɔ"), 0.5),
    (("ɑ", "ʌ"), 0.5), (("eɪ", "ɛ"), 0.5), (("oʊ", "ɔ"), 0.5), (("ə", "ɚ"), 0.5),
    (("p", "b"), 0.5), (("t", "d"), 0.5), (("k", "g"), 0.5), (("f", "v"), 0.5),
    (("s", "z"), 0.5), (("θ", "ð"), 0.5), (("ʃ", "ʒ"), 0.5), (("tʃ", "dʒ"), 0.5),
    (("m", "n"), 0.6), (("n", "ŋ"), 0.5),
]:
    _NEAR_COSTS[frozenset(_pair)] = _cost

_LEGAL_ONSETS = {
    tuple(onset.split())
    for onset in [
        "p l", "p r", "p j", "b l", "b r", "b j", "t r", "t w", "d r", "d w",
        "k l", "k r", "k w", "k j", "g l", "g r", "g w", "f l", "f r", "f j",
        "v j", "θ r", "θ w", "ʃ r", "s p", "s t", "s k", "s m", "s n", "s l",
        "s w", "s f", "m j", "n j", "h j", "l j",
        "s p l", "s p r", "s t r", "s k r", "s k w", "s p j", "s k j",
    ]
}

_ONES = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
    "eighteen", "nineteen",
]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]


# ---------------------------------------------------------------------------
# Tokenisation
# ---------------------------------------------------------------------------

def number_to_words(n: int) -> list[str]:
    """Spell out a non-negative integer below one million."""
    if n < 20:
        return [_ONES[n]]
    if n < 100:
        tens, ones = divmod(n, 10)
        return [_TENS[tens]] + ([_ONES[ones]] if ones else [])
    if n < 1000:
        hundreds, rest = divmod(n, 100)
        return [_ONES[hundreds], "hundred"] + (number_to_words(rest) if rest else [])
    if n < 1_000_000:
        thousands, rest = divmod(n, 1000)
        return number_to_words(thousands) + ["thousand"] + (number_to_words(rest) if rest else [])
    return [_ONES[int(d)] for d in str(n)]


def normalize_text(text: str) -> str:
    """Lowercase, strip accents and unify apostrophes and whitespace."""
    text = unicodedata.normalize("NFKC", text or "").lower()
    text = text.replace("’", "'").replace("‘", "'")
    text = "".join(ch for ch in unicodedata.normalize("NFKD", text) if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", text).strip()


_DISPLAY_WORD_RE = re.compile(r"[A-Za-z0-9]+(?:'[A-Za-z0-9]+)*")


def _split_words(text: str) -> list[tuple[str, str]]:
    """Return ``(token, display)`` pairs: the comparable token and its original casing."""
    text = unicodedata.normalize("NFKC", text or "").replace("’", "'").replace("‘", "'")
    text = "".join(ch for ch in unicodedata.normalize("NFKD", text) if not unicodedata.combining(ch))
    text = re.sub(r"(\d),(\d)", r"\1\2", text)
    text = re.sub(r"[-–—/]", " ", text)
    pairs: list[tuple[str, str]] = []
    for display in _DISPLAY_WORD_RE.findall(text):
        if display.isdigit():
            spelled = number_to_words(int(display)) if len(display) <= 6 else [_ONES[int(d)] for d in display]
            pairs.extend((word, word) for word in spelled)
        else:
            pairs.append((display.lower(), display))
    return pairs


def tokenize(text: str) -> list[str]:
    """Split text into comparable words; digits are spelled out."""
    return [token for token, _ in _split_words(text)]


def display_tokens(text: str) -> list[str]:
    """Same words as :func:`tokenize`, with the original casing kept for display."""
    return [display for _, display in _split_words(text)]


# ---------------------------------------------------------------------------
# Pronunciation lookup
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Pronunciation:
    phonemes: tuple[str, ...]
    stresses: tuple[int | None, ...]
    source: str  # "cmudict" | "epitran" | "rules" | "spelling"


_cmudict_cache: dict[str, list[list[str]]] | None = None
_epitran_state: dict[str, object] = {"instance": None, "disabled": False, "language": "eng-Latn"}


def _cmudict() -> dict[str, list[list[str]]]:
    global _cmudict_cache
    if _cmudict_cache is not None:
        return _cmudict_cache
    try:
        import nltk

        try:
            nltk.data.find("corpora/cmudict")
        except LookupError:
            nltk.download("cmudict", quiet=True)
        from nltk.corpus import cmudict

        _cmudict_cache = cmudict.dict()
        logger.info("Loaded CMUDict with %d entries.", len(_cmudict_cache))
    except Exception:
        logger.warning("CMUDict is unavailable; falling back to Epitran/spelling.", exc_info=True)
        _cmudict_cache = {}
    return _cmudict_cache


def warm_up(language: str = "eng-Latn") -> None:
    """Load dictionaries eagerly so the first request is fast."""
    _epitran_state["language"] = language
    _cmudict()
    word_with_sounds(())


def dictionary_available() -> bool:
    return bool(_cmudict())


def _from_arpabet(arpabet: Sequence[str]) -> Pronunciation:
    phonemes: list[str] = []
    stresses: list[int | None] = []
    for symbol in arpabet:
        base = symbol.rstrip("012")
        stress = int(symbol[-1]) if symbol[-1].isdigit() else None
        ipa = UNSTRESSED_IPA[base] if stress == 0 and base in UNSTRESSED_IPA else ARPABET_TO_IPA.get(base)
        if ipa is None:
            continue
        phonemes.append(ipa)
        stresses.append(stress)
    return Pronunciation(tuple(phonemes), tuple(stresses), "cmudict")


def _epitran_pronunciation(word: str) -> Pronunciation | None:
    if _epitran_state["disabled"]:
        return None
    try:
        if _epitran_state["instance"] is None:
            import epitran

            _epitran_state["instance"] = epitran.Epitran(str(_epitran_state["language"]))
        segments = _epitran_state["instance"].trans_list(word)  # type: ignore[attr-defined]
    except Exception:
        # English Epitran needs Flite's lex_lookup binary; don't retry per word.
        logger.info("Epitran unavailable; out-of-dictionary words will be compared by spelling.")
        _epitran_state["disabled"] = True
        return None

    phonemes = tuple(EPITRAN_FOLD.get(seg, seg) for seg in segments if seg.strip() and seg not in {"ˈ", "ˌ", "ː"})
    if not phonemes:
        return None
    return Pronunciation(phonemes, tuple(None for _ in phonemes), "epitran")


# Letter-to-sound rules for words CMUDict doesn't know. Whisper often writes
# mispronunciations as non-words ("tings", "zis", "vill"); approximate
# phonemes still let us pinpoint the substituted sound against the target.
_GRAPHEME_RULES: list[tuple[str, tuple[str, ...]]] = sorted(
    [
        ("tch", ("tʃ",)), ("dge", ("dʒ",)), ("igh", ("aɪ",)), ("eigh", ("eɪ",)), ("augh", ("ɔ",)),
        ("th", ("θ",)), ("sh", ("ʃ",)), ("ch", ("tʃ",)), ("ph", ("f",)), ("wh", ("w",)), ("ck", ("k",)),
        ("ng", ("ŋ",)), ("nk", ("ŋ", "k")), ("qu", ("k", "w")), ("kn", ("n",)), ("wr", ("r",)),
        ("ee", ("i",)), ("ea", ("i",)), ("oo", ("u",)), ("ou", ("aʊ",)), ("ow", ("aʊ",)), ("ai", ("eɪ",)),
        ("ay", ("eɪ",)), ("oi", ("ɔɪ",)), ("oy", ("ɔɪ",)), ("au", ("ɔ",)), ("aw", ("ɔ",)), ("ie", ("i",)),
        ("ei", ("eɪ",)), ("oa", ("oʊ",)), ("ue", ("u",)), ("ew", ("u",)),
        ("ar", ("ɑ", "r")), ("er", ("ɝ",)), ("ir", ("ɝ",)), ("ur", ("ɝ",)), ("or", ("ɔ", "r")),
    ],
    key=lambda rule: -len(rule[0]),
)
_WORD_INITIAL_ONLY = {"kn", "wr"}
_SHORT_VOWEL = {"a": "æ", "e": "ɛ", "i": "ɪ", "o": "ɑ", "u": "ʌ"}
_LONG_VOWEL = {"a": "eɪ", "e": "i", "i": "aɪ", "o": "oʊ", "u": "u"}
_CONSONANT = {
    "b": "b", "d": "d", "f": "f", "h": "h", "j": "dʒ", "k": "k", "l": "l", "m": "m", "n": "n",
    "p": "p", "q": "k", "r": "r", "s": "s", "t": "t", "v": "v", "w": "w", "z": "z",
}
_VOICED_ENDINGS = set("bdglmnrvw")
_R_COLORED = {"ar", "er", "ir", "ur", "or"}


def rule_pronunciation(word: str) -> Pronunciation | None:
    """Approximate General American phonemes from spelling (greedy grapheme rules)."""
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w or not re.search(r"[aeiouy]", w):
        return None
    out: list[str] = []
    i, n = 0, len(w)
    while i < n:
        ch = w[i]
        # Magic e: vowel + single consonant + final "e" -> long vowel (bike, vote).
        if ch in _LONG_VOWEL and i + 2 == n - 1 and w[-1] == "e" and w[i + 1] not in "aeiouwy":
            out.append(_LONG_VOWEL[ch])
            i += 1
            continue
        rule = next(
            (
                r
                for r in _GRAPHEME_RULES
                if w.startswith(r[0], i)
                and (r[0] not in _WORD_INITIAL_ONLY or i == 0)
                # "er" in "very" is /ɛr/, not r-coloured: only before a consonant or word end.
                and not (r[0] in _R_COLORED and i + 2 < n and w[i + 2] in "aeiouy")
            ),
            None,
        )
        if rule:
            grapheme, phonemes = rule
            out.extend(("oʊ",) if grapheme == "ow" and i + 2 == n else phonemes)
            i += len(grapheme)
            continue
        if ch == "e" and i == n - 1 and out:
            i += 1  # silent final e
            continue
        if i > 0 and ch == w[i - 1] and ch not in "aeiou":
            i += 1  # doubled consonant
            continue
        if ch in _SHORT_VOWEL:
            out.append(_SHORT_VOWEL[ch])
        elif ch == "c":
            out.append("s" if i + 1 < n and w[i + 1] in "eiy" else "k")
        elif ch == "g":
            out.append("dʒ" if 0 < i < n - 1 and w[i + 1] in "ei" else "g")
        elif ch == "x":
            out.extend(("k", "s"))
        elif ch == "y":
            out.append("j" if i == 0 else ("i" if i == n - 1 else "ɪ"))
        elif ch == "s" and i == n - 1 and i > 0 and (w[i - 1] in _VOICED_ENDINGS or w[i - 2 : i] in ("ie", "ee")):
            out.append("z")
        else:
            out.append(_CONSONANT.get(ch, ch))
        i += 1
    return Pronunciation(tuple(out), tuple(None for _ in out), "rules") if out else None


PHONEMIC_SOURCES = frozenset({"cmudict", "epitran", "rules"})


def spelling_pronunciation(word: str) -> Pronunciation:
    letters = tuple(ch for ch in word if ch.isalnum())
    return Pronunciation(letters, tuple(None for _ in letters), "spelling")


# Natural reduced ("weak") forms of common function words. In connected speech "and" is
# usually /ən/, "you" /jə/ and "at" /ət/, so marking them wrong punishes fluent speech.
# CMUDict already has the reduced vowel of a, an, the, to, for, of, can, was, were, has,
# them and that; these fill in the rest of the twenty most common ones. They are added
# after the dictionary's own forms and the scorer picks whichever matches the audio.
# Only the vowel is reduced: a changed or dropped consonant is never accepted ("the" as
# "də", or "and" as plain "n", which lowered agreement with expert ratings on
# speechocean762), and r-less forms are left to a British target.
WEAK_FORMS: dict[str, tuple[str, ...]] = {
    "to": ("T UH0",),
    "and": ("AH0 N", "AE1 N"),
    "have": ("HH AH0 V",),
    "from": ("F R AH0 M",),
    "you": ("Y AH0",),
    "your": ("Y ER0",),
    "at": ("AH0 T",),
    "as": ("AH0 Z",),
    "but": ("B AH0 T",),
}


@lru_cache(maxsize=8192)
def pronunciations(word: str) -> tuple[Pronunciation, ...]:
    """Candidate pronunciations, best source first: up to three dictionary forms, then weak forms."""
    entries = _cmudict().get(word)
    if entries:
        found = [_from_arpabet(entry) for entry in entries[:3]]
        for weak in WEAK_FORMS.get(word, ()):
            pron = _from_arpabet(weak.split())
            if all(pron.phonemes != known.phonemes for known in found):
                found.append(pron)
        return tuple(found)
    epi = _epitran_pronunciation(word)
    if epi is not None:
        return (epi,)
    rules = rule_pronunciation(word)
    if rules is not None:
        return (rules,)
    return (spelling_pronunciation(word),)


_word_index: dict[tuple[str, ...], str] | None = None
COMMON_WORDS_FILE = Path(__file__).resolve().parent / "data" / "common_words.txt"


def word_with_sounds(phonemes: Sequence[str]) -> str | None:
    """A common English word pronounced exactly like this ("s ɪ ŋ k" -> "sink"), if there is one.

    Used to tell whether a slip turned the target into a different real word. Only the ~15,000
    words in data/common_words.txt count (so "sink", not the rare "cinq"); among several
    spellings with the same sounds the more frequent wins. Stress is ignored.
    """
    global _word_index
    if _word_index is None:
        index: dict[tuple[str, ...], str] = {}
        try:
            lines = COMMON_WORDS_FILE.read_text(encoding="utf-8").splitlines()
        except OSError:
            logger.warning("Common word list missing; slips will not be checked for changed words.")
            lines = []
        cmu = _cmudict()
        for word in (line.strip() for line in lines):  # most frequent first: the first claim wins
            if not word or word.startswith("#"):
                continue
            for entry in cmu.get(word, ()):
                index.setdefault(_from_arpabet(entry).phonemes, word)
        _word_index = index
    return _word_index.get(tuple(phonemes))


ACCENTS = ("american", "british")


def non_rhotic(pron: Pronunciation) -> Pronunciation:
    """The British (non-rhotic) form: no /r/ unless a vowel follows, and unstressed "-er" as /ə/.

    "car" /kɑr/ -> /kɑ/, "better" /bɛtɚ/ -> /bɛtə/; "red" and "very" keep their /r/. Long
    vowels such as /ɝ/ in "bird" stay, since the sound model already accepts the British /ɜː/.
    """
    phonemes, stresses = [], []
    for i, (ph, stress) in enumerate(zip(pron.phonemes, pron.stresses, strict=True)):
        following = pron.phonemes[i + 1] if i + 1 < len(pron.phonemes) else None
        if ph == "r" and (following is None or following not in VOWELS):
            continue
        phonemes.append("ə" if ph == "ɚ" else ph)
        stresses.append(stress)
    return Pronunciation(tuple(phonemes), tuple(stresses), pron.source)


def accent_pronunciations(word: str, accent: str = "american") -> tuple[Pronunciation, ...]:
    """Candidates for scoring: the usual ones, plus the non-rhotic forms for a British target."""
    found = pronunciations(word)
    if accent != "british":
        return found
    extra = []
    for pron in found:
        if pron.source == "spelling":
            continue
        british = non_rhotic(pron)
        if british.phonemes and all(british.phonemes != p.phonemes for p in (*found, *extra)):
            extra.append(british)
    return (*found, *extra)


# Approximate RP display: the GOAT vowel as /əʊ/ and the NURSE vowel as /ɜː/ (lexical sets such
# as BATH and LOT are not modelled; see the README).
_BRITISH_DISPLAY = {"oʊ": "əʊ", "ɝ": "ɜː"}


def british_display(pron: Pronunciation) -> Pronunciation:
    plain = non_rhotic(pron)
    return Pronunciation(tuple(_BRITISH_DISPLAY.get(p, p) for p in plain.phonemes), plain.stresses, plain.source)


def primary_pronunciation(word: str) -> Pronunciation:
    return pronunciations(word)[0]


# ---------------------------------------------------------------------------
# Syllables and display
# ---------------------------------------------------------------------------

def syllabify(pron: Pronunciation) -> list[dict[str, object]]:
    """Group phonemes into syllables using the maximal-onset principle."""
    if pron.source == "spelling":
        return []
    nuclei = [i for i, ph in enumerate(pron.phonemes) if ph in VOWELS]
    if not nuclei:
        return [{"phonemes": list(pron.phonemes), "stress": 0}]

    boundaries = [0]
    for left, right in zip(nuclei, nuclei[1:], strict=False):
        cluster = pron.phonemes[left + 1:right]
        split = len(cluster)
        for k in range(len(cluster) + 1):
            onset = cluster[k:]
            if not onset or (len(onset) == 1 and onset[0] != "ŋ") or onset in _LEGAL_ONSETS:
                split = k
                break
        boundaries.append(left + 1 + split)
    boundaries.append(len(pron.phonemes))

    syllables = []
    for index, nucleus in enumerate(nuclei):
        start, end = boundaries[index], boundaries[index + 1]
        stress = pron.stresses[nucleus]
        syllables.append({"phonemes": list(pron.phonemes[start:end]), "stress": stress or 0})
    return syllables


def ipa_string(pron: Pronunciation) -> str:
    """Render a pronunciation as IPA with stress marks (no slashes)."""
    if pron.source == "spelling":
        return ""
    syllables = syllabify(pron)
    if len(syllables) <= 1:
        return "".join(pron.phonemes)
    parts = []
    for syllable in syllables:
        mark = {1: "ˈ", 2: "ˌ"}.get(int(syllable["stress"]), "")  # type: ignore[arg-type]
        parts.append(mark + "".join(syllable["phonemes"]))  # type: ignore[arg-type]
    return "".join(parts)


def describe_word(word: str, accent: str = "american") -> dict[str, object]:
    """Pronunciation summary used by the tutor and the practice preview."""
    pron = primary_pronunciation(word)
    if accent == "british" and pron.source != "spelling":
        pron = british_display(pron)
    syllables = syllabify(pron)
    stress_index = next((i + 1 for i, s in enumerate(syllables) if s["stress"] == 1), 0)
    return {
        "word": word,
        "ipa": ipa_string(pron),
        "phonemes": list(pron.phonemes) if pron.source != "spelling" else [],
        "syllables": syllables,
        "syllable_count": len(syllables),
        "stress_index": stress_index,
        "source": pron.source,
    }


# ---------------------------------------------------------------------------
# Alignment
# ---------------------------------------------------------------------------

def align(
    ref: Sequence[T],
    hyp: Sequence[T],
    sub_cost: Callable[[T, T], float],
    indel_cost: float = 1.0,
) -> tuple[list[tuple[str, int | None, int | None]], float]:
    """Weighted Levenshtein alignment with backtrace.

    Returns ``(ops, total_cost)`` where each op is ``(kind, ref_index,
    hyp_index)`` and kind is ``equal``, ``replace``, ``delete`` or ``insert``.
    Diagonal moves win ties so near-matches pair up instead of splitting.
    """
    n, m = len(ref), len(hyp)
    costs = [[sub_cost(r, h) for h in hyp] for r in ref]
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        dp[i][0] = i * indel_cost
    for j in range(1, m + 1):
        dp[0][j] = j * indel_cost
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            dp[i][j] = min(
                dp[i - 1][j - 1] + costs[i - 1][j - 1],
                dp[i - 1][j] + indel_cost,
                dp[i][j - 1] + indel_cost,
            )

    ops: list[tuple[str, int | None, int | None]] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and math.isclose(dp[i][j], dp[i - 1][j - 1] + costs[i - 1][j - 1]):
            ops.append(("equal" if costs[i - 1][j - 1] == 0 else "replace", i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i > 0 and math.isclose(dp[i][j], dp[i - 1][j] + indel_cost):
            ops.append(("delete", i - 1, None))
            i -= 1
        else:
            ops.append(("insert", None, j - 1))
            j -= 1
    ops.reverse()
    return ops, dp[n][m]


def phoneme_cost(a: str, b: str) -> float:
    if a == b:
        return 0.0
    return _NEAR_COSTS.get(frozenset((a, b)), 1.0)


@dataclass(frozen=True)
class WordComparison:
    ref: Pronunciation
    hyp: Pronunciation
    similarity: float
    ops: tuple[tuple[str, str, str], ...]  # (kind, expected, actual)


def compare_pronunciations(ref: Pronunciation, hyp: Pronunciation) -> WordComparison:
    ops, cost = align(ref.phonemes, hyp.phonemes, phoneme_cost)
    longest = max(len(ref.phonemes), len(hyp.phonemes))
    similarity = 1.0 if longest == 0 else max(0.0, 1.0 - cost / longest)
    rendered = tuple(
        (
            kind,
            ref.phonemes[i] if i is not None else "",
            hyp.phonemes[j] if j is not None else "",
        )
        for kind, i, j in ops
    )
    return WordComparison(ref, hyp, similarity, rendered)


@lru_cache(maxsize=16384)
def compare_words(ref_word: str, hyp_word: str) -> WordComparison:
    """Compare two words using the closest pair of candidate pronunciations."""
    ref_options = pronunciations(ref_word)
    if ref_word == hyp_word:
        return compare_pronunciations(ref_options[0], ref_options[0])

    hyp_options = pronunciations(hyp_word)
    best: WordComparison | None = None
    for ref in ref_options:
        for hyp in hyp_options:
            comparable = ref.source == hyp.source or {ref.source, hyp.source} <= PHONEMIC_SOURCES
            if not comparable:
                continue
            candidate = compare_pronunciations(ref, hyp)
            if best is None or candidate.similarity > best.similarity:
                best = candidate
    if best is None:
        # Mixed sources aren't comparable phoneme-by-phoneme; compare spelling.
        best = compare_pronunciations(spelling_pronunciation(ref_word), spelling_pronunciation(hyp_word))
    return best


def word_cost(ref_word: str, hyp_word: str) -> float:
    if ref_word == hyp_word:
        return 0.0
    return 1.0 - compare_words(ref_word, hyp_word).similarity
