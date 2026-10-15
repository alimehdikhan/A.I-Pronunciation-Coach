"""Profile keys, security headers, request limits, backpressure and observability."""

import asyncio

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.applications import Starlette

from backend import main
from backend.runtime import WorkGate, runtime
from backend.security import RateLimiter, build_spa_csp
from backend.spa import SPAStaticFiles
from tests.conftest import OTHER_KEY, PROFILE_KEY, wav_bytes

AUDIO = {"audio": ("sample.wav", wav_bytes(), "audio/wav")}
MINE = {"X-Profile-Key": PROFILE_KEY}
THEIRS = {"X-Profile-Key": OTHER_KEY}


def evaluate(client, username, headers=None):
    return client.post(
        "/api/evaluate", data={"target_text": "Hello world", "username": username}, files=AUDIO, headers=headers
    )


# --- Profile keys ----------------------------------------------------------------


def test_first_key_claims_a_new_profile_and_locks_out_others(client):
    assert evaluate(client, "Ada", MINE).json()["saved"] is True

    assert len(client.get("/api/history/Ada", headers=MINE).json()["records"]) == 1
    locked = client.get("/api/history/Ada", headers=THEIRS)
    assert locked.status_code == 403
    assert locked.json()["code"] == "profile_locked"
    assert client.get("/api/history/Ada").status_code == 403
    assert client.get("/api/analytics/Ada", headers=THEIRS).status_code == 403


def test_locked_profile_still_gets_feedback_but_is_not_saved(client):
    evaluate(client, "Ada", MINE)

    body = evaluate(client, "Ada", THEIRS).json()

    assert body["success"] is True and body["score"] > 0
    assert body["saved"] is False
    assert body["save_error"] == "profile_locked"
    assert len(client.get("/api/history/Ada", headers=MINE).json()["records"]) == 1


def test_legacy_unclaimed_profile_is_readable_then_claimed_by_first_key(client):
    evaluate(client, "Legacy")  # no key: an unclaimed profile, like rows from v2.0

    assert len(client.get("/api/history/Legacy").json()["records"]) == 1
    assert len(client.get("/api/history/Legacy", headers=MINE).json()["records"]) == 1  # claims it
    assert client.get("/api/history/Legacy").status_code == 403
    assert client.get("/api/history/Legacy", headers=THEIRS).status_code == 403


def test_delete_requires_the_owning_key(client):
    evaluate(client, "Grace", MINE)

    assert client.delete("/api/history/Grace").status_code == 400
    assert client.delete("/api/history/Grace", headers=THEIRS).status_code == 403
    assert client.delete("/api/history/Grace", headers=MINE).json() == {"deleted": 1}
    # The name stays claimed after its history is cleared.
    assert client.get("/api/history/Grace", headers=THEIRS).status_code == 403


def test_locked_profile_gets_default_drills(client, fake_asr):
    evaluate(client, "Ada", MINE)

    practice = client.get("/api/tutor/personalized-practice/Ada", headers=THEIRS)

    assert practice.status_code == 200
    assert practice.json()["personalized"] is False


def test_malformed_profile_key_is_rejected(client):
    assert client.get("/api/history/Ada", headers={"X-Profile-Key": "short"}).status_code == 400


# --- Headers ------------------------------------------------------------------------


def test_security_headers_and_request_id(client):
    response = client.get("/health", headers={"X-Request-ID": "client-supplied-id-123"})

    assert response.headers["x-content-type-options"] == "nosniff"
    assert "microphone=(self)" in response.headers["permissions-policy"]
    assert response.headers["x-request-id"] == "client-supplied-id-123"
    assert "strict-transport-security" not in response.headers
    assert len(client.get("/health", headers={"X-Request-ID": "bad id!"}).headers["x-request-id"]) == 32
    https = client.get("/health", headers={"X-Forwarded-Proto": "https"})
    assert "max-age" in https.headers["strict-transport-security"]


def test_spa_shell_has_strict_csp_with_inline_script_hash(tmp_path):
    (tmp_path / "index.html").write_text(
        "<html><head><script>document.documentElement.dataset.t='1'</script>"
        '<script type="module" src="/assets/app.js"></script></head></html>',
        encoding="utf-8",
    )
    csp = build_spa_csp(tmp_path / "index.html", "'self'")
    assert "script-src 'self' 'sha256-" in csp
    assert "object-src 'none'" in csp and "frame-ancestors 'self'" in csp

    spa = Starlette()
    spa.mount("/", SPAStaticFiles(directory=str(tmp_path), html=True, frame_ancestors="'self'"))
    web = TestClient(spa)
    assert web.get("/progress").headers["content-security-policy"] == csp
    assert "content-security-policy" not in web.get("/assets/missing.js").headers

    # A rebuilt index.html (new inline script) gets a matching policy without a restart.
    import os
    import time

    (tmp_path / "index.html").write_text("<html><script>console.log('v2')</script></html>", encoding="utf-8")
    os.utime(tmp_path / "index.html", (time.time() + 5, time.time() + 5))
    assert web.get("/").headers["content-security-policy"] != csp


def test_evaluate_reports_server_timing(client):
    response = evaluate(client, None)

    timing = response.headers["server-timing"]
    for stage in ("upload", "decode", "asr", "score"):
        assert f"{stage};dur=" in timing


def test_cacheable_library_responses(client):
    assert "max-age" in client.get("/api/phonemes").headers["cache-control"]
    assert "max-age" in client.get("/api/pronounce", params={"text": "hello"}).headers["cache-control"]


# --- Limits -------------------------------------------------------------------------


def test_oversized_upload_is_rejected_before_reading(client):
    response = client.post(
        "/api/evaluate",
        content=b"x" * 16,
        headers={"Content-Type": "multipart/form-data; boundary=x", "Content-Length": str(main.MAX_REQUEST_BYTES + 1)},
    )
    assert response.status_code == 413


def test_streamed_body_over_the_limit_is_rejected(client, monkeypatch):
    from backend.security import BodySizeLimitMiddleware

    async def app(scope, receive, send):
        while (await receive()).get("more_body"):
            pass

    limited = BodySizeLimitMiddleware(app, max_bytes=10)
    messages = iter([
        {"type": "http.request", "body": b"123456", "more_body": True},
        {"type": "http.request", "body": b"123456", "more_body": False},
    ])

    async def receive():
        return next(messages)

    async def send(message):
        pass

    with pytest.raises(HTTPException) as caught:
        asyncio.run(limited({"type": "http", "method": "POST", "headers": []}, receive, send))
    assert caught.value.status_code == 413


def test_rate_limiter_forgets_idle_clients():
    limiter = RateLimiter(limit=5, window_seconds=0.0, max_clients=50)
    for i in range(300):
        limiter.check(f"10.0.0.{i}")
    assert limiter.tracked_clients <= 50


def test_rate_limiter_ignores_spoofed_forwarded_for(client, monkeypatch):
    from backend.api import speech

    monkeypatch.setattr(speech.audio_rate_limiter, "limit", 1)
    assert evaluate(client, None).status_code == 200
    spoofed = client.post(
        "/api/evaluate", data={"target_text": "Hello world"}, files=AUDIO, headers={"X-Forwarded-For": "1.2.3.4"}
    )
    assert spoofed.status_code == 429


def test_work_gate_sheds_load_when_queue_is_full():
    async def scenario():
        gate = WorkGate(concurrency=1, queue_limit=1)
        release = asyncio.Event()

        async def job():
            async with gate.slot():
                await release.wait()

        running = asyncio.create_task(job())
        await asyncio.sleep(0)
        queued = asyncio.create_task(job())
        await asyncio.sleep(0)
        with pytest.raises(HTTPException) as caught:
            async with gate.slot():
                pass
        release.set()
        await asyncio.gather(running, queued)
        return caught.value, gate

    error, gate = asyncio.run(scenario())
    assert error.status_code == 503 and error.headers["Retry-After"]
    assert gate.running == 0 and gate.waiting == 0


# --- Observability ----------------------------------------------------------------------


def test_ready_reflects_model_state(client, monkeypatch):
    assert client.get("/ready").status_code == 200
    monkeypatch.setattr(runtime, "asr", None)
    response = client.get("/ready")
    assert response.status_code == 503 and response.json()["models_loaded"] is False


def test_metrics_use_route_templates(client):
    client.get("/api/history/SomeoneNew")
    body = client.get("/metrics").text
    assert 'route="/api/history/{username}"' in body
    assert "SomeoneNew" not in body


def test_metrics_token(client, monkeypatch):
    from backend.config import settings

    monkeypatch.setattr(type(settings), "metrics_token", "s3cret", raising=False)
    object.__setattr__(settings, "metrics_token", "s3cret")
    try:
        assert client.get("/metrics").status_code == 401
        assert client.get("/metrics", headers={"Authorization": "Bearer s3cret"}).status_code == 200
    finally:
        object.__setattr__(settings, "metrics_token", "")


def test_unhandled_errors_return_json_with_request_id(client, monkeypatch):
    from backend import phonetics

    def boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(phonetics, "describe_word", boom)
    response = TestClient(main.app, raise_server_exceptions=False).get("/api/pronounce", params={"text": "hello"})
    assert response.status_code == 500
    assert response.json()["request_id"] == response.headers["x-request-id"]


# --- which database the app uses --------------------------------------------------

from backend.database import resolve_database_url  # noqa: E402

NEON = "postgresql://user:secret@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require"


def test_the_documented_variable_is_used():
    assert resolve_database_url({"NEON_DATABASE_URL": NEON}) == (NEON, "NEON_DATABASE_URL")


def test_neons_own_variable_name_works_too():
    assert resolve_database_url({"DATABASE_URL": NEON}) == (NEON, "DATABASE_URL")


def test_a_sqlite_default_never_hides_a_real_database():
    env = {"NEON_DATABASE_URL": "sqlite:////app/data/pc.db", "DATABASE_URL": NEON}
    assert resolve_database_url(env) == (NEON, "DATABASE_URL")


def test_pasted_forms_are_cleaned():
    assert resolve_database_url({"NEON_DATABASE_URL": f"psql '{NEON}'"})[0] == NEON
    assert resolve_database_url({"NEON_DATABASE_URL": f'"{NEON}"'})[0] == NEON
    legacy = NEON.replace("postgresql://", "postgres://")
    assert resolve_database_url({"DATABASE_URL": legacy})[0] == NEON


def test_without_any_url_it_falls_back_to_sqlite_and_says_so():
    assert resolve_database_url({}) == ("sqlite:///./pronunciation_coach.db", "default")
    custom = {"PRONUNCIATION_COACH_SQLITE_URL": "sqlite:////app/data/x.db"}
    assert resolve_database_url(custom) == ("sqlite:////app/data/x.db", "default")
    assert resolve_database_url({"NEON_DATABASE_URL": "   "})[1] == "default"
