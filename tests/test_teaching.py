"""The teaching engine: mastery, the choice of focus, the session, and the plan endpoint."""

import httpx
import pytest

from backend import teaching
from backend.coach import CoachService
from backend.runtime import runtime
from tests.conftest import OTHER_KEY, PROFILE_KEY, timed_words, wav_bytes


def obs(phoneme, ok, word="", score=None):
    return (phoneme, ok, score, word, None)


def attempts(phoneme, pattern, word="think"):
    """Observations newest-first from a string like 'xx..' (x = slip, . = clean)."""
    return [obs(phoneme, ch == ".", word, 95.0 if ch == "." else 40.0) for ch in pattern]


def test_mastery_counts_clean_rate_and_status():
    stats = {s.phoneme: s for s in teaching.compute_mastery(attempts("θ", "x.x.x") + attempts("r", "......") + attempts("v", ".x"))}

    assert stats["θ"].attempts == 5 and stats["θ"].clean == 2 and stats["θ"].status == "needs_work"
    assert stats["r"].status == "solid" and stats["r"].clean_rate == 1.0
    assert stats["v"].status == "new"  # two tries is not enough to judge


def test_trend_compares_the_latest_tries_with_earlier_ones():
    recent_good = attempts("θ", "......" + "xxxxxx")  # newest six clean, older ones slips
    recent_bad = attempts("θ", "xxxxxx" + "......")
    steady = attempts("θ", ".x.x.x.x.x.x")

    assert teaching.compute_mastery(recent_good)[0].trend == "improving"
    assert teaching.compute_mastery(recent_bad)[0].trend == "slipping"
    assert teaching.compute_mastery(steady)[0].trend == "steady"
    assert teaching.compute_mastery(attempts("θ", "x.x"))[0].trend == "new"


def test_focus_is_the_sound_costing_the_most():
    rows = attempts("θ", "xxxx.x") + attempts("ð", "x.") + attempts("r", "x.........")
    focus, why = teaching.choose_focus(teaching.compute_mastery(rows))
    assert (focus, why) == ("θ", "history")  # often wrong and often tried beats rarely tried


def test_a_slipping_sound_outranks_an_equally_weak_steady_one():
    slipping = attempts("θ", "xxxxxx" + "......")  # fell from perfect
    steady = attempts("v", ".x" * 6)
    stats = teaching.compute_mastery(slipping + steady)
    assert teaching.choose_focus(stats)[0] == "θ"


def test_new_learners_get_a_starter_focus_and_good_ones_a_refresher():
    assert teaching.choose_focus([]) == ("θ", "starter")
    solid = teaching.compute_mastery(attempts("θ", "......") + attempts("r", "....x....."))
    focus, why = teaching.choose_focus(solid)
    assert why == "maintenance" and focus == "r"


def test_plan_builds_a_session_around_the_learners_own_words():
    rows = attempts("θ", "xxxx.", word="thought") + attempts("θ", "x", word="thumb")
    plan = teaching.build_plan(rows)
    focus = plan["focus"]

    assert focus["phoneme"] == "θ" and focus["why"] == "history"
    assert focus["your_words"][0] == "thought"  # the most-missed word comes first
    assert focus["words"][: len(focus["your_words"])] == focus["your_words"]
    assert len(focus["words"]) == 4 and len(set(focus["words"])) == 4
    assert [step["kind"] for step in plan["session"]] == ["learn", "listen", "words", "sentence", "review"]
    assert "“th”" in focus["reason"] and "cleanly" in focus["reason"]  # named in words, not by symbol


def test_plan_without_history_is_still_a_complete_session():
    plan = teaching.build_plan([])
    assert plan["has_history"] is False and plan["focus"]["why"] == "starter"
    assert plan["focus"]["words"] and plan["focus"]["sentence"]
    assert "Welcome" in teaching.template_briefing(plan)


def test_session_outcome_compares_with_history():
    assert teaching.session_outcome(0.3, 4, 4)["verdict"] == "better"
    assert teaching.session_outcome(0.9, 1, 4)["verdict"] == "worse"
    assert teaching.session_outcome(0.5, 2, 4)["verdict"] == "same"
    assert teaching.session_outcome(None, 3, 4)["verdict"] == "baseline"
    assert teaching.session_outcome(0.5, 0, 0)["verdict"] == "no_data"


# --- through the API ------------------------------------------------------------


def evaluate(client, fake_asr, said, username="Sam", key=PROFILE_KEY, target="Hello world"):
    fake_asr.text, fake_asr.words = said, timed_words(said)
    return client.post(
        "/api/evaluate",
        files={"audio": ("clip.wav", wav_bytes(), "audio/wav")},
        data={"target_text": target, "username": username, "difficulty": "beginner"},
        headers={"X-Profile-Key": key},
    )


def test_every_attempted_sound_is_remembered_not_only_the_slips(client, fake_asr):
    for _ in range(3):
        assert evaluate(client, fake_asr, "Hello word").json()["saved"] is True  # "world" -> "word"

    plan = client.get("/api/coach/plan/Sam", headers={"X-Profile-Key": PROFILE_KEY}).json()

    assert plan["has_history"] is True and plan["observations"] > 0
    by_sound = {m["phoneme"]: m for m in plan["mastery"]}
    assert by_sound["h"]["clean_rate"] == 1.0  # sounds that went right are counted too
    assert by_sound["l"]["attempts"] >= 3
    assert plan["briefing"]["source"] == "template"  # no model key in tests


def test_the_plan_is_private_to_the_learner(client, fake_asr):
    evaluate(client, fake_asr, "Hello world")
    assert client.get("/api/coach/plan/Sam", headers={"X-Profile-Key": OTHER_KEY}).status_code == 403
    # An unknown name simply gets a starter plan.
    starter = client.get("/api/coach/plan/Nobody", headers={"X-Profile-Key": OTHER_KEY}).json()
    assert starter["has_history"] is False and starter["focus"]["why"] == "starter"


def test_deleting_history_clears_what_the_coach_remembers(client, fake_asr):
    evaluate(client, fake_asr, "Hello world")
    headers = {"X-Profile-Key": PROFILE_KEY}
    assert client.get("/api/coach/plan/Sam", headers=headers).json()["has_history"] is True
    assert client.delete("/api/history/Sam", headers=headers).status_code == 200
    assert client.get("/api/coach/plan/Sam", headers=headers).json()["has_history"] is False


# --- the voice ----------------------------------------------------------------


def llm(content):
    import json

    return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(content)}}]})


@pytest.mark.anyio
async def test_briefing_uses_the_model_but_only_the_facts_it_is_given():
    seen = {}

    def handler(request):
        import json

        seen.update(json.loads(request.content))
        return llm({"note": "Today is all about /θ/: you have it right 3 times in 10."})

    svc = CoachService("k", "test-model", transport=httpx.MockTransport(handler))
    facts = {"has_history": True, "focus_sound": "θ", "focus_stats": {"clean": 3, "attempts": 10}}

    text, source = await svc.briefing(facts, "fallback")
    again, _ = await svc.briefing(facts, "fallback")

    assert source == "groq" and text == again and "“th”" in text  # the symbol is spelled out
    assert "has_history" in seen["messages"][1]["content"]
    assert "Sam" not in seen["messages"][1]["content"]  # no names are sent


@pytest.mark.anyio
@pytest.mark.parametrize("response", [httpx.Response(500), llm({"note": ""}), llm({"note": "x" * 900}), llm(["no"])])
async def test_briefing_falls_back_to_the_template(response):
    svc = CoachService("k", "test-model", transport=httpx.MockTransport(lambda request: response))
    assert await svc.briefing({"focus_sound": "r"}, "template note") == ("template note", "template")


@pytest.mark.anyio
async def test_attempt_feedback_carries_a_single_cue():
    from backend.coach import CoachRequest

    payload = {
        "summary": "Close.",
        "one_thing": "Let your tongue tip touch your upper teeth and blow air.",
        "tips": [{"word": "think", "phoneme": "θ", "tip": "Tongue between the teeth."}],
    }
    svc = CoachService("k", "test-model", transport=httpx.MockTransport(lambda request: llm(payload)))
    request = CoachRequest(
        target_text="I think so.", score=60, slips=[{"word": "think", "kind": "substitution", "expected": "θ", "actual": "s"}]
    )

    reply = await svc.coach(request)
    assert reply.one_thing.startswith("Let your tongue")

    offline = await CoachService("", "test-model").coach(request)
    assert offline.source == "template" and offline.one_thing  # the template gives a cue too
    assert runtime is not None


# --- the plan speaks in plain words --------------------------------------------------------------------------


def test_the_plan_has_no_slashed_symbols_but_keeps_the_sounds_themselves():
    plan = teaching.build_plan([])

    prose = []

    def collect(value, key=""):
        if key in {"phoneme", "symbol", "words", "your_words", "sentence", "pairs", "confused_with", "label", "name", "kind"}:
            return
        if isinstance(value, str):
            prose.append(value)
        elif isinstance(value, list):
            for item in value:
                collect(item, key)
        elif isinstance(value, dict):
            for k, v in value.items():
                collect(v, k)

    collect(plan)
    import re

    assert not [t for t in prose if re.search(r"/[^/\s]{1,3}/", t) or re.search("[\u03b8\u00f0\u0283\u0292\u014b]", t)]
    assert plan["focus"]["phoneme"] == "\u03b8"  # the symbol is still there for the app to use
    assert "confused_with" in plan["focus"]


def test_the_template_note_names_the_sound_in_words():
    note = teaching.template_briefing(teaching.build_plan([]))
    assert "/" not in note and "th" in note.lower()


@pytest.mark.anyio
async def test_a_model_note_with_symbols_is_cleaned_before_it_is_shown():
    def handler(request):
        return llm({"note": "Today we work on the /\u03b8/ sound, which often becomes /s/."})

    svc = CoachService("k", "test-model", transport=httpx.MockTransport(handler))
    text, source = await svc.briefing({"focus_sound": "\u03b8"}, "fallback")

    assert source == "groq"
    assert "/" not in text and "\u03b8" not in text
    assert "\u201cth\u201d" in text and "\u201cs\u201d" in text
