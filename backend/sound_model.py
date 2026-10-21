"""
Trained sound classifiers: from the evidence about one expected sound to the chance a
trained listener would rate it clean.

The default scorer maps each sound's goodness of pronunciation (GOP) to that chance with
one logistic curve (backend.acoustic.acceptance), fitted on Mandarin speakers reading
English. A sound model replaces the curve for one group of learners, chosen by their first
language. It also uses what the curve ignores: which sound it is and what kind, how long it
lasted, the strongest competing sound and whether the sound was dropped, and how clean the
neighbouring sounds and the whole recording were.

Models are trained by scripts/train_sound_model.py and stored next to this file as JSON,
so the app runs them with numpy alone. Each model's output is put on the default curve's
scale (`remap`), so 0.80 and 0.70 keep meaning "flagged" and "Fix this" for every group.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from backend import gop

logger = logging.getLogger("pronunciation_coach.sound_model")

MODELS_DIR = Path(__file__).resolve().parent / "data" / "sound_models"
FORMAT = 1

# GOP is a log-posterior (<= 0) and -inf when the audio can't contain the sound at all.
GOP_FLOOR = -30.0

PHONEMES = list(gop.PHONEME_TOKENS)
_CLASS_OF: dict[str, str] = {}
for _name, _members in {
    "vowel": ("i", "ɪ", "ɛ", "æ", "ɑ", "ɔ", "ʊ", "u", "ʌ", "ə", "ɝ", "ɚ", "eɪ", "aɪ", "ɔɪ", "aʊ", "oʊ"),
    "stop": ("p", "b", "t", "d", "k", "g"),
    "fricative": ("f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "h"),
    "affricate": ("tʃ", "dʒ"),
    "nasal": ("m", "n", "ŋ"),
    "liquid": ("l", "r"),
    "glide": ("w", "j"),
}.items():
    for _member in _members:
        _CLASS_OF[_member] = _name
CLASSES = ["vowel", "stop", "fricative", "affricate", "nasal", "liquid", "glide"]

NUMERIC_FEATURES = [
    "gop",  # log-posterior of the expected sound given everything else
    "alternative_gop",  # log-posterior of the strongest competitor
    "margin",  # gop - alternative_gop
    "alternative_dropped",  # the strongest competitor is "no sound at all"
    "alternative_other",  # ... a sound outside English
    "frames",  # how long the sound lasted, in 20 ms frames
    "log_frames",
    "recording_mean_gop",  # how clean the whole recording was (microphone, voice, accent)
    "recording_low_gop",  # its 10th percentile
    "previous_gop",
    "next_gop",
    "previous_vowel",
    "next_vowel",
    "first",
    "last",
    "log_length",  # sounds in the recording
]
FEATURE_NAMES = [*NUMERIC_FEATURES, *(f"class_{c}" for c in CLASSES), *(f"sound_{p}" for p in PHONEMES)]


def _gop(value: float) -> float:
    return max(GOP_FLOOR, value) if math.isfinite(value) else GOP_FLOOR


def features(results: Sequence[gop.PhonemeScore]) -> np.ndarray:
    """(sounds, len(FEATURE_NAMES)) features for every expected sound of one recording, in order."""
    n = len(results)
    out = np.zeros((n, len(FEATURE_NAMES)), dtype=np.float64)
    if n == 0:
        return out
    g = np.array([_gop(r.gop) for r in results])
    alt = np.array([_gop(r.alternative_gop) for r in results])
    frames = np.array(
        [max(0.0, (r.end - r.start) / gop.FRAME_SECONDS) if r.start is not None and r.end is not None else 0.0 for r in results]
    )
    vowel = np.array([_CLASS_OF.get(r.phoneme) == "vowel" for r in results], dtype=np.float64)
    column = {name: i for i, name in enumerate(FEATURE_NAMES)}
    out[:, column["gop"]] = g
    out[:, column["alternative_gop"]] = alt
    out[:, column["margin"]] = g - alt
    out[:, column["alternative_dropped"]] = [r.best_alternative == gop.DELETED for r in results]
    out[:, column["alternative_other"]] = [r.best_alternative == gop.OTHER for r in results]
    out[:, column["frames"]] = frames
    out[:, column["log_frames"]] = np.log1p(frames)
    out[:, column["recording_mean_gop"]] = g.mean()
    out[:, column["recording_low_gop"]] = np.percentile(g, 10)
    out[1:, column["previous_gop"]] = g[:-1]
    out[:-1, column["next_gop"]] = g[1:]
    out[1:, column["previous_vowel"]] = vowel[:-1]
    out[:-1, column["next_vowel"]] = vowel[1:]
    out[0, column["first"]] = 1.0
    out[-1, column["last"]] = 1.0
    out[:, column["log_length"]] = math.log(n)
    for i, r in enumerate(results):
        kind = _CLASS_OF.get(r.phoneme)
        if kind is not None:
            out[i, column[f"class_{kind}"]] = 1.0
        if f"sound_{r.phoneme}" in column:
            out[i, column[f"sound_{r.phoneme}"]] = 1.0
    return out


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -50.0, 50.0)))


@dataclass(frozen=True)
class _Tree:
    feature: np.ndarray
    threshold: np.ndarray
    left: np.ndarray
    right: np.ndarray
    missing_left: np.ndarray
    leaf: np.ndarray
    value: np.ndarray

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "_Tree":
        return cls(
            feature=np.asarray(data["feature"], dtype=np.int64),
            threshold=np.asarray(data["threshold"], dtype=np.float64),
            left=np.asarray(data["left"], dtype=np.int64),
            right=np.asarray(data["right"], dtype=np.int64),
            missing_left=np.asarray(data["missing_left"], dtype=bool),
            leaf=np.asarray(data["leaf"], dtype=bool),
            value=np.asarray(data["value"], dtype=np.float64),
        )

    def predict(self, x: np.ndarray) -> np.ndarray:
        node = np.zeros(len(x), dtype=np.int64)
        rows = np.arange(len(x))
        for _ in range(len(self.leaf)):
            done = self.leaf[node]
            if done.all():
                break
            value = x[rows, self.feature[node]]
            go_left = np.where(np.isnan(value), self.missing_left[node], value <= self.threshold[node])
            node = np.where(done, node, np.where(go_left, self.left[node], self.right[node]))
        return self.value[node]


class SoundModel:
    """One trained classifier and the calibration that puts it on the app's scale."""

    def __init__(self, spec: dict[str, Any]):
        if spec.get("format") != FORMAT:
            raise ValueError(f"unsupported sound model format {spec.get('format')!r}")
        if spec.get("features") != FEATURE_NAMES:
            raise ValueError("sound model was trained on different features")
        self.spec = spec
        self.profile: str = spec["profile"]
        self.version: str = spec.get("version", "")
        self.kind: str = spec["kind"]
        self.first_languages: frozenset[str] = frozenset(spec.get("first_languages", []))
        params = spec["params"]
        if self.kind == "sigmoid":
            self._slope, self._offset = float(params["slope"]), float(params["offset"])
        elif self.kind == "logistic":
            self._mean = np.asarray(params["mean"], dtype=np.float64)
            self._scale = np.asarray(params["scale"], dtype=np.float64)
            self._coef = np.asarray(params["coef"], dtype=np.float64)
            self._intercept = float(params["intercept"])
        elif self.kind == "trees":
            self._baseline = float(params["baseline"])
            self._trees = [_Tree.from_json(t) for t in params["trees"]]
        else:
            raise ValueError(f"unknown sound model kind {self.kind!r}")
        calibration = spec.get("calibration")
        self._calibration = (
            (np.asarray(calibration["x"], dtype=np.float64), np.asarray(calibration["y"], dtype=np.float64))
            if calibration
            else None
        )
        remap = spec["remap"]
        self._remap = (np.asarray(remap["x"], dtype=np.float64), np.asarray(remap["y"], dtype=np.float64))

    def raw(self, x: np.ndarray) -> np.ndarray:
        """The classifier's own probability that each sound is clean."""
        if self.kind == "sigmoid":
            return _sigmoid(self._slope * x[:, 0] + self._offset)
        if self.kind == "logistic":
            return _sigmoid(((x - self._mean) / self._scale) @ self._coef + self._intercept)
        margin = np.full(len(x), self._baseline)
        for tree in self._trees:
            margin += tree.predict(x)
        return _sigmoid(margin)

    def calibrated(self, x: np.ndarray) -> np.ndarray:
        """Chance a listener rates each sound clean, calibrated on held-out speakers."""
        p = self.raw(x)
        if self._calibration is not None:
            p = np.interp(p, *self._calibration)
        return p

    def predict(self, x: np.ndarray) -> np.ndarray:
        """On the app's scale: below 0.80 is flagged, below 0.70 is "Fix this"."""
        return np.clip(np.interp(self.calibrated(x), *self._remap), 0.0, 1.0)

    def score(self, results: Sequence[gop.PhonemeScore]) -> list[float]:
        if not results:
            return []
        return [float(p) for p in self.predict(features(results))]


def load(path: str | Path) -> SoundModel:
    return SoundModel(json.loads(Path(path).read_text(encoding="utf-8")))


@lru_cache(maxsize=1)
def _installed(directory: str) -> tuple[SoundModel, ...]:
    models = []
    for path in sorted(Path(directory).glob("*.json")):
        try:
            models.append(load(path))
        except Exception:
            logger.exception("Ignoring sound model %s", path.name)
    if models:
        logger.info("Sound models: %s", ", ".join(f"{m.profile} ({m.kind}, {m.version})" for m in models))
    return tuple(models)


def installed(directory: str | Path = MODELS_DIR) -> tuple[SoundModel, ...]:
    return _installed(str(directory))


def for_learner(first_language: str | None, directory: str | Path = MODELS_DIR) -> SoundModel | None:
    """The model trained for speakers of this first language, or None for the default curve."""
    if not first_language:
        return None
    for model in installed(directory):
        if first_language in model.first_languages:
            return model
    return None
