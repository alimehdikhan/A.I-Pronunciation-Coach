"""Password reset by email: off without a mail provider, single-use and short-lived when on."""

import dataclasses
import re
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update

from backend import mailer
from backend.api import auth, health
from backend.database import PasswordReset
from tests.conftest import OTHER_KEY, PROFILE_KEY

EMAIL, PASSWORD, NEW = "asha@example.com", "maple-river-4821", "harbour-lantern-7356"


@pytest.fixture()
def outbox(monkeypatch):
    sent = []
    configured = dataclasses.replace(mailer.settings, smtp_host="smtp.test", mail_from="coach@example.com", public_url="https://coach.test")
    for module in (mailer, auth, health):
        monkeypatch.setattr(module, "settings", configured)
    monkeypatch.setattr(mailer, "send", lambda to, subject, body: sent.append((to, subject, body)))
    auth.auth_rate_limiter.reset()
    return sent


def register(client):
    response = client.post("/api/auth/register", json={"email": EMAIL, "password": PASSWORD, "username": "asha"},
                           headers={"X-Profile-Key": PROFILE_KEY})
    assert response.status_code == 200, response.text


def token_from(body):
    return re.search(r"token=([\w-]+)", body).group(1)


def test_without_a_mail_provider_there_is_no_reset(client):
    assert client.get("/health").json()["password_reset"] is False
    response = client.post("/api/auth/forgot", json={"email": EMAIL})
    assert response.status_code == 404 and response.json()["code"] == "reset_unavailable"


def test_a_reset_link_sets_a_new_password_once_and_signs_everyone_out(client, outbox):
    register(client)
    assert client.get("/health").json()["password_reset"] is True

    unknown = client.post("/api/auth/forgot", json={"email": "nobody@example.com"}).json()
    known = client.post("/api/auth/forgot", json={"email": EMAIL}).json()
    assert unknown == known  # the answer never says whether the account exists
    assert len(outbox) == 1 and outbox[0][0] == EMAIL
    token = token_from(outbox[0][2])
    assert "https://coach.test/reset?token=" in outbox[0][2]

    assert client.post("/api/auth/reset", json={"token": token, "password": "short"}).status_code == 400
    assert client.post("/api/auth/reset", json={"token": token, "password": NEW}).json() == {"reset": True}
    assert client.post("/api/auth/reset", json={"token": token, "password": NEW}).json()["code"] == "reset_invalid"  # single use
    assert client.get("/api/auth/me", headers={"X-Profile-Key": PROFILE_KEY}).json() == {"account": False}  # signed out

    old = client.post("/api/auth/login", json={"identifier": EMAIL, "password": PASSWORD}, headers={"X-Profile-Key": OTHER_KEY})
    assert old.status_code == 401
    fresh = client.post("/api/auth/login", json={"identifier": EMAIL, "password": NEW}, headers={"X-Profile-Key": OTHER_KEY})
    assert fresh.status_code == 200


def test_an_expired_link_does_nothing(client, outbox, session_factory):
    register(client)
    client.post("/api/auth/forgot", json={"email": EMAIL})
    token = token_from(outbox[0][2])
    db = session_factory()
    db.execute(update(PasswordReset).values(expires_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)))
    db.commit()
    db.close()
    assert client.post("/api/auth/reset", json={"token": token, "password": NEW}).json()["code"] == "reset_invalid"
