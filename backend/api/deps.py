"""Shared request dependencies."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Header

from backend.errors import CodedHTTPException
from backend.runtime import runtime
from backend.security import PROFILE_KEY_HEADER, normalize_profile_key

if TYPE_CHECKING:
    from backend.asr import WhisperASR
    from backend.pronunciation import PronunciationScorer


def profile_key(x_profile_key: str | None = Header(None, alias=PROFILE_KEY_HEADER)) -> str | None:
    """The browser's profile key, if it sent one."""
    return normalize_profile_key(x_profile_key)


def require_models() -> tuple[WhisperASR, PronunciationScorer]:
    """Return the loaded models or a clear 503 while they warm up."""
    if runtime.asr is None or runtime.scorer is None:
        raise CodedHTTPException(
            503, "Speech models are still loading. Please try again shortly.", "models_loading", {"Retry-After": "5"}
        )
    return runtime.asr, runtime.scorer
