"""Group discussion practice: participants who react, an honest assessor's count, and a guarded model report."""

import json

import httpx
import pytest

from backend import gd
from backend.api import gd as gd_api
from backend.coach import CoachService
from tests.conftest import timed_words, wav_bytes


def turn(speaker, text, you=False, **extra):
    return {"speaker": speaker, "text": text, "you": you, **extra}


DISCUSSION = [
    turn("Alex", "Welcome everyone. Today's topic is: Work from home is here to stay. Who would like to start?"),
    turn("Sam", "I'd like to start. Work from home saves hours of travel, for example I save two hours a day.", you=True, seconds=20),
    turn("Priya", "I agree with Sam, and companies can hire talent from anywhere."),
    turn("Rahul", "I see it differently. New joiners learn faster in an office."),
    turn("Sam", "Adding to Rahul's point, mentoring is harder on video calls, but tools are improving.", you=True, seconds=25),
    turn("Meera", "Both sides have a point, it depends on the job."),
    turn("Sam", "I think a hybrid model works best for most teams.", you=True, seconds=15),
    turn("Sam", "To sum up, remote work saves time and widens hiring, but new joiners need office time, so hybrid is best.",
         you=True, seconds=20, summary=True),
]


def test_every_topic_has_points_on_both_sides():
    assert len(gd.TOPICS) >= 10
    for topic in gd.TOPICS:
        assert len(topic["for"]) >= 3 and len(topic["against"]) >= 3, topic["id"]
    assert {p["stance"] for p in gd.PERSONAS} == {"for", "against", "balanced"}


def test_without_the_model_participants_react_and_never_repeat_a_point():
    topic = gd.clean_topic("wfh")
    turns = gd.clean_turns(DISCUSSION[:2])
    first = gd.fallback_turn(topic, "Priya", turns, "Sam")
    assert first.startswith(("I agree with Sam", "Building on what Sam said", "To add another point"))
    rahul = gd.fallback_turn(topic, "Rahul", gd.clean_turns([*DISCUSSION[:2], turn("Priya", first)]), "Sam")
    assert "Priya" in rahul and any(point in rahul for point in topic["against"])
    spoken = turns + [turn("Priya", first)]
    for _ in range(6):  # exhausts the bank, then invites the candidate in
        spoken.append(turn("Priya", gd.fallback_turn(topic, "Priya", gd.clean_turns(spoken), "Sam")))
    assert "Sam, is there anything we've missed?" in spoken[-1]["text"]
    texts = [t["text"] for t in spoken[2:-1]]
    assert len(set(texts)) == len(texts)


def test_the_assessor_counts_what_matters_in_a_discussion():
    checks, stats = gd.report_checks(gd.clean_turns(DISCUSSION))
    by_id = {c["id"]: c for c in checks}
    assert by_id["started"]["ok"] and by_id["summarised"]["ok"] and by_id["built_on"]["ok"] and by_id["example"]["ok"]
    assert stats["contributions"] == 3 and by_id["contributions"]["ok"]
    # Short participant turns against long ones of the candidate's: too much of the airtime.
    assert stats["share"] > 0.8 and not by_id["share"]["ok"] and "Give others space" in by_id["share"]["fix"]


def test_a_quiet_candidate_gets_clear_fixes():
    quiet = [*DISCUSSION[:1], turn("Priya", "I'd like to start. People save hours of travel every week."),
             turn("Rahul", "I see it differently. Teamwork suffers on video calls and decisions take longer."),
             turn("Sam", "I agree.", you=True, seconds=2, cut_in=True)]
    by_id = {c["id"]: c for c in gd.report_checks(gd.clean_turns(quiet))[0]}
    assert not by_id["started"]["ok"] and not by_id["contributions"]["ok"] and not by_id["share"]["ok"]
    assert not by_id["summarised"]["ok"] and "summarise" in by_id["summarised"]["fix"]


def test_cutting_in_again_and_again_is_noted():
    rude = [turn("Priya", "Something long."), *[turn("Sam", f"Point number {i}.", you=True, cut_in=True) for i in range(4)]]
    by_id = {c["id"]: c for c in gd.report_checks(gd.clean_turns(rude))[0]}
    assert not by_id["polite"]["ok"] and "4 times" in by_id["polite"]["fix"]


@pytest.mark.parametrize("bad", ["", "ok", "- point one\n- point two", "x" * 400])
def test_a_participants_turn_that_cant_be_said_is_rejected(bad):
    with pytest.raises(ValueError):
        gd.parse_turn({"text": bad})


# --- the API --------------------------------------------------------------------------------


def test_topics_and_participants(client):
    body = client.get("/api/gd/topics").json()
    assert len(body["topics"]) == len(gd.TOPICS) and [p["name"] for p in body["personas"]] == ["Priya", "Rahul", "Meera"]


def test_a_turn_without_the_model_comes_from_the_bank(client):
    body = client.post("/api/gd/turn", json={"topic_id": "ai-jobs", "speaker": "Rahul", "user_name": "Sam", "turns": DISCUSSION[:1]}).json()
    assert body["source"] == "template" and any(p in body["text"] for p in gd.TOPICS_BY_ID["ai-jobs"]["against"])
    assert client.post("/api/gd/turn", json={"topic_id": "ai-jobs", "speaker": "Bob", "turns": []}).status_code == 400


def test_a_turn_with_the_model_reacts_to_the_discussion(client, monkeypatch):
    seen = {}

    def handler(request):
        payload = json.loads(request.content)
        seen["system"], seen["facts"] = payload["messages"][0]["content"], json.loads(payload["messages"][1]["content"])
        reply = {"text": "Sam, you mentioned travel time. In my last company, hybrid days fixed that without losing mentoring."}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(reply)}}]})

    monkeypatch.setattr(gd_api, "get_coach", lambda: CoachService("k", "m", transport=httpx.MockTransport(handler)))
    body = client.post("/api/gd/turn", json={"topic_id": "wfh", "speaker": "Meera", "user_name": "Sam", "turns": DISCUSSION[:3]}).json()
    assert body["source"] == "groq" and body["text"].startswith("Sam, you mentioned")
    assert "You are Meera" in seen["system"] and seen["facts"]["discussion"][1] == {"speaker": "Sam", "text": DISCUSSION[1]["text"]}


def test_a_contribution_is_transcribed_and_measured(client, fake_asr):
    fake_asr.text = "Adding to Priya's point, for example my team works from home twice a week."
    fake_asr.words = timed_words(fake_asr.text)
    body = client.post("/api/gd/contribution", files={"audio": ("a.wav", wav_bytes(seconds=3), "audio/wav")}).json()
    assert body["text"].startswith("Adding to Priya") and body["delivery"]["wpm"] and body["no_speech"] is False


def test_the_report_needs_something_said_and_uses_the_model_when_it_can(client, monkeypatch):
    assert client.post("/api/gd/report", json={"topic_id": "wfh", "turns": DISCUSSION[:1]}).status_code == 400
    plain = client.post("/api/gd/report", json={"topic_id": "wfh", "user_name": "Sam", "turns": DISCUSSION}).json()
    assert plain["rubric"] is None and plain["stats"]["contributions"] == 3

    assessment = {
        "scores": {"content": 4, "communication": 4, "teamwork": 5, "leadership": 4},
        "strengths": ["You built on Rahul's point."], "improvements": ["Add a number to your example."],
        "better_point": "Hybrid work keeps the time we save on travel and still gives new joiners time with mentors.",
        "summary": "A balanced, collaborative performance.",
    }

    def handler(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(assessment)}}]})

    monkeypatch.setattr(gd_api, "get_coach", lambda: CoachService("k", "m", transport=httpx.MockTransport(handler)))
    scored = client.post("/api/gd/report", json={"topic_id": "wfh", "user_name": "Sam", "turns": DISCUSSION}).json()
    assert scored["rubric_source"] == "groq" and scored["rubric"]["scores"]["teamwork"] == 5


def test_a_quiet_candidate_is_invited_in_now_and_then_not_every_turn():
    quiet = gd.clean_turns([*DISCUSSION[:2], turn("Priya", "Point one."), turn("Rahul", "Point two.")])
    assert not gd.should_invite(quiet, "Sam")  # two turns since Sam spoke
    quieter = gd.clean_turns([*quiet, turn("Meera", "Point three.")])
    assert gd.should_invite(quieter, "Sam")
    invited = gd.clean_turns([*quieter, turn("Priya", "Point four. Sam, what do you think?")])
    assert not gd.should_invite(invited, "Sam")  # someone just asked


def test_the_assessor_speaks_to_the_candidate_not_about_them():
    prompt = gd.REPORT_PROMPT.format(user="Sam")
    assert 'directly as "you"' in prompt and "never \"he\"" in prompt
