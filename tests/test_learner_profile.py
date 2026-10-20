"""The learner profile: first language orders what comes first, goal decides emphasis, tips come in the learner's language."""

import json

import httpx
import numpy as np
import pytest

from backend import learners, pronunciation, teaching
from backend.acoustic import PhonemeResult, WordAcoustics
from backend.coach import CoachRequest, CoachService, template_reply
from backend.phonetics import primary_pronunciation
from backend.pronunciation import PronunciationScorer
from backend.tutor import get_personalized_practice
from tests.conftest import OTHER_KEY, PROFILE_KEY
from tests.test_tiers import CLEAN, score

KEY = {"X-Profile-Key": PROFILE_KEY}


def test_the_listed_first_languages_and_their_common_sounds():
    options = learners.options()
    for language in ("Hindi", "Urdu", "Bengali", "Tamil", "Telugu", "Marathi", "Chinese (Mandarin)", "Arabic", "Spanish", "Other"):
        assert language in options["first_languages"]
    assert learners.common_sounds("Hindi")[:2] == ["v", "w"]
    assert learners.common_sounds("Tamil")[0] == "f"
    assert learners.common_sounds("Other") == [] and learners.common_sounds(None) == []
    assert "व" in learners.why_hard("Hindi", "v")


def test_profile_is_saved_cleaned_and_owned(client):
    assert client.get("/api/learner/Asha").json() == {"first_language": None, "goal": "understood", "tip_language": "English"}
    saved = client.put("/api/learner/Asha", json={"first_language": "hindi", "goal": "accent", "tip_language": "Urdu"}, headers=KEY)
    assert saved.json() == {"first_language": "Hindi", "goal": "accent", "tip_language": "Urdu"}
    cleaned = client.put("/api/learner/Asha", json={"first_language": "Klingon", "goal": "fame", "tip_language": "French"}, headers=KEY)
    assert cleaned.json() == {"first_language": None, "goal": "understood", "tip_language": "English"}
    assert client.put("/api/learner/Asha", json={"goal": "accent"}, headers={"X-Profile-Key": OTHER_KEY}).status_code == 403


def test_first_language_orders_new_learners_drills_and_starter_focus(client):
    assert [d["target_phoneme"] for d in get_personalized_practice([], "Tamil")][:2] == ["f", "z"]
    assert get_personalized_practice([("θ", 3)], "Tamil")[0]["target_phoneme"] == "θ"  # real weaknesses still lead
    assert teaching.build_plan([], first_language="Hindi")["focus"]["phoneme"] == "v"
    assert teaching.build_plan([])["focus"]["phoneme"] == "θ"

    client.put("/api/learner/Asha", json={"first_language": "Arabic"}, headers=KEY)
    drills = client.get("/api/tutor/personalized-practice/Asha", headers=KEY).json()["practices"]
    assert drills[0]["target_phoneme"] == "p"


def test_a_slip_that_makes_another_word_affects_understanding(monkeypatch):
    think = PronunciationScorer().score_pronunciation("I think so.", "I sink so")["words"][1]
    assert think["changes_word"] == "sink" and think["affects_understanding"] is True

    heard_right = score(monkeypatch, [0.3, CLEAN, CLEAN, CLEAN])["words"][1]  # /θ/ came out as /s/ though Whisper heard "think"
    assert heard_right["changes_word"] == "sink" and heard_right["affects_understanding"] is True


def test_a_sound_slip_that_makes_no_word_and_is_heard_right_is_minor(monkeypatch):
    def heard(word, first, alternative):
        pron = primary_pronunciation(word)
        return WordAcoustics(pron, [PhonemeResult(p, first if i == 0 else CLEAN, -1.0, alternative, None, None)
                                    for i, p in enumerate(pron.phonemes)])

    evidence = [heard("i", CLEAN, "s"), heard("think", 0.3, "?"), heard("so", CLEAN, "s")]
    monkeypatch.setattr(pronunciation, "analyse_acoustics", lambda tokens, log_probs, inventory: evidence)
    think = PronunciationScorer(inventory=object()).score_pronunciation(
        "I think so.", "I think so", "intermediate", None, None, np.zeros((5, 3))
    )["words"][1]
    assert think["status"] == "mispronounced" and think["changes_word"] is None and think["affects_understanding"] is False


def slip(word, expected, actual, affects):
    return {"word": word, "kind": "substitution", "expected": expected, "actual": actual, "tier": "fix", "affects": affects}


def test_goal_understood_coaches_slips_that_change_meaning_and_lists_the_rest_as_minor():
    slips = [slip("think", "θ", "s", True), slip("this", "ð", "d", False)]
    understood = template_reply(CoachRequest(target_text="I think this.", score=70, slips=slips))
    assert [t.word for t in understood.tips] == ["think"] and understood.minor == ["this"]

    only_minor = template_reply(CoachRequest(target_text="I think this.", score=85, slips=slips[1:]))
    assert only_minor.tips == [] and "understood" in only_minor.summary

    accent = template_reply(CoachRequest(target_text="I think this.", score=70, slips=slips, goal="accent"))
    assert [t.word for t in accent.tips] == ["think", "this"] and accent.minor == []


def test_built_in_tips_in_hindi_and_urdu_and_an_honest_fallback():
    very = [slip("very", "v", "w", True)]
    hindi = template_reply(CoachRequest(target_text="Very good.", score=70, slips=very, tip_language="Hindi"))
    assert hindi.language == "Hindi" and "होंठ" in hindi.tips[0].tip and hindi.language_note is None
    assert any("ऀ" <= ch <= "ॿ" for ch in hindi.summary)

    urdu = template_reply(CoachRequest(target_text="Very good.", score=70, slips=very, tip_language="Urdu"))
    assert urdu.language == "Urdu" and "ہونٹ" in urdu.tips[0].tip

    untranslated = template_reply(CoachRequest(target_text="Go.", score=70, slips=[slip("go", "g", "k", True)], tip_language="Hindi"))
    assert untranslated.tips[0].tip.isascii() and "English" in untranslated.language_note

    hinglish = template_reply(CoachRequest(target_text="Very good.", score=70, slips=very, tip_language="Hinglish"))
    assert hinglish.language == "English" and "Hinglish" in hinglish.language_note


def test_english_tips_explain_why_for_the_first_language():
    reply = template_reply(CoachRequest(target_text="Very good.", score=70, slips=[slip("very", "v", "w", True)], native_language="Hindi"))
    assert "व" in reply.tips[0].tip


@pytest.mark.anyio
async def test_a_model_reply_in_the_wrong_language_falls_back_to_the_built_in_one():
    seen = {}

    def handler(request):
        seen["facts"] = json.loads(json.loads(request.content)["messages"][1]["content"])
        content = {"summary": "Nice try.", "one_thing": "Bite your lip.", "tips": [{"word": "very", "phoneme": "v", "tip": "Teeth on lip."}]}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(content)}}]})

    service = CoachService("k", "m", transport=httpx.MockTransport(handler))
    reply = await service.coach(CoachRequest(target_text="Very good.", score=70, slips=[slip("very", "v", "w", True)],
                                             tip_language="Hindi", native_language="Hindi"))
    assert seen["facts"]["tip_language"] == "Hindi" and "व" in seen["facts"]["first_language_notes"]["v"]
    assert reply.source == "template" and reply.language == "Hindi"
