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
# When Whisper heard a different word, the audio can still vouch for the target:
# the word stays "correct" unless its blended score is below this.
REPLACED_WORD_BELOW = 60.0


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
            acoustic = analyse_acoustics(ref_tokens, phoneme_log_probs, self.inventory)

        ops, _ = phonetics.align(ref_tokens, [t.text for t in spoken], phonetics.word_cost)

        entries: List[Dict[str, Any]] = []
        mistakes: Counter[str] = Counter()
        unclear_below = settings["unclear_below"]

        for index, (kind, ri, hi) in enumerate(ops):
            ref_word = ref_tokens[ri] if ri is not None else None
            token = spoken[hi] if hi is not None else None
            entry = self._word_entry(index, ref_word, ref_display[ri] if ri is not None else None, token)

            if kind == "delete":
                pron = phonetics.primary_pronunciation(ref_word)  # type: ignore[arg-type]
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
                    alignment=[
                        {"op": op_kind, "expected": expected, "actual": actual}
                        for op_kind, expected, actual in comparison.ops
                    ] if phoneme_mode else [],
                    syllables=phonetics.syllabify(reference_pron),
                    source=comparison.ref.source,
                )
                heard = acoustic[ri] if acoustic is not None and ri is not None else None
                if heard is not None:
                    self._apply_acoustic(entry, heard, kind, confidence, unclear_below, mistakes)
            entries.append(entry)

        speech = self._speech_stats(entries, duration, settings)
        metrics = self._metrics(entries, ref_tokens, speech, settings)
        score = self._overall(metrics, settings)
        word_accuracy = 100.0 * sum(1 for e in entries if e["status"] in ("correct", "unclear")) / len(ref_tokens)

        insights = self._insights(entries, speech, settings, score)
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
        for p in heard.phonemes:
            if p.probability >= PHONEME_ERROR:
                ops.append({"op": "equal", "expected": p.phoneme, "actual": p.phoneme})
                spoken_phonemes.append(p.phoneme)
                continue
            errors.append(p)
            if p.alternative == gop.DELETED:
                ops.append({"op": "delete", "expected": p.phoneme, "actual": ""})
            else:
                ops.append({"op": "replace", "expected": p.phoneme, "actual": p.alternative})
                spoken_phonemes.append(p.alternative)

        # Whisper's words and the audio each see things the other misses, so
        # the word score blends both (weights fitted against expert ratings).
        text_score = entry["score"] if entry["score"] is not None else 0.0
        score = _clamp(
            acoustic_params.BLEND_INTERCEPT
            + acoustic_params.BLEND_TEXT * text_score
            + acoustic_params.BLEND_ACOUSTIC * heard.score
        )
        if errors or (kind == "replace" and score < REPLACED_WORD_BELOW):
            status = "mispronounced"
            score = min(MISPRONOUNCED_CEILING, score)
            for p in errors:
                mistakes[p.phoneme] += 1
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
            phonemes=[
                {
                    "phoneme": p.phoneme,
                    "score": round(100.0 * p.probability, 1),
                    "flagged": p.probability < PHONEME_ERROR,
                    "alternative": None if p.probability >= PHONEME_ERROR else p.alternative,
                    "start": p.start,
                    "end": p.end,
                }
                for p in heard.phonemes
            ],
        )

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
                expected: Optional[str] = None, actual: Optional[str] = None) -> None:
            insights.append({
                "kind": kind, "severity": severity, "title": title,
                "word_index": index, "expected": expected, "actual": actual,
            })

        for entry in entries:
            word = entry["reference"]
            if entry["status"] == "mispronounced":
                ops = [op for op in entry["alignment"] if op["op"] != "equal"]
                if not ops:
                    add("word", "high", f"You said “{entry['spoken']}” instead of “{word}”.", entry["index"])
                    continue
                op = ops[0]
                if op["op"] == "replace" and op["actual"] == gop.OTHER:
                    add("substitution", "high", f"In “{word}”, the /{op['expected']}/ sound wasn’t clear.",
                        entry["index"], op["expected"], op["actual"])
                elif op["op"] == "replace":
                    add("substitution", "high", f"In “{word}”, /{op['expected']}/ sounded like /{op['actual']}/.",
                        entry["index"], op["expected"], op["actual"])
                elif op["op"] == "delete":
                    add("deletion", "high", f"In “{word}”, the /{op['expected']}/ sound was dropped.",
                        entry["index"], op["expected"])
                else:
                    add("insertion", "medium", f"In “{word}”, an extra /{op['actual']}/ sound crept in.",
                        entry["index"], None, op["actual"])
            elif entry["status"] == "missing":
                add("missing", "high", f"You skipped “{word}”.", entry["index"])
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
            "speech": {"duration": None, "speaking_time": None, "wpm": None, "long_pauses": 0, "word_count": 0},
            "feedback": feedback,
            "phoneme_analysis": {
                "reference_phonemes": "",
                "transcribed_phonemes": "",
                "phoneme_similarity": 0.0,
                "backend": "cmudict",
            },
        }
