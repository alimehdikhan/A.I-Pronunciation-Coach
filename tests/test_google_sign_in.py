"""“Continue with Google”: the start, the callback, linking by verified email, and the guards.

Google is replaced by a fake `oauth.identity`; nothing here reaches the network.
"""

from urllib.parse import parse_qs, urlparse

import pytest

from backend import oauth
from backend.api import auth as auth_api
from backend.config import settings
from tests.conftest import OTHER_KEY, PROFILE_KEY

PASSWORD = "correct horse battery"
SAM = {"sub": "google-sub-1", "email": "sam@example.com", "email_verified": True, "name": "Sam Lee"}


@pytest.fixture(autouse=True)
def google_on(monkeypatch):
    monkeypatch.setattr(auth_api.auth_rate_limiter, "limit", 1000)
    auth_api.auth_rate_limiter.reset()
    object.__setattr__(settings, "google_client_id", "client-id.apps.googleusercontent.com")
    object.__setattr__(settings, "google_client_secret", "client-secret")
    yield
    object.__setattr__(settings, "google_client_id", "")
    object.__setattr__(settings, "google_client_secret", "")


@pytest.fixture
def google_says(monkeypatch):
    """Make the fake Google return `who` for the next sign-in."""
    answers = {}

    def identity(code, pending):
        assert code == "the-code" and pending.verifier
        return dict(answers["who"])

    monkeypatch.setattr(oauth, "identity", identity)
    return lambda who: answers.update(who=who)


def headers(key):
    return {"X-Profile-Key": key}


def start(client, key=PROFILE_KEY, next_path="/interview"):
    response = client.post("/api/auth/google/start", json={"next": next_path}, headers=headers(key))
    assert response.status_code == 200, response.text
    query = parse_qs(urlparse(response.json()["url"]).query)
    return query


def callback(client, state, code="the-code"):
    response = client.get(f"/api/auth/google/callback?code={code}&state={state}", follow_redirects=False)
    assert response.status_code == 303
    location = urlparse(response.headers["location"])
    assert location.path == "/login"
    return parse_qs(location.query)


def me(client, key=PROFILE_KEY):
    return client.get("/api/auth/me", headers=headers(key)).json()


def test_health_says_whether_google_is_on(client):
    assert client.get("/health").json()["google_sign_in"] is True
    object.__setattr__(settings, "google_client_secret", "")
    assert client.get("/health").json()["google_sign_in"] is False
    assert client.post("/api/auth/google/start", json={}, headers=headers(PROFILE_KEY)).json()["code"] == "google_unavailable"


def test_start_sends_the_browser_to_google_with_pkce(client):
    query = start(client)
    assert query["client_id"] == ["client-id.apps.googleusercontent.com"]
    assert query["code_challenge_method"] == ["S256"] and query["code_challenge"][0]
    assert query["scope"] == ["openid email profile"]
    assert query["redirect_uri"][0].endswith("/api/auth/google/callback")


def test_a_new_google_user_gets_an_account_and_this_browser_is_signed_in(client, google_says):
    google_says(SAM)
    back = callback(client, start(client)["state"][0])
    assert back == {"signed_in": ["google"], "next": ["/interview"]}
    profile = me(client)
    assert profile["account"] is True and profile["email"] == "sam@example.com"
    assert profile["username"] == "sam.lee" and profile["display_name"] == "Sam Lee"
    assert profile["google"] is True and profile["google_only"] is True


def test_the_same_google_account_signs_in_again_on_another_device(client, google_says):
    google_says(SAM)
    callback(client, start(client)["state"][0])
    callback(client, start(client, key=OTHER_KEY)["state"][0])
    assert me(client, OTHER_KEY)["username"] == "sam.lee"
    assert me(client)["devices"] == 2


def test_a_verified_email_links_the_existing_password_account(client, google_says):
    client.post(
        "/api/auth/register",
        json={"email": "sam@example.com", "password": PASSWORD, "username": "Sam"},
        headers=headers(OTHER_KEY),
    )
    google_says(SAM)
    callback(client, start(client)["state"][0])
    profile = me(client)
    assert profile["username"] == "Sam" and profile["google"] is True and profile["google_only"] is False
    # The password still works too.
    login = client.post("/api/auth/login", json={"identifier": "Sam", "password": PASSWORD}, headers=headers(PROFILE_KEY))
    assert login.status_code == 200


def test_an_unverified_email_never_takes_over_an_account(client, google_says):
    client.post(
        "/api/auth/register",
        json={"email": "sam@example.com", "password": PASSWORD, "username": "Sam"},
        headers=headers(OTHER_KEY),
    )
    google_says({**SAM, "email_verified": False})
    back = callback(client, start(client)["state"][0])
    assert back["error"] == ["google_unverified"]
    assert me(client) == {"account": False}


def test_a_state_works_once_and_a_made_up_one_never(client, google_says):
    google_says(SAM)
    state = start(client)["state"][0]
    callback(client, state)
    assert callback(client, state)["error"] == ["google_expired"]
    assert callback(client, "made-up-state")["error"] == ["google_expired"]


def test_cancelling_at_google_comes_back_with_a_message(client):
    state = start(client)["state"][0]
    response = client.get(f"/api/auth/google/callback?error=access_denied&state={state}", follow_redirects=False)
    assert parse_qs(urlparse(response.headers["location"]).query)["error"] == ["google_cancelled"]


def test_a_failure_at_google_is_reported_not_raised(client, monkeypatch):
    def broken(code, pending):
        raise oauth.GoogleError("token endpoint said no")

    monkeypatch.setattr(oauth, "identity", broken)
    assert callback(client, start(client)["state"][0])["error"] == ["google_failed"]


@pytest.mark.parametrize("unsafe", ["https://evil.example/", "//evil.example/", "/api/auth/me", "practice"])
def test_next_never_leaves_the_app(client, google_says, unsafe):
    google_says(SAM)
    assert callback(client, start(client, next_path=unsafe)["state"][0])["next"] == ["/practice"]


def test_a_google_only_account_is_told_to_use_google_and_can_add_a_password(client, google_says):
    google_says(SAM)
    callback(client, start(client)["state"][0])
    wrong = client.post("/api/auth/login", json={"identifier": "sam.lee", "password": "anything at all"}, headers=headers(OTHER_KEY))
    assert wrong.status_code == 401 and wrong.json()["code"] == "use_google"
    added = client.post(
        "/api/auth/password", json={"current_password": "", "new_password": PASSWORD}, headers=headers(PROFILE_KEY)
    )
    assert added.status_code == 200 and added.json()["google_only"] is False
    login = client.post("/api/auth/login", json={"identifier": "sam.lee", "password": PASSWORD}, headers=headers(OTHER_KEY))
    assert login.status_code == 200


def test_a_google_only_account_can_be_deleted_without_a_password(client, google_says):
    google_says(SAM)
    callback(client, start(client)["state"][0])
    assert client.post("/api/auth/delete", json={"password": ""}, headers=headers(PROFILE_KEY)).json() == {"deleted": True}
    assert me(client) == {"account": False}


def test_usernames_from_google_names_do_not_collide(client, google_says):
    google_says(SAM)
    callback(client, start(client)["state"][0])
    google_says({**SAM, "sub": "google-sub-2", "email": "other.sam@example.com"})
    callback(client, start(client, key=OTHER_KEY)["state"][0])
    assert me(client, OTHER_KEY)["username"] == "sam.lee2"
