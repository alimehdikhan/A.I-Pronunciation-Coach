"""Mock interviews: questions for a role and level (or written from the learner's CV), each spoken
answer scored for content and delivery, and (for a learner with a name) the interview saved as text
so it can be resumed or reviewed."""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend import cv, interview, learners, quick_transcribe
from backend.api.coach import coach_rate_limiter
from backend.api.deps import profile_key, require_models
from backend.api.speaking import analyse_free_answer
from backend.api.speech import audio_rate_limiter
from backend.audio import decode_audio, normalize_loudness, read_upload, validate_upload
from backend.config import settings
from backend.database import InterviewSession, as_utc, get_db, utcnow
from backend.errors import CodedHTTPException
from backend.observability import StageTimer
from backend.repositories import (
    authorize,
    create_interview,
    delete_interview,
    find_interview,
    find_or_create_user,
    find_user,
    interview_rows,
    save_interview_answer,
)
from backend.runtime import get_coach, runtime
from backend.security import RateLimiter, clean_username, client_key

logger = logging.getLogger("pronunciation_coach.api.interview")
router = APIRouter()
# Every answer in a live interview asks for a turn as well as its scoring, so turns have their own budget.
turn_rate_limiter = RateLimiter(settings.rate_limit_per_minute, name="interview_turn")


class StartRequest(BaseModel):
    type: str = Field("full", max_length=16)
    role: str = Field("general", max_length=20)
    level: str = Field("mid", max_length=10)
    count: int = 5
    # With a name and a profile key the interview is saved (text only) so it can be resumed and reviewed.
    username: str | None = Field(None, max_length=40)
    # The job the learner is preparing for, if they gave it: the interviewer words its questions for it.
    company: str | None = Field(None, max_length=80)
    job_title: str | None = Field(None, max_length=80)


def _stamp(value) -> str | None:
    return as_utc(value).isoformat() if value else None


def _entries(row: InterviewSession) -> list[str | dict[str, Any]]:
    """The interview's questions: bank ids, or whole questions written from a CV."""
    try:
        data = json.loads(row.questions or "[]")
    except ValueError:
        return []
    if not isinstance(data, list):
        return []
    return [e for e in data if isinstance(e, str) or (isinstance(e, dict) and isinstance(e.get("id"), str) and isinstance(e.get("text"), str))]


def _entry_id(entry: str | dict[str, Any] | None) -> str | None:
    return entry if isinstance(entry, str) else (entry or {}).get("id")


def _question_ids(row: InterviewSession) -> list[str]:
    return [_entry_id(e) or "" for e in _entries(row)]


def _view(entry: str | dict[str, Any]) -> dict[str, Any] | None:
    if isinstance(entry, dict):
        return interview.custom_view(entry)
    return interview.question_view(interview.BY_ID[entry]) if entry in interview.BY_ID else None


def _answers(row: InterviewSession) -> dict[str, dict[str, Any]]:
    try:
        data = json.loads(row.answers or "{}")
    except ValueError:
        return {}
    return {k: v for k, v in data.items() if isinstance(v, dict)} if isinstance(data, dict) else {}


def _questions(entries: list[str | dict[str, Any]]) -> list[dict[str, Any]]:
    """Question views with their position, so answers (keyed by position) line up."""
    return [{**view, "index": i} for i, entry in enumerate(entries) if (view := _view(entry)) is not None]


def _kind(row: InterviewSession) -> str:
    return interview.clean_type(row.interview_type)


def _labels(kind: str, role: str, level: str) -> dict[str, Any]:
    spec = interview.TYPES[kind]
    return {
        "type": kind,
        "type_label": spec["label"],
        "role": role,
        "role_label": interview.ROLES.get(role, role) if spec["role"] else None,
        "level": level,
        "level_label": interview.LEVELS.get(level, level) if spec["level"] else None,
    }


def _context(row: InterviewSession) -> dict[str, str]:
    try:
        data = json.loads(row.context or "{}")
    except ValueError:
        return {}
    return interview.clean_context(data.get("company"), data.get("job_title")) if isinstance(data, dict) else {}


def _summary(row: InterviewSession) -> dict[str, Any]:
    total = len(_question_ids(row))
    answers = list(_answers(row).values())
    context = _context(row)
    return {
        "id": row.id,
        **_labels(_kind(row), row.role, row.level),
        "company": context.get("company"),
        "job_title": context.get("job_title"),
        "created_at": _stamp(row.created_at),
        "updated_at": _stamp(row.updated_at),
        "total": total,
        "answered": len(answers),
        "finished": total > 0 and len(answers) >= total,
        "content_score": interview.content_score(answers),
    }


def _detail(row: InterviewSession) -> dict[str, Any]:
    answers = _answers(row)
    ordered = [answers[k] for k in sorted(answers, key=lambda k: int(k) if k.isdigit() else 0)]
    return {
        **_summary(row),
        "questions": _questions(_entries(row)),
        "answers": answers,
        "report": interview.session_report(ordered),
        "max_seconds": settings.interview_seconds,
    }


def _owner(db: Session, username: str, key: str | None):
    name = clean_username(username)
    user = find_user(db, name) if name else None
    if user is None:
        raise HTTPException(status_code=404, detail="No interviews for that name.")
    authorize(db, user, key)
    return user


def _session(db: Session, username: str, key: str | None, session_id: int) -> InterviewSession:
    row = find_interview(db, _owner(db, username, key), session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="That interview isn't saved.")
    return row


@router.get("/api/interview/options")
def interview_options() -> dict[str, Any]:
    """Roles, levels, interview lengths and the longest answer allowed."""
    return interview.options(settings.interview_seconds)


@router.post("/api/interview/sessions")
async def start_interview(body: StartRequest, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Pick the questions, in the order a real interview asks them, and word them the way a real interviewer for
    this job would (the language model; the bank's wording without it). Saved when the learner has a name."""
    kind, role, level = interview.settings_for(body.type, body.role, body.level)
    # A job interview can be for a named company and job; a visa or admission interview is not.
    context = interview.clean_context(body.company, body.job_title) if kind not in ("visa", "university") else {}
    planned = interview.build_session(role, level, interview.clean_count(body.count), kind=kind)
    entries: list[Any] = [q["id"] for q in planned]
    questions = planned
    coach = get_coach()
    if coach.enabled and planned:
        spec = interview.TYPES[kind]
        facts = {
            "interview": spec["label"],
            **({"role": interview.ROLES[role]} if spec["role"] else {}),
            **({"candidate_level": interview.LEVELS[level]} if spec["level"] else {}),
            **context,
            "questions": [{"kind": q["kind"], "text": q["text"]} for q in planned],
        }
        texts, _source = await coach.generate(
            "interview_wording", interview.WORDING_PROMPT, facts,
            lambda data: interview.parse_wording(data, planned), lambda: None, cache=False, effort="low",
        )
        if texts:
            entries = interview.worded(planned, texts)
            questions = [interview.custom_view(entry) for entry in entries]
    session_id = None
    name = clean_username(body.username)
    if name and key:
        user = find_or_create_user(db, name, key)
        session_id = create_interview(db, user, kind, role, level, entries, interview.MAX_SAVED, context).id
    return {
        "id": session_id,
        "saved": session_id is not None,
        **_labels(kind, role, level),
        "company": context.get("company"),
        "job_title": context.get("job_title"),
        "questions": [{**q, "index": i} for i, q in enumerate(questions)],
        "max_seconds": settings.interview_seconds,
    }


@router.post("/api/interview/cv")
async def interview_from_cv(
    request: Request,
    cv_file: UploadFile | None = File(None, description="PDF, Word (.docx) or text"),
    cv_text: str | None = Form(None, max_length=30000, description="The CV pasted as text"),
    job_ad: str | None = Form(None, max_length=12000),
    level: str = Form("mid", max_length=10),
    count: int = Form(5),
    username: str | None = Form(None, max_length=40),
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Questions a real interviewer would ask this candidate, from their CV and (optionally) the job advert.

    The CV and advert are read once and never stored; only the questions are kept with a saved interview.
    """
    text = ""
    if cv_file is not None and cv_file.filename:
        data = await cv_file.read(cv.MAX_FILE_BYTES + 1)
        try:
            text = await run_in_threadpool(cv.extract_text, data, cv_file.filename)
        except cv.CVError as exc:
            raise CodedHTTPException(400, str(exc), exc.code) from exc
    if len(text) < cv.MIN_CV_CHARS and cv_text:
        text = cv.clean(cv_text)
    if len(text) < cv.MIN_CV_CHARS:
        raise CodedHTTPException(400, "Add your CV: upload the file or paste at least a few lines of it.", "cv_missing")
    job = cv.clean(job_ad or "")[: cv.MAX_JOB_CHARS]
    level = interview.clean_level(level)
    count = count if count in cv.COUNTS else 5
    found = await run_in_threadpool(cv.read_profile, text, job)

    coach = get_coach()
    if coach.enabled:
        coach_rate_limiter.check(client_key(request))
    questions, source = await coach.generate(
        "interview_cv", cv.QUESTIONS_PROMPT, cv.model_facts(text, job, interview.LEVELS[level], count),
        lambda data: cv.parse_questions(data, count), lambda: cv.fallback_questions(found, count), cache=False,
    )
    entries = [{"id": f"cv-{i}", **q} for i, q in enumerate(questions)]

    session_id = None
    name = clean_username(username)
    if name and key:
        user = find_or_create_user(db, name, key)
        session_id = create_interview(db, user, "cv", "general", level, entries, interview.MAX_SAVED).id
    return {
        "id": session_id,
        "saved": session_id is not None,
        **_labels("cv", "general", level),
        "questions": [{**interview.custom_view(e), "index": i} for i, e in enumerate(entries)],
        "max_seconds": settings.interview_seconds,
        "source": source,
        # What was read, so the learner can see the questions are about them. Not stored.
        "read": {k: found[k] for k in ("current_role", "job_title", "projects", "skills", "shared_skills", "missing_skills")},
    }


@router.get("/api/interview/sessions/{username}")
def list_interviews(username: str, key: str | None = Depends(profile_key), db: Session = Depends(get_db)) -> dict[str, Any]:
    """The learner's saved interviews, newest first."""
    name = clean_username(username)
    user = find_user(db, name) if name else None
    if user is None:
        return {"sessions": []}
    authorize(db, user, key)
    return {"sessions": [_summary(row) for row in interview_rows(db, user)]}


@router.get("/api/interview/sessions/{username}/{session_id}")
def get_interview(
    username: str, session_id: int, key: str | None = Depends(profile_key), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """One saved interview: its questions, every answer's feedback and the report."""
    return _detail(_session(db, username, key, session_id))


@router.post("/api/interview/sessions/{username}/{session_id}/repeat")
def repeat_interview(
    username: str, session_id: int, key: str | None = Depends(profile_key), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """A new interview with the same questions (a CV interview has no bank to pick fresh ones from)."""
    user = _owner(db, username, key)
    row = find_interview(db, user, session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="That interview isn't saved.")
    entries = _entries(row)
    fresh = create_interview(db, user, _kind(row), row.role, row.level, entries, interview.MAX_SAVED)
    return {
        "id": fresh.id,
        "saved": True,
        **_labels(_kind(row), row.role, row.level),
        "questions": _questions(entries),
        "max_seconds": settings.interview_seconds,
    }


@router.delete("/api/interview/sessions/{username}/{session_id}")
def remove_interview(
    username: str, session_id: int, key: str | None = Depends(profile_key), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Delete one saved interview."""
    if not delete_interview(db, _owner(db, username, key), session_id):
        raise HTTPException(status_code=404, detail="That interview isn't saved.")
    return {"deleted": True}


@router.post("/api/interview/answer")
async def answer_question(
    request: Request,
    response: Response,
    audio: UploadFile = File(...),
    question_id: str = Form(..., max_length=40),
    interview_type: str = Form("full", max_length=16),
    role: str = Form("general", max_length=20),
    level: str = Form("mid", max_length=10),
    session_id: int | None = Form(None),
    question_index: int | None = Form(None, ge=0, lt=20),
    username: str | None = Form(None, max_length=40),
    follow_up: str | None = Form(None, max_length=12, description="Answering the interviewer's follow-up to this question"),
    follow_up_text: str | None = Form(None, max_length=200, description="The follow-up as it was asked"),
    question_text: str | None = Form(None, max_length=cv.MAX_QUESTION_CHARS, description="A CV question in an unsaved interview"),
    question_kind: str | None = Form(None, max_length=12),
    key: str | None = Depends(profile_key),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Score one spoken answer: what was said (structure, examples, result) and how (pace, pauses, fillers, sure sound slips).

    The reply names the follow-up a real interviewer would ask, if the answer missed something. With
    `follow_up` set this is the answer to that follow-up, checked for the missing part. With `session_id`
    the answer is stored in that saved interview (text only), replacing an earlier try.
    """
    if follow_up is not None and follow_up not in interview.FOLLOW_UPS:
        raise HTTPException(status_code=400, detail="Unknown follow-up.")

    # A saved interview is checked before the slow part, so a wrong id fails at once.
    row = None
    main_question: dict[str, Any] | None = None
    if session_id is not None:
        if question_index is None:
            raise HTTPException(status_code=400, detail="question_index is required with session_id.")
        row = _session(db, username or "", key, session_id)
        entries = _entries(row)
        entry = entries[question_index] if question_index < len(entries) else None
        if entry is None or _entry_id(entry) != question_id or (main_question := _view(entry)) is None:
            raise HTTPException(status_code=400, detail="That question isn't part of this interview.")
        if follow_up and str(question_index) not in _answers(row):
            raise HTTPException(status_code=409, detail="Answer the question before its follow-up.")
        interview_type, role, level = _kind(row), row.role, row.level
    elif question_id in interview.BY_ID:
        main_question = interview.question_view(interview.BY_ID[question_id])
    elif question_id.startswith("cv-") and question_text and question_kind in cv.KINDS:
        text = " ".join(question_text.split())
        if len(text) < 12:
            raise HTTPException(status_code=400, detail="Unknown interview question.")
        main_question = interview.custom_view({"id": question_id, "kind": question_kind, "text": text})
    else:
        raise HTTPException(status_code=400, detail="Unknown interview question.")
    question = interview.follow_up_view(main_question, follow_up, follow_up_text) if follow_up else main_question
    kind, role, level = interview.settings_for(interview_type, role, level)
    learner = find_user(db, clean_username(username) or "") if username else None
    model = learners.sound_model_for(learner.first_language if learner else None)
    db.commit()  # end the read before transcription, which can take a while

    audio_rate_limiter.check(client_key(request))
    timer = StageTimer()
    analysed = await analyse_free_answer(
        audio, timer, max_seconds=settings.interview_seconds, endpoint="/api/interview/answer", sound_model=model,
        background=True,
    )
    body: dict[str, Any] = {
        "question": {**question, "index": question_index},
        "transcription": analysed["text"],
        "no_speech": not analysed["text"],
        "note": interview.NOTE,
        "max_seconds": settings.interview_seconds,
    }
    if not analysed["text"]:
        response.headers["Server-Timing"] = timer.header()
        return {
            **body, "delivery": None, "words": [], "slips": [], "pronunciation": None,
            "checks": [], "rubric": None, "rubric_source": None, "follow_up": None, "reply": None, "saved": False, "attempt": 0,
        }

    if follow_up:
        return _answer_follow_up(db, row, question_index, question, analysed, body, response, timer)

    previous = (_answers(row).get(str(question_index)) or {}) if row is not None else {}
    checks = interview.answer_checks(question, analysed["target"], analysed["delivery"])
    if previous.get("transcript"):
        repeat = interview.memorised_check(previous["transcript"], analysed["target"])
        if repeat:
            checks.append(repeat)
    rubric, source = None, None
    coach = get_coach()
    if coach.enabled:
        spec = interview.TYPES[kind]
        facts = {
            "interview": spec["label"],
            **({"role": interview.ROLES[role]} if spec["role"] else {}),
            **({"candidate_level": interview.LEVELS[level]} if spec["level"] else {}),
            "question": question["text"],
            "question_kind": question["kind"],
            "what_interviewers_look_for": question["look_for"],
            "answer_transcript": analysed["target"][: interview.MAX_TRANSCRIPT],
            "answer_seconds": analysed["delivery"]["duration"],
        }
        with timer.stage("rubric"):
            rubric, source = await coach.generate(
                "interview", interview.RUBRIC_PROMPT, facts,
                lambda data: interview.parse_rubric(data, analysed["target"], question["star"]), lambda: None, cache=False,
            )
        if rubric is None:
            source = None

    # The candidate's own questions at the end get an answer, as they would in the room.
    reply = None
    if coach.enabled and question["kind"] == "closing":
        spec = interview.TYPES[kind]
        facts = {
            "interview": spec["label"],
            **({"role": interview.ROLES[role]} if spec["role"] else {}),
            "candidate_said": analysed["target"][:1500],
        }
        reply, _source = await coach.generate(
            "interview_reply", interview.REPLY_PROMPT, facts, interview.parse_reply, lambda: None, cache=False
        )

    saved, attempt = False, 1
    if row is not None:
        attempt = int(previous.get("attempt") or 0) + 1
        stored = interview.stored_answer(question, analysed, checks, rubric, attempt, utcnow().isoformat())
        save_interview_answer(db, row, question_index, stored)
        saved = True

    response.headers["Server-Timing"] = timer.header()
    return {
        **body,
        "delivery": analysed["delivery"],
        "words": analysed["words"],
        "slips": analysed["slips"],
        "pronunciation": analysed["pronunciation"],
        "checks": checks,
        "rubric": rubric,
        "rubric_source": source,
        "follow_up": _follow_up(question, checks, rubric),
        "reply": reply,
        "saved": saved,
        "attempt": attempt,
    }


def _json_list(raw: str) -> list[Any]:
    try:
        value = json.loads(raw or "[]")
    except ValueError:
        return []
    return value if isinstance(value, list) else []


@router.post("/api/interview/turn")
async def interviewer_turn(
    request: Request,
    response: Response,
    audio: UploadFile = File(...),
    question_id: str = Form(..., max_length=40),
    interview_type: str = Form("full", max_length=16),
    role: str = Form("general", max_length=20),
    level: str = Form("mid", max_length=10),
    question_text: str | None = Form(None, max_length=cv.MAX_QUESTION_CHARS, description="A CV question's text"),
    question_kind: str | None = Form(None, max_length=12),
    conversation: str = Form("[]", max_length=40_000, description="JSON: what was said on this question so far"),
    earlier: str = Form("[]", max_length=20_000, description="JSON: earlier questions and the start of each answer"),
    follow_ups_asked: int = Form(0, ge=0, le=10),
    company: str | None = Form(None, max_length=80),
    job_title: str | None = Form(None, max_length=80),
) -> dict[str, Any]:
    """What the interviewer says after an answer, in a second or two, the way a real interviewer reacts.

    The answer is transcribed quickly (backend.quick_transcribe) and the language model decides, like a
    skilled interviewer, whether to follow up on something the candidate said, ask them to clarify, bring
    them back to the question, or move on (interview.TURN_PROMPT; simple checks when it is unavailable).
    Scoring the same answer is separate (`/api/interview/answer`) and runs while the interview goes on.
    """
    turn_rate_limiter.check(client_key(request))
    # The candidate's reply to the greeting: the interviewer answers it, and the interview begins.
    small_talk = question_id == interview.SMALL_TALK_ID
    question: dict[str, Any] = {"kind": "small_talk"}
    if small_talk:
        pass  # no question to look up
    elif question_id in interview.BY_ID:
        question = interview.question_view(interview.BY_ID[question_id])
        asked = " ".join((question_text or "").split())
        if 12 <= len(asked) <= cv.MAX_QUESTION_CHARS:
            question = {**question, "text": asked}  # worded for this job when the interview started
    elif question_id.startswith("cv-") and question_text and question_kind in cv.KINDS:
        question = interview.custom_view({"id": question_id, "kind": question_kind, "text": " ".join(question_text.split())})
    else:
        raise HTTPException(status_code=400, detail="Unknown interview question.")
    kind, role, level = interview.settings_for(interview_type, role, level)

    timer = StageTimer()
    suffix = validate_upload(audio)
    with timer.stage("upload"):
        data = await read_upload(audio, settings.max_upload_bytes)
    # Only the words are needed here, so no noise cleanup: it costs CPU the scoring of earlier answers is using.
    with timer.stage("decode"):
        samples = await run_in_threadpool(decode_audio, data, suffix, settings.interview_seconds)
        samples, _gain = await run_in_threadpool(normalize_loudness, samples)
    seconds = round(len(samples) / quick_transcribe.SAMPLE_RATE, 1)
    if seconds < 0.3:
        response.headers["Server-Timing"] = timer.header()
        move_on = {"action": "repeat", "probe": None, "reaction": None, "question": None, "missing": None}
        return {"transcript": "", "no_speech": True, "seconds": seconds, "transcribed_by": None, "reply": None, **move_on, "source": None}

    async def local_whisper(clip):
        asr, _scorer = require_models()
        async with runtime.asr_gate.slot():
            return await run_in_threadpool(asr.transcribe, clip)

    with timer.stage("asr"):
        text, heard_by = await quick_transcribe.transcribe(samples, local_whisper)
    move_on = {"action": "move_on", "probe": None, "reaction": None, "question": None, "missing": None}
    body: dict[str, Any] = {"transcript": text, "no_speech": not text, "seconds": seconds, "transcribed_by": heard_by, "reply": None}
    if not text:
        response.headers["Server-Timing"] = timer.header()
        return {**body, **move_on, "action": "repeat", "source": None}

    coach = get_coach()
    spec = interview.TYPES[kind]
    if small_talk:
        greeting = next((line["text"] for line in interview.clean_conversation(_json_list(conversation)) if line["speaker"] == "interviewer"), "")
        with timer.stage("reply"):
            mood, source = await coach.generate(
                "interview_small_talk", interview.SMALL_TALK_PROMPT,
                {"interview": spec["label"], "you_said": greeting, "candidate_said": text[:600]},
                interview.parse_mood, lambda: interview.small_talk_mood(text), cache=False, effort="low",
            )
        response.headers["Server-Timing"] = timer.header()
        return {**body, **move_on, "mood": mood, "source": source}
    about = {
        "interview": spec["label"],
        **({"role": interview.ROLES[role]} if spec["role"] else {}),
        **({"candidate_level": interview.LEVELS[level]} if spec["level"] else {}),
        **interview.clean_context(company, job_title),
    }
    # The candidate's own questions at the end get an answer, as they would in the room.
    if question["kind"] == "closing":
        reply = None
        if coach.enabled:
            with timer.stage("reply"):
                reply, _source = await coach.generate(
                    "interview_reply", interview.REPLY_PROMPT, {**about, "candidate_said": text[:1500]},
                    interview.parse_reply, lambda: None, cache=False, effort="low",
                )
        response.headers["Server-Timing"] = timer.header()
        return {**body, **move_on, "reply": reply, "source": "groq" if reply else None}

    limit = interview.follow_up_limit(kind, question["kind"])
    lines = interview.clean_conversation(_json_list(conversation))
    lines.append({"speaker": "candidate", "text": text[: interview.MAX_TRANSCRIPT]})
    facts = {
        **about,
        "your_manner": interview.STYLES.get(kind, interview.STYLES["full"]),
        "main_question": question["text"],
        "what_a_good_answer_covers": question["look_for"],
        "this_question_so_far": lines,
        "follow_ups_asked": follow_ups_asked,
        "most_follow_ups": limit,
        "earlier_answers": interview.clean_earlier(_json_list(earlier)),
        "answer_seconds": seconds,
    }
    with timer.stage("decide"):
        turn, source = await coach.generate(
            "interview_turn", interview.TURN_PROMPT, facts,
            lambda data: interview.parse_turn(data, follow_ups_asked, limit),
            lambda: interview.turn_fallback(question, text, seconds, follow_ups_asked, limit),
            cache=False, effort="low",
        )
    response.headers["Server-Timing"] = timer.header()
    return {**body, **turn, "source": source}


def _follow_up(question: dict[str, Any], checks: list[dict[str, Any]], rubric: dict[str, Any] | None) -> dict[str, str] | None:
    """Whether to follow up comes from the checks; the model, when it ran, words it about this answer."""
    follow = interview.follow_up_for(question, checks)
    if follow and rubric and rubric.get("follow_up"):
        follow = {**follow, "text": rubric["follow_up"]}
    return follow


def _answer_follow_up(
    db: Session,
    row: InterviewSession | None,
    question_index: int | None,
    question: dict[str, Any],
    analysed: dict[str, Any],
    body: dict[str, Any],
    response: Response,
    timer: StageTimer,
) -> dict[str, Any]:
    """The answer to a follow-up: checked for the part that was missing, and kept with the main answer."""
    checks = interview.follow_up_checks(question["follow_up"], analysed["target"], analysed["delivery"])
    saved = False
    if row is not None and question_index is not None:
        answers = _answers(row)
        main = answers.get(str(question_index))
        if main is not None:
            stored = interview.stored_answer(question, analysed, checks, None, 1, utcnow().isoformat())
            follows = [*interview.follow_ups_of(main), {**stored, "id": question["follow_up"], "text": question["text"]}]
            main["follow_ups"] = follows[-(interview.MAX_FOLLOW_UPS_BY_TYPE["behavioural"] + 1):]
            main.pop("follow_up", None)
            save_interview_answer(db, row, question_index, main)
            saved = True
    response.headers["Server-Timing"] = timer.header()
    return {
        **body,
        "delivery": analysed["delivery"],
        "words": analysed["words"],
        "slips": analysed["slips"],
        "pronunciation": analysed["pronunciation"],
        "checks": checks,
        "rubric": None,
        "rubric_source": None,
        "follow_up": None,
        "reply": None,
        "saved": saved,
        "attempt": 1,
    }
