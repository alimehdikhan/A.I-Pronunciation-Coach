"""
Speech recognition with faster-whisper (CTranslate2).

Same Whisper weights as openai-whisper, but about 4x faster on CPU with int8
quantisation and a fraction of the memory, with no PyTorch dependency.
Silero VAD skips silence, which also stops Whisper from hallucinating words
("Thank you.") on empty or near-silent clips.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import numpy as np

from backend.audio import SAMPLE_RATE

logger = logging.getLogger("pronunciation_coach.asr")

MIN_AUDIO_SECONDS = 0.25


def _resolve_device(device: str) -> str:
    if device != "auto":
        return device
    try:
        import ctranslate2

        return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    except Exception:  # pragma: no cover - depends on the host
        return "cpu"


class WhisperASR:
    """Thread-safe faster-whisper wrapper returning text plus word timings."""

    def __init__(
        self,
        model_size: str = "base",
        device: str = "auto",
        compute_type: str = "auto",
        cpu_threads: int = 0,
        num_workers: int = 1,
        download_root: str | None = None,
        beam_size: int = 5,
    ):
        from faster_whisper import WhisperModel

        self.model_size = model_size
        self.device = _resolve_device(device)
        self.compute_type = compute_type if compute_type != "auto" else ("float16" if self.device == "cuda" else "int8")
        self.beam_size = max(1, beam_size)
        options = dict(
            device=self.device,
            compute_type=self.compute_type,
            cpu_threads=cpu_threads,
            num_workers=num_workers,
            download_root=download_root,
        )
        logger.info("Loading Whisper %s (%s, %s)...", model_size, self.device, self.compute_type)
        try:
            # Prefer the cached copy so startup never waits on the network.
            self.model = WhisperModel(model_size, local_files_only=True, **options)
        except Exception:
            logger.info("Whisper %s is not cached yet; downloading it.", model_size)
            if download_root:
                os.makedirs(download_root, exist_ok=True)
            self.model = WhisperModel(model_size, **options)
        logger.info("Whisper %s ready.", model_size)

    def warm_up(self) -> None:
        """Run one tiny inference so the first user request doesn't pay for kernel setup."""
        noise = (np.random.default_rng(0).standard_normal(SAMPLE_RATE) * 0.01).astype(np.float32)
        segments, _ = self.model.transcribe(noise, language="en", beam_size=1, vad_filter=False, without_timestamps=True)
        list(segments)

    def transcribe(self, audio: np.ndarray, language: str = "en", prompt: str | None = None) -> dict[str, Any]:
        """Transcribe 16 kHz mono float32 audio.

        Returns ``text``, ``words`` (``word``, ``start``, ``end``,
        ``probability``), ``language`` and ``duration``. Scoring never passes a
        ``prompt``: Whisper is not told the target sentence. Free speaking passes a
        generic disfluent one so that filler words are written down.
        """
        duration = len(audio) / SAMPLE_RATE
        if duration < MIN_AUDIO_SECONDS:
            return {"text": "", "words": [], "language": language, "duration": round(duration, 2)}

        segments, info = self.model.transcribe(
            audio,
            language=language,
            task="transcribe",
            beam_size=self.beam_size,
            word_timestamps=True,
            condition_on_previous_text=False,
            initial_prompt=prompt,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 300},
        )
        texts: list[str] = []
        words: list[dict[str, Any]] = []
        for segment in segments:
            texts.append(segment.text)
            for word in segment.words or ():
                token = word.word.strip()
                if token:
                    words.append({
                        "word": token,
                        "start": round(float(word.start), 3),
                        "end": round(float(word.end), 3),
                        "probability": round(float(word.probability), 4),
                    })
        return {
            "text": "".join(texts).strip(),
            "words": words,
            "language": info.language or language,
            "duration": round(duration, 2),
        }

    def get_model_info(self) -> dict[str, str]:
        return {
            "model_size": self.model_size,
            "device": self.device,
            "compute_type": self.compute_type,
            "framework": "faster-whisper",
        }
