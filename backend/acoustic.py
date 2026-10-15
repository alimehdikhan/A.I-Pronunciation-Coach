"""
Per-word acoustic evidence from the phoneme recogniser.

For a target sentence this picks each word's dictionary pronunciation that best
matches the audio (so "either" may be /iðɚ/ or /aɪðɚ/), scores every expected
phoneme with backend.gop, and groups the results by word.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np

from backend import gop, phonetics

# Maps GOP (a log-posterior, <= 0) to the probability that a trained listener
# rates the sound as clean: sigmoid(SLOPE * gop + OFFSET).
# Fitted on 6,952 sounds from 376 speechocean762 training recordings
# (scripts/eval_speechocean.py calibrate). 85% of sounds in that data are
# rated perfect, so the probabilities cluster high (median 0.98); what matters
# is how far below that a sound falls.
GOP_SLOPE = 0.383
GOP_OFFSET = 4.187

# A word's acoustic score is driven by its weakest sound: at the word level the
# minimum tracked human ratings (r = 0.34) better than the mean (r = 0.28).
WORD_MIN_WEIGHT = 1.0

# Word score = INTERCEPT + TEXT * (score from Whisper's words) + ACOUSTIC *
# (acoustic word score), clipped to 0-100. Least-squares fit against the
# experts' word ratings on 1,891 words from 300 training recordings
# (scripts/eval_speechocean.py fit). On those words the text score alone
# correlates at r = 0.49, the acoustic score at 0.58 and the blend at 0.62.
BLEND_INTERCEPT = -10.2
BLEND_TEXT = 0.139
BLEND_ACOUSTIC = 0.996


def acceptance(gop_value: float) -> float:
    if not math.isfinite(gop_value):
        return 0.0
    return 1.0 / (1.0 + math.exp(-(GOP_SLOPE * gop_value + GOP_OFFSET)))


@dataclass(frozen=True)
class PhonemeResult:
    phoneme: str
    probability: float  # 0..1: how likely it was said acceptably
    gop: float
    alternative: str  # most likely other outcome: a phoneme, gop.OTHER or gop.DELETED
    start: float | None
    end: float | None


@dataclass(frozen=True)
class WordAcoustics:
    pronunciation: phonetics.Pronunciation
    phonemes: list[PhonemeResult]

    @property
    def score(self) -> float:
        """0-100: weakest sound mixed with the mean (see WORD_MIN_WEIGHT)."""
        if not self.phonemes:
            return 0.0
        probabilities = [p.probability for p in self.phonemes]
        weakest = min(probabilities)
        mean = sum(probabilities) / len(probabilities)
        return 100.0 * (WORD_MIN_WEIGHT * weakest + (1.0 - WORD_MIN_WEIGHT) * mean)


def _candidates(word: str, inventory: gop.Inventory) -> list[tuple[phonetics.Pronunciation, list[int]]]:
    out = []
    for pron in phonetics.pronunciations(word):
        if pron.source == "spelling" or not pron.phonemes:
            continue
        labels = [inventory.index.get(ph) for ph in pron.phonemes]
        if all(label is not None for label in labels):
            out.append((pron, labels))  # type: ignore[arg-type]
    return out


def analyse(words: Sequence[str], log_probs: np.ndarray, inventory: gop.Inventory) -> list[WordAcoustics | None] | None:
    """Acoustic evidence for each target word (None for words without phonemes).

    Returns None when the audio can't be explained at all (e.g. far too short).
    """
    options = [_candidates(word, inventory) for word in words]
    choice = [0 if opts else None for opts in options]
    scores, blank = inventory.emissions(log_probs)

    def flatten(selection: list[int | None]) -> list[int]:
        return [label for opts, k in zip(options, selection, strict=True) if k is not None for label in opts[k][1]]

    best = gop.sequence_log_likelihood(flatten(choice), scores, blank)
    if not np.isfinite(best):
        return None
    for w, opts in enumerate(options):
        for k in range(1, len(opts)):
            trial = list(choice)
            trial[w] = k
            likelihood = gop.sequence_log_likelihood(flatten(trial), scores, blank)
            if likelihood > best:
                best, choice = likelihood, trial

    labels = flatten(choice)
    results = gop.score_sequence(labels, log_probs, inventory, emissions=(scores, blank))
    out: list[WordAcoustics | None] = []
    position = 0
    for opts, k in zip(options, choice, strict=True):
        if k is None:
            out.append(None)
            continue
        pron, word_labels = opts[k]
        chunk = results[position : position + len(word_labels)]
        position += len(word_labels)
        out.append(
            WordAcoustics(
                pron,
                [
                    PhonemeResult(r.phoneme, acceptance(r.gop), r.gop, r.best_alternative, r.start, r.end)
                    for r in chunk
                ],
            )
        )
    return out
