"""Group discussion practice: topics, the participants' turns, scoring each of the learner's
contributions, and the assessor's report. Nothing is saved: the transcript lives in the browser."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field

from backend import gd
from backend.api.coach import coach_rate_limiter
from backend.api.speaking import analyse_free_answer
from backend.api.speech import audio_rate_limiter
from backend.observability import StageTimer
from backend.runtime import get_coach
from backend.security import client_key

router = APIRouter()


class TurnRequest(BaseModel):
    topic_id: str = Field(..., max_length=40)
    speaker: str = Field(..., max_length=20)
    user_name: str = Field("", max_length=40)
    turns: list[dict[str, Any]] = Field(default_factory=list, max_length=gd.MAX_TURNS)


class ReportRequest(BaseModel):
    topic_id: str = Field(..., max_length=40)
    user_name: str = Field("", max_length=40)
    turns: list[dict[str, Any]] = Field(default_factory=list, max_length=gd.MAX_TURNS)


@router.get("/api/gd/topics")
def gd_topics() -> dict[str, Any]:
    """The topics, the participants (name, voice, view) and the longest contribution."""
    return {
        "topics": [{"id": t["id"], "title": t["title"]} for t in gd.TOPICS],
        "personas": [{"name": p["name"], "voice": p["voice"], "stance": p["stance"]} for p in gd.PERSONAS],
        "max_seconds": gd.MAX_CONTRIBUTION_SECONDS,
    }


@router.post("/api/gd/turn")
async def gd_turn(body: TurnRequest, request: Request) -> dict[str, Any]:
    """What a participant says next: the model reacting to the discussion, or a point from the topic's bank."""
    if body.speaker not in gd.BY_NAME:
        raise HTTPException(status_code=400, detail="Unknown participant.")
    topic = gd.clean_topic(body.topic_id)
    turns = gd.clean_turns(body.turns)
    fallback = gd.fallback_turn(topic, body.speaker, turns, body.user_name)
    coach = get_coach()
    if not coach.enabled:
        return {"speaker": body.speaker, "text": fallback, "source": "template"}
    coach_rate_limiter.check(client_key(request))
    facts = {
        "topic": topic["title"],
        "discussion": [{"speaker": (body.user_name or "Candidate") if t["you"] else t["speaker"], "text": t["text"]} for t in turns[-16:]],
        "invite_candidate": gd.should_invite(turns, body.user_name),
    }
    text, source = await coach.generate(
        "gd_turn", gd.turn_prompt(body.speaker, body.user_name), facts, gd.parse_turn, lambda: fallback, cache=False
    )
    return {"speaker": body.speaker, "text": text, "source": source}


@router.post("/api/gd/contribution")
async def gd_contribution(request: Request, response: Response, audio: UploadFile = File(...)) -> dict[str, Any]:
    """Transcribe and measure one of the learner's contributions. Not saved."""
    audio_rate_limiter.check(client_key(request))
    timer = StageTimer()
    analysed = await analyse_free_answer(audio, timer, max_seconds=gd.MAX_CONTRIBUTION_SECONDS, endpoint="/api/gd/contribution")
    response.headers["Server-Timing"] = timer.header()
    return {
        "text": analysed["target"] or analysed["text"],
        "no_speech": not analysed["text"],
        "delivery": analysed["delivery"],
        "slips": analysed["slips"],
    }


@router.post("/api/gd/report")
async def gd_report(body: ReportRequest, request: Request) -> dict[str, Any]:
    """The assessor's view of the learner: counts anyone could make, and (with the model) a scored assessment."""
    topic = gd.clean_topic(body.topic_id)
    turns = gd.clean_turns(body.turns)
    if not any(t["you"] for t in turns):
        raise HTTPException(status_code=400, detail="You didn't say anything in this discussion yet.")
    checks, stats = gd.report_checks(turns)
    rubric, source = None, None
    coach = get_coach()
    if coach.enabled:
        coach_rate_limiter.check(client_key(request))
        prompt = gd.REPORT_PROMPT.format(user=body.user_name or "Candidate")
        rubric, source = await coach.generate(
            "gd_report", prompt, gd.report_facts(topic, turns, body.user_name, stats), gd.parse_report, lambda: None, cache=False
        )
        if rubric is None:
            source = None
    return {"topic": {"id": topic["id"], "title": topic["title"]}, "checks": checks, "stats": stats, "rubric": rubric,
            "rubric_source": source}
