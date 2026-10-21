"""Shared request dependencies."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import get_db
from backend.errors import CodedHTTPException
from backend.repositories import account_for_key
from backend.runtime import runtime
from backend.security import PROFILE_KEY_HEADER, normalize_profile_key

if TYPE_CHECKING:
    from backend.asr import WhisperASR
    from backend.pronunciation import PronunciationScorer


def profile_key(x_profile_key: str | None = Header(None, alias=PROFILE_KEY_HEADER)) -> str | None:
    """The browser's profile key, if it sent one."""
    return normalize_profile_key(x_profile_key)


def require_account(key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> None:
    """Every learner feature needs a signed-in account: without one the answer is 401 `sign_in_required`."""
    if settings.require_account and account_for_key(db, key) is None:
        raise CodedHTTPException(401, "Sign in or create an account to use Vocaly AI.", "sign_in_required")


def require_models() -> tuple[WhisperASR, PronunciationScorer]:
    """Return the loaded models or a clear 503 while they warm up."""
    if runtime.asr is None or runtime.scorer is None:
        raise CodedHTTPException(
            503, "Speech models are still loading. Please try again shortly.", "models_loading", {"Retry-After": "5"}
        )
    return runtime.asr, runtime.scorer
