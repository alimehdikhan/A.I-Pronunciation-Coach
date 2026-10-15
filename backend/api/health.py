"""Liveness, readiness and metrics."""

from __future__ import annotations

import hmac
import os
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

from backend import phonetics
from backend.config import settings
from backend.database import check_db
from backend.observability import metrics_response
from backend.runtime import runtime

router = APIRouter()


def database_status() -> dict[str, Any]:
    """Which database is in use and whether accounts and history outlive a restart.

    SQLite inside a container (as on a Hugging Face Space without persistent
    storage) is thrown away whenever the container is replaced.
    """
    from backend.database import DATABASE_SOURCE, IS_SQLITE

    in_container = bool(os.getenv("SPACE_ID")) or os.path.exists("/.dockerenv")
    return {
        "engine": "sqlite" if IS_SQLITE else "postgresql",
        "persistent": not (IS_SQLITE and in_container),
        "source": DATABASE_SOURCE,  # the variable's name, never its value
    }


@router.get("/health")
async def health_check(request: Request) -> dict[str, Any]:
    """Liveness plus model status (the web app polls this while models load)."""
    models_loaded = runtime.models_loaded
    return {
        "status": "healthy" if models_loaded else "loading",
        "models_loaded": models_loaded,
        "model_size": settings.whisper_model_size,
        "language": settings.language,
        "phoneme_backend": "cmudict" if phonetics.dictionary_available() else "spelling",
        "tts_ready": runtime.voice is not None,
        "tts_engine": runtime.voice_engine,
        "database": database_status(),
        "acoustic_scoring": runtime.phonemes is not None,
        "coach_llm": bool(settings.groq_api_key),
        "version": request.app.version,
    }


@router.get("/ready", include_in_schema=False)
async def readiness() -> JSONResponse:
    """200 only when requests can be fully served (models loaded, database reachable)."""
    db_ok = await run_in_threadpool(check_db)
    ready = runtime.models_loaded and db_ok
    return JSONResponse(
        {
            "ready": ready,
            "models_loaded": runtime.models_loaded,
            "database": db_ok,
            "tts_ready": runtime.voice is not None,
            "asr_running": runtime.asr_gate.running,
            "asr_waiting": runtime.asr_gate.waiting,
        },
        status_code=200 if ready else 503,
    )


@router.get("/metrics", include_in_schema=False)
async def metrics(request: Request) -> Response:
    """Prometheus metrics (optionally protected by PRONUNCIATION_COACH_METRICS_TOKEN)."""
    if not settings.metrics_enabled:
        raise HTTPException(status_code=404, detail="Not found")
    if settings.metrics_token:
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied, f"Bearer {settings.metrics_token}"):
            raise HTTPException(status_code=401, detail="Unauthorized", headers={"WWW-Authenticate": "Bearer"})
    return metrics_response()
