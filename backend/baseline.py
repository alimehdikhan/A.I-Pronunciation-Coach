"""
Before and after: five fixed sentences recorded at the start, then again after 14 days and
every 30 days, so learners can hear (not just read) how they have changed.

Audio is stored only with the learner's explicit consent, and they can delete it at any
time; the scores stay. Everything here is plain functions over the saved rounds.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Iterable

SENTENCES = (
    "I think the weather will be better this week.",
    "Very few people visit the village in winter.",
    "She bought fresh vegetables at the market.",
    "Please send the report before Thursday evening.",
    "My job involves a lot of reading and writing.",
)
FIRST_REDO = timedelta(days=14)
THEN_EVERY = timedelta(days=30)
MAX_AUDIO_BYTES = 3 * 1024 * 1024  # a levelled 16 kHz WAV of a sentence is well under 1 MB


def rounds_of(rows: Iterable[Any]) -> list[dict[str, Any]]:
    """Saved recordings grouped into rounds (0 = the baseline), each with its sentences and when it was finished."""
    by_round: dict[int, dict[int, Any]] = {}
    for row in rows:
        by_round.setdefault(row.round, {})[row.sentence_index] = row
    out = []
    for number in sorted(by_round):
        sentences = by_round[number]
        done = len(sentences) == len(SENTENCES)
        scores = [r.score for r in sentences.values() if r.score is not None]
        out.append({
            "round": number,
            "complete": done,
            "finished_at": max(r.created_at for r in sentences.values()) if done else None,
            "average": round(sum(scores) / len(scores), 1) if scores else None,
            "sentences": {
                i: {"id": r.id, "score": r.score, "has_audio": r.audio is not None, "created_at": r.created_at}
                for i, r in sentences.items()
            },
        })
    return out


def next_round(rounds: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    """Which round to record next and whether it is due: (round number, due, due_at)."""
    if not rounds:
        return {"round": 0, "due": True, "due_at": None}
    latest = rounds[-1]
    if not latest["complete"]:
        return {"round": latest["round"], "due": True, "due_at": None}
    wait = FIRST_REDO if latest["round"] == 0 else THEN_EVERY
    due_at = latest["finished_at"] + wait
    return {"round": latest["round"] + 1, "due": now >= due_at, "due_at": due_at}
