"""
FastAPI application for the AI Pronunciation Coach.

The API accepts short browser recordings, transcribes them with Whisper
(faster-whisper), and compares the result against a target sentence. It also
serves the built React frontend (``frontend/dist``) as a single-page app.

Layout:
    config          settings from the environment
    observability   logging, request IDs, metrics, Server-Timing
    security        rate limiting, profile keys, security headers, body limits
    runtime         loaded models and the transcription work gate
    audio / asr     decoding, loudness normalisation, speech recognition
    repositories    database queries
    api/*           HTTP routes
    spa             the React app shell
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from backend.api import routers
from backend.api.sharing import purge_on_startup
from backend.config import PROJECT_ROOT, settings
from backend.database import init_db
from backend.errors import CodedHTTPException
from backend.observability import RequestContextMiddleware, configure_logging
from backend.repositories import ProfileLocked
from backend.runtime import load_all, runtime
from backend.security import AuthError, BodySizeLimitMiddleware, SecurityHeadersMiddleware
from backend.spa import SPAStaticFiles

configure_logging(settings.log_level, settings.log_format)
logger = logging.getLogger("pronunciation_coach")

frontend_dir = os.path.abspath(settings.frontend_dir)
# Multipart framing adds a little on top of the audio file itself.
MAX_REQUEST_BYTES = settings.max_upload_bytes + 256 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    runtime.db_ready = await run_in_threadpool(init_db)
    if runtime.db_ready:
        try:
            await run_in_threadpool(purge_on_startup)
        except Exception:
            logger.warning("Could not purge expired share links", exc_info=True)
    loader: asyncio.Task | None = None
    if settings.load_models_on_startup:
        # Serve the app (and /health) immediately; models warm up in the
        # background and speech endpoints return 503 until they're ready.
        loader = asyncio.create_task(load_all())
    else:
        logger.warning("Model startup loading is disabled by environment configuration.")
    yield
    if loader and not loader.done():
        loader.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await loader


app = FastAPI(
    title="AI Pronunciation Coach API",
    description="Phoneme-level pronunciation feedback using Whisper ASR and CMUDict",
    version="2.1.0",
    lifespan=lifespan,
)

# Middleware runs outermost-first in reverse order of registration:
# CORS -> request context -> security headers -> gzip -> body size limit -> app.
app.add_middleware(BodySizeLimitMiddleware, max_bytes=MAX_REQUEST_BYTES)
app.add_middleware(GZipMiddleware, minimum_size=1024, exclude_content_types=("text/event-stream", "audio/wav"))
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials="*" not in settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "Server-Timing", "Retry-After"],
)


@app.exception_handler(ProfileLocked)
async def profile_locked_handler(request: Request, exc: ProfileLocked) -> JSONResponse:
    return JSONResponse(
        {"detail": "This name is in use on another device. Choose a different name in Settings.", "code": "profile_locked"},
        status_code=403,
    )


@app.exception_handler(CodedHTTPException)
async def coded_error_handler(request: Request, exc: CodedHTTPException) -> JSONResponse:
    return JSONResponse({"detail": exc.detail, "code": exc.code}, status_code=exc.status_code, headers=exc.headers)


@app.exception_handler(AuthError)
async def auth_error_handler(request: Request, exc: AuthError) -> JSONResponse:
    return JSONResponse({"detail": exc.detail, "code": exc.code}, status_code=exc.status_code)


for router in routers:
    app.include_router(router)


# The agent endpoint exposes internal source code details (file paths,
# function names, line numbers).  It is disabled by default and can be
# enabled via PRONUNCIATION_COACH_ENABLE_AGENT=1 for local development.
if settings.enable_agent:
    from backend.agent import CodeFlowAgent

    @app.get("/api/agent/analyze")
    async def analyze_codebase() -> JSONResponse:
        """Run a conservative code-flow analysis and return findings."""
        try:
            agent = CodeFlowAgent(root=str(PROJECT_ROOT))
            report = await run_in_threadpool(agent.analyze_project)
            return JSONResponse(content={"success": True, "report": report})
        except Exception as exc:
            logger.exception("Agent analysis failed")
            raise HTTPException(status_code=500, detail=f"Agent analysis failed: {exc}") from exc


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
async def api_not_found(path: str):
    """Unknown API routes return JSON 404s instead of the SPA shell."""
    raise HTTPException(status_code=404, detail="Not found")


# ---------------------------------------------------------------------------
# Frontend (React single-page app)
# ---------------------------------------------------------------------------

if os.path.isfile(os.path.join(frontend_dir, "index.html")):
    app.mount(
        "/",
        SPAStaticFiles(directory=frontend_dir, html=True, frame_ancestors=settings.frame_ancestors),
        name="frontend",
    )
else:
    logger.warning("Frontend build not found at %s. Run `npm run build` in frontend/.", frontend_dir)

    @app.get("/", include_in_schema=False)
    async def frontend_missing() -> dict[str, Any]:
        return {
            "message": "AI Pronunciation Coach API is running. Build the frontend with `cd frontend && npm ci && npm run build`.",
            "docs": "/docs",
        }


__all__ = ["app", "SPAStaticFiles"]


if __name__ == "__main__":
    import uvicorn

    logger.info("Starting AI Pronunciation Coach API on http://localhost:8000 (docs at /docs)")
    uvicorn.run(app, host="0.0.0.0", port=8000)
