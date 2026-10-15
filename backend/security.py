"""
Security primitives: rate limiting, client identity, profile keys and headers.

Profile keys: the app has no accounts, so a display name used to be enough to
read or delete anyone's history. Each browser now holds a random secret per
name (sent as X-Profile-Key); the first keyed request claims a name, and only
that key can access it afterwards. Only a SHA-256 hash is stored server-side.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import threading
import time
from collections import OrderedDict, deque
from pathlib import Path

from fastapi import HTTPException, Request
from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.observability import RATE_LIMITED

PROFILE_KEY_HEADER = "X-Profile-Key"
_PROFILE_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
USERNAME_RE = re.compile(r"^[\w .'-]{1,40}$", re.UNICODE)


# --- Rate limiting --------------------------------------------------------------


class RateLimiter:
    """Sliding-window limiter keyed by client IP (in-memory, per process).

    Memory is bounded: idle clients are pruned periodically and the table is
    capped, so a stream of unique IPs can't grow it without limit.
    """

    def __init__(self, limit: int, window_seconds: float = 60.0, name: str = "default", max_clients: int = 10_000):
        self.limit = limit
        self.window = window_seconds
        self.name = name
        self.max_clients = max_clients
        self._hits: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = threading.Lock()
        self._checks = 0

    def check(self, key: str) -> None:
        if self.limit <= 0:
            return
        now = time.monotonic()
        with self._lock:
            hits = self._hits.get(key)
            if hits is None:
                hits = deque()
                self._hits[key] = hits
            else:
                self._hits.move_to_end(key)
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                RATE_LIMITED.labels(self.name).inc()
                retry_after = max(1, int(self.window - (now - hits[0])))
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests. Please wait a moment and try again.",
                    headers={"Retry-After": str(retry_after)},
                )
            hits.append(now)
            self._checks += 1
            if self._checks % 256 == 0 or len(self._hits) > self.max_clients:
                self._prune(now)

    def _prune(self, now: float) -> None:
        stale = [key for key, hits in self._hits.items() if not hits or now - hits[-1] > self.window]
        for key in stale:
            del self._hits[key]
        while len(self._hits) > self.max_clients:
            self._hits.popitem(last=False)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    @property
    def tracked_clients(self) -> int:
        return len(self._hits)


def client_key(request: Request) -> str:
    """The caller's IP as seen by the ASGI server.

    X-Forwarded-For is never parsed here: anyone can send it. Behind a reverse
    proxy, uvicorn's --proxy-headers/--forwarded-allow-ips decide which
    forwarded addresses to trust (see the Dockerfile and render.yaml).
    """
    return request.client.host if request.client else "unknown"


# --- Usernames and profile keys ------------------------------------------------


def clean_username(username: str | None) -> str | None:
    value = (username or "").strip()
    if not value:
        return None
    if not USERNAME_RE.match(value):
        raise HTTPException(
            status_code=400,
            detail="Usernames can be up to 40 characters: letters, numbers, spaces, and . ' _ -",
        )
    return value


def normalize_profile_key(key: str | None) -> str | None:
    if not key:
        return None
    key = key.strip()
    if not _PROFILE_KEY_RE.match(key):
        raise HTTPException(status_code=400, detail="Malformed profile key.")
    return key


def hash_profile_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def profile_key_matches(stored_hash: str, key: str | None) -> bool:
    return bool(key) and hmac.compare_digest(stored_hash, hash_profile_key(key))


# --- Accounts ------------------------------------------------------------------

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s.]{2,}$")
PASSWORD_MIN, PASSWORD_MAX = 8, 128
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


class AuthError(Exception):
    """A user-facing account problem with a stable machine-readable code."""

    def __init__(self, status_code: int, detail: str, code: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code


def normalize_email(email: str | None) -> str:
    value = (email or "").strip().lower()
    if len(value) > 254 or not EMAIL_RE.match(value):
        raise AuthError(400, "Enter a valid email address.", "invalid_email")
    return value


def check_password_strength(password: str | None) -> str:
    value = password or ""
    if len(value) < PASSWORD_MIN:
        raise AuthError(400, f"Use at least {PASSWORD_MIN} characters for your password.", "weak_password")
    if len(value) > PASSWORD_MAX:
        raise AuthError(400, f"Passwords can be at most {PASSWORD_MAX} characters.", "weak_password")
    return value


def hash_password(password: str) -> str:
    """scrypt with a random salt, in a self-describing string."""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    return f"scrypt${_SCRYPT_N}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    """Constant-time check. Runs the same work for an unknown account (stored=None)."""
    try:
        _, n, salt_hex, digest_hex = (stored or _DUMMY_HASH).split("$")
        digest = hashlib.scrypt(
            password.encode("utf-8"), salt=bytes.fromhex(salt_hex), n=int(n), r=_SCRYPT_R, p=_SCRYPT_P, dklen=32
        )
        return stored is not None and hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


# Verifying against this when no account matches keeps login timing uniform.
_DUMMY_HASH = f"scrypt${_SCRYPT_N}${'00' * 16}${'00' * 32}"


# --- Response headers ------------------------------------------------------------

_INLINE_SCRIPT_RE = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.DOTALL | re.IGNORECASE)


def build_spa_csp(index_html: Path, frame_ancestors: str) -> str:
    """A strict Content-Security-Policy for the app shell.

    Inline scripts in the built index.html (the pre-paint theme script) are
    allowed by hash, computed from the file itself so the policy always
    matches the deployed build.
    """
    hashes: list[str] = []
    try:
        html = index_html.read_text(encoding="utf-8")
        for script in _INLINE_SCRIPT_RE.findall(html):
            digest = base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode()
            hashes.append(f"'sha256-{digest}'")
    except OSError:
        pass
    return "; ".join(
        [
            "default-src 'self'",
            "script-src 'self' " + " ".join(hashes),
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "media-src 'self' blob:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            f"frame-ancestors {frame_ancestors}",
        ]
    )


class SecurityHeadersMiddleware:
    """Baseline security headers on every response (pure ASGI)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        forwarded_proto = Headers(scope=scope).get("x-forwarded-proto")
        https = (forwarded_proto or scope.get("scheme", "http")) == "https"

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
                headers.setdefault("Permissions-Policy", "microphone=(self), camera=(), geolocation=(), payment=()")
                headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
                if https:
                    headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
            await send(message)

        await self.app(scope, receive, send_wrapper)


class BodySizeLimitMiddleware:
    """Reject oversized request bodies before they are read or spooled to disk.

    Without this, the multipart parser would receive an entire oversized upload
    before the endpoint could check its size.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in ("POST", "PUT", "PATCH"):
            await self.app(scope, receive, send)
            return
        declared = Headers(scope=scope).get("content-length")
        if declared is not None:
            if not declared.isdigit():
                await JSONResponse({"detail": "Invalid Content-Length header."}, status_code=400)(scope, receive, send)
                return
            if int(declared) > self.max_bytes:
                await JSONResponse({"detail": "Request body is too large."}, status_code=413)(scope, receive, send)
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise HTTPException(status_code=413, detail="Request body is too large.")
            return message

        await self.app(scope, limited_receive, send)
