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


def test_a_typed_word_is_answered_from_the_dictionary_and_the_library(client, model):
    model.reply = {"reply": "Say mi-to-KON-dree-uh.", "try_next": None, "words": []}

    client.post("/api/coach/chat", json={"username": "", "message": "How do I say mitochondria?"})

    facts = sent_facts(model)
    word = facts["words_in_message"][0]
    assert word["word"] == "mitochondria" and word["from_dictionary"] is True
    assert word["ipa"] and word["syllables"] >= 4 and word["stressed_syllable"] >= 1
    assert "_phonemes" not in word  # internal detail stays on the server
    assert all("how" in guide and "ipa" in guide for guide in facts["sound_guides"])
    # Filler words are not mistaken for the word being asked about.
    assert [w["word"] for w in facts["words_in_message"]] == ["mitochondria"]


def test_a_misspelt_word_is_corrected_before_anything_is_looked_up(client, model):
    model.reply = {"reply": "Did you mean mitochondria?", "try_next": None, "words": []}
    client.post("/api/coach/chat", json={"username": "", "message": "mitochoindria"})

    word = sent_facts(model)["words_in_message"][0]
    assert word["word"] == "mitochondria" and word["typed"] == "mitochoindria" and word["corrected"] is True
    assert word["from_dictionary"] is True and word["ipa"]


def test_an_unknown_word_is_marked_unknown_and_no_sounds_are_guessed(client, model):
    model.reply = {"reply": "I do not know that word.", "try_next": None, "words": []}
    client.post("/api/coach/chat", json={"username": "", "message": "zzqxkv"})

    facts = sent_facts(model)
    word = facts["words_in_message"][0]
    assert word["from_dictionary"] is False and word["ipa"] is None and word["corrected"] is False
    assert [g["ipa"] for g in facts["sound_guides"]] == ["θ"]  # only the focus sound, nothing from the guess


# --- the model chain -------------------------------------------------------------------------------


def chain(*steps, models=("main", "backup", "last")):
    """A coach whose models answer according to `steps`: ("status", body) per call, in order."""
    calls = []
    script = list(steps)

    def handler(request):
        payload = json.loads(request.content)
        calls.append((payload["model"], "response_format" in payload))
        status, body = script.pop(0)
        if status == 200:
            return llm(body)
        return httpx.Response(status, text=json.dumps(body) if isinstance(body, dict) else str(body))

    return CoachService("k", models[0], fallback_models=models[1:], transport=httpx.MockTransport(handler)), calls


@pytest.mark.anyio
async def test_a_rate_limited_model_hands_over_to_the_next_one():
    service, calls = chain((429, {"error": "rate"}), (200, {"note": "from the backup"}))

    note, source = await service.briefing({"focus_sound": "r"}, "template note")

    assert (note, source) == ("from the backup", "groq")
    assert [m for m, _ in calls] == ["main", "backup"]
    assert service.answered_by == {"backup": 1}


@pytest.mark.anyio
async def test_rejected_json_is_retried_as_plain_text_on_the_same_model():
    service, calls = chain(
        (400, {"error": {"code": "json_validate_failed"}}),
        (200, {"note": "repaired"}),
    )

    note, _ = await service.briefing({"focus_sound": "r"}, "template note")

    assert note == "repaired"
    assert calls == [("main", True), ("main", False)]  # same model, JSON mode off the second time


@pytest.mark.anyio
async def test_every_model_failing_falls_back_to_the_template():
    service, calls = chain((429, "x"), (500, "x"), (503, "x"))

    assert await service.briefing({"focus_sound": "r"}, "template note") == ("template note", "template")
    assert len(calls) == 3


@pytest.mark.anyio
async def test_a_bad_key_stops_the_chain_at_once():
    service, calls = chain((401, {"error": "invalid key"}))
    assert await service.briefing({"focus_sound": "r"}, "template note") == ("template note", "template")
    assert len(calls) == 1


def test_json_wrapped_in_text_is_still_read():
    from backend.coach import _json_object

    assert _json_object('Here you go:\n```json\n{"note": "hi"}\n```') == {"note": "hi"}
    with pytest.raises(ValueError):
        _json_object("no object here")


@pytest.mark.anyio
async def test_attempt_feedback_is_grounded_in_the_sound_library():
    from backend.coach import CoachRequest

    seen = {}

    def handler(request):
        seen.update(json.loads(request.content))
        return llm({"summary": "Close.", "one_thing": "Put the tongue between the teeth.", "tips": []})

    service = CoachService("k", "test-model", transport=httpx.MockTransport(handler))
    request = CoachRequest(
        target_text="I think so.", score=60, slips=[{"word": "think", "kind": "substitution", "expected": "θ", "actual": "s"}]
    )

    await service.coach(request)

    facts = json.loads(seen["messages"][1]["content"])
    guide = facts["sound_guides"][0]
    assert guide["ipa"] == "θ" and "teeth" in guide["how"].lower()


def test_practice_chips_are_the_word_that_was_asked_about(client, model):
    model.reply = {"reply": "Say mi-to-KON-dree-uh.", "try_next": None, "words": ["think", "thin", "bath"]}

    body = client.post("/api/coach/chat", json={"username": "", "message": "mitochoindria"}).json()

    assert body["words"] == ["mitochondria"]  # the corrected word, not the model's unrelated suggestions


def test_a_named_sound_is_explained_and_its_words_are_kept(client, model):
    model.reply = {"reply": "Curl your tongue back a little.", "try_next": None, "words": ["red", "think", "right"]}

    body = client.post("/api/coach/chat", json={"username": "", "message": "Give me a trick for the r sound"}).json()

    facts = sent_facts(model)
    assert facts["words_in_message"] == []  # "trick" is not the word being asked about
    assert facts["sound_guides"][0]["ipa"] == "r"  # what they asked about comes first, ahead of the focus sound
    assert body["words"] == ["red", "right"]  # "think" has no /r/ and is dropped


def test_sounds_are_recognised_from_how_people_name_them():
    from backend.coach_tools import sounds_mentioned

    assert sounds_mentioned("How do I make the th sound?") == ["θ"]
    assert sounds_mentioned("the r sound and the sh sound") == ["r", "ʃ"]
    assert sounds_mentioned("what about /v/?") == ["v"]
    assert sounds_mentioned("How do I say hello") == []


def test_the_prompt_asks_for_a_human_voice_without_jargon():
    prompt = coach_tools.CHAT_PROMPT
    assert "Talk like a person" in prompt and "No IPA symbols" in prompt
    assert "syllables with the stressed one in capitals" in prompt


def test_relevant_words_prefers_the_asked_word_and_drops_the_rest():
    typed = [{"word": "mitochondria", "from_dictionary": True}]
    assert coach_tools.relevant_words(["think"], typed, [{"ipa": "θ"}]) == ["mitochondria"]
    assert coach_tools.relevant_words(["think", "red"], [], [{"ipa": "r"}]) == ["red"]
    assert coach_tools.relevant_words(["think"], [{"word": "zzqxkv", "from_dictionary": False}], [{"ipa": "r"}]) == []


def test_a_general_question_has_no_subject_word():
    from backend.coach_tools import words_in_message

    assert words_in_message("Where should I start?") == []
    assert words_in_message("Which sound should I fix first?") == []
    assert [w["word"] for w in words_in_message("How do I say thorough?")] == ["thorough"]
    assert [w["word"] for w in words_in_message("Why do I keep getting 'world' wrong?")] == ["world"]
    assert [w["word"] for w in words_in_message("mitochondria")] == ["mitochondria"]


# --- abuse, intents and the tools the chat uses ----------------------------------------------------


def test_abuse_gets_a_respectful_reply_without_calling_the_model(client, model):
    body = client.post("/api/coach/chat", json={"username": "", "message": "madarchod"}).json()

    assert body["source"] == "guard" and "respectful" in body["reply"].lower()
    assert body["words"] == [] and body["sentences"] == []
    assert model.seen == []  # nothing was sent to the model


def test_questions_are_understood_by_their_wording():
    assert coach_tools.intents("How am I doing?") == {"progress"}
    assert coach_tools.intents("Give me sentences with the r sound") == {"sentences"}
    assert coach_tools.intents("What is the difference between ship and sheep") == {"compare"}
    assert coach_tools.intents("How do I say mitochondria?") == set()
    assert coach_tools.compared_words("live vs leave") == ["live", "leave"]
    assert coach_tools.compared_words("hello") == []


def test_a_comparison_names_the_sounds_that_differ(client, model):
    model.reply = {"reply": "Ship is short, sheep is long.", "try_next": None, "words": []}

    body = client.post("/api/coach/chat", json={"username": "", "message": "ship or sheep?"}).json()

    facts = sent_facts(model)
    assert [w["word"] for w in facts["comparison"]["words"]] == ["ship", "sheep"]
    assert facts["comparison"]["sounds_that_differ"]  # the vowels
    assert body["words"] == ["ship", "sheep"]  # both words, to hear side by side


def test_asking_about_progress_sends_the_learners_real_numbers(client, model, fake_asr):
    fake_asr.text, fake_asr.words = "Hello word", timed_words("Hello word")
    for _ in range(3):
        client.post(
            "/api/evaluate",
            files={"audio": ("clip.wav", wav_bytes(), "audio/wav")},
            data={"target_text": "Hello world", "username": "Sam", "difficulty": "beginner"},
            headers=HEADERS,
        )
    model.reply = {"reply": "You are on a roll.", "try_next": None, "words": []}

    client.post("/api/coach/chat", json={"username": "Sam", "message": "How am I doing?"}, headers=HEADERS)

    progress = sent_facts(model)["progress"]
    assert progress["sessions"] == 3 and "average_score" in progress


def test_asking_for_sentences_returns_checked_sentences(client, model):
    model.reply = {"sentences": ["I think three thick things.", "The cat sat on the mat.", "Both of them thought about it."]}

    body = client.post("/api/coach/chat", json={"username": "", "message": "give me sentences with the th sound"}).json()

    assert [s["text"] for s in body["sentences"]] == ["I think three thick things.", "Both of them thought about it."]
    assert body["source"] == "groq" and body["words"] == []
