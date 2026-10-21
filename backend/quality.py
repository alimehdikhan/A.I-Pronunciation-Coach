"""
Is a practice recording good enough to train the scorer on?

"Good" means a clean recording of the right sentence, not good pronunciation. The scorer has
to learn what slips sound like too, so a recording is never chosen by its score. It is kept
only when every check below passes:

* long enough to hold a word, and within the practice limit;
* loud enough, and not clipped (distortion would teach the model the wrong sounds);
* the voice stands well clear of the background (a signal-to-noise estimate);
* the learner read the sentence they were given: most target words were attempted, there
  are few extra words, and the sound model could follow the sentence through the audio.

The thresholds are deliberately strict: a lost recording costs nothing, a bad one teaches
the model something false. They were set by hand, not fitted, because the labelled datasets
are studio recordings in which nearly everything passes.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from backend.audio import SAMPLE_RATE

MIN_SECONDS = 0.6
MAX_SECONDS = 30.0
# Speech level (loudest 5% of 20 ms frames), in dB below full scale.
MIN_LEVEL_DB = -45.0
# Share of samples at or beyond full scale.
MAX_CLIPPED = 0.001
CLIP_LEVEL = 0.999
# Speech level minus the noise floor (quietest 5% of frames).
MIN_SNR_DB = 15.0
# Share of target words attempted (the scorer's completeness, 0-100), and extra words allowed.
MIN_COMPLETENESS = 80.0
MAX_EXTRA_WORDS = 2


def _db(value: float) -> float:
    return 20.0 * float(np.log10(max(value, 1e-9)))


def signal(samples: np.ndarray) -> dict[str, float]:
    """Level, clipping and signal-to-noise of raw 16 kHz audio (before any cleanup or gain)."""
    samples = np.asarray(samples, dtype=np.float32)
    frame = SAMPLE_RATE // 50
    count = samples.size // frame
    if count < 2:
        return {"seconds": samples.size / SAMPLE_RATE, "level_db": -180.0, "noise_db": -180.0, "snr_db": 0.0, "clipped": 0.0}
    centred = samples - float(samples.mean())
    levels = np.sqrt(np.mean(centred[: count * frame].reshape(count, frame) ** 2, axis=1))
    speech, noise = float(np.percentile(levels, 95)), float(np.percentile(levels, 5))
    return {
        "seconds": round(samples.size / SAMPLE_RATE, 2),
        "level_db": round(_db(speech), 1),
        "noise_db": round(_db(noise), 1),
        "snr_db": round(_db(speech) - _db(noise), 1),
        "clipped": round(float(np.mean(np.abs(samples) >= CLIP_LEVEL)), 5),
    }


def assess(samples: np.ndarray, result: dict[str, Any]) -> dict[str, Any]:
    """The checks for one recording and its scoring result; `usable` is True when all pass."""
    measures: dict[str, Any] = signal(samples)
    words = [w for w in result.get("words", []) if w.get("reference")]
    measures["completeness"] = (result.get("metrics") or {}).get("completeness")
    measures["extra_words"] = sum(1 for w in result.get("words", []) if w.get("status") == "extra")
    measures["sound_model_followed"] = any(w.get("acoustic") for w in words)

    problems = []
    if not MIN_SECONDS <= measures["seconds"] <= MAX_SECONDS:
        problems.append("length")
    if measures["level_db"] < MIN_LEVEL_DB:
        problems.append("too_quiet")
    if measures["clipped"] > MAX_CLIPPED:
        problems.append("clipped")
    if measures["snr_db"] < MIN_SNR_DB:
        problems.append("noisy")
    if measures["completeness"] is None or measures["completeness"] < MIN_COMPLETENESS:
        problems.append("not_the_sentence")
    if measures["extra_words"] > MAX_EXTRA_WORDS:
        problems.append("extra_words")
    if not measures["sound_model_followed"]:
        problems.append("no_sound_analysis")
    measures["problems"] = problems
    measures["usable"] = not problems
    return measures
