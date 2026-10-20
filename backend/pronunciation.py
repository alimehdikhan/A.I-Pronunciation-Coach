"""
Pronunciation scoring.

The scorer aligns the words Whisper heard against the target sentence, then
compares each aligned pair phoneme by phoneme. Whisper's per-word confidence
and timestamps add two signals a plain transcript comparison misses: words
that were recognised but sounded unclear, and delivery (pace and pauses).

Four metrics are produced, each 0-100:

* pronunciation - phoneme accuracy of the words that were spoken
* completeness  - share of target words that were attempted
* fluency       - speaking rate, long pauses and extra words (needs timings)
* clarity       - mean ASR confidence on the target words (needs timings)

These are heuristics built on ASR output, not a forced-alignment acoustic
model, so they measure how intelligible the speech was to Whisper.
"""

from __future__ import annotations

import logging
import math
from collections import Counter
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import numpy as np

from backend import acoustic as acoustic_params
from backend import gop, phonetics
from backend.acoustic import WordAcoustics
from backend.acoustic import analyse as analyse_acoustics

logger = logging.getLogger("pronunciation_coach.pronunciation")

DIFFICULTY_ALIASES = {
    "beginner": "beginner",
    "easy": "beginner",
    "intermediate": "intermediate",
    "custom": "intermediate",
    "advanced": "advanced",
    "professional": "advanced",
    "expert": "advanced",
}

# Speaking rate. Human fluency ratings on speechocean762 rise steadily with
# words per minute (r = +0.56): slow, halting reading is what sounds
# disfluent, and learners almost never speak "too fast". So the rate score
# ramps up from RATE_FLOOR * low wpm to `high` wpm, and only speech beyond
# RATE_CEILING * high wpm is penalised.
RATE_FLOOR = 0.45
RATE_CEILING = 1.45

# curve < 1 is lenient, > 1 is strict (applied as score ** curve).
DIFFICULTY_SETTINGS: Dict[str, Dict[str, Any]] = {
    "beginner": {"curve": 0.75, "unclear_below": 0.35, "wpm": (70, 190), "pause_s": 0.9},
    "intermediate": {"curve": 1.0, "unclear_below": 0.5, "wpm": (90, 180), "pause_s": 0.7},
    "advanced": {"curve": 1.3, "unclear_below": 0.6, "wpm": (110, 175), "pause_s": 0.5},
}

METRIC_WEIGHTS = {"pronunciation": 0.6, "completeness": 0.1, "fluency": 0.15, "clarity": 0.15}
# A word with a wrong sound reads as wrong to a listener, so substituted
# words are scored on a steeper curve and never above this ceiling.
MISPRONOUNCED_CEILING = 80.0
# Substitutes less similar than this are treated as different words, not attempts.
ATTEMPT_SIMILARITY = 0.3
# A sound whose probability of being rated clean falls below this is reported
# as a slip. On speechocean762 training data this flags 1.7% of sounds with 36%
# precision; a higher cut-off finds more slips but raises false alarms.
PHONEME_ERROR = 0.80
# Flagged sounds come in two tiers. Below PHONEME_FIX the slip is likely real
# ("Fix this"); between it and PHONEME_ERROR it is borderline ("Worth
# checking"). Tiers only label slips: scores and statuses don't depend on them.
# Only "Fix this" slips count against mastery and get coaching tips.
# Chosen on speechocean762 training data (scripts/eval_speechocean.py tiers) as the loosest
# cut-off with "Fix this" precision >= 0.6 (0.63 there; 0.55 precision, 0.23 recall on test).
PHONEME_FIX = 0.70
FIX = "fix"
CHECK = "check"
# Whisper sometimes drops a word that was spoken. The audio decides: a word it
# marked missing is counted as spoken when its weakest sound still scores at
# least this much (0-100).
MISSING_BELOW = 60.0


def is_careful(speech: Dict[str, Any], careful_wpm: float) -> bool:
    """Slower than natural speech: easy to score well on, unlike real conversation."""
    wpm = speech.get("wpm")
    return bool(wpm and speech.get("word_count", 0) >= 3 and wpm < careful_wpm)


def sound_tier(probability: float) -> Optional[str]:
    """"fix", "check" or None (clean) for a sound's probability of being rated clean."""
    if probability >= PHONEME_ERROR:
        return None
    return FIX if probability < PHONEME_FIX else CHECK


# "Say just this word": a borderline sound said on its own is a confirmed slip when its
# probability falls below ALONE_SLIP_BELOW, or below ALONE_WHISPER_BELOW when Whisper also
# heard a different word that differs at that very sound. Alone, the sound model separates
# sounds but stays generous (median 0.98 for a correct word, 0.90 for a substituted one), so
# these are its own cut-offs. On 476 synthetic minimal-pair words (scripts/eval_confirm.py,
# two voices) the rule caught 91% of substitutions and flagged 9% of correct words.
ALONE_SLIP_BELOW = 0.88
ALONE_WHISPER_BELOW = 0.97


def _heard_instead(entry: Dict[str, Any], phoneme: str) -> Optional[str]:
    """What Whisper's word has in place of `phoneme`, when it heard a different word that differs there."""
    reference, spoken = entry.get("reference"), entry.get("spoken")
    if not reference or not spoken or reference == spoken:
        return None
    comparison = phonetics.compare_words(reference, spoken)
    if "spelling" in (comparison.ref.source, comparison.hyp.source):
        return None  # "3rd" for "third" is formatting, not a different sound
    for kind, expected, actual in comparison.ops:
        if expected == phoneme and kind in ("replace", "delete"):
            return actual
    return None


def said_alone(entry: Optional[Dict[str, Any]], phonemes: List[str]) -> List[Dict[str, Any]]:
    """Verdicts for borderline sounds when their word was said on its own (one scored word entry)."""
    heard = {p["phoneme"]: p for p in (entry or {}).get("phonemes") or []}
    out = []
    for phoneme in phonemes:
        sound = heard.get(phoneme)
        if sound is None:
            out.append({"phoneme": phoneme, "verdict": "unheard", "score": None, "alternative": None, "heard_as": None})
            continue
        instead = _heard_instead(entry or {}, phoneme)
        slip = sound["score"] < 100.0 * ALONE_SLIP_BELOW or (instead is not None and sound["score"] < 100.0 * ALONE_WHISPER_BELOW)
        alternative = sound.get("alternative") or instead if slip else None
        out.append({
            "phoneme": phoneme,
            "verdict": "slip" if slip else "fine",
            "score": sound["score"],
            "alternative": (alternative or gop.OTHER) if slip else None,
            "heard_as": instead,
        })
    return out


def normalize_difficulty(difficulty: Optional[str]) -> str:
    return DIFFICULTY_ALIASES.get((difficulty or "").strip().lower(), "intermediate")


@dataclass
class SpokenToken:
    text: str
    display: str = ""
    start: Optional[float] = None
    end: Optional[float] = None
    probability: Optional[float] = None


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _round(value: Optional[float], digits: int = 1) -> Optional[float]:
    return None if value is None else round(value, digits)


class PronunciationScorer:
    """Scores pronunciation from a target sentence and an ASR result."""

    def __init__(self, language: str = "eng-Latn", inventory: Optional[gop.Inventory] = None):
        self.language = language
        # The phoneme recogniser's token inventory; enables acoustic scoring
        # when score_pronunciation() is given its log-probabilities.
        self.inventory = inventory
        phonetics.warm_up(language)

    @property
    def phoneme_backend(self) -> str:
        return "cmudict" if phonetics.dictionary_available() else "spelling"

    # -- helpers -----------------------------------------------------------

    @staticmethod
    def spoken_tokens(transcription: str, words: Optional[List[Dict[str, Any]]]) -> List[SpokenToken]:
        """Expand ASR words (with timings) into normalised tokens."""
        if not words:
            return [
                SpokenToken(text, display)
                for text, display in zip(phonetics.tokenize(transcription), phonetics.display_tokens(transcription), strict=True)
            ]

        tokens: List[SpokenToken] = []
        for word in words:
            prob = word.get("probability")
            raw = str(word.get("word", ""))
            for text, display in zip(phonetics.tokenize(raw), phonetics.display_tokens(raw), strict=True):
                tokens.append(
                    SpokenToken(
                        text=text,
                        display=display,
                        start=word.get("start"),
                        end=word.get("end"),
                        probability=float(prob) if prob is not None else None,
                    )
                )
        return tokens

    @staticmethod
    def _word_entry(
        index: int, reference: Optional[str], display: Optional[str], spoken: Optional[SpokenToken]
    ) -> Dict[str, Any]:
        return {
            "index": index,
            "reference": reference,
            "display": display or (spoken.display or spoken.text if spoken else ""),
            "spoken": spoken.text if spoken else None,
            "status": "correct",
            "score": None,
            "confidence": _round(spoken.probability, 3) if spoken and spoken.probability is not None else None,
            "start": spoken.start if spoken else None,
            "end": spoken.end if spoken else None,
            "expected_ipa": "",
            "spoken_ipa": "",
            "expected_phonemes": [],
            "spoken_phonemes": [],
            "alignment": [],
            "syllables": [],
            "source": "cmudict",
            "pause_before": None,
            "similarity": None,
            # The surest slip in the word: "fix", "check" or None.
            "tier": None,
            # A listener would likely not catch this target word: Whisper heard another word or
            # none (heard_as is what it heard). None for extra words.
            "misheard": None,
            "heard_as": None,
            # The real word the slip turned this into ("think" said as "sink"), if any.
            "changes_word": None,
            # Would the slip change what a listener understands (another word, or likely misheard)?
            "affects_understanding": None,
        }

    # -- main entry point --------------------------------------------------

    def score_pronunciation(
        self,
        reference_text: str,
        transcribed_text: str,
        difficulty: Optional[str] = "intermediate",
        words: Optional[List[Dict[str, Any]]] = None,
        duration: Optional[float] = None,
        phoneme_log_probs: Optional[np.ndarray] = None,
        accent: str = "american",
    ) -> Dict[str, Any]:
        level = normalize_difficulty(difficulty)
        settings = DIFFICULTY_SETTINGS[level]
        ref_tokens = phonetics.tokenize(reference_text)
        ref_display = phonetics.display_tokens(reference_text)
        spoken = self.spoken_tokens(transcribed_text, words)

        if not ref_tokens:
            return self._empty_result(level, "No reference text was provided for pronunciation scoring.")

        # Acoustic evidence: what each target word's sounds were actually like.
        acoustic: Optional[List[Optional[WordAcoustics]]] = None
        if phoneme_log_probs is not None and self.inventory is not None and len(phoneme_log_probs):
            # A British target also accepts non-rhotic forms ("car" without its /r/).
            acoustic = (
                analyse_acoustics(ref_tokens, phoneme_log_probs, self.inventory, accent)
                if accent != "american"
                else analyse_acoustics(ref_tokens, phoneme_log_probs, self.inventory)
            )

        ops, _ = phonetics.align(ref_tokens, [t.text for t in spoken], phonetics.word_cost)

        entries: List[Dict[str, Any]] = []
        mistakes: Counter[str] = Counter()
        unclear_below = settings["unclear_below"]

        for index, (kind, ri, hi) in enumerate(ops):
            ref_word = ref_tokens[ri] if ri is not None else None
            token = spoken[hi] if hi is not None else None
            entry = self._word_entry(index, ref_word, ref_display[ri] if ri is not None else None, token)
            if ref_word is not None:
                # Whisper gets no hint of the target, so it stands in for a listener hearing the words cold.
                entry.update(misheard=kind != "equal", heard_as=token.text if kind == "replace" and token else None)

            if kind == "delete":
                pron = phonetics.primary_pronunciation(ref_word)  # type: ignore[arg-type]
                heard = acoustic[ri] if acoustic is not None and ri is not None else None
                if heard is not None and heard.score >= MISSING_BELOW:
                    # Whisper dropped it but the audio contains it: score the sounds.
                    entry.update(score=0.0)
                    self._apply_acoustic(entry, heard, "equal", None, unclear_below, mistakes)
                    entries.append(entry)
                    continue
                entry.update(
                    status="missing",
                    score=0.0,
                    expected_ipa=phonetics.ipa_string(pron),
                    expected_phonemes=list(pron.phonemes) if pron.source != "spelling" else [],
                    syllables=phonetics.syllabify(pron),
                    source=pron.source,
                )
            elif kind == "insert":
                pron = phonetics.primary_pronunciation(token.text)  # type: ignore[union-attr]
                entry.update(
                    status="extra",
                    spoken_ipa=phonetics.ipa_string(pron),
                    spoken_phonemes=list(pron.phonemes) if pron.source != "spelling" else [],
                    source=pron.source,
                )
            else:
                comparison = phonetics.compare_words(ref_word, token.text)  # type: ignore[arg-type,union-attr]
                confidence = token.probability if token else None
                conf_factor = 1.0 if confidence is None else 0.75 + 0.25 * confidence
                phoneme_mode = comparison.ref.source != "spelling"

                if kind == "equal":
                    status = "unclear" if confidence is not None and confidence < unclear_below else "correct"
                    score = 100.0 * conf_factor
                else:
                    status = "mispronounced"
                    score = min(MISPRONOUNCED_CEILING, 100.0 * (comparison.similarity ** 2) * conf_factor)
                    if phoneme_mode:
                        for op_kind, expected, _actual in comparison.ops:
                            if op_kind in ("replace", "delete") and expected:
                                mistakes[expected] += 1

                # Spelling comparisons carry no phonemes; still show the target IPA.
                reference_pron = comparison.ref if phoneme_mode else phonetics.primary_pronunciation(ref_word)  # type: ignore[arg-type]
                entry.update(
                    status=status,
                    similarity=round(comparison.similarity, 3),
                    score=round(_clamp(score), 1),
                    expected_ipa=phonetics.ipa_string(reference_pron),
                    spoken_ipa=phonetics.ipa_string(comparison.hyp),
                    expected_phonemes=list(comparison.ref.phonemes) if phoneme_mode else [],
                    spoken_phonemes=list(comparison.hyp.phonemes) if phoneme_mode else [],
                    # Without the audio model the only evidence is Whisper hearing another
                    # word, which is what a listener would hear too, so it is a "fix" slip.
                    alignment=[
                        {"op": op_kind, "expected": expected, "actual": actual,
                         "tier": FIX if op_kind != "equal" else None}
                        for op_kind, expected, actual in comparison.ops
                    ] if phoneme_mode else [],
                    tier=FIX if status == "mispronounced" else None,
                    syllables=phonetics.syllabify(reference_pron),
                    source=comparison.ref.source,
                )
                heard = acoustic[ri] if acoustic is not None and ri is not None else None
                if heard is not None:
                    self._apply_acoustic(entry, heard, kind, confidence, unclear_below, mistakes)
            entries.append(entry)

        for entry in entries:
            if entry["status"] == "mispronounced":
                entry["changes_word"] = self._changed_word(entry)
                entry["affects_understanding"] = bool(entry["misheard"] or entry["changes_word"])

        speech = self._speech_stats(entries, duration, settings)
        metrics = self._metrics(entries, ref_tokens, speech, settings)
        score = self._overall(metrics, settings)
        word_accuracy = 100.0 * sum(1 for e in entries if e["status"] in ("correct", "unclear")) / len(ref_tokens)

        insights = self._insights(entries, speech, settings, score)
        recovered = sum(1 for e in entries if e["reference"] and not e["misheard"])
        sources = {e["source"] for e in entries if e["reference"]}
        backend = "cmudict" if sources <= {"cmudict"} else ("mixed" if "cmudict" in sources else sources.pop())

        return {
            "score": round(score, 1),
            "accuracy": round(word_accuracy, 1),
            "difficulty": level,
            "metrics": {name: _round(value) for name, value in metrics.items()},
            "words": entries,
            "insights": insights,
            "weak_phonemes": [ph for ph, _ in mistakes.most_common(3)],
            # "Would a listener understand you?": the share of target words recovered by a recogniser
            # that is not told the target. A machine estimate, not part of the score.
            "intelligibility": {
                "score": round(100.0 * recovered / len(ref_tokens), 1),
                "recovered": recovered,
                "words": len(ref_tokens),
                "estimate": True,
            },
            "speech": speech,
            "feedback": self._headline(score),
            "phoneme_analysis": {
                "reference_phonemes": " ".join(e["expected_ipa"] for e in entries if e["reference"]),
                "transcribed_phonemes": " ".join(e["spoken_ipa"] for e in entries if e["spoken"]),
                "phoneme_similarity": _round(metrics["pronunciation"]),
                "backend": backend,
            },
        }

    # -- scoring components ------------------------------------------------

    @staticmethod
    def _apply_acoustic(
        entry: Dict[str, Any],
        heard: WordAcoustics,
        kind: str,
        confidence: Optional[float],
        unclear_below: float,
        mistakes: "Counter[str]",
    ) -> None:
        """Replace Whisper-text-based evidence with what the audio sounded like.

        Whisper recovers the intended word even from a mispronunciation, so the
        transcript can't tell "said it right" from "said it close enough for
        Whisper". The phoneme recogniser can.
        """
        ops = []
        spoken_phonemes = []
        errors = []
        tiers = [sound_tier(p.probability) for p in heard.phonemes]
        for p, tier in zip(heard.phonemes, tiers, strict=True):
            if tier is None:
                ops.append({"op": "equal", "expected": p.phoneme, "actual": p.phoneme, "tier": None})
                spoken_phonemes.append(p.phoneme)
                continue
            errors.append(p)
            if p.alternative == gop.DELETED:
                ops.append({"op": "delete", "expected": p.phoneme, "actual": "", "tier": tier})
            else:
                ops.append({"op": "replace", "expected": p.phoneme, "actual": p.alternative, "tier": tier})
                spoken_phonemes.append(p.alternative)

        # Whisper's words and the audio each see things the other misses, so
        # the word score blends both (weights fitted against expert ratings).
        text_score = entry["score"] if entry["score"] is not None else 0.0
        score = _clamp(
            acoustic_params.BLEND_INTERCEPT
            + acoustic_params.BLEND_TEXT * text_score
            + acoustic_params.BLEND_ACOUSTIC * heard.score
        )
        if errors:
            status = "mispronounced"
            score = min(MISPRONOUNCED_CEILING, score)
            for p, tier in zip(heard.phonemes, tiers, strict=True):
                if tier == FIX:
                    mistakes[p.phoneme] += 1
        elif kind == "replace":
            # The sounds look fine to the audio model but Whisper heard another
            # word. Never call that "correct": say it was not recognised.
            status = "unclear"
        elif kind == "equal" and confidence is not None and confidence < unclear_below:
            status = "unclear"
        else:
            status = "correct"

        pron = heard.pronunciation
        entry.update(
            status=status,
            score=round(_clamp(score), 1),
            similarity=round(heard.score / 100.0, 3),
            expected_ipa=phonetics.ipa_string(pron),
            spoken_ipa="".join(spoken_phonemes),
            expected_phonemes=list(pron.phonemes),
            spoken_phonemes=spoken_phonemes,
            alignment=ops,
            syllables=phonetics.syllabify(pron),
            source=pron.source,
            acoustic=True,
            text_score=round(text_score, 1),
            acoustic_score=round(heard.score, 1),
            tier=FIX if FIX in tiers else CHECK if CHECK in tiers else None,
            phonemes=[
                {
                    "phoneme": p.phoneme,
                    "score": round(100.0 * p.probability, 1),
                    # The raw goodness of pronunciation (log-posterior, <= 0) behind the score.
                    "gop": round(p.gop, 3) if np.isfinite(p.gop) else None,
                    "flagged": tier is not None,
                    "tier": tier,
                    "alternative": None if tier is None else p.alternative,
                    "start": p.start,
                    "end": p.end,
                }
                for p, tier in zip(heard.phonemes, tiers, strict=True)
            ],
        )

    @staticmethod
    def _changed_word(entry: Dict[str, Any]) -> Optional[str]:
        """The dictionary word the learner's sounds spell instead of the target, if any."""
        if entry["spoken"] and entry["spoken"] != entry["reference"] and not entry.get("acoustic"):
            return entry["spoken"]  # Whisper itself heard another word
        sounds = []
        for op in entry["alignment"]:
            if op["op"] == "replace":
                if op["actual"] in (gop.OTHER, ""):
                    return None  # not a standard English sound: no word to land on
                sounds.append(op["actual"])
            elif op["op"] == "equal":
                sounds.append(op["expected"])
            elif op["op"] == "insert":
                sounds.append(op["actual"])
        word = phonetics.word_with_sounds(sounds) if sounds else None
        return word if word and word != entry["reference"] else None

    @staticmethod
    def _speech_stats(entries: List[Dict[str, Any]], duration: Optional[float], settings: Dict[str, Any]) -> Dict[str, Any]:
        timed = [e for e in entries if e["spoken"] and e["start"] is not None and e["end"] is not None]
        stats: Dict[str, Any] = {
            "duration": _round(duration, 2),
            "speaking_time": None,
            "wpm": None,
            "long_pauses": 0,
            "word_count": sum(1 for e in entries if e["spoken"]),
        }
        if len(timed) < 2:
            return stats

        span = float(timed[-1]["end"]) - float(timed[0]["start"])
        stats["speaking_time"] = _round(span, 2)
        if span > 0:
            stats["wpm"] = round(len(timed) / span * 60)

        threshold = settings["pause_s"]
        for previous, current in zip(timed, timed[1:], strict=False):
            gap = float(current["start"]) - float(previous["end"])
            if gap > threshold:
                current["pause_before"] = round(gap, 2)
                stats["long_pauses"] += 1
        return stats

    @staticmethod
    def _metrics(
        entries: List[Dict[str, Any]],
        ref_tokens: List[str],
        speech: Dict[str, Any],
        settings: Dict[str, Any],
    ) -> Dict[str, Optional[float]]:
        spoken_refs = [e for e in entries if e["reference"] and e["status"] != "missing"]
        pronunciation = sum(e["score"] for e in spoken_refs) / len(spoken_refs) if spoken_refs else 0.0
        # An unrelated word in a target word's place doesn't count as saying it.
        attempted = [
            e for e in spoken_refs
            if e["status"] != "mispronounced" or (e["similarity"] or 0.0) >= ATTEMPT_SIMILARITY
        ]
        completeness = 100.0 * len(attempted) / len(ref_tokens)

        # Confidence in a substituted word says little about the target, so
        # scale it by how close the substitute was.
        confidences = [
            e["confidence"] * (e["similarity"] if e["status"] == "mispronounced" else 1.0)
            for e in spoken_refs
            if e["confidence"] is not None
        ]
        clarity = 100.0 * sum(confidences) / len(confidences) if confidences else None

        fluency: Optional[float] = None
        timed_count = sum(1 for e in entries if e["spoken"] and e["start"] is not None)
        if timed_count >= 3 and speech["wpm"]:
            low, high = settings["wpm"]
            wpm = speech["wpm"]
            floor = RATE_FLOOR * low
            rate_score = 100.0 * _clamp((wpm - floor) / (high - floor), 0.0, 1.0)
            rate_score -= max(0.0, wpm - RATE_CEILING * high)
            pause_penalty = sum(
                min(20.0, 8.0 + 10.0 * (e["pause_before"] - settings["pause_s"]))
                for e in entries
                if e["pause_before"]
            )
            extra_penalty = 6.0 * sum(1 for e in entries if e["status"] == "extra")
            fluency = _clamp(0.5 * _clamp(rate_score) + 0.5 * _clamp(100 - pause_penalty - extra_penalty))

        return {
            "pronunciation": _clamp(pronunciation),
            "fluency": fluency,
            "completeness": _clamp(completeness),
            "clarity": None if clarity is None else _clamp(clarity),
        }

    @staticmethod
    def _overall(metrics: Dict[str, Optional[float]], settings: Dict[str, Any]) -> float:
        weighted = [(METRIC_WEIGHTS[name], value) for name, value in metrics.items() if value is not None]
        total_weight = sum(weight for weight, _ in weighted)
        raw = sum(weight * value for weight, value in weighted) / total_weight if total_weight else 0.0
        # Skipped words cap the score so a perfect first word can't carry a sentence.
        raw *= math.sqrt((metrics["completeness"] or 0.0) / 100.0)
        return _clamp(100.0 * (raw / 100.0) ** settings["curve"]) if raw > 0 else 0.0

    @staticmethod
    def _headline(score: float) -> str:
        if score >= 90:
            return "Excellent pronunciation. Your speech is clear and natural."
        if score >= 75:
            return "Good pronunciation with a few sounds to polish."
        if score >= 60:
            return "Fair attempt. Focus on the highlighted words and sounds."
        return "Keep practising. Slow down and work through the words one at a time."

    @staticmethod
    def _insights(
        entries: List[Dict[str, Any]],
        speech: Dict[str, Any],
        settings: Dict[str, Any],
        score: float,
    ) -> List[Dict[str, Any]]:
        insights: List[Dict[str, Any]] = []

        def add(kind: str, severity: str, title: str, index: Optional[int] = None,
                expected: Optional[str] = None, actual: Optional[str] = None, tier: Optional[str] = None) -> None:
            insights.append({
                "kind": kind, "severity": severity, "title": title,
                "word_index": index, "expected": expected, "actual": actual, "tier": tier,
            })

        for entry in entries:
            word = entry["reference"]
            if entry["status"] == "mispronounced":
                ops = [op for op in entry["alignment"] if op["op"] != "equal"]
                if not ops:
                    add("word", "high", f"You said “{entry['spoken']}” instead of “{word}”.", entry["index"], tier=FIX)
                    continue
                # Lead with the surest slip in the word; a borderline one is worded as uncertain.
                op = next((o for o in ops if o.get("tier") == FIX), ops[0])
                sure = op.get("tier") != CHECK
                severity, tier = ("high", FIX) if sure else ("medium", CHECK)
                if op["op"] == "replace" and op["actual"] == gop.OTHER:
                    title = (f"In “{word}”, the /{op['expected']}/ sound wasn’t clear." if sure
                             else f"In “{word}”, the /{op['expected']}/ sound may not have been clear. Worth checking.")
                    add("substitution", severity, title, entry["index"], op["expected"], op["actual"], tier)
                elif op["op"] == "replace":
                    title = (f"In “{word}”, /{op['expected']}/ sounded like /{op['actual']}/." if sure
                             else f"In “{word}”, /{op['expected']}/ may have sounded like /{op['actual']}/. Worth checking.")
                    add("substitution", severity, title, entry["index"], op["expected"], op["actual"], tier)
                elif op["op"] == "delete":
                    title = (f"In “{word}”, the /{op['expected']}/ sound was dropped." if sure
                             else f"In “{word}”, the /{op['expected']}/ sound may have been dropped. Worth checking.")
                    add("deletion", severity, title, entry["index"], op["expected"], tier=tier)
                else:
                    add("insertion", "medium", f"In “{word}”, an extra /{op['actual']}/ sound crept in.",
                        entry["index"], None, op["actual"], tier)
            elif entry["status"] == "missing":
                add("missing", "high", f"You skipped “{word}”.", entry["index"])
            elif entry["status"] == "unclear" and entry["spoken"] and entry["spoken"] != word:
                add("unclear", "medium", f"“{word}” came across as “{entry['spoken']}”. Say it a little slower.",
                    entry["index"])
            elif entry["status"] == "unclear":
                confidence = round((entry["confidence"] or 0) * 100)
                add("unclear", "medium", f"“{word}” was recognised but sounded unclear ({confidence}% confidence).",
                    entry["index"])
            elif entry["status"] == "extra":
                add("extra", "low", f"Extra word “{entry['spoken']}”. Try to stick to the script.", entry["index"])

        for entry in entries:
            if entry["pause_before"]:
                add("pause", "low", f"Long pause before “{entry['reference'] or entry['spoken']}” ({entry['pause_before']:.1f}s).",
                    entry["index"])

        wpm = speech.get("wpm")
        if wpm and speech.get("word_count", 0) >= 3:
            low, high = settings["wpm"]
            if wpm > RATE_CEILING * high:
                add("pace", "medium", f"You spoke quickly ({wpm} wpm). Slow down slightly so every sound lands.")
            elif wpm < low:
                add("pace", "low", f"Your pace was slow ({wpm} wpm). Aim for a smooth, connected rhythm.")

        severity_rank = {"high": 0, "medium": 1, "low": 2}
        insights.sort(key=lambda item: severity_rank[item["severity"]])
        if not insights and score >= 85:
            add("praise", "positive", "Clean delivery. Every word came through clearly.")
        return insights[:8]

    @staticmethod
    def _empty_result(level: str, feedback: str) -> Dict[str, Any]:
        return {
            "score": 0.0,
            "accuracy": 0.0,
            "difficulty": level,
            "metrics": {"pronunciation": 0.0, "fluency": None, "completeness": 0.0, "clarity": None},
            "words": [],
            "insights": [],
            "weak_phonemes": [],
            "intelligibility": {"score": 0.0, "recovered": 0, "words": 0, "estimate": True},
            "speech": {"duration": None, "speaking_time": None, "wpm": None, "long_pauses": 0, "word_count": 0},
            "feedback": feedback,
            "phoneme_analysis": {
                "reference_phonemes": "",
                "transcribed_phonemes": "",
                "phoneme_similarity": 0.0,
                "backend": "cmudict",
            },
        }
