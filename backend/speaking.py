"""
Free speaking: answering a question in your own words, the way an interview or the IELTS
speaking test works, instead of reading a sentence aloud.

The transcript becomes the target (there is nothing else to compare against), so this
reports delivery (pace, long pauses, filler words) and only the sound slips the scorer is
sure about. Everything here is plain functions over a transcription.
"""

from __future__ import annotations

import re
from typing import Any

# Pauses longer than this (seconds, between words) are reported.
LONG_PAUSE = 1.0
FILLERS = ("um", "uh", "erm", "er", "ah", "hmm", "mm")
_FILLER_RE = re.compile(r"\b(" + "|".join(FILLERS) + r"|u+m+|u+h+|e+r+m+|h+m+)\b", re.IGNORECASE)
# A disfluent prompt nudges Whisper to write the "um"s and "uh"s it otherwise cleans up.
# It says nothing about what the learner will say, so it does not bias the words.
FILLER_PROMPT = "Umm, let me think, uh... So, um, I mean, uh, it's like, hmm, you know."

PROMPTS: list[dict[str, Any]] = [
    # Job interviews
    {"id": "int-about", "kind": "interview", "title": "Tell me about yourself.", "hint": "Your background, what you do now, and why this role."},
    {"id": "int-strength", "kind": "interview", "title": "What is your greatest strength?", "hint": "Name one strength and give a real example."},
    {"id": "int-weakness", "kind": "interview", "title": "What is a weakness you are working on?", "hint": "Be honest, and say what you are doing about it."},
    {"id": "int-challenge", "kind": "interview", "title": "Describe a challenge at work and how you handled it.", "hint": "Situation, what you did, and the result."},
    {"id": "int-why", "kind": "interview", "title": "Why do you want to work here?", "hint": "What you know about the company and what you would bring."},
    {"id": "int-five", "kind": "interview", "title": "Where do you see yourself in five years?", "hint": "A realistic goal and how this job fits it."},
    {"id": "int-team", "kind": "interview", "title": "Tell me about a time you worked in a team.", "hint": "Your role, a difficulty, and what the team achieved."},
    {"id": "int-questions", "kind": "interview", "title": "Do you have any questions for us?", "hint": "Ask two thoughtful questions about the role or team."},
    # IELTS Speaking Part 2 style cue cards (one minute to prepare, then up to two minutes)
    {"id": "ielts-person", "kind": "ielts", "title": "Describe a person who has influenced you.",
     "points": ["who this person is", "how you know them", "what they have done", "and explain why they influenced you"]},
    {"id": "ielts-place", "kind": "ielts", "title": "Describe a place you would like to visit.",
     "points": ["where it is", "how you know about it", "what you would do there", "and explain why you want to go"]},
    {"id": "ielts-skill", "kind": "ielts", "title": "Describe a skill you learned that was difficult.",
     "points": ["what the skill is", "when and how you learned it", "what made it difficult", "and explain how you feel about it now"]},
    {"id": "ielts-event", "kind": "ielts", "title": "Describe a celebration you enjoyed.",
     "points": ["what it was", "where and when it happened", "who was there", "and explain why you enjoyed it"]},
    {"id": "ielts-book", "kind": "ielts", "title": "Describe a book or film that made you think.",
     "points": ["what it was", "what it was about", "when you read or watched it", "and explain why it made you think"]},
    {"id": "ielts-decision", "kind": "ielts", "title": "Describe an important decision you made.",
     "points": ["what the decision was", "when you made it", "how you decided", "and explain whether it was the right choice"]},
    # Everyday situations
    {"id": "day-intro", "kind": "everyday", "title": "Introduce yourself to a new colleague.", "hint": "Name, role, how long you have been here, one thing you enjoy."},
    {"id": "day-phone", "kind": "everyday", "title": "Call a shop to ask whether an order has arrived.", "hint": "Greet, give your order details, ask, and close politely."},
    {"id": "day-meeting", "kind": "everyday", "title": "Give a short update in a team meeting.", "hint": "What you finished, what you are doing next, any blockers."},
    {"id": "day-directions", "kind": "everyday", "title": "Explain the way from your home to the nearest station.", "hint": "Landmarks, turns and how long it takes."},
    {"id": "day-complaint", "kind": "everyday", "title": "Politely complain about a late delivery.", "hint": "What happened, what you expected, and what you would like now."},
    {"id": "day-weekend", "kind": "everyday", "title": "Tell a friend about your weekend.", "hint": "Where you went, who you met and the best moment."},
]
KINDS = {
    "interview": {"label": "Job interview", "prep_seconds": 0},
    "ielts": {"label": "IELTS cue card", "prep_seconds": 60},
    "everyday": {"label": "Everyday situations", "prep_seconds": 0},
}


def prompt_by_id(prompt_id: str | None) -> dict[str, Any] | None:
    return next((p for p in PROMPTS if p["id"] == prompt_id), None)


def count_fillers(text: str) -> dict[str, Any]:
    """Filler words in a transcript: how many, and which."""
    found = [m.group(0).lower() for m in _FILLER_RE.finditer(text or "")]
    return {"count": len(found), "words": sorted(set(found))}


def strip_fillers(text: str) -> str:
    """The transcript without fillers, so "um" is never scored as a word."""
    stripped = re.sub(_FILLER_RE.pattern + r"[,.!?]?\s*", "", text or "", flags=re.IGNORECASE)
    return re.sub(r"\s{2,}", " ", stripped).strip(" ,")


def pauses(words: list[dict[str, Any]], longer_than: float = LONG_PAUSE) -> list[float]:
    """Gaps between consecutive words longer than `longer_than` seconds."""
    out = []
    for previous, current in zip(words, words[1:], strict=False):
        if previous.get("end") is None or current.get("start") is None:
            continue
        gap = float(current["start"]) - float(previous["end"])
        if gap > longer_than:
            out.append(round(gap, 2))
    return out


def delivery(words: list[dict[str, Any]], text: str) -> dict[str, Any]:
    """Pace, long pauses and filler words for a free answer."""
    timed = [w for w in words if w.get("start") is not None and w.get("end") is not None]
    spoken = [w for w in timed if not _FILLER_RE.fullmatch(str(w.get("word", "")).strip(" ,.!?").lower())]
    wpm = None
    if len(spoken) >= 3:
        span = float(timed[-1]["end"]) - float(timed[0]["start"])
        wpm = round(len(spoken) / span * 60) if span > 0 else None
    gaps = pauses(timed)
    return {
        "wpm": wpm,
        "words": len(spoken),
        "duration": round(float(timed[-1]["end"]) - float(timed[0]["start"]), 1) if timed else None,
        "long_pauses": len(gaps),
        "pause_lengths": gaps,
        "longest_pause": max(gaps) if gaps else None,
        "fillers": count_fillers(text),
    }
