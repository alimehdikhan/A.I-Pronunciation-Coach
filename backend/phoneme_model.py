"""
Acoustic phoneme recognition: wav2vec 2.0 CTC (espeak IPA) on ONNX Runtime.

Whisper is built to recover the intended *words*, so it often "hears" a
mispronounced word as the right one. This model has no language model: it
reports the sounds that were actually produced, frame by frame, which is what
phoneme-level scoring (backend.gop) needs. The ONNX file is produced by
scripts/export_phoneme_model.py, so no PyTorch is needed at runtime.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np

from backend import gop
from backend.audio import SAMPLE_RATE

logger = logging.getLogger("pronunciation_coach.phoneme_model")

MODEL_FILE = "phonemes.onnx"
VOCAB_FILE = "vocab.json"
SAMPLES_PER_FRAME = 320
# Self-attention cost grows with the square of the length, so long clips are
# scored in windows with some context on each side.
WINDOW_SECONDS = 20.0
CONTEXT_SECONDS = 1.0


def model_available(model_dir: str | Path) -> bool:
    directory = Path(model_dir)
    return (directory / MODEL_FILE).is_file() and (directory / VOCAB_FILE).is_file()


class PhonemeRecognizer:
    """Thread-safe phoneme posteriors for 16 kHz mono audio."""

    def __init__(self, model_dir: str | Path, threads: int = 0):
        import onnxruntime as ort

        directory = Path(model_dir)
        options = ort.SessionOptions()
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        if threads > 0:
            options.intra_op_num_threads = threads
        self.session = ort.InferenceSession(str(directory / MODEL_FILE), options, providers=["CPUExecutionProvider"])
        self.vocab: dict[str, int] = json.loads((directory / VOCAB_FILE).read_text(encoding="utf-8"))
        self.inventory = gop.Inventory(self.vocab)
        meta = directory / "MODEL"
        self.description = meta.read_text(encoding="utf-8").strip() if meta.is_file() else str(directory)
        logger.info("Phoneme model loaded from %s.", directory)

    def warm_up(self) -> None:
        noise = (np.random.default_rng(0).standard_normal(SAMPLE_RATE) * 0.01).astype(np.float32)
        self.log_probs(noise)

    def _run(self, samples: np.ndarray) -> np.ndarray:
        x = samples.astype(np.float32)
        x = (x - x.mean()) / np.sqrt(x.var() + 1e-7)  # the model's feature normalisation
        return self.session.run(None, {"input_values": x[None, :]})[0][0]

    def log_probs(self, samples: np.ndarray) -> np.ndarray:
        """(frames, vocab) log-probabilities, one frame per 20 ms."""
        if samples.size < SAMPLES_PER_FRAME * 2:
            samples = np.pad(samples, (0, SAMPLES_PER_FRAME * 2 - samples.size))
        window = int(WINDOW_SECONDS * SAMPLE_RATE)
        if samples.size <= window:
            return self._run(samples)
        context = int(CONTEXT_SECONDS * SAMPLE_RATE)
        total_frames = samples.size // SAMPLES_PER_FRAME
        pieces = []
        for start in range(0, samples.size, window):
            lo, hi = max(0, start - context), min(samples.size, start + window + context)
            out = self._run(samples[lo:hi])
            skip = (start - lo) // SAMPLES_PER_FRAME
            keep = min(window, samples.size - start) // SAMPLES_PER_FRAME
            pieces.append(out[skip : skip + keep])
        result = np.concatenate(pieces)
        return result[:total_frames] if result.shape[0] > total_frames else result
