"""
The learning journey: where the learner is, what comes next, and what keeps them coming back.

Everything here is computed from data the app already stores (attempts and the per-sound
observations), as plain functions with no database or model, so it can be tested directly.

    goal      today's attempts against a daily target
    xp        points for every attempt, a level that rises as they add up
    badges    milestones: first attempt, streaks, high scores, sounds mastered
    path      an ordered route through the sounds learners find hardest, with a current unit
    review    words that keep going wrong and have not been seen for a while
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Sequence

from backend import teaching
from backend.phoneme_kb import get_phoneme

GOALS = (3, 5, 10)
DEFAULT_GOAL = 5
XP_BASE = 10  # for turning up
XP_PER_TEN_POINTS = 1  # and a little more for a good score: 10 to 20 per attempt
LEVEL_UNIT = 60  # xp for level 2 is 60, level 3 is 240, level 4 is 540, ...

# The order learners usually need the sounds, hardest-to-avoid first. Anything the library
# has that is not listed follows, by its own difficulty rating.
PATH_ORDER = ["θ", "ð", "r", "l", "v", "w", "ʃ", "tʃ", "dʒ", "ŋ", "z", "s", "ɪ", "i", "æ", "ʌ", "ɛ", "ɑ", "ʊ", "u", "ə"]

REVIEW_MIN_MISSES = 2
REVIEW_MIN_SLIP_RATE = 0.25
REVIEW_WAIT = timedelta(hours=12)
REVIEW_LIMIT = 8


# --- points and levels -------------------------------------------------------------------------


def attempt_xp(score: float) -> int:
    return XP_BASE + int(max(0.0, min(100.0, score)) // 10) * XP_PER_TEN_POINTS


def level_for(xp: int) -> dict[str, Any]:
    """Level, and how far through it: level n needs LEVEL_UNIT * (n - 1)^2 points in total."""
    xp = max(0, int(xp))
    level = int(math.sqrt(xp / LEVEL_UNIT)) + 1
    floor = LEVEL_UNIT * (level - 1) ** 2
    ceiling = LEVEL_UNIT * level**2
    return {
        "level": level,
        "xp": xp,
        "level_floor": floor,
        "next_level_at": ceiling,
        "progress": round((xp - floor) / (ceiling - floor), 3),
    }


# --- the daily goal -----------------------------------------------------------------------------


def clean_goal(value: int | None) -> int:
    return value if value in GOALS else DEFAULT_GOAL


def goal_status(today_count: int, goal: int) -> dict[str, Any]:
    return {"target": goal, "done": today_count, "met": today_count >= goal, "progress": round(min(1.0, today_count / goal), 3)}


# --- badges ------------------------------------------------------------------------------------

BADGES: list[dict[str, Any]] = [
    {"id": "first_try", "title": "First words", "text": "Make your first attempt", "icon": "microphone", "metric": "attempts", "need": 1},
    {"id": "ten_tries", "title": "Getting going", "text": "Make 10 attempts", "icon": "rocket", "metric": "attempts", "need": 10},
    {"id": "fifty_tries", "title": "Regular", "text": "Make 50 attempts", "icon": "medal", "metric": "attempts", "need": 50},
    {"id": "hundred_tries", "title": "Dedicated", "text": "Make 100 attempts", "icon": "trophy", "metric": "attempts", "need": 100},
    {"id": "score_80", "title": "Clear speaker", "text": "Score 80 or more", "icon": "star", "metric": "best_score", "need": 80},
    {"id": "score_90", "title": "Nearly native", "text": "Score 90 or more", "icon": "sparkle", "metric": "best_score", "need": 90},
    {"id": "streak_3", "title": "Three days running", "text": "Practise 3 days in a row", "icon": "fire", "metric": "streak", "need": 3},
    {"id": "streak_7", "title": "A full week", "text": "Practise 7 days in a row", "icon": "fire", "metric": "streak", "need": 7},
    {"id": "streak_30", "title": "A habit", "text": "Practise 30 days in a row", "icon": "crown", "metric": "streak", "need": 30},
    {"id": "first_sound", "title": "First sound mastered", "text": "Get one sound solid", "icon": "check", "metric": "sounds_mastered", "need": 1},
    {"id": "five_sounds", "title": "Five sounds down", "text": "Get five sounds solid", "icon": "check", "metric": "sounds_mastered", "need": 5},
    {"id": "goal_week", "title": "Goal getter", "text": "Meet your daily goal on 5 days", "icon": "target", "metric": "goal_days", "need": 5},
]


def badges_for(stats: dict[str, float]) -> list[dict[str, Any]]:
    out = []
    for badge in BADGES:
        have = float(stats.get(badge["metric"], 0))
        need = badge["need"]
        out.append({
            "id": badge["id"],
            "title": badge["title"],
            "text": badge["text"],
            "icon": badge["icon"],
            "earned": have >= need,
            "have": round(min(have, need), 1) if isinstance(have, float) and have % 1 else int(min(have, need)),
            "need": need,
        })
    return out


# --- the path ------------------------------------------------------------------------------------


def _path_symbols() -> list[str]:
    from backend.phoneme_kb import PHONEMES

    listed = [s for s in PATH_ORDER if s in PHONEMES]
    rest = sorted((s for s in PHONEMES if s not in listed), key=lambda s: (PHONEMES[s].get("difficulty", 1), s), reverse=True)
    return [*listed, *rest]


def build_path(stats: Sequence[teaching.SoundStat]) -> dict[str, Any]:
    """Units in teaching order. The current unit is the first one not yet mastered."""
    by_sound = {s.phoneme: s for s in stats}
    units: list[dict[str, Any]] = []
    current: str | None = None
    for symbol in _path_symbols():
        entry = get_phoneme(symbol) or {}
        stat = by_sound.get(symbol)
        if stat and stat.status == "solid":
            status = "mastered"
        elif stat and stat.attempts >= teaching.MIN_ATTEMPTS:
            status = "practising"
        elif stat:
            status = "started"
        else:
            status = "new"
        if current is None and status != "mastered":
            current = symbol
        units.append({
            "phoneme": symbol,
            "label": entry.get("label", symbol),
            "name": entry.get("name", ""),
            "example": (entry.get("examples") or [""])[0],
            "status": status,
            "clean_rate": round(stat.clean_rate, 3) if stat else None,
            "attempts": stat.attempts if stat else 0,
        })
    mastered = sum(1 for u in units if u["status"] == "mastered")
    return {"units": units, "current": current, "mastered": mastered, "total": len(units)}


# --- review ---------------------------------------------------------------------------------------


def review_queue(rows: Iterable[tuple[str, bool, Any, str, Any]], now: datetime | None = None) -> list[dict[str, Any]]:
    """Words that keep going wrong and have not been seen for a while, most missed first."""
    now = now or datetime.now(timezone.utc)
    seen: dict[str, dict[str, Any]] = defaultdict(lambda: {"tries": 0, "misses": 0, "last": None})
    for _phoneme, ok, _score, word, created in rows:
        if not word:
            continue
        item = seen[word.lower()]
        item["tries"] += 1
        item["misses"] += 0 if ok else 1
        if created is not None and (item["last"] is None or created > item["last"]):
            item["last"] = created
    due = []
    for word, item in seen.items():
        if item["misses"] < REVIEW_MIN_MISSES or item["misses"] / item["tries"] < REVIEW_MIN_SLIP_RATE:
            continue
        last = item["last"]
        if last is not None:
            stamp = last if last.tzinfo else last.replace(tzinfo=timezone.utc)
            if now - stamp < REVIEW_WAIT:
                continue  # seen very recently: let it rest
        due.append({"word": word, "misses": item["misses"], "tries": item["tries"]})
    due.sort(key=lambda d: (-d["misses"], d["word"]))
    return due[:REVIEW_LIMIT]


# --- the check-up --------------------------------------------------------------------------------

PLACEMENT: list[dict[str, Any]] = [
    {"text": "Think about the thin path.", "sounds": ["θ", "ɪ"]},
    {"text": "My brother wears that red jacket.", "sounds": ["ð", "r", "dʒ"]},
    {"text": "The very lovely river fell slowly.", "sounds": ["v", "l", "r"]},
    {"text": "She sells fresh fish by the sea shore.", "sounds": ["ʃ", "s"]},
    {"text": "We walked with a wonderful young man.", "sounds": ["w", "ŋ"]},
    {"text": "The cheap chair is a huge change.", "sounds": ["tʃ", "dʒ"]},
]


def suggested_level(average_score: float) -> str:
    if average_score < 60:
        return "beginner"
    if average_score < 80:
        return "intermediate"
    return "advanced"
