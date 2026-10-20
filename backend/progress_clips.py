"""
"Day 1 vs Day 30": the learner answers one interview question today and the same question again
a month later, then hears (and can share a video of) the two side by side.

Each recording is measured the way a free answer is (pace, long pauses, fillers, sure sound slips,
the sound score), so the comparison is in numbers as well as in sound. Plain functions.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

MAX_SECONDS = 60.0
MAX_AUDIO_BYTES = 8 * 1024 * 1024

PROMPTS = [
    {"id": "about", "text": "Tell me about yourself."},
    {"id": "hire", "text": "Why should we hire you?"},
    {"id": "challenge", "text": "Tell me about a challenge you overcame."},
]
PROMPTS_BY_ID = {p["id"]: p for p in PROMPTS}


def measures(analysed: dict[str, Any]) -> dict[str, Any]:
    """What is kept of one recording besides its audio: the numbers that change as you improve."""
    delivery = analysed["delivery"] or {}
    duration = delivery.get("duration") or 0
    fillers = (delivery.get("fillers") or {}).get("count", 0)
    return {
        "wpm": delivery.get("wpm"),
        "duration": duration,
        "words": delivery.get("words", 0),
        "long_pauses": delivery.get("long_pauses", 0),
        "fillers": fillers,
        "fillers_per_minute": round(fillers / max(duration / 60, 0.5), 1) if duration else None,
        "pronunciation": analysed.get("pronunciation"),
        "slips": [{"word": s["word"], "expected": s["expected"], "actual": s["actual"]} for s in analysed.get("slips", [])][:12],
    }


def next_round(rounds: list[dict[str, Any]], now: datetime, every_days: int) -> dict[str, Any]:
    """The next recording: day one if there is none, otherwise one more after `every_days`."""
    if not rounds:
        return {"round": 0, "due": True, "due_at": None}
    last = max(rounds, key=lambda r: r["round"])
    due_at = last["created_at"] + timedelta(days=every_days)
    return {"round": last["round"] + 1, "due": now >= due_at, "due_at": due_at}


def _change(before: float | None, after: float | None, lower_is_better: bool) -> dict[str, Any] | None:
    if before is None or after is None:
        return None
    delta = round(after - before, 1)
    better = delta < 0 if lower_is_better else delta > 0
    return {"before": before, "after": after, "delta": delta, "better": better if delta else None}


# A comfortable pace to understand; getting closer to it counts as better, from either side.
EASY_PACE = 140


def _pace(before: float | None, after: float | None) -> dict[str, Any] | None:
    if before is None or after is None:
        return None
    delta = round(after - before)
    return {"before": before, "after": after, "delta": delta, "better": abs(after - EASY_PACE) < abs(before - EASY_PACE) if delta else None}


def compare(first: dict[str, Any], latest: dict[str, Any]) -> dict[str, Any]:
    """Day one against the latest round, measure by measure."""
    a, b = first["measures"], latest["measures"]
    return {
        "fillers_per_minute": _change(a.get("fillers_per_minute"), b.get("fillers_per_minute"), lower_is_better=True),
        "long_pauses": _change(a.get("long_pauses"), b.get("long_pauses"), lower_is_better=True),
        "slips": _change(len(a.get("slips", [])), len(b.get("slips", [])), lower_is_better=True),
        "pronunciation": _change(a.get("pronunciation"), b.get("pronunciation"), lower_is_better=False),
        "wpm": _pace(a.get("wpm"), b.get("wpm")),
        "duration": _change(a.get("duration"), b.get("duration"), lower_is_better=False),
    }
