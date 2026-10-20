"""Speak freely: delivery measures, a longer limit for this mode only, sure slips only, optional feedback."""

import json

import httpx
import numpy as np
import pytest

from backend import pronunciation, speaking
from backend.api import speaking as speaking_api
from backend.api import speech
from backend.coach import CoachService
from backend.runtime import runtime
from tests.conftest import timed_words, wav_bytes
from tests.test_tiers import BORDERLINE, CLEAN, SURE, heard


def test_fillers_are_counted_and_never_scored():
    assert speaking.count_fillers("So, um, I think, uh, umm yes") == {"count": 3, "words": ["uh", "um", "umm"]}
    assert speaking.strip_fillers("So, um, I think, uh, yes") == "So, I think, yes"
    assert speaking.count_fillers("umbrella under summer")["count"] == 0  # whole words only


def test_delivery_reports_pace_long_pauses_and_fillers():
    words = timed_words("so um I think we should start now", step=0.4)
    words[4]["start"] += 1.5  # a pause before "we"
    for w in words[4:]:
        w["start"] = round(w["start"] + (1.5 if w is not words[4] else 0), 3)
        w["end"] = round(w["end"] + 1.5, 3)
    stats = speaking.delivery(words, "so um I think we should start now")
    assert stats["words"] == 7 and stats["fillers"]["count"] == 1
    assert stats["long_pauses"] == 1 and stats["longest_pause"] > 1.0
    assert 40 < stats["wpm"] < 140


def test_the_prompt_bank_has_interviews_cue_cards_and_everyday_situations(client):
    body = client.get("/api/speak/prompts").json()
    kinds = {p["kind"] for p in body["prompts"]}
    assert kinds == {"interview", "ielts", "everyday"} and body["kinds"]["ielts"]["prep_seconds"] == 60
    assert all(len(p["points"]) == 4 for p in body["prompts"] if p["kind"] == "ielts")
    assert body["max_seconds"] == 120


def answer(client, seconds=3.0, prompt_id="int-about"):
    return client.post(
        "/api/speak/evaluate", data={"prompt_id": prompt_id}, files={"audio": ("a.wav", wav_bytes(seconds=seconds), "audio/wav")}
    )


def test_a_free_answer_may_be_longer_than_a_sentence_but_not_endless(client, fake_asr):
    fake_asr.text, fake_asr.words = "I think so", timed_words("I think so")
    assert answer(client, seconds=75).status_code == 200  # over the 60 s sentence limit
    too_long = answer(client, seconds=125)
    assert too_long.status_code == 413 and too_long.json()["code"] == "recording_too_long"
    sentence = client.post("/api/evaluate", data={"target_text": "Hi there."}, files={"audio": ("a.wav", wav_bytes(seconds=75), "audio/wav")})
    assert sentence.status_code == 413  # the longer limit is this mode only


def test_whisper_is_prompted_for_fillers_and_nothing_is_saved(client, fake_asr):
    fake_asr.text = "Um, I think so, uh, yes"
    fake_asr.words = timed_words("Um, I think so, uh, yes")
    body = answer(client).json()
    assert fake_asr.prompts[-1] == speaking.FILLER_PROMPT
    assert body["delivery"]["fillers"] == {"count": 2, "words": ["uh", "um"], "approximate": True}
    assert [w["reference"] for w in body["words"]] == ["i", "think", "so", "yes"]
    assert "harder to score" in body["note"] and body["prompt"]["id"] == "int-about"


def test_only_sure_sound_slips_are_reported(client, fake_asr, monkeypatch):
    fake_asr.text, fake_asr.words = "I think so", timed_words("I think so")
    plan = {"think": [SURE, CLEAN, CLEAN, BORDERLINE]}
    monkeypatch.setattr(runtime, "phonemes", type("P", (), {"log_probs": lambda self, s: np.zeros((10, 5), np.float32)})())
    monkeypatch.setattr(runtime.scorer, "inventory", object())
    monkeypatch.setattr(pronunciation, "analyse_acoustics", lambda tokens, lp, inv: [
        heard(w, plan.get(w, [CLEAN] * (1 if w == "i" else 2))) for w in tokens
    ])
    body = answer(client).json()
    assert [(s["word"], s["expected"]) for s in body["slips"]] == [("think", "θ")]  # the borderline /k/ is left out
    assert body["pronunciation"] is not None


def test_silence_and_the_optional_model_feedback(client, fake_asr, monkeypatch):
    fake_asr.text, fake_asr.words = "", []
    assert answer(client).json()["no_speech"] is True

    fake_asr.text, fake_asr.words = "I think so", timed_words("I think so")
    assert answer(client).json()["feedback"] is None  # no model configured

    seen = {}

    def handler(request):
        seen["facts"] = json.loads(json.loads(request.content)["messages"][1]["content"])
        content = {"feedback": "You answered the question directly. Add one example from your work to make it memorable."}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(content)}}]})

    monkeypatch.setattr(speaking_api, "get_coach", lambda: CoachService("k", "m", transport=httpx.MockTransport(handler)))
    speech.audio_rate_limiter.reset()
    body = answer(client).json()
    assert body["feedback"]["source"] == "groq" and "example" in body["feedback"]["text"]
    assert seen["facts"]["task"] == "Tell me about yourself." and "answer_transcript" in seen["facts"]


@pytest.mark.parametrize("bad", ["", "x" * 20])
def test_feedback_that_is_empty_or_too_short_is_dropped(bad):
    with pytest.raises(ValueError):
        speaking_api._parse_feedback({"feedback": bad})
