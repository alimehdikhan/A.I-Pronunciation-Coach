"""Coaching text: LLM replies are validated, cached and always have a template fallback."""

import json

import httpx
import pytest

from backend.api import coach as coach_api
from backend.coach import CoachRequest, CoachService, template_reply
from backend.runtime import runtime

SLIP = {"word": "think", "kind": "substitution", "expected": "θ", "actual": "s"}
BODY = {"target_text": "I think so.", "level": "beginner", "score": 62, "slips": [SLIP], "weak_sounds": [{"phoneme": "θ", "count": 4}]}


def llm_reply(content):
    return {"choices": [{"message": {"content": content if isinstance(content, str) else json.dumps(content)}}]}


GOOD = {
    "summary": "Nice try. The th in think came out as an s.",
    "tips": [{"word": "think", "phoneme": "θ", "tip": "Put your tongue tip lightly between your teeth and blow air."}],
    "practice_sentence": "Thank three thin thieves.",
}


def service(handler, key="test-key"):
    return CoachService(key, "test-model", transport=httpx.MockTransport(handler))


@pytest.mark.anyio
async def test_llm_reply_is_used_and_request_is_grounded():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=llm_reply(GOOD))

    reply = await service(handler).coach(CoachRequest(**BODY))

    assert reply.source == "groq"
    assert reply.tips[0].phoneme == "θ" and "tongue" in reply.tips[0].tip
    assert reply.practice_sentence == "Thank three thin thieves."
    assert seen["auth"] == "Bearer test-key"
    assert seen["body"]["model"] == "test-model"
    assert seen["body"]["response_format"] == {"type": "json_object"}
    sent = json.loads(seen["body"]["messages"][1]["content"])
    assert sent["slips"][0]["expected"] == "θ" and sent["target_text"] == "I think so."
    assert "username" not in sent


@pytest.mark.anyio
async def test_identical_requests_are_answered_from_cache():
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(200, json=llm_reply(GOOD))

    svc = service(handler)
    first = await svc.coach(CoachRequest(**BODY))
    second = await svc.coach(CoachRequest(**BODY))

    assert len(calls) == 1 and first == second


@pytest.mark.anyio
@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(429, json={"error": "rate limited"}),
        httpx.Response(500, text="boom"),
        httpx.Response(200, json=llm_reply("not json at all")),
        httpx.Response(200, json=llm_reply('["a list"]')),
        httpx.Response(200, json=llm_reply({"summary": "x" * 1000, "tips": []})),
        httpx.Response(200, json={"unexpected": True}),
    ],
)
async def test_failures_fall_back_to_templates(response):
    reply = await service(lambda request: response).coach(CoachRequest(**BODY))

    assert reply.source == "template"
    assert reply.tips and reply.tips[0].phoneme == "θ"


@pytest.mark.anyio
async def test_timeout_falls_back_to_templates():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    assert (await service(handler).coach(CoachRequest(**BODY))).source == "template"


@pytest.mark.anyio
async def test_without_a_key_no_request_is_made():
    def handler(request):
        raise AssertionError("must not call the API without a key")

    reply = await service(handler, key="").coach(CoachRequest(**BODY))

    assert reply.source == "template"


def test_template_covers_every_slip_kind_and_clean_attempts():
    request = CoachRequest(
        target_text="Hello there friend",
        score=40,
        slips=[
            {"word": "hello", "kind": "missing"},
            {"word": "um", "kind": "extra"},
            {"word": "there", "kind": "unclear"},
            {"word": "friend", "kind": "deletion", "expected": "r"},
        ],
    )
    reply = template_reply(request)

    assert [t.word for t in reply.tips] == ["hello", "um", "there", "friend"]
    assert "r" in reply.tips[3].tip.lower() or reply.tips[3].phoneme == "r"
    assert template_reply(CoachRequest(target_text="Hi", score=95)).summary.startswith("Clean")


def test_endpoint_validates_input_and_uses_the_service(client, monkeypatch):
    def handler(request):
        return httpx.Response(200, json=llm_reply(GOOD))

    monkeypatch.setattr(runtime, "coach", service(handler))
    coach_api.coach_rate_limiter.reset()

    ok = client.post("/api/coach", json=BODY)
    assert ok.status_code == 200 and ok.json()["source"] == "groq"
    assert client.post("/api/coach", json={**BODY, "score": 500}).status_code == 422
    assert client.post("/api/coach", json={**BODY, "target_text": ""}).status_code == 422
    assert client.post("/api/coach", json={**BODY, "slips": [SLIP] * 20}).status_code == 422


def test_endpoint_is_rate_limited(client, monkeypatch):
    monkeypatch.setattr(runtime, "coach", service(lambda request: httpx.Response(200, json=llm_reply(GOOD))))
    monkeypatch.setattr(coach_api.coach_rate_limiter, "limit", 2)
    coach_api.coach_rate_limiter.reset()

    codes = [client.post("/api/coach", json=BODY).status_code for _ in range(3)]

    assert codes == [200, 200, 429]
    coach_api.coach_rate_limiter.reset()


@pytest.mark.anyio
async def test_reasoning_models_get_a_medium_effort_and_a_roomy_token_budget():
    seen = {}

    def handler(request):
        seen.update(json.loads(request.content))
        return httpx.Response(200, json=llm_reply(GOOD))

    svc = CoachService("k", "openai/gpt-oss-120b", transport=httpx.MockTransport(handler))
    await svc.coach(CoachRequest(**BODY))

    assert seen["reasoning_effort"] == "medium" and seen["max_tokens"] >= 1000
