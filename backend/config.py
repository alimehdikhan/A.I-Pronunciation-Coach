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


def _load_dotenv(path: Path) -> None:
    """Read KEY=value lines from a local .env into the environment.

    Real environment variables always win, so hosts that inject secrets
    (Hugging Face Spaces, Render, Docker) are unaffected.
    """
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        name, value = name.strip(), value.strip().strip("'\"")
        if name and value:
            os.environ.setdefault(name, value)


_load_dotenv(PROJECT_ROOT / ".env")

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


def _dataset_repo() -> str:
    """The private dataset for given recordings: set explicitly, or "<owner>/vocaly-recordings" on a Hugging Face Space."""
    configured = os.getenv("PRONUNCIATION_COACH_DATASET_REPO", "").strip()
    if configured:
        return configured
    owner = os.getenv("SPACE_AUTHOR_NAME", "").strip()  # set by Hugging Face Spaces
    return f"{owner}/vocaly-recordings" if owner else ""


def _cache_dir() -> Path:
    return Path(os.getenv("XDG_CACHE_HOME") or Path.home() / ".cache") / "pronunciation_coach"


@dataclass(frozen=True)
class Settings:
    # Speech recognition: Groq's hosted Whisper large when a Groq key is set ("auto"), so no Whisper model is
    # loaded here; the local faster-whisper model only without a key, or when asked for ("local").
    asr_engine: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_ASR_ENGINE", "auto").strip().lower())
    groq_asr_model: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_GROQ_ASR_MODEL", "whisper-large-v3").strip())
    whisper_model_size: str = field(default_factory=lambda: os.getenv("WHISPER_MODEL_SIZE", "base"))
    # With Groq, the local Whisper only stands in when Groq fails: a small model, loaded only then (the
    # Docker image bakes this one in).
    asr_fallback_model: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_FALLBACK_WHISPER", "base").strip())
    asr_device: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_ASR_DEVICE", "auto"))
    asr_compute_type: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_ASR_COMPUTE_TYPE", "auto"))
    asr_threads: int = field(default_factory=lambda: _int("PRONUNCIATION_COACH_ASR_THREADS", 0))
    asr_beam_size: int = field(default_factory=lambda: _int("PRONUNCIATION_COACH_ASR_BEAM_SIZE", 5))
    asr_dir: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_ASR_DIR", str(_cache_dir() / "whisper")))
    # How many transcriptions run at once, and how many may wait before 503s.
    asr_concurrency: int = field(default_factory=lambda: max(1, _int("PRONUNCIATION_COACH_ASR_CONCURRENCY", 1)))
    asr_queue_limit: int = field(default_factory=lambda: max(0, _int("PRONUNCIATION_COACH_ASR_QUEUE_LIMIT", 8)))
    # Speech waiting to be rendered (one renders at a time); beyond this the server says it is busy.
    tts_queue_limit: int = field(default_factory=lambda: max(0, _int("PRONUNCIATION_COACH_TTS_QUEUE_LIMIT", 16)))
    language: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_LANGUAGE", "eng-Latn"))
    load_models_on_startup: bool = field(default_factory=lambda: _flag("PRONUNCIATION_COACH_LOAD_MODELS_ON_STARTUP", "1"))

    # Personalised coaching text from a language model (backend.coach). Without a
    # key the knowledge-base templates are used.
    groq_api_key: str = field(default_factory=lambda: os.getenv("GROQ_API_KEY", "").strip())
    groq_model: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_LLM_MODEL", "openai/gpt-oss-120b"))
    # The live interviewer transcribes each answer with Groq's hosted Whisper (backend.quick_transcribe),
    # so it can follow up within a second or two. Empty keeps interview audio on this server (slower turns).
    turn_asr_model: str = field(
        default_factory=lambda: os.getenv("PRONUNCIATION_COACH_TURN_ASR_MODEL", "whisper-large-v3-turbo").strip()
    )
    # The live voice conversation (Gemini Live). The key stays on the server; the browser talks to us.
    gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", "").strip())
    # Password reset by email (optional): any SMTP provider. Without a host and sender it is off.
    smtp_host: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_SMTP_HOST", "").strip())
    smtp_port: int = field(default_factory=lambda: _int("PRONUNCIATION_COACH_SMTP_PORT", 587))
    smtp_user: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_SMTP_USER", "").strip())
    smtp_password: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_SMTP_PASSWORD", ""))
    mail_from: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_MAIL_FROM", "").strip())
    # Who runs this deployment and how to reach them, shown on the Privacy, Terms and About pages.
    operator_name: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_OPERATOR", "Ali Mehdi Khan").strip())
    contact_email: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_CONTACT_EMAIL", "").strip())
    # The address learners open the app at, for links in emails (e.g. https://coach.example.com).
    public_url: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_PUBLIC_URL", "").strip().rstrip("/"))
    # Every learner feature needs a signed-in account; sign-in, health checks and teachers' share
    # links stay open. 0 lets guests practise without one, as older versions did.
    require_account: bool = field(default_factory=lambda: _flag("PRONUNCIATION_COACH_REQUIRE_ACCOUNT", "1"))
    # "Continue with Google" (backend.oauth): an OAuth client from Google Cloud. Without both it is off.
    google_client_id: str = field(default_factory=lambda: os.getenv("GOOGLE_CLIENT_ID", "").strip())
    google_client_secret: str = field(default_factory=lambda: os.getenv("GOOGLE_CLIENT_SECRET", "").strip())
    gemini_live_model: str = field(
        default_factory=lambda: os.getenv("PRONUNCIATION_COACH_VOICE_MODEL", "gemini-3.1-flash-live-preview").strip()
    )
    gemini_live_fallbacks: str = field(
        default_factory=lambda: os.getenv(
            "PRONUNCIATION_COACH_VOICE_FALLBACKS", "gemini-3.8-live,gemini-2.5-flash-native-audio-latest"
        )
    )
    voice_max_sessions: int = field(default_factory=lambda: _int("PRONUNCIATION_COACH_VOICE_MAX_SESSIONS", 3))
    # Gemini Live is paid by the second, so every conversation and every caller has a budget.
    voice_session_seconds: int = field(default_factory=lambda: max(60, _int("PRONUNCIATION_COACH_VOICE_SESSION_SECONDS", 6 * 60)))
    # Talk time per caller (IP address) per UTC day. 0 switches the daily allowance off.
    voice_daily_minutes: float = field(default_factory=lambda: max(0.0, _float("PRONUNCIATION_COACH_VOICE_DAILY_MINUTES", 20.0)))
    # A call where the learner says nothing for this long is ended (the coach checks in halfway).
    # Slower than this (words per minute) an attempt is "careful speech". 95% of the readers that
    # speechocean762's experts rated fluent spoke faster (5th percentile: 103 wpm, train split).
    careful_wpm: float = field(default_factory=lambda: max(0.0, _float("PRONUNCIATION_COACH_CAREFUL_WPM", 100.0)))
    # Below this share of listening trials heard right, the coach session trains the ear first.
    perception_threshold: float = field(
        default_factory=lambda: min(1.0, max(0.0, _float("PRONUNCIATION_COACH_PERCEPTION_THRESHOLD", 0.8)))
    )
    voice_idle_seconds: int = field(default_factory=lambda: max(20, _int("PRONUNCIATION_COACH_VOICE_IDLE_SECONDS", 90)))

    @property
    def gemini_live_models(self) -> tuple[str, ...]:
        """The live model to try first, then the fallbacks, without duplicates."""
        models = [self.gemini_live_model, *self.gemini_live_fallbacks.split(",")]
        return tuple(dict.fromkeys(m.strip() for m in models if m.strip()))

    # Tried in order when the main model is rate limited or fails (each has its own token budget).
    groq_fallback_models: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            m.strip()
            for m in os.getenv("PRONUNCIATION_COACH_LLM_FALLBACKS", "qwen/qwen3.8-27b,openai/gpt-oss-20b").split(",")
            if m.strip()
        )
    )
    llm_timeout: float = field(default_factory=lambda: _float("PRONUNCIATION_COACH_LLM_TIMEOUT", 8.0))

    # Acoustic phoneme scoring (backend.phoneme_model). Without the model files
    # the scorer falls back to comparing Whisper's words.
    phoneme_scoring: bool = field(default_factory=lambda: _flag("PRONUNCIATION_COACH_PHONEME_SCORING", "1"))
    phoneme_model_dir: str = field(
        default_factory=lambda: os.getenv("PRONUNCIATION_COACH_PHONEME_DIR", str(_cache_dir() / "phonemes"))
    )
    phoneme_threads: int = field(default_factory=lambda: _int("PRONUNCIATION_COACH_PHONEME_THREADS", 0))
    # Trained sound models per first language (backend/data/sound_models). 0 uses the default curve for everyone.
    sound_models: bool = field(default_factory=lambda: _flag("PRONUNCIATION_COACH_SOUND_MODELS", "1"))

    # "Help improve Vocaly AI" (backend.contributions): a private Hugging Face dataset ("user/name";
    # on a Space it defaults to "<owner>/vocaly-recordings") and a token that can write to it. The
    # token has its own name, not HF_TOKEN, so setting a Hugging Face token for anything else never
    # turns this on by accident. Without a token the option isn't offered.
    dataset_repo: str = field(default_factory=_dataset_repo)
    hf_token: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_DATASET_TOKEN", "").strip())
    contrib_dir: str = field(
        default_factory=lambda: os.getenv("PRONUNCIATION_COACH_CONTRIB_DIR", str(_cache_dir() / "contributions"))
    )
    contrib_upload_minutes: float = field(default_factory=lambda: max(1.0, _float("PRONUNCIATION_COACH_CONTRIB_UPLOAD_MINUTES", 10.0)))
    # Recordings kept per learner per day, so one person can't fill the dataset.
    contrib_daily_limit: int = field(default_factory=lambda: max(0, _int("PRONUNCIATION_COACH_CONTRIB_DAILY_LIMIT", 100)))

    # Uploads
    max_upload_bytes: int = field(default_factory=lambda: _int("PRONUNCIATION_COACH_MAX_UPLOAD_BYTES", 25 * 1024 * 1024))
    max_audio_seconds: float = field(default_factory=lambda: _float("PRONUNCIATION_COACH_MAX_AUDIO_SECONDS", 60.0))
    # Longest answer in "Speak freely" (that mode only; everything else keeps max_audio_seconds).
    free_speech_seconds: float = field(default_factory=lambda: max(10.0, _float("PRONUNCIATION_COACH_FREE_SPEECH_SECONDS", 120.0)))
    # Longest answer in a mock interview: a full STAR story runs to two minutes, so a little more room.
    interview_seconds: float = field(default_factory=lambda: max(30.0, _float("PRONUNCIATION_COACH_INTERVIEW_SECONDS", 150.0)))
    # Days between the "Day 1" interview answer and the next recording of the same answer.
    compare_days: int = field(default_factory=lambda: max(0, _int("PRONUNCIATION_COACH_COMPARE_DAYS", 30)))
    max_target_chars: int = 500
    # Remove room noise and quieter background voices from recordings before scoring.
    noise_cleanup: bool = field(default_factory=lambda: _flag("PRONUNCIATION_COACH_NOISE_CLEANUP", "1"))
    # RNNoise made scoring less accurate in measurement (see backend/enhance.py), so it is opt-in.
    noise_neural: bool = field(default_factory=lambda: _flag("PRONUNCIATION_COACH_NOISE_NEURAL", "0"))

    # Coach voice
    tts_enabled: bool = field(default_factory=lambda: _flag("PRONUNCIATION_COACH_TTS", "1"))
    tts_voice: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_TTS_VOICE", "en_US-lessac-medium"))
    max_tts_chars: int = 300
    # "auto" uses Kokoro when its model files are present, otherwise Piper.
    tts_engine: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_TTS_ENGINE", "auto").strip().lower())
    kokoro_voice: str = field(default_factory=lambda: os.getenv("PRONUNCIATION_COACH_KOKORO_VOICE", "af_heart"))
    kokoro_threads: int = field(default_factory=lambda: _int("PRONUNCIATION_COACH_KOKORO_THREADS", 0))

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
