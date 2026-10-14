"""
Application settings, read once from the environment.

Every variable from earlier releases keeps its name and default; new ones are
additive. Import `settings` rather than reading os.environ elsewhere.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8000",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
]


def _flag(name: str, default: str) -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


def _cors_origins() -> list[str]:
    raw = os.getenv("PRONUNCIATION_COACH_CORS_ORIGINS")
    if not raw:
        return list(DEFAULT_CORS_ORIGINS)
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or list(DEFAULT_CORS_ORIGINS)


def _cache_dir() -> Path:
    return Path(os.getenv("XDG_CACHE_HOME") or Path.home() / ".cache") / "pronunciation_coach"


@dataclass(frozen=True)
class Settings:
    # Speech recognition
    whisper_model_size: str = field(default_factory=lambda: os.getenv("WHISPER_MODEL_SIZE", "base"))
    asr_device: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_ASR_DEVICE", "auto"))
    asr_compute_type: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_ASR_COMPUTE_TYPE", "auto"))
    asr_threads: int = field(default_factory=lambda: _int("PRONUNCIATION_COACH_ASR_THREADS", 0))
    asr_beam_size: int = field(default_factory=lambda: _int("PRONUNCIATION_COACH_ASR_BEAM_SIZE", 5))
    asr_dir: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_ASR_DIR", str(_cache_dir() / "whisper")))
    # How many transcriptions run at once, and how many may wait before 503s.
    asr_concurrency: int = field(default_factory=lambda: max(1, _int("PRONUNCIATION_COACH_ASR_CONCURRENCY", 1)))
    asr_queue_limit: int = field(default_factory=lambda: max(0, _int("PRONUNCIATION_COACH_ASR_QUEUE_LIMIT", 8)))
    language: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_LANGUAGE", "eng-Latn"))
    load_models_on_startup: bool = field(default_factory=lambda: _flag("PRONUNCIATION_COACH_LOAD_MODELS_ON_STARTUP", "1"))

    # Uploads
    max_upload_bytes: int = field(default_factory=lambda: _int("PRONUNCIATION_COACH_MAX_UPLOAD_BYTES", 25 * 1024 * 1024))
    max_audio_seconds: float = field(default_factory=lambda: _float("PRONUNCIATION_COACH_MAX_AUDIO_SECONDS", 60.0))
    max_target_chars: int = 500

    # Coach voice
    tts_enabled: bool = field(default_factory=lambda: _flag("PRONUNCIATION_COACH_TTS", "1"))
    tts_voice: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_TTS_VOICE", "en_US-lessac-medium"))
    max_tts_chars: int = 300

    # HTTP
    cors_origins: list[str] = field(default_factory=_cors_origins)
    rate_limit_per_minute: int = field(default_factory=lambda: _int("PRONUNCIATION_COACH_RATE_LIMIT", 30))
    frontend_dir: str = field(
        default_factory=lambda: os.getenv("PRONUNCIATION_COACH_FRONTEND_DIR", str(PROJECT_ROOT / "frontend" / "dist"))
    )
    enable_agent: bool = field(default_factory=lambda: _flag("PRONUNCIATION_COACH_ENABLE_AGENT", "0"))
    metrics_enabled: bool = field(default_factory=lambda: _flag("PRONUNCIATION_COACH_METRICS", "1"))
    # When set, /metrics requires "Authorization: Bearer <token>".
    metrics_token: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_METRICS_TOKEN", ""))
    # Pages allowed to embed the app (Hugging Face Spaces renders it in an iframe).
    frame_ancestors: str = field(
        default_factory=lambda: os.getenv(
            "PRONUNCIATION_COACH_FRAME_ANCESTORS", "'self' https://huggingface.co https://*.hf.space"
        )
    )

    # Logging
    log_level: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_LOG_LEVEL", "INFO").upper())
    log_format: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_LOG_FORMAT", "text").lower())


settings = Settings()
