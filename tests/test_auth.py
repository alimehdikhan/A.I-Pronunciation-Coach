"""Accounts: sign up, sign in, devices, guest upgrade, password change and deletion."""

import pytest

from backend.api import auth as auth_api
from backend.security import hash_password, verify_password
from tests.conftest import OTHER_KEY, PROFILE_KEY, wav_bytes

THIRD_KEY = "third-profile-key-0123456789abcdefghijklmn"
PASSWORD = "correct horse battery"


@pytest.fixture(autouse=True)
def _loose_auth_limit(monkeypatch):
    monkeypatch.setattr(auth_api.auth_rate_limiter, "limit", 1000)
    auth_api.auth_rate_limiter.reset()


def headers(key):
    return {"X-Profile-Key": key}


def register(client, key=PROFILE_KEY, email="sam@example.com", username="Sam", password=PASSWORD):
    return client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "username": username},
        headers=headers(key),
    )


def login(client, key, email="sam@example.com", password=PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password}, headers=headers(key))


def attempt(client, key, username="Sam"):
    return client.post(
        "/api/evaluate",
        files={"audio": ("clip.wav", wav_bytes(), "audio/wav")},
        data={"target_text": "Hello world", "username": username},
        headers=headers(key),
    )


def test_password_hashing_is_salted_and_verifiable():
    first, second = hash_password("hunter2hunter2"), hash_password("hunter2hunter2")
    assert first != second and first.startswith("scrypt$")
    assert verify_password("hunter2hunter2", first)
    assert not verify_password("wrong", first)
    assert not verify_password("anything", None)


def test_register_creates_an_account_and_me_reports_it(client):
    response = register(client)
    assert response.status_code == 200
    body = response.json()
    assert body["account"] is True and body["username"] == "Sam" and body["email"] == "sam@example.com"
    assert body["devices"] == 1
    assert "password" not in str(body).lower().replace("password_hash", "")

    me = client.get("/api/auth/me", headers=headers(PROFILE_KEY)).json()
    assert me["account"] is True and me["username"] == "Sam"
    assert client.get("/api/auth/me", headers=headers(OTHER_KEY)).json() == {"account": False}
    assert client.get("/api/auth/me").json() == {"account": False}


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ({"email": "not-an-email", "password": PASSWORD, "username": "Sam"}, "invalid_email"),
        ({"email": "sam@example.com", "password": "short", "username": "Sam"}, "weak_password"),
        ({"email": "sam@example.com", "password": PASSWORD, "username": "  "}, "username_required"),
    ],
)
def test_register_validates_input(client, payload, code):
    response = client.post("/api/auth/register", json=payload, headers=headers(PROFILE_KEY))
    assert response.status_code == 400 and response.json()["code"] == code


def test_register_needs_a_profile_key(client):
    response = client.post("/api/auth/register", json={"email": "a@b.co", "password": PASSWORD, "username": "A"})
    assert response.status_code == 400 and response.json()["code"] == "profile_key_required"


def test_duplicate_email_and_name_are_rejected(client):
    assert register(client).status_code == 200
    again = register(client, key=OTHER_KEY, email="SAM@example.com", username="Other")
    assert again.status_code == 409 and again.json()["code"] == "email_taken"
    same_name = register(client, key=OTHER_KEY, email="other@example.com", username="Sam")
    assert same_name.status_code == 409 and same_name.json()["code"] == "username_taken"


def test_signed_in_browser_cannot_create_a_second_account(client):
    assert register(client).status_code == 200
    second = register(client, email="two@example.com", username="Two")
    assert second.status_code == 409 and second.json()["code"] == "already_signed_in"


def test_login_failures_do_not_reveal_which_emails_exist(client):
    register(client)
    wrong_password = login(client, OTHER_KEY, password="wrong password!")
    unknown_email = login(client, OTHER_KEY, email="nobody@example.com")
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()
    assert wrong_password.json()["code"] == "invalid_credentials"


def test_a_second_device_can_sign_in_and_read_the_same_history(client):
    register(client)
    assert attempt(client, PROFILE_KEY).json()["saved"] is True

    assert client.get("/api/history/Sam", headers=headers(OTHER_KEY)).status_code == 403
    assert login(client, OTHER_KEY).status_code == 200

    history = client.get("/api/history/Sam", headers=headers(OTHER_KEY))
    assert history.status_code == 200 and len(history.json()["records"]) == 1
    assert client.get("/api/history/Sam", headers=headers(PROFILE_KEY)).status_code == 200
    assert client.get("/api/history/Sam", headers=headers(THIRD_KEY)).status_code == 403
    assert client.get("/api/auth/me", headers=headers(OTHER_KEY)).json()["devices"] == 2


def test_signing_out_removes_only_that_device(client):
    register(client)
    login(client, OTHER_KEY)
    assert client.post("/api/auth/logout", headers=headers(OTHER_KEY)).json() == {"signed_out": True}

    assert client.get("/api/history/Sam", headers=headers(OTHER_KEY)).status_code == 403
    assert client.get("/api/auth/me", headers=headers(OTHER_KEY)).json() == {"account": False}
    assert client.get("/api/history/Sam", headers=headers(PROFILE_KEY)).status_code == 200


def test_an_account_is_never_readable_without_a_key_after_its_last_device_leaves(client):
    register(client)
    attempt(client, PROFILE_KEY)
    client.post("/api/auth/logout", headers=headers(PROFILE_KEY))

    # Neither no key, nor the old key, nor a stranger's key may read it.
    assert client.get("/api/history/Sam").status_code == 403
    assert client.get("/api/history/Sam", headers=headers(PROFILE_KEY)).status_code == 403
    assert client.get("/api/history/Sam", headers=headers(THIRD_KEY)).status_code == 403
    # Signing back in restores access, and counts as exactly one device.
    assert login(client, THIRD_KEY).json()["devices"] == 1
    assert client.get("/api/history/Sam", headers=headers(THIRD_KEY)).status_code == 200


def test_registering_from_a_guest_profile_keeps_its_history(client):
    assert attempt(client, PROFILE_KEY, username="Sam").json()["saved"] is True
    assert attempt(client, PROFILE_KEY, username="Sam").json()["saved"] is True

    body = register(client).json()

    assert body["account"] is True and body["attempts"] == 2
    records = client.get("/api/history/Sam", headers=headers(PROFILE_KEY)).json()["records"]
    assert len(records) == 2


def test_cannot_take_over_someone_elses_guest_profile_by_registering(client):
    attempt(client, PROFILE_KEY, username="Sam")
    response = register(client, key=OTHER_KEY, email="thief@example.com", username="Sam")
    assert response.status_code == 409 and response.json()["code"] == "username_taken"
    assert client.get("/api/history/Sam", headers=headers(OTHER_KEY)).status_code == 403


def test_signing_in_on_a_device_moves_it_out_of_its_previous_account(client):
    register(client)
    register(client, key=OTHER_KEY, email="kim@example.com", username="Kim")
    assert login(client, PROFILE_KEY, email="kim@example.com").status_code == 200

    me = client.get("/api/auth/me", headers=headers(PROFILE_KEY)).json()
    assert me["username"] == "Kim"
    assert client.get("/api/history/Sam", headers=headers(PROFILE_KEY)).status_code == 403


def test_display_names_may_repeat_but_usernames_may_not(client):
    first = register(client, username="sam_one", email="a@example.com")
    assert first.json()["display_name"] == "sam_one"  # defaults to the username

    shared = client.post(
        "/api/auth/register",
        json={"email": "b@example.com", "password": PASSWORD, "username": "sam_two", "display_name": "Sam"},
        headers=headers(OTHER_KEY),
    )
    assert shared.status_code == 200 and shared.json()["display_name"] == "Sam"

    # Two people can both be shown as "Sam" ...
    ok = client.patch("/api/auth/me", json={"display_name": "Sam"}, headers=headers(PROFILE_KEY))
    assert ok.status_code == 200 and ok.json()["display_name"] == "Sam"
    assert ok.json()["username"] == "sam_one"
    # ... but the username they are stored under stays unique.
    clash = client.patch("/api/auth/me", json={"username": "sam_two"}, headers=headers(PROFILE_KEY))
    assert clash.status_code == 409 and clash.json()["code"] == "username_taken"
    taken = register(client, key=THIRD_KEY, email="c@example.com", username="sam_two")
    assert taken.status_code == 409 and taken.json()["code"] == "username_taken"


def test_rename_username_and_guest_cases(client):
    register(client)
    ok = client.patch("/api/auth/me", json={"username": "Samuel"}, headers=headers(PROFILE_KEY))
    assert ok.status_code == 200 and ok.json()["username"] == "Samuel"
    empty = client.patch("/api/auth/me", json={}, headers=headers(PROFILE_KEY))
    assert empty.status_code == 400 and empty.json()["code"] == "nothing_to_change"
    guest = client.patch("/api/auth/me", json={"username": "X"}, headers=headers(THIRD_KEY))
    assert guest.status_code == 401 and guest.json()["code"] == "not_signed_in"


def test_changing_the_password_signs_out_other_devices(client):
    register(client)
    login(client, OTHER_KEY)

    wrong = client.post(
        "/api/auth/password",
        json={"current_password": "not it at all", "new_password": "a brand new password"},
        headers=headers(PROFILE_KEY),
    )
    assert wrong.status_code == 401

    ok = client.post(
        "/api/auth/password",
        json={"current_password": PASSWORD, "new_password": "a brand new password"},
        headers=headers(PROFILE_KEY),
    )
    assert ok.status_code == 200

    assert client.get("/api/auth/me", headers=headers(OTHER_KEY)).json() == {"account": False}
    assert client.get("/api/auth/me", headers=headers(PROFILE_KEY)).json()["account"] is True
    assert login(client, THIRD_KEY, password=PASSWORD).status_code == 401
    assert login(client, THIRD_KEY, password="a brand new password").status_code == 200


def test_deleting_the_account_removes_everything_and_frees_the_email(client):
    register(client)
    attempt(client, PROFILE_KEY)

    wrong = client.post("/api/auth/delete", json={"password": "nope nope nope"}, headers=headers(PROFILE_KEY))
    assert wrong.status_code == 401
    assert client.post("/api/auth/delete", json={"password": PASSWORD}, headers=headers(PROFILE_KEY)).json() == {"deleted": True}

    assert client.get("/api/history/Sam", headers=headers(PROFILE_KEY)).json()["records"] == []
    assert client.get("/api/auth/me", headers=headers(PROFILE_KEY)).json() == {"account": False}
    assert register(client, key=OTHER_KEY).status_code == 200  # same email and name are free again


def test_account_endpoints_are_rate_limited(client, monkeypatch):
    monkeypatch.setattr(auth_api.auth_rate_limiter, "limit", 3)
    auth_api.auth_rate_limiter.reset()
    codes = [login(client, OTHER_KEY, password="guess number %d" % i).status_code for i in range(5)]
    assert codes[:3] == [401, 401, 401] and codes[3:] == [429, 429]
