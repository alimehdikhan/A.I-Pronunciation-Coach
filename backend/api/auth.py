"""Accounts: sign up, sign in, sign out and profile management.

There are no server-side sessions. A signed-in device is a browser profile key
(the same X-Profile-Key every other endpoint already uses) that has been bound
to an account, so history, analytics and drills authorise exactly as before.
Signing out unbinds the device; passwords are scrypt-hashed.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

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
    if not verify_password(body.current_password, user.password_hash):
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
    if not verify_password(body.password, user.password_hash):
        raise AuthError(401, "Your password is incorrect.", "invalid_credentials")
    delete_account(db, user)
    return {"deleted": True}
