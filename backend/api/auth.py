"""Accounts: sign up, sign in, sign out and profile management.

There are no server-side sessions. A signed-in device is a browser profile key
(the same X-Profile-Key every other endpoint already uses) that has been bound
to an account, so history, analytics and drills authorise exactly as before.
Signing out unbinds the device; passwords are scrypt-hashed.
"""

from __future__ import annotations

import logging
import re
import secrets
from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete as sql_delete
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend import oauth
from backend.api.deps import profile_key
from backend.config import settings
from backend.database import PronunciationRecord, User, UserKey, as_utc, get_db
from backend.repositories import (
    ProfileLocked,
    account_for_key,
    add_device,
    authorize,
    delete_account,
    drop_other_devices,
    find_user,
    find_user_by_email,
    remove_device,
)
from backend.security import (
    AuthError,
    RateLimiter,
    check_password_strength,
    clean_username,
    client_key,
    hash_password,
    normalize_email,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["accounts"])
logger = logging.getLogger("pronunciation_coach.auth")

# Password guessing is the thing to slow down, so this is stricter than the audio limit.
_limit = 0 if settings.rate_limit_per_minute <= 0 else max(5, settings.rate_limit_per_minute // 3)
auth_rate_limiter = RateLimiter(_limit, name="auth")


class Credentials(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)


class LoginBody(BaseModel):
    # An email address or a username. "email" is the original field name.
    identifier: str | None = Field(default=None, max_length=254)
    email: str | None = Field(default=None, max_length=254)
    password: str = Field(max_length=256)


class RegisterBody(Credentials):
    username: str = Field(max_length=80)
    # Shown in the app; may be shared with other people. Defaults to the username.
    display_name: str | None = Field(default=None, max_length=80)


class RenameBody(BaseModel):
    username: str | None = Field(default=None, max_length=80)
    display_name: str | None = Field(default=None, max_length=80)


class ChangePasswordBody(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(max_length=256)


class PasswordBody(BaseModel):
    password: str = Field(max_length=256)


def _need_key(key: str | None) -> str:
    if not key:
        raise AuthError(400, "This browser has no profile key yet. Reload the page and try again.", "profile_key_required")
    return key


def _profile(db: Session, user: User) -> dict[str, Any]:
    attempts = db.scalar(select(func.count()).select_from(PronunciationRecord).where(PronunciationRecord.user_id == user.id))
    devices = db.scalar(select(func.count()).select_from(UserKey).where(UserKey.user_id == user.id)) or 0
    return {
        "account": True,
        "username": user.username,
        "display_name": user.display_name or user.username,
        "email": user.email,
        "member_since": as_utc(user.created_at).isoformat() if user.created_at else None,
        "attempts": int(attempts or 0),
        "devices": int(devices),
        # Made with Google and no password set: there is no current password to ask for.
        "google_only": user.password_hash == oauth.GOOGLE_ONLY,
        "google": user.google_sub is not None,
    }


def _release_key(db: Session, key: str, except_user_id: int | None = None) -> None:
    """A device belongs to one account at a time: unbind it from any other."""
    other = account_for_key(db, key)
    if other is not None and other.id != except_user_id:
        remove_device(db, other, key)


def _require_account(db: Session, key: str | None) -> User:
    user = account_for_key(db, key)
    if user is None:
        raise AuthError(401, "Sign in to manage your account.", "not_signed_in")
    return user


@router.post("/register")
def register(
    request: Request, body: RegisterBody, key: str | None = Depends(profile_key), db: Session = Depends(get_db)
) -> dict[str, Any]:
    auth_rate_limiter.check(client_key(request))
    key = _need_key(key)
    email = normalize_email(body.email)
    name = clean_username(body.username)
    password = check_password_strength(body.password, email=email, username=name)
    if not name:
        raise AuthError(400, "Choose a username.", "username_required")
    display = clean_username(body.display_name) if (body.display_name or "").strip() else name
    if account_for_key(db, key) is not None:
        raise AuthError(409, "This browser is already signed in. Sign out first to create another account.", "already_signed_in")
    if find_user_by_email(db, email) is not None:
        raise AuthError(409, "An account with this email already exists. Try signing in.", "email_taken")

    user = find_user(db, name)
    if user is None:
        user = User(
            username=name, display_name=display, key_hash=None, email=email, password_hash=hash_password(password)
        )
        db.add(user)
        db.flush()
        add_device(db, user, key)
    else:
        if user.password_hash is not None:
            raise AuthError(409, "That username is taken. Choose another one.", "username_taken")
        try:
            authorize(db, user, key)  # a guest profile this browser owns is upgraded in place
        except ProfileLocked:
            db.rollback()
            raise AuthError(409, "That username is in use on another device. Choose another one.", "username_taken") from None
        user.email = email
        user.display_name = display
        user.password_hash = hash_password(password)
        add_device(db, user, key)  # moves this browser's key out of the guest slot
    db.commit()
    return _profile(db, user)


@router.post("/login")
def login(
    request: Request, body: LoginBody, key: str | None = Depends(profile_key), db: Session = Depends(get_db)
) -> dict[str, Any]:
    auth_rate_limiter.check(client_key(request))
    key = _need_key(key)
    identifier = (body.identifier or body.email or "").strip()
    if not identifier:
        raise AuthError(400, "Enter your email or username.", "identifier_required")
    if "@" in identifier:
        user = find_user_by_email(db, identifier.lower())
    else:
        user = find_user(db, identifier)
        if user is None:  # usernames are case-sensitive in storage; be forgiving when signing in
            user = db.scalar(select(User).where(func.lower(User.username) == identifier.lower(), User.password_hash.is_not(None)))
    if user is not None and user.password_hash is None:
        user = None  # a guest profile has no password to sign in with
    # Always do the hashing work, so timing does not depend on whether the account exists.
    valid = verify_password(body.password or "", user.password_hash if user else None)
    if user is None:
        raise AuthError(
            401,
            "There is no account with that email or username. Check the spelling, or create an account.",
            "no_account",
        )
    if user.password_hash == oauth.GOOGLE_ONLY:
        raise AuthError(401, "This account signs in with Google. Use “Continue with Google”.", "use_google")
    if not valid:
        raise AuthError(401, "That password is not right for this account.", "wrong_password")
    _release_key(db, key, except_user_id=user.id)
    add_device(db, user, key)
    db.commit()
    return _profile(db, user)


@router.get("/available")
def availability(
    request: Request,
    username: str = Query("", max_length=80),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Whether a username can be taken, so sign-up can say so before the form is sent."""
    auth_rate_limiter.check(client_key(request))
    try:
        name = clean_username(username)
    except HTTPException:
        return {"available": False, "reason": "invalid"}
    if not name:
        return {"available": False, "reason": "empty"}
    user = find_user(db, name)
    taken = user is not None and user.password_hash is not None
    return {"available": not taken, "reason": "taken" if taken else None}


@router.post("/logout")
def logout(key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, bool]:
    user = account_for_key(db, key)
    if user is not None and key:
        remove_device(db, user, key)
        db.commit()
    return {"signed_out": True}


@router.get("/me")
def me(key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    user = account_for_key(db, key)
    return _profile(db, user) if user is not None else {"account": False}


@router.patch("/me")
def rename(body: RenameBody, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    user = _require_account(db, key)
    if body.username is None and body.display_name is None:
        raise AuthError(400, "Nothing to change.", "nothing_to_change")
    if body.username is not None:
        name = clean_username(body.username)
        if not name:
            raise AuthError(400, "Choose a username.", "username_required")
        existing = find_user(db, name)
        if existing is not None and existing.id != user.id:
            raise AuthError(409, "That username is taken. Choose another one.", "username_taken")
        user.username = name
    if body.display_name is not None:
        shown = clean_username(body.display_name)
        if not shown:
            raise AuthError(400, "Enter a name to show on your profile.", "display_name_required")
        user.display_name = shown  # not unique: several people can share a name
    db.commit()
    return _profile(db, user)


@router.post("/password")
def change_password(
    request: Request, body: ChangePasswordBody, key: str | None = Depends(profile_key), db: Session = Depends(get_db)
) -> dict[str, Any]:
    auth_rate_limiter.check(client_key(request))
    user = _require_account(db, key)
    # A Google account with no password yet can add one: this signed-in device is the proof.
    if user.password_hash != oauth.GOOGLE_ONLY and not verify_password(body.current_password, user.password_hash):
        raise AuthError(401, "Your current password is incorrect.", "invalid_credentials")
    user.password_hash = hash_password(check_password_strength(body.new_password))
    drop_other_devices(db, user, _need_key(key))  # other devices must sign in again
    db.commit()
    return _profile(db, user)


@router.post("/delete")
def delete(
    request: Request, body: PasswordBody, key: str | None = Depends(profile_key), db: Session = Depends(get_db)
) -> dict[str, bool]:
    auth_rate_limiter.check(client_key(request))
    user = _require_account(db, key)
    if user.password_hash != oauth.GOOGLE_ONLY and not verify_password(body.password, user.password_hash):
        raise AuthError(401, "Your password is incorrect.", "invalid_credentials")
    delete_account(db, user)
    return {"deleted": True}


# --- Continue with Google (only when a Google OAuth client is configured) ----------------------


class GoogleStartBody(BaseModel):
    next: str | None = Field(default=None, max_length=300)


def _safe_next(path: str | None) -> str:
    """Where to go after signing in: only a path inside this app, never another site."""
    if path and path.startswith("/") and not path.startswith(("//", "/api/")) and "\\" not in path:
        return path
    return "/practice"


def _to_login(**params: str) -> RedirectResponse:
    return RedirectResponse(f"/login?{urlencode(params)}", status_code=303)


def _free_username(db: Session, name: str, email: str) -> str:
    """A unique username from the Google name or the email: "Sam Lee" -> "sam.lee", then "sam.lee2"."""
    base = re.sub(r"[^a-z0-9]+", ".", (name or email.split("@")[0]).lower()).strip(".")[:30] or "learner"
    for candidate in [base, *(f"{base}{n}" for n in range(2, 50))]:
        if find_user(db, candidate) is None:
            return candidate
    return f"{base}{secrets.randbelow(900_000) + 100_000}"


def _google_account(db: Session, who: dict[str, Any]) -> User | None:
    """The account for this Google identity: linked before, matched by a verified email, or new."""
    user = db.scalar(select(User).where(User.google_sub == who["sub"]))
    if user is not None:
        return user
    if not who["email_verified"]:
        return None  # an address Google has not checked could belong to someone else's account
    user = find_user_by_email(db, who["email"])
    if user is not None:
        user.google_sub = who["sub"]  # Google has checked this person owns the address
        return user
    username = _free_username(db, who["name"], who["email"])
    try:
        display = clean_username(who["name"]) or username
    except HTTPException:
        display = username
    user = User(
        username=username,
        display_name=display[:40],
        email=who["email"],
        password_hash=oauth.GOOGLE_ONLY,
        google_sub=who["sub"],
        key_hash=None,
    )
    db.add(user)
    db.flush()
    return user


@router.post("/google/start")
def google_start(request: Request, body: GoogleStartBody, key: str | None = Depends(profile_key)) -> dict[str, str]:
    auth_rate_limiter.check(client_key(request))
    if not oauth.enabled():
        raise AuthError(404, "Google sign-in is not switched on for this app.", "google_unavailable")
    url = oauth.start(_need_key(key), _safe_next(body.next), oauth.redirect_uri(str(request.base_url)))
    return {"url": url}


@router.get("/google/callback", include_in_schema=False)
def google_callback(
    code: str = Query("", max_length=2000),
    state: str = Query("", max_length=200),
    error: str = Query("", max_length=200),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Google sends the browser here. Back on the sign-in page, the app picks up the account."""
    pending = oauth.take(state) if state else None
    if pending is None:
        return _to_login(error="google_expired")
    if error or not code:
        return _to_login(error="google_cancelled", next=pending.next)
    try:
        who = oauth.identity(code, pending)
    except oauth.GoogleError as failure:
        logger.warning("Google sign-in failed: %s", failure)
        reason = re.sub(r"[^a-z0-9]+", "_", str(failure).lower()).strip("_")[:40] or "unknown"
        return _to_login(error="google_failed", reason=reason, next=pending.next)
    user = _google_account(db, who)
    if user is None:
        db.rollback()
        return _to_login(error="google_unverified", next=pending.next)
    _release_key(db, pending.key, except_user_id=user.id)
    add_device(db, user, pending.key)
    db.commit()
    return _to_login(signed_in="google", next=pending.next)


# --- Password reset by email (only when an email provider is configured) ----------------------

RESET_MINUTES = 30


class ForgotBody(BaseModel):
    email: str = Field(max_length=254)


class ResetBody(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(max_length=256)


def _reset_hash(token: str) -> str:
    import hashlib

    return hashlib.sha256(token.encode()).hexdigest()


def _naive_now():
    from backend.database import utcnow

    return utcnow().replace(tzinfo=None)


@router.post("/forgot")
async def forgot_password(body: ForgotBody, request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Email a single-use reset link (30 minutes). The answer is the same whether or not the email has an account."""
    import secrets
    from datetime import timedelta

    from fastapi.concurrency import run_in_threadpool

    from backend import mailer
    from backend.database import PasswordReset

    if not mailer.enabled():
        raise AuthError(404, "Password reset isn't available on this server.", "reset_unavailable")
    auth_rate_limiter.check(client_key(request))
    sent = {"sent": True, "detail": "If an account uses that email, a reset link is on its way. It works for 30 minutes."}
    user = find_user_by_email(db, normalize_email(body.email))
    if user is None or user.password_hash is None:
        return sent
    token = secrets.token_urlsafe(32)
    db.add(PasswordReset(user_id=user.id, token_hash=_reset_hash(token), expires_at=_naive_now() + timedelta(minutes=RESET_MINUTES)))
    db.commit()
    base = settings.public_url or str(request.base_url).rstrip("/")
    link = f"{base}/reset?token={token}"
    text = (
        f"Someone asked to reset the password for your Vocaly AI account ({user.username}).\n\n"
        f"To choose a new password, open this link within {RESET_MINUTES} minutes:\n{link}\n\n"
        "If it wasn't you, ignore this email: your password stays the same."
    )
    try:
        await run_in_threadpool(mailer.send, user.email, "Reset your password", text)
    except Exception:
        # Never tell the requester whether the account exists; the operator sees the failure.
        import logging

        logging.getLogger("pronunciation_coach.api.auth").exception("Password reset email could not be sent")
    return sent


@router.post("/reset")
def reset_password(body: ResetBody, request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Set a new password with a reset link's token, then sign out every device."""
    from backend import mailer
    from backend.database import PasswordReset

    if not mailer.enabled():
        raise AuthError(404, "Password reset isn't available on this server.", "reset_unavailable")
    auth_rate_limiter.check(client_key(request))
    reset = db.scalar(select(PasswordReset).where(PasswordReset.token_hash == _reset_hash(body.token)))
    if reset is None or reset.used_at is not None or reset.expires_at <= _naive_now():
        raise AuthError(400, "This reset link has expired or was already used. Ask for a new one.", "reset_invalid")
    user = db.get(User, reset.user_id)
    if user is None:
        raise AuthError(400, "This reset link has expired or was already used. Ask for a new one.", "reset_invalid")
    user.password_hash = hash_password(check_password_strength(body.password, email=user.email, username=user.username))
    reset.used_at = _naive_now()
    db.execute(sql_delete(PasswordReset).where(PasswordReset.user_id == user.id, PasswordReset.id != reset.id))
    db.execute(sql_delete(UserKey).where(UserKey.user_id == user.id))
    db.commit()
    return {"reset": True}
