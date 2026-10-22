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
from backend.sound_model import SoundModel

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


def _candidates(word: str, inventory: gop.Inventory, accent: str = "american") -> list[tuple[phonetics.Pronunciation, list[int]]]:
    out = []
    for pron in phonetics.accent_pronunciations(word, accent):
        if pron.source == "spelling" or not pron.phonemes:
            continue
        labels = [inventory.index.get(ph) for ph in pron.phonemes]
        if all(label is not None for label in labels):
            out.append((pron, labels))  # type: ignore[arg-type]
    return out


def choose_pronunciations(
    options: Sequence[Sequence[Sequence[int]]], scores: np.ndarray, blank: np.ndarray
) -> tuple[list[int | None], list[int]] | None:
    """For each word, the pronunciation the audio supports best: each word's alternatives are tried in turn,
    left to right, and one is kept when the whole sequence becomes more likely.

    `options[w]` lists word w's pronunciations as label sequences (empty when it has none). Returns the
    choice per word and the chosen labels, or None when the audio can't be explained at all. A trial
    changes one word only, so its likelihood comes from the current sequence's alpha and beta
    (gop.replaced_log_likelihood) instead of a pass over the whole answer per trial.
    """
    choice: list[int | None] = [0 if opts else None for opts in options]
    first = [label for opts in options if opts for label in opts[0]]
    # Everything after the word being tried is still the first choice, so one backward pass serves them all.
    alpha, beta, best = gop.ctc_forward_backward(first, scores, blank)
    if not np.isfinite(best):
        return None
    longest = sum(max(len(labels) for labels in opts) for opts in options if opts)
    forward = gop.ForwardPass(first, scores, blank, alpha, longest)
    start = 0  # where the word being tried begins, in the current labels
    end_first = 0  # where it ends, in the first choice's labels
    for w, opts in enumerate(options):
        if not opts:
            continue
        end_first += len(opts[0])
        after = first[end_first] if end_first < len(first) else None
        out_of = beta[:, 2 * end_first + 1] if after is not None else None
        for k in range(1, len(opts)):
            current = choice[w]
            assert current is not None
            likelihood = gop.stretch_log_likelihood(
                opts[k],
                scores,
                blank,
                best,
                into_blank=forward.column(2 * start),
                into_label=forward.column(2 * start - 1) if start > 0 else None,
                before=forward.labels[start - 1] if start > 0 else None,
                out_of=out_of,
                after=after,
            )
            if likelihood > best:
                forward.replace(start, start + len(opts[current]), opts[k])
                best, choice[w] = likelihood, k
        chosen = choice[w]
        assert chosen is not None
        start += len(opts[chosen])
    return choice, forward.labels


def analyse(
    words: Sequence[str],
    log_probs: np.ndarray,
    inventory: gop.Inventory,
    accent: str = "american",
    model: SoundModel | None = None,
) -> list[WordAcoustics | None] | None:
    """Acoustic evidence for each target word (None for words without phonemes).

    `model` is a trained sound classifier for the learner's group (backend.sound_model);
    without one each sound's probability comes from the default curve, `acceptance`.
    Returns None when the audio can't be explained at all (e.g. far too short).
    """
    options = [_candidates(word, inventory, accent) for word in words]
    scores, blank = inventory.emissions(log_probs)
    chosen = choose_pronunciations([[labels for _pron, labels in opts] for opts in options], scores, blank)
    if chosen is None:
        return None
    choice, labels = chosen

    results = gop.score_sequence(labels, log_probs, inventory, emissions=(scores, blank))
    probabilities = model.score(results) if model is not None else [acceptance(r.gop) for r in results]
    out: list[WordAcoustics | None] = []
    position = 0
    for opts, k in zip(options, choice, strict=True):
        if k is None:
            out.append(None)
            continue
        pron, word_labels = opts[k]
        span = range(position, position + len(word_labels))
        position += len(word_labels)
        out.append(
            WordAcoustics(
                pron,
                [
                    PhonemeResult(
                        results[i].phoneme, probabilities[i], results[i].gop, results[i].best_alternative,
                        results[i].start, results[i].end,
                    )
                    for i in span
                ],
            )
        )
    return out
