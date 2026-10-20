"""
Word stress: which syllable did the learner stress?

A stressed English syllable is usually longer, louder and higher in pitch than its
neighbours. For each word of two or more syllables, the vowel of every syllable is
timed by the phoneme alignment (backend.gop), and its length, loudness and pitch are
compared with the other syllables of the same word (z-scores within the word, so a
quiet or deep voice is not penalised). The syllable with the highest combined
prominence is the one that sounded stressed. A stress slip is reported only when that
syllable beats the dictionary's stressed one by at least STRESS_MARGIN, because these
cues are noisy (see the README for how well this agrees with expert ratings).
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np

from backend.phonetics import VOWELS

SAMPLE_RATE = 16000
# How much more prominent (in summed z-scores) another syllable must be before the stress
# is called wrong. Chosen on speechocean762's training split (scripts/eval_stress.py): only at
# this margin did flags beat the base rate, so agreement is poor and the check is experimental.
STRESS_MARGIN = 2.5
MIN_PITCH, MAX_PITCH = 70.0, 400.0


def _pitch(segment: np.ndarray, rate: int = SAMPLE_RATE) -> float | None:
    """Median fundamental frequency (Hz) of a short voiced segment by autocorrelation; None if unvoiced."""
    window, hop = int(0.04 * rate), int(0.01 * rate)
    lo, hi = int(rate / MAX_PITCH), int(rate / MIN_PITCH)
    found = []
    for start in range(0, max(0, len(segment) - window) + 1, hop):
        frame = segment[start : start + window]
        if len(frame) < window or not np.any(frame):
            continue
        frame = frame - frame.mean()
        corr = np.correlate(frame, frame, mode="full")[window - 1 :]
        if corr[0] <= 0 or hi >= len(corr):
            continue
        lag = lo + int(np.argmax(corr[lo:hi]))
        if corr[lag] / corr[0] > 0.45:  # clearly periodic: voiced
            found.append(rate / lag)
    return float(np.median(found)) if found else None


def _syllable_vowels(phonemes: Sequence[dict[str, Any]], syllables: Sequence[dict[str, Any]]) -> list[dict[str, Any] | None]:
    """The timed vowel of each syllable, walking the word's sounds in order."""
    out: list[dict[str, Any] | None] = []
    position = 0
    for syllable in syllables:
        size = len(syllable["phonemes"])
        chunk = phonemes[position : position + size]
        position += size
        out.append(next((p for p in chunk if p["phoneme"] in VOWELS), None))
    return out


def _z(values: list[float | None]) -> list[float]:
    known = [v for v in values if v is not None]
    if len(known) < 2:
        return [0.0] * len(values)
    mean, spread = float(np.mean(known)), float(np.std(known))
    if spread < 1e-9:
        return [0.0] * len(values)
    return [0.0 if v is None else (v - mean) / spread for v in values]


def word_stress(
    phonemes: Sequence[dict[str, Any]], syllables: Sequence[dict[str, Any]], samples: np.ndarray, rate: int = SAMPLE_RATE
) -> dict[str, Any] | None:
    """Expected and heard stress for one word, or None when it can't be judged (one syllable, no timings)."""
    if len(syllables) < 2 or not phonemes:
        return None
    expected = next((i for i, s in enumerate(syllables) if s.get("stress") == 1), None)
    vowels = _syllable_vowels(phonemes, syllables)
    if expected is None or any(v is None or v.get("start") is None or v.get("end") is None for v in vowels):
        return None
    lengths, loudness, pitches = [], [], []
    for v in vowels:
        start, end = int(float(v["start"]) * rate), int(float(v["end"]) * rate)  # type: ignore[index]
        segment = samples[start:end]
        lengths.append(max(0.0, float(v["end"]) - float(v["start"])))  # type: ignore[index]
        rms = float(np.sqrt(np.mean(np.square(segment, dtype=np.float64)))) if segment.size else 0.0
        loudness.append(20 * np.log10(max(rms, 1e-6)))
        pitches.append(_pitch(segment, rate) if segment.size else None)
    prominence = [a + b + c for a, b, c in zip(_z(lengths), _z(loudness), _z(pitches), strict=True)]
    heard = int(np.argmax(prominence))
    margin = prominence[heard] - prominence[expected]
    return {
        "expected": expected,
        "heard": heard,
        "margin": round(float(margin), 2),
        "error": bool(heard != expected and margin >= STRESS_MARGIN),
        "prominence": [round(float(p), 2) for p in prominence],
    }


def annotate(entries: list[dict[str, Any]], samples: np.ndarray, rate: int = SAMPLE_RATE) -> list[dict[str, Any]]:
    """Add "stress" to every scored multi-syllable word; returns insights for clear stress slips."""
    insights = []
    for entry in entries:
        if not entry.get("reference") or not entry.get("phonemes") or entry.get("status") == "missing":
            continue
        result = word_stress(entry["phonemes"], entry.get("syllables") or [], samples, rate)
        if result is None:
            continue
        entry["stress"] = result
        if result["error"]:
            syllables = ["".join(s["phonemes"]) for s in entry["syllables"]]
            insights.append({
                "kind": "stress",
                "severity": "low",
                "title": f"In “{entry['reference']}”, the stress seemed to fall on /{syllables[result['heard']]}/ instead of "
                         f"/{syllables[result['expected']]}/. (Experimental)",
                "word_index": entry["index"],
                "expected": None,
                "actual": None,
                "tier": None,
            })
    return insights
