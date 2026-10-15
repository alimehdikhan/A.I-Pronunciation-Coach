"""The model's larger jobs: chat, generated practice sentences and the progress note.

The model is replaced by a mock transport, so these run offline. What matters is that
what it says is checked before anyone sees it, and that every feature still answers
when it is unavailable.
"""

import json

import httpx
import pytest

from backend import coach_tools
from backend.coach import CoachService
from backend.runtime import runtime
from tests.conftest import PROFILE_KEY, timed_words, wav_bytes

HEADERS = {"X-Profile-Key": PROFILE_KEY}


def llm(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(content)}}]})


@pytest.fixture
def model(monkeypatch):
    """Install a coach whose 'model' answers with whatever `model.reply` is; records what it was sent."""

    class Holder:
        reply: object = {}
        status: int = 200
        seen: list = []

    holder = Holder()
    holder.seen = []

    def handler(request):
        holder.seen.append(json.loads(request.content))
        if holder.status != 200:
            return httpx.Response(holder.status)
        return llm(holder.reply)

    monkeypatch.setattr(runtime, "coach", CoachService("k", "test-model", transport=httpx.MockTransport(handler)))
    return holder


def sent_facts(holder):
    return json.loads(holder.seen[-1]["messages"][1]["content"])


# --- validators ------------------------------------------------------------------------------


def test_chat_answers_are_trimmed_and_filtered():
    parsed = coach_tools.parse_chat(
        {"reply": "  Put your tongue   between your teeth.  ", "try_next": "Say think.", "words": ["think", "<script>", "x" * 40, "three"]}
    )
    assert parsed == {"reply": "Put your tongue between your teeth.", "try_next": "Say think.", "words": ["think", "three"]}

    for bad in ({"reply": ""}, {"reply": "x" * 1200}, {}):
        with pytest.raises(ValueError):
            coach_tools.parse_chat(bad)


def test_generated_sentences_must_really_contain_the_sound():
    data = {
        "sentences": [
            "I think three thick things.",  # fine for /θ/
            "The cat sat on the mat.",  # no /θ/ at all
            "Thanks.",  # too short for any level
            "I think three thick things.",  # duplicate
            "Both of them thought about it.",  # "both", "thought" (and "them" has /ð/, not /θ/)
            "Visit <b>this</b> site",  # markup is rejected
        ]
    }
    parsed = coach_tools.parse_sentences(data, "θ", "intermediate", 4)

    assert [p["text"] for p in parsed] == ["I think three thick things.", "Both of them thought about it."]
    assert parsed[0]["target_words"] == ["think", "three", "thick", "things"]  # found by us, not claimed by the model
    assert "them" not in parsed[1]["target_words"]

    with pytest.raises(ValueError):
        coach_tools.parse_sentences({"sentences": ["The cat sat on the mat."]}, "θ", "beginner", 3)


def test_the_level_sets_how_long_a_sentence_may_be():
    long = "I think that both of those three thick things were rather worth thinking about for a while."
    assert coach_tools.parse_sentences({"sentences": [long]}, "θ", "advanced", 1)
    with pytest.raises(ValueError):
        coach_tools.parse_sentences({"sentences": [long]}, "θ", "beginner", 1)


def test_reports_need_a_headline_and_a_summary():
    ok = coach_tools.parse_report({"headline": "Steady gains", "summary": "You are improving.", "wins": ["a", 3, "b"], "next_steps": "no"})
    assert ok["wins"] == ["a", "b"] and ok["next_steps"] == []
    with pytest.raises(ValueError):
        coach_tools.parse_report({"headline": "Only this"})


# --- chat -------------------------------------------------------------------------------------


def test_chat_is_grounded_in_the_learner_and_sends_no_name(client, model):
    model.reply = {"reply": "Try /θ/ with your tongue between your teeth.", "try_next": "Say think slowly.", "words": ["think"]}

    body = client.post(
        "/api/coach/chat",
        json={"username": "Sam", "message": "How do I say think?", "history": [{"role": "coach", "text": "Hi!"}]},
        headers=HEADERS,
    ).json()

    assert body["source"] == "groq" and body["words"] == ["think"] and body["try_next"] == "Say think slowly."
    facts = sent_facts(model)
    assert facts["learner_message"] == "How do I say think?"
    assert facts["conversation"] == [{"role": "coach", "text": "Hi!"}]
    assert facts["learner"]["has_history"] is False
    assert "Sam" not in json.dumps(facts)


def test_chat_falls_back_to_the_templates_when_the_model_fails(client, model):
    model.status = 500
    body = client.post("/api/coach/chat", json={"username": "Sam", "message": "Help"}, headers=HEADERS).json()
    assert body["source"] == "template" and body["reply"]

    model.status = 200
    model.reply = {"reply": ""}  # an empty answer is not an answer
    assert client.post("/api/coach/chat", json={"username": "Sam", "message": "Help"}, headers=HEADERS).json()["source"] == "template"


def test_chat_validates_its_input_and_respects_privacy(client, model, fake_asr):
    assert client.post("/api/coach/chat", json={"username": "Sam", "message": ""}, headers=HEADERS).status_code == 422
    assert client.post("/api/coach/chat", json={"message": "x" * 500}, headers=HEADERS).status_code == 422

    fake_asr.text, fake_asr.words = "Hello world", timed_words("Hello world")
    client.post(
        "/api/evaluate",
        files={"audio": ("clip.wav", wav_bytes(), "audio/wav")},
        data={"target_text": "Hello world", "username": "Sam", "difficulty": "beginner"},
        headers=HEADERS,
    )
    other = {"X-Profile-Key": "y" * 43}
    assert client.post("/api/coach/chat", json={"username": "Sam", "message": "Hi"}, headers=other).status_code == 403


# --- practice sentences ----------------------------------------------------------------------


def test_practice_returns_only_sentences_that_pass_the_checks(client, model):
    model.reply = {"sentences": ["I think three thick things.", "The cat sat on the mat."]}

    body = client.post("/api/coach/practice", json={"phoneme": "θ", "level": "intermediate", "count": 3}).json()

    assert body["source"] == "groq" and body["phoneme"] == "θ"
    assert [s["text"] for s in body["sentences"]] == ["I think three thick things."]
    facts = sent_facts(model)
    assert facts["sound"]["ipa"] == "θ" and facts["level"] == "intermediate" and facts["count"] == 3


def test_practice_uses_the_library_when_the_model_cannot_help(client, model):
    model.status = 503
    body = client.post("/api/coach/practice", json={"phoneme": "θ"}).json()
    assert body["source"] == "template" and body["sentences"]
    assert all(coach_tools.words_with_sound(s["text"], "θ") for s in body["sentences"])


def test_practice_without_a_named_sound_uses_the_learners_focus(client, model):
    model.status = 503
    body = client.post("/api/coach/practice", json={"username": "Nobody"}).json()
    assert body["phoneme"] == "θ"  # the starter focus for someone with no history


# --- progress note ------------------------------------------------------------------------------


def test_the_report_waits_for_history_then_is_written_from_the_facts(client, model, fake_asr):
    assert client.get("/api/coach/report/Sam", headers=HEADERS).json()["report"] is None

    fake_asr.text, fake_asr.words = "Hello word", timed_words("Hello word")
    for _ in range(4):
        client.post(
            "/api/evaluate",
            files={"audio": ("clip.wav", wav_bytes(), "audio/wav")},
            data={"target_text": "Hello world", "username": "Sam", "difficulty": "beginner"},
            headers=HEADERS,
        )
    model.reply = {"headline": "Getting going", "summary": "Four sessions in.", "wins": ["Showing up"], "next_steps": ["Work on /l/"]}

    body = client.get("/api/coach/report/Sam", headers=HEADERS).json()

    assert body["source"] == "groq" and body["report"]["headline"] == "Getting going"
    facts = sent_facts(model)["facts"]
    assert facts["sessions"] == 4 and "username" not in json.dumps(facts)

    model.status = 500
    runtime.coach._generated.clear()  # the cached note would otherwise answer
    assert client.get("/api/coach/report/Sam", headers=HEADERS).json()["source"] == "template"
    assert client.get("/api/coach/report/Sam", headers={"X-Profile-Key": "z" * 43}).status_code == 403
