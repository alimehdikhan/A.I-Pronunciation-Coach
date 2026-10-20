"""Mock interviews: realistic question order, honest checks, a guarded model rubric, and text-only saving."""

import json
import random

import httpx
import pytest

from backend import interview
from backend.api import interview as interview_api
from backend.api import speech
from backend.coach import CoachService
from tests.conftest import OTHER_KEY, PROFILE_KEY, timed_words, wav_bytes

HEADERS = {"X-Profile-Key": PROFILE_KEY}

STAR_ANSWER = (
    "One example is when our release was late at my last job. My job was to get it out on time. "
    "I organised the team and I fixed the build. As a result we delivered two days early and saved 20% of the cost."
)


# --- questions ---------------------------------------------------------------------------


@pytest.mark.parametrize("kind", [k for k, t in interview.TYPES.items() if not t.get("custom")])
@pytest.mark.parametrize("role", list(interview.ROLES))
@pytest.mark.parametrize("level", list(interview.LEVELS))
@pytest.mark.parametrize("count", interview.COUNTS)
def test_every_type_role_level_and_length_gets_a_full_interview_in_a_real_order(kind, role, level, count):
    for seed in range(3):
        questions = interview.build_session(role, level, count, random.Random(seed), kind=kind)
        assert [q["kind"] for q in questions] == interview.TYPES[kind]["shapes"][count]
        assert len({q["id"] for q in questions}) == count  # never the same question twice
        _kind, used_role, used_level = interview.settings_for(kind, role, level)
        for q in questions:
            known = interview.BY_ID[q["id"]]
            assert used_level not in known.get("not", ()) and ("only" not in known or used_level in known["only"])
            if q["kind"] == "role":
                assert known["role"] == used_role
            assert q["star"] == (q["kind"] == "behavioural") and q["target_seconds"][0] < q["target_seconds"][1]


def test_a_student_interview_ignores_job_role_and_experience():
    assert interview.settings_for("visa", "sales", "senior") == ("visa", "general", "fresher")
    assert interview.settings_for("behavioural", "sales", "senior") == ("behavioural", "general", "senior")
    visa = interview.build_session("sales", "senior", 5, random.Random(1), kind="visa")
    assert all(q["kind"].startswith("visa_") for q in visa)


def test_every_question_kind_has_guidance():
    used = {step for t in interview.TYPES.values() for shape in t["shapes"].values() for step in shape}
    assert used <= set(interview.KINDS) and {q["kind"] for q in interview.QUESTIONS} <= set(interview.KINDS)


def test_unknown_settings_fall_back_to_sensible_defaults():
    assert interview.clean_type("podcast") == "full"
    assert interview.clean_role("astronaut") == "general"
    assert interview.clean_level("ceo") == "mid"
    assert interview.clean_count(4) == 5


# --- checks without a model ------------------------------------------------------------------


def delivery(seconds, words=100, fillers=0, wpm=140):
    return {"duration": seconds, "words": words, "fillers": {"count": fillers, "words": []}, "wpm": wpm, "long_pauses": 0}


def checks_by_id(question_id, text, stats):
    q = interview.question_view(interview.BY_ID[question_id])
    return {c["id"]: c for c in interview.answer_checks(q, text, stats)}


def test_a_complete_star_answer_passes_every_check():
    checks = checks_by_id("beh-problem", STAR_ANSWER, delivery(80))
    assert all(c["ok"] for c in checks.values()), checks
    assert set(checks) == {"length", "example", "ownership", "result", "fillers", "pace"}


def test_a_short_vague_answer_gets_specific_fixes():
    checks = checks_by_id("beh-problem", "We worked hard and it was fine.", delivery(12, words=8, fillers=4, wpm=190))
    failed = {k for k, c in checks.items() if not c["ok"]}
    assert failed == {"length", "example", "ownership", "result", "fillers", "pace"}
    assert "aim for 60-120 seconds" in checks["length"]["fix"] and "Slow down" in checks["pace"]["fix"]


def test_the_closing_question_checks_that_a_question_was_asked():
    assert checks_by_id("close-questions", "What does success look like in this role?", delivery(30))["asked"]["ok"]
    assert not checks_by_id("close-questions", "No, I think that is everything.", delivery(30))["asked"]["ok"]


# --- the model's rubric is checked before anyone sees it ------------------------------------


GOOD_RUBRIC = {
    "scores": {"relevance": 5, "structure": 4, "specificity": 3, "clarity": 4},
    "star": {"situation": True, "task": True, "action": True, "result": False},
    "strengths": ["You answered the question directly."],
    "improvements": ["End with the result.", "Name your role.", "Add a number.", "A fourth tip is dropped."],
    "stronger_answer": "When our release was late, I organised the team and fixed the build. As a result, [result with a number].",
    "summary": "A clear story that needs a stronger ending.",
}


def test_a_valid_rubric_is_kept_and_trimmed():
    rubric = interview.parse_rubric(GOOD_RUBRIC, STAR_ANSWER, behavioural=True)
    assert rubric["scores"]["relevance"] == 5 and rubric["star"]["result"] is False
    assert len(rubric["improvements"]) == 3 and rubric["stronger_answer"].startswith("When our release")


def test_the_rubric_never_puts_invented_numbers_in_the_candidates_mouth():
    invented = {**GOOD_RUBRIC, "stronger_answer": "I organised the team and we cut costs by 45% in 3 weeks, which saved a lot."}
    assert interview.parse_rubric(invented, STAR_ANSWER, behavioural=True)["stronger_answer"] is None
    said = {**GOOD_RUBRIC, "stronger_answer": "I organised the team and fixed the build, and we saved 20% of the cost."}
    assert interview.parse_rubric(said, STAR_ANSWER, behavioural=True)["stronger_answer"]


@pytest.mark.parametrize("scores", [None, {"relevance": 9, "structure": 4, "specificity": 3, "clarity": 4}, {"relevance": 5}])
def test_an_unusable_rubric_is_rejected(scores):
    with pytest.raises(ValueError):
        interview.parse_rubric({**GOOD_RUBRIC, "scores": scores}, STAR_ANSWER, behavioural=True)


def test_star_parts_are_only_reported_for_story_questions():
    assert interview.parse_rubric(GOOD_RUBRIC, STAR_ANSWER, behavioural=False)["star"] is None


# --- the report -------------------------------------------------------------------------------


def stored(question_id, text, seconds, rubric=None, slips=()):
    q = interview.question_view(interview.BY_ID[question_id])
    stats = {**delivery(seconds, fillers=2), "longest_pause": None}
    analysed = {"target": text, "delivery": stats, "slips": list(slips), "pronunciation": None}
    return interview.stored_answer(q, analysed, interview.answer_checks(q, text, stats), rubric, 1, "2026-10-20T10:00:00+00:00")


def test_the_report_averages_and_names_what_to_work_on():
    rubric = interview.parse_rubric(GOOD_RUBRIC, STAR_ANSWER, behavioural=True)
    slip = {"word": "think", "expected": "θ", "actual": "s", "changes_word": "sink"}
    answers = [stored("beh-problem", STAR_ANSWER, 80, rubric, [slip]), stored("intro-about", "I am a developer.", 10)]
    report = interview.session_report(answers)
    assert report["answered"] == 2 and report["average_wpm"] == 140
    assert report["content"]["relevance"] == 5.0 and report["content_overall"] == 4.0
    assert report["sounds"] == ["θ"] and 0 < report["checks_passed"] < report["checks_total"]
    assert report["focus"] and len(report["focus"]) <= 3
    assert "audio" not in json.dumps(answers)  # text and numbers only


def test_an_empty_report_has_every_field():
    report = interview.session_report([])
    assert report["answered"] == 0 and report["focus"] == [] and report["content"] is None


# --- the API --------------------------------------------------------------------------------


def start(client, **body):
    return client.post("/api/interview/sessions", json={"role": "software", "level": "mid", "count": 3, **body}, headers=HEADERS)


def speak(client, question, *, seconds=3.0, session=None, username="maya", headers=HEADERS, follow_up=None):
    data = {"question_id": question["id"], "role": "software", "level": "mid"}
    if session is not None:
        data |= {"session_id": str(session), "question_index": str(question["index"]), "username": username}
    if follow_up:
        data["follow_up"] = follow_up
    return client.post(
        "/api/interview/answer", data=data, files={"audio": ("a.wav", wav_bytes(seconds=seconds), "audio/wav")}, headers=headers
    )


def test_options_list_types_roles_levels_lengths_and_the_answer_limit(client):
    body = client.get("/api/interview/options").json()
    assert [t["id"] for t in body["types"]] == ["full", "hr", "behavioural", "technical", "tough", "phone", "university", "visa"]
    assert {t["id"]: (t["role"], t["level"]) for t in body["types"]}["visa"] == (False, False)
    assert {r["id"] for r in body["roles"]} == set(interview.ROLES)
    assert body["counts"] == [3, 5, 7] and body["max_seconds"] == 150


def test_without_a_name_nothing_is_saved_but_answers_are_scored(client, fake_asr):
    session = start(client).json()
    assert session["id"] is None and session["saved"] is False and len(session["questions"]) == 3
    fake_asr.text, fake_asr.words = STAR_ANSWER, timed_words(STAR_ANSWER)
    body = speak(client, session["questions"][1]).json()
    assert body["saved"] is False and body["rubric"] is None  # no model configured: the checks still run
    assert {c["id"] for c in body["checks"]} >= {"length", "example", "ownership", "result"}
    assert body["question"]["kind"] == "behavioural" and body["delivery"]["wpm"]


def test_a_named_interview_is_saved_resumable_and_reported(client, fake_asr):
    session = start(client, username="maya").json()
    assert session["saved"] is True
    fake_asr.text, fake_asr.words = STAR_ANSWER, timed_words(STAR_ANSWER)
    first = speak(client, session["questions"][0], session=session["id"]).json()
    again = speak(client, session["questions"][0], session=session["id"]).json()
    assert first["saved"] and first["attempt"] == 1 and again["attempt"] == 2

    listed = client.get("/api/interview/sessions/maya", headers=HEADERS).json()["sessions"]
    assert [(s["id"], s["answered"], s["total"], s["finished"]) for s in listed] == [(session["id"], 1, 3, False)]

    detail = client.get(f"/api/interview/sessions/maya/{session['id']}", headers=HEADERS).json()
    assert [q["index"] for q in detail["questions"]] == [0, 1, 2]
    assert detail["answers"]["0"]["attempt"] == 2 and detail["answers"]["0"]["transcript"].startswith("One example")
    assert detail["report"]["answered"] == 1
    assert "audio" not in json.dumps(detail)


def test_a_saved_interview_belongs_to_its_owner(client, fake_asr):
    session = start(client, username="maya").json()
    other = {"X-Profile-Key": OTHER_KEY}
    assert client.get(f"/api/interview/sessions/maya/{session['id']}", headers=other).status_code == 403
    assert speak(client, session["questions"][0], session=session["id"], headers=other).status_code == 403
    assert client.delete(f"/api/interview/sessions/maya/{session['id']}", headers=other).status_code == 403
    assert client.get("/api/interview/sessions/nobody", headers=HEADERS).json() == {"sessions": []}


def test_an_answer_must_match_its_place_in_the_interview(client):
    session = start(client, username="maya").json()
    wrong = {**session["questions"][1], "index": 0}
    assert speak(client, wrong, session=session["id"]).status_code == 400
    assert speak(client, {"id": "made-up", "index": 0}).status_code == 400
    assert speak(client, session["questions"][0], session=999999).status_code == 404


def test_silence_is_not_saved(client, fake_asr):
    session = start(client, username="maya").json()
    fake_asr.text, fake_asr.words = "", []
    body = speak(client, session["questions"][0], session=session["id"]).json()
    assert body["no_speech"] is True and body["saved"] is False and body["checks"] == []
    assert client.get(f"/api/interview/sessions/maya/{session['id']}", headers=HEADERS).json()["answered"] == 0


def test_interview_answers_may_run_longer_than_speak_freely(client, fake_asr):
    fake_asr.text, fake_asr.words = "I think so", timed_words("I think so")
    question = start(client).json()["questions"][0]
    assert speak(client, question, seconds=130).status_code == 200  # over Speak freely's 120 s
    too_long = speak(client, question, seconds=155)
    assert too_long.status_code == 413 and too_long.json()["code"] == "recording_too_long"


def test_deleting_one_interview_or_the_whole_history(client):
    first = start(client, username="maya").json()["id"]
    second = start(client, username="maya").json()["id"]
    assert client.delete(f"/api/interview/sessions/maya/{first}", headers=HEADERS).json() == {"deleted": True}
    assert client.delete(f"/api/interview/sessions/maya/{first}", headers=HEADERS).status_code == 404
    assert [s["id"] for s in client.get("/api/interview/sessions/maya", headers=HEADERS).json()["sessions"]] == [second]
    assert client.delete("/api/history/maya", headers=HEADERS).status_code == 200
    assert client.get("/api/interview/sessions/maya", headers=HEADERS).json() == {"sessions": []}


def test_only_the_newest_interviews_are_kept(client, monkeypatch):
    monkeypatch.setattr(interview, "MAX_SAVED", 2)
    ids = [start(client, username="maya").json()["id"] for _ in range(3)]
    kept = [s["id"] for s in client.get("/api/interview/sessions/maya", headers=HEADERS).json()["sessions"]]
    assert kept == ids[:0:-1]  # the oldest was dropped


def test_the_models_rubric_is_used_when_valid(client, fake_asr, monkeypatch):
    seen = {}

    def handler(request):
        seen["facts"] = json.loads(json.loads(request.content)["messages"][1]["content"])
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(GOOD_RUBRIC)}}]})

    monkeypatch.setattr(interview_api, "get_coach", lambda: CoachService("k", "m", transport=httpx.MockTransport(handler)))
    speech.audio_rate_limiter.reset()
    session = start(client, username="maya").json()
    fake_asr.text, fake_asr.words = STAR_ANSWER, timed_words(STAR_ANSWER)
    behavioural = session["questions"][1]
    body = speak(client, behavioural, session=session["id"]).json()
    assert body["rubric_source"] == "groq" and body["rubric"]["scores"]["structure"] == 4
    assert body["rubric"]["star"] == GOOD_RUBRIC["star"]
    assert seen["facts"]["question"] == behavioural["text"] and seen["facts"]["role"] == "Software / IT"
    assert seen["facts"]["answer_transcript"].startswith("One example")
    saved = client.get(f"/api/interview/sessions/maya/{session['id']}", headers=HEADERS).json()
    assert saved["answers"]["1"]["rubric"]["summary"] == GOOD_RUBRIC["summary"] and saved["content_score"] == 4.0


def test_a_broken_model_reply_falls_back_to_the_checks(client, fake_asr, monkeypatch):
    def handler(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({"scores": "great"})}}]})

    monkeypatch.setattr(interview_api, "get_coach", lambda: CoachService("k", "m", transport=httpx.MockTransport(handler)))
    fake_asr.text, fake_asr.words = STAR_ANSWER, timed_words(STAR_ANSWER)
    body = speak(client, start(client).json()["questions"][1]).json()
    assert body["rubric"] is None and body["rubric_source"] is None and body["checks"]


# --- follow-up questions -----------------------------------------------------------------------


def test_the_interviewer_follows_up_on_what_the_answer_missed():
    def follow_up(question_id, text, seconds):
        q = interview.question_view(interview.BY_ID[question_id])
        return interview.follow_up_for(q, interview.answer_checks(q, text, delivery(seconds)))

    assert follow_up("beh-problem", STAR_ANSWER, 80) is None  # complete: straight on to the next question
    no_result = "One example is when our release was late at my last job. I organised the team and I fixed the build."
    assert follow_up("beh-problem", no_result, 70)["id"] == "result"
    assert follow_up("beh-problem", "We worked hard on it.", 70)["id"] == "example"
    assert follow_up("mot-why-job", "I like it.", 8) == {"id": "more", "text": interview.FOLLOW_UPS["more"]}
    assert follow_up("close-questions", "No.", 3) is None  # the closing question is never probed


def test_a_follow_up_answer_is_checked_for_the_missing_part():
    assert interview.follow_up_checks("result", "In the end we saved 20% of the cost.", delivery(20))[0]["ok"]
    missed = interview.follow_up_checks("result", "It was a busy week.", delivery(20))[0]
    assert not missed["ok"] and "what changed" in missed["fix"]


def test_a_follow_up_is_asked_answered_and_kept_with_its_question(client, fake_asr):
    session = start(client, username="maya").json()
    behavioural = session["questions"][1]
    fake_asr.text = "One example is when our release was late at my last job. I organised the team and I fixed the build."
    fake_asr.words = timed_words(fake_asr.text)
    assert speak(client, behavioural, session=session["id"], follow_up="result").status_code == 409  # main answer first
    main = speak(client, behavioural, session=session["id"]).json()
    assert main["follow_up"] == {"id": "result", "text": interview.FOLLOW_UPS["result"]}

    fake_asr.text, fake_asr.words = "In the end we delivered two days early.", timed_words("In the end we delivered two days early.")
    reply = speak(client, behavioural, session=session["id"], follow_up="result").json()
    assert reply["question"]["kind"] == "follow_up" and reply["checks"][0]["ok"] and reply["follow_up"] is None
    stored = client.get(f"/api/interview/sessions/maya/{session['id']}", headers=HEADERS).json()["answers"]["1"]
    assert stored["follow_up"]["id"] == "result" and stored["follow_up"]["transcript"].startswith("In the end")
    assert speak(client, behavioural, follow_up="nonsense").status_code == 400


def test_the_models_follow_up_refers_to_the_answer_and_is_spoken_as_asked(client, fake_asr, monkeypatch):
    asked = "You mentioned the release was late. What happened once it shipped?"
    reply = {**GOOD_RUBRIC, "follow_up": asked}

    def handler(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(reply)}}]})

    monkeypatch.setattr(interview_api, "get_coach", lambda: CoachService("k", "m", transport=httpx.MockTransport(handler)))
    session = start(client, username="maya").json()
    behavioural = session["questions"][1]
    fake_asr.text = "One example is when our release was late at my last job. I organised the team and I fixed the build."
    fake_asr.words = timed_words(fake_asr.text)
    main = speak(client, behavioural, session=session["id"]).json()
    assert main["follow_up"] == {"id": "result", "text": asked}

    fake_asr.text, fake_asr.words = "In the end we delivered early.", timed_words("In the end we delivered early.")
    data = {"question_id": behavioural["id"], "session_id": str(session["id"]), "question_index": "1", "username": "maya",
            "follow_up": "result", "follow_up_text": asked}
    answer = client.post("/api/interview/answer", data=data, files={"audio": ("a.wav", wav_bytes(), "audio/wav")}, headers=HEADERS)
    assert answer.json()["question"]["text"] == asked
    stored = client.get(f"/api/interview/sessions/maya/{session['id']}", headers=HEADERS).json()["answers"]["1"]
    assert stored["follow_up"]["text"] == asked


@pytest.mark.parametrize("bad", ["", "Tell me more.", "Why? And how?", "x" * 170 + "?"])
def test_a_follow_up_the_interviewer_could_not_say_is_dropped(bad):
    assert interview.parse_rubric({**GOOD_RUBRIC, "follow_up": bad}, STAR_ANSWER, behavioural=True)["follow_up"] is None
    assert interview.clean_follow_up_text(bad, "result") == interview.FOLLOW_UPS["result"]


def test_the_interview_type_is_saved_and_shapes_what_the_model_is_told(client, fake_asr, monkeypatch):
    seen = {}

    def handler(request):
        seen["facts"] = json.loads(json.loads(request.content)["messages"][1]["content"])
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(GOOD_RUBRIC)}}]})

    monkeypatch.setattr(interview_api, "get_coach", lambda: CoachService("k", "m", transport=httpx.MockTransport(handler)))
    session = start(client, username="maya", type="visa").json()
    assert (session["type"], session["type_label"], session["role_label"], session["level_label"]) == ("visa", "Student visa", None, None)
    fake_asr.text, fake_asr.words = "My father is paying for my studies.", timed_words("My father is paying for my studies.")
    speak(client, session["questions"][0], session=session["id"])
    assert seen["facts"]["interview"] == "Student visa" and "role" not in seen["facts"] and "candidate_level" not in seen["facts"]
    listed = client.get("/api/interview/sessions/maya", headers=HEADERS).json()["sessions"][0]
    assert listed["type"] == "visa" and listed["type_label"] == "Student visa"



# --- what goes wrong in real interviews --------------------------------------------------------


def test_visa_answers_are_expected_short_and_direct():
    checks = checks_by_id("visa-fund-who", "My father is paying. He runs a textile business in Lahore. " * 6, delivery(55))
    assert not checks["length"]["ok"] and "short, direct answers" in checks["length"]["fix"]
    assert checks_by_id("visa-fund-who", "My father is paying for my studies.", delivery(15))["length"]["ok"]


def test_stock_phrases_are_flagged_where_specific_reasons_matter():
    stock = checks_by_id("visa-why-uni", "It is my dream university and it has world-class faculty.", delivery(15))
    assert not stock["stock"]["ok"] and "specific" in stock["stock"]["fix"]
    specific = checks_by_id("visa-why-uni", "The robotics lab runs the drone project I want to join.", delivery(15))
    assert "stock" not in specific


def test_tough_answers_are_checked_for_blame():
    blame = checks_by_id("tough-layoff", "My manager was toxic and they fired me for no reason.", delivery(40))
    assert not blame["neutral"]["ok"]
    calm = checks_by_id("tough-layoff", "My manager was very supportive, but the team was cut in a restructure.", delivery(40))
    assert calm["neutral"]["ok"]


def test_a_retry_that_repeats_the_same_words_sounds_recited():
    assert interview.memorised_check(STAR_ANSWER, STAR_ANSWER)["id"] == "fresh"
    reworded = "Last year our launch slipped, so I took charge of the team, repaired the broken build myself, and we shipped two days early."
    assert interview.memorised_check(STAR_ANSWER, reworded) is None
    assert interview.memorised_check("Yes I can.", "Yes I can.") is None  # short answers repeat naturally


def test_a_saved_retry_with_the_same_words_is_flagged(client, fake_asr):
    session = start(client, username="maya").json()
    fake_asr.text, fake_asr.words = STAR_ANSWER, timed_words(STAR_ANSWER)
    first = speak(client, session["questions"][1], session=session["id"]).json()
    again = speak(client, session["questions"][1], session=session["id"]).json()
    assert "fresh" not in {c["id"] for c in first["checks"]}
    assert {c["id"]: c["ok"] for c in again["checks"]}["fresh"] is False


def test_tough_questions_cover_what_candidates_dread():
    texts = " ".join(q["text"] for q in interview.QUESTIONS if q["kind"] == "tough").lower()
    for topic in ("gap", "last job end", "changed jobs", "different field", "salary", "failure"):
        assert topic in texts



# --- a proper interview: the interviewer listens and answers -------------------------------------------


@pytest.mark.parametrize(
    ("reaction", "kept"),
    [
        ("Thanks, the refunds project sounds like a big change for your team.", True),
        ("Great answer, you did really well?", False),  # a question
        ("Ok", False),  # too short to say anything
        ("x" * 130 + ".", False),
    ],
)
def test_the_interviewer_reacts_in_one_short_sentence(reaction, kept):
    parsed = interview.parse_rubric({**GOOD_RUBRIC, "reaction": reaction}, STAR_ANSWER, behavioural=True)
    assert (parsed["reaction"] == reaction) is kept


def test_the_candidates_questions_at_the_end_get_an_answer(client, fake_asr, monkeypatch):
    replies = {"reply": "Good question. In a role like this, the first months are mostly about learning the systems and the team."}

    def handler(request):
        system = json.loads(request.content)["messages"][0]["content"]
        content = replies if "end of a practice interview" in system else GOOD_RUBRIC
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(content)}}]})

    monkeypatch.setattr(interview_api, "get_coach", lambda: CoachService("k", "m", transport=httpx.MockTransport(handler)))
    closing = interview.question_view(interview.BY_ID["close-questions"])
    fake_asr.text = "Yes, what does success look like in the first six months?"
    fake_asr.words = timed_words(fake_asr.text)
    body = speak(client, {**closing, "index": None}).json()
    assert body["reply"] == replies["reply"]
    other = speak(client, start(client).json()["questions"][0]).json()
    assert other["reply"] is None  # only the closing question gets a reply


def test_without_the_model_there_is_no_reply_and_nothing_breaks(client, fake_asr):
    closing = interview.question_view(interview.BY_ID["close-questions"])
    fake_asr.text, fake_asr.words = "What is the team like?", timed_words("What is the team like?")
    assert speak(client, {**closing, "index": None}).json()["reply"] is None
