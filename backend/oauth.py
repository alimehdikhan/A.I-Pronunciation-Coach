"""“Continue with Google”: the OAuth 2.0 authorization code flow, with PKCE.

The browser asks `POST /api/auth/google/start` (sending its profile key, as every request does) for
Google's sign-in address and goes there. Google sends it back to `GET /api/auth/google/callback`,
which trades the code for the Google account's id, email and name, finds or creates the Vocaly
account and binds this browser's profile key to it, exactly like signing in with a password.

The callback also hands the browser a one-time pass (`?ticket=`, two minutes), which the sign-in
page trades for a sign-in of whatever profile key it holds by then (`POST /api/auth/google/finish`).
So the sign-in survives a browser that changes its key on the way (a cleared or blocked storage, an
in-app browser handing Google to the system browser), not only the usual case where the key is kept.

Pending sign-ins and passes live in memory: a restart in the middle of one only means trying again.
Nothing from Google is kept but the account id (`sub`), the email and the name.
"""

from __future__ import annotations

import base64
import hashlib
import os
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx

from backend.config import settings

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
PENDING_SECONDS = 600
TICKET_SECONDS = 120
MAX_PENDING = 5000
CALLBACK_PATH = "/api/auth/google/callback"

# Stored instead of a password hash for an account made with Google: it counts as an account,
# and no password can ever match it (backend.security.verify_password rejects it).
GOOGLE_ONLY = "google"


class GoogleError(Exception):
    """Google did not confirm who this is. The message is a short code: Google's own error
    (`invalid_client`, `invalid_grant`, ...), `network`, or what was missing."""


def _refusal(response: httpx.Response, step: str) -> GoogleError:
    try:
        code = response.json().get("error")
    except ValueError:
        code = None
    return GoogleError(code if isinstance(code, str) and code else f"{step}_{response.status_code}")


@dataclass(frozen=True)
class Pending:
    key: str
    next: str
    verifier: str
    redirect_uri: str
    expires: float


_pending: dict[str, Pending] = {}
_tickets: dict[str, tuple[int, float]] = {}  # pass -> (user id, expiry)
_lock = threading.Lock()


def enabled() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


def redirect_uri(base_url: str) -> str:
    """Where Google sends the browser back. It must match the address registered with Google."""
    if settings.public_url:
        base = settings.public_url
    elif os.getenv("SPACE_HOST"):  # set by Hugging Face Spaces
        base = f"https://{os.environ['SPACE_HOST']}"
    else:
        base = base_url.rstrip("/")
    return base + CALLBACK_PATH


def start(key: str, next_path: str, callback: str) -> str:
    """Remember this sign-in and return Google's address for it."""
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    now = time.monotonic()
    with _lock:
        for old in [s for s, p in _pending.items() if p.expires < now]:
            del _pending[old]
        if len(_pending) >= MAX_PENDING:
            del _pending[next(iter(_pending))]
        _pending[state] = Pending(key, next_path, verifier, callback, now + PENDING_SECONDS)
    query = {
        "client_id": settings.google_client_id,
        "redirect_uri": callback,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    return f"{AUTHORIZE_URL}?{urlencode(query)}"


def take(state: str) -> Pending | None:
    """The sign-in this `state` belongs to, once: a state can't be replayed."""
    with _lock:
        pending = _pending.pop(state, None)
    if pending is None or pending.expires < time.monotonic():
        return None
    return pending


def issue_ticket(user_id: int) -> str:
    """A one-time pass the sign-in page trades for signing its browser in to this account."""
    ticket = secrets.token_urlsafe(32)
    now = time.monotonic()
    with _lock:
        for old in [t for t, (_, expires) in _tickets.items() if expires < now]:
            del _tickets[old]
        if len(_tickets) >= MAX_PENDING:
            del _tickets[next(iter(_tickets))]
        _tickets[ticket] = (user_id, now + TICKET_SECONDS)
    return ticket


def redeem_ticket(ticket: str) -> int | None:
    """The account a pass is for, once: a pass can't be used twice or after two minutes."""
    with _lock:
        entry = _tickets.pop(ticket, None)
    if entry is None or entry[1] < time.monotonic():
        return None
    return entry[0]


def identity(code: str, pending: Pending) -> dict[str, Any]:
    """Trade the code for the Google account's id, email and name."""
    try:
        with httpx.Client(timeout=10) as client:
            token = client.post(
                TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": pending.redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": pending.verifier,
                },
            )
            if token.status_code >= 400:
                raise _refusal(token, "token")
            access = token.json().get("access_token")
            if not access:
                raise GoogleError("no_access_token")
            info = client.get(USERINFO_URL, headers={"Authorization": f"Bearer {access}"})
            if info.status_code >= 400:
                raise _refusal(info, "userinfo")
            data = info.json()
    except httpx.HTTPError as error:
        raise GoogleError("network") from error
    except ValueError as error:
        raise GoogleError("unreadable_answer") from error
    if not data.get("sub") or not data.get("email"):
        raise GoogleError("no_account_id_or_email")
    return {
        "sub": str(data["sub"]),
        "email": str(data["email"]).strip().lower(),
        "email_verified": data.get("email_verified") is True,
        "name": str(data.get("name") or "").strip(),
    }
