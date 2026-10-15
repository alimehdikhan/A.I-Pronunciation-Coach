"""
Logging, request IDs, timing and Prometheus metrics.

Every request gets an ID (reusing a sane incoming X-Request-ID), which is
echoed in the response and attached to every log line written while handling
it. Metrics use route templates, never raw paths, to keep cardinality bounded.
"""

from __future__ import annotations

import contextvars
import json
import logging
import re
import time
import uuid
from contextlib import contextmanager
from typing import Iterator

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{8,64}$")

logger = logging.getLogger("pronunciation_coach.http")

# --- Metrics ------------------------------------------------------------------

HTTP_REQUESTS = Counter("pc_http_requests_total", "HTTP requests", ["method", "route", "status"])
HTTP_LATENCY = Histogram(
    "pc_http_request_duration_seconds",
    "HTTP request latency",
    ["route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16),
)
EVALUATE_STAGE = Histogram(
    "pc_evaluate_stage_seconds",
    "Time spent in each stage of /api/evaluate",
    ["stage"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8),
)
ASR_WAITING = Gauge("pc_asr_waiting", "Transcriptions waiting for a free slot")
ASR_RUNNING = Gauge("pc_asr_running", "Transcriptions currently running")
ASR_REJECTED = Counter("pc_asr_rejected_total", "Transcriptions rejected because the queue was full")
TTS_CACHE = Counter("pc_tts_cache_total", "Coach voice cache lookups", ["result"])
LLM_CALLS = Counter("pc_llm_calls_total", "Language model calls by model and outcome", ["model", "outcome"])
LLM_SECONDS = Histogram(
    "pc_llm_seconds",
    "Language model call latency (successful calls)",
    ["model"],
    buckets=(0.25, 0.5, 1, 2, 3, 5, 8, 15, 30),
)
LLM_RESULTS = Counter("pc_llm_results_total", "What learners were shown, by feature and source", ["kind", "source"])
RATE_LIMITED = Counter("pc_rate_limited_total", "Requests rejected by the rate limiter", ["limiter"])


def metrics_response() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


# --- Logging ------------------------------------------------------------------


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "message": record.getMessage(),
        }
        for key in ("method", "path", "status", "duration_ms", "route"):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str = "INFO", fmt: str = "text") -> None:
    handler = logging.StreamHandler()
    handler.addFilter(_RequestIdFilter())
    if fmt == "json":
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s [%(request_id)s] %(name)s: %(message)s"))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # Uvicorn's access log duplicates ours.
    logging.getLogger("uvicorn.access").disabled = True


# --- Timing -------------------------------------------------------------------


class StageTimer:
    """Collects per-stage durations for metrics and a Server-Timing header."""

    def __init__(self) -> None:
        self.stages: list[tuple[str, float]] = []

    @contextmanager
    def stage(self, name: str) -> Iterator[None]:
        start = time.perf_counter()
        try:
            yield
        finally:
            elapsed = time.perf_counter() - start
            self.stages.append((name, elapsed))
            EVALUATE_STAGE.labels(stage=name).observe(elapsed)

    def header(self) -> str:
        return ", ".join(f"{name};dur={seconds * 1000:.1f}" for name, seconds in self.stages)


# --- Middleware ---------------------------------------------------------------


class RequestContextMiddleware:
    """Request IDs, access logging, HTTP metrics and JSON 500s (pure ASGI)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = Headers(scope=scope).get("x-request-id", "")
        request_id = incoming if _REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        start = time.perf_counter()
        status = 500
        started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal status, started
            if message["type"] == "http.response.start":
                started = True
                status = message["status"]
                MutableHeaders(scope=message)["X-Request-ID"] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            logger.exception("Unhandled error in %s %s", scope["method"], scope["path"])
            if started:
                raise
            response = JSONResponse({"detail": "Internal server error.", "request_id": request_id}, status_code=500)
            await response(scope, receive, send_wrapper)
        finally:
            elapsed = time.perf_counter() - start
            path = scope["path"]
            route = scope.get("route")
            template = getattr(route, "path", None) or ("unmatched" if path.startswith("/api") else "static")
            HTTP_REQUESTS.labels(scope["method"], template, str(status)).inc()
            HTTP_LATENCY.labels(template).observe(elapsed)
            if path.startswith("/api") or status >= 500:
                logger.info(
                    "%s %s -> %s in %.1f ms",
                    scope["method"],
                    path,
                    status,
                    elapsed * 1000,
                    extra={"method": scope["method"], "path": path, "status": status,
                           "duration_ms": round(elapsed * 1000, 1), "route": template},
                )
            request_id_var.reset(token)
