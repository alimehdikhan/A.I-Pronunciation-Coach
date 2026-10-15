"""
The teaching side of the coach: what a learner has mastered, what to work on
next, and a short session built around it.

Everything here is plain functions over observations (one row per sound the
learner attempted: which sound, whether it came out clean, the word) so it can
be tested without a database or a model. The language model only phrases the
result; it never chooses the focus or changes a number (see backend.coach).
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable, Sequence

from backend.phoneme_kb import get_phoneme
from backend.tutor import DEFAULT_FOCUS

# (phoneme, ok, score 0-100 or None, word, created_at); newest first.
Observation = tuple[str, bool, "float | None", str, "datetime | None"]

MIN_ATTEMPTS = 3  # fewer tries than this is not enough to call a sound weak
SOLID_RATE = 0.9
WEAK_RATE = 0.7
RECENT = 6  # how many of the latest tries count as "lately"
TREND_MIN = 8  # tries needed before a trend is reported
TREND_DELTA = 0.15


@dataclass(frozen=True)
class SoundStat:
    phoneme: str
    attempts: int
    clean: int
    clean_rate: float
    avg_score: float | None
    recent_rate: float
    trend: str  # "new" | "improving" | "steady" | "slipping"
    status: str  # "new" | "needs_work" | "getting_there" | "solid"
    last_seen: datetime | None

    def as_dict(self) -> dict[str, Any]:
        entry = get_phoneme(self.phoneme) or {}
        return {
            "phoneme": self.phoneme,
            "label": entry.get("label", ""),
            "name": entry.get("name", ""),
            "attempts": self.attempts,
            "clean": self.clean,
            "clean_rate": round(self.clean_rate, 3),
            "avg_score": None if self.avg_score is None else round(self.avg_score, 1),
            "recent_rate": round(self.recent_rate, 3),
            "trend": self.trend,
            "status": self.status,
            "last_seen": self.last_seen.isoformat() if self.last_seen else None,
        }


def compute_mastery(observations: Iterable[Observation]) -> list[SoundStat]:
    """Per-sound statistics, weakest first."""
    by_sound: dict[str, list[Observation]] = defaultdict(list)
    for obs in observations:  # newest first, so index 0 is the latest try
        by_sound[obs[0]].append(obs)

    stats: list[SoundStat] = []
    for phoneme, rows in by_sound.items():
        attempts = len(rows)
        clean = sum(1 for r in rows if r[1])
        rate = clean / attempts
        scores = [r[2] for r in rows if r[2] is not None]
        recent = rows[:RECENT]
        recent_rate = sum(1 for r in recent if r[1]) / len(recent)

        trend = "new"
        if attempts >= TREND_MIN:
            earlier = rows[RECENT:]
            earlier_rate = sum(1 for r in earlier if r[1]) / len(earlier)
            delta = recent_rate - earlier_rate
            trend = "improving" if delta >= TREND_DELTA else "slipping" if delta <= -TREND_DELTA else "steady"

        if attempts < MIN_ATTEMPTS:
            status = "new"
        elif rate >= SOLID_RATE and attempts >= 5:
            status = "solid"
        elif rate < WEAK_RATE:
            status = "needs_work"
        else:
            status = "getting_there"

        stats.append(
            SoundStat(
                phoneme=phoneme,
                attempts=attempts,
                clean=clean,
                clean_rate=rate,
                avg_score=sum(scores) / len(scores) if scores else None,
                recent_rate=recent_rate,
                trend=trend,
                status=status,
                last_seen=rows[0][4],
            )
        )
    stats.sort(key=lambda s: (s.clean_rate, -s.attempts, s.phoneme))
    return stats


def _priority(stat: SoundStat) -> float:
    """Which weak sound is worth the learner's time first.

    A sound that is often wrong *and* often attempted matters most; one that is
    slipping gets a boost so progress is not lost, and one already improving is
    nudged down so attention goes where it is still needed.
    """
    weight = (1.0 - stat.clean_rate) * min(stat.attempts, 12)
    if stat.trend == "slipping":
        weight += 0.75
    elif stat.trend == "improving":
        weight *= 0.8
    return weight


def choose_focus(stats: Sequence[SoundStat]) -> tuple[str, str]:
    """The sound to work on and why: (phoneme, reason)."""
    known = [s for s in stats if get_phoneme(s.phoneme)]
    candidates = [s for s in known if s.attempts >= MIN_ATTEMPTS and s.clean_rate < SOLID_RATE]
    if candidates:
        best = max(candidates, key=_priority)
        return best.phoneme, "history"
    if known and all(s.status == "solid" for s in known if s.attempts >= MIN_ATTEMPTS):
        weakest = min(known, key=lambda s: s.clean_rate)
        return weakest.phoneme, "maintenance"
    return DEFAULT_FOCUS[0], "starter"


def _words_for(phoneme: str, observations: Sequence[Observation], limit: int = 4) -> tuple[list[str], list[str]]:
    """(your_words, practice_words): the words this sound slipped in, then library words."""
    missed = Counter(word for p, ok, _s, word, _t in observations if p == phoneme and not ok and word)
    yours = [w.lower() for w, _n in missed.most_common(limit)]
    entry = get_phoneme(phoneme) or {}
    library: list[str] = []
    for word in [*entry.get("examples", []), *(pair[0] for pair in entry.get("minimal_pairs", []))]:
        word = word.lower()
        if word not in yours and word not in library:
            library.append(word)
    return yours, library[: max(0, limit - len(yours))]


def _reason_text(stat: SoundStat | None, why: str, phoneme: str) -> str:
    sound = f"/{phoneme}/"
    if why == "starter" or stat is None:
        return f"This is a good place to start: {sound} is one of the sounds learners find hardest, and it shows up in many everyday words."
    if why == "maintenance":
        return f"Your sounds are in good shape. {sound} is the one with the most room left, so a short refresher keeps it sharp."
    pct = round(stat.clean_rate * 100)
    base = f"You said {sound} cleanly {stat.clean} of {stat.attempts} times ({pct}%)"
    if stat.trend == "slipping":
        return f"{base}, and it has slipped lately. Let's get it back."
    if stat.trend == "improving":
        return f"{base}, and it is improving. A bit more focus should lock it in."
    return f"{base}. It is the sound costing you the most right now."


def build_plan(observations: Sequence[Observation], focus_override: str | None = None) -> dict[str, Any]:
    """The coach's assessment and a practice session for the sound that matters most.

    `focus_override` is a sound the learner picked (from the learning path): it replaces the
    coach's own choice, and the session is built around it in the same way.
    """
    stats = compute_mastery(observations)
    by_sound = {s.phoneme: s for s in stats}
    focus, why = choose_focus(stats)
    if focus_override and get_phoneme(focus_override):
        focus, why = focus_override, "chosen"
    entry = get_phoneme(focus) or {}
    stat = by_sound.get(focus)
    label = entry.get("label") or f"/{focus}/"

    yours, library = _words_for(focus, observations)
    practice_words = [*yours, *library]
    sentence = entry.get("practice_sentence", "")
    pairs = [list(pair) for pair in entry.get("minimal_pairs", [])[:4]]

    session: list[dict[str, Any]] = [
        {
            "kind": "learn",
            "title": "Feel the sound",
            "instruction": entry.get("placement", "Listen to the reference and copy the mouth shape."),
            "steps": entry.get("steps", []),
        },
        {
            "kind": "listen",
            "title": "Hear the difference",
            "instruction": "Listen to each pair. The first word has the sound you are working on.",
            "pairs": pairs,
        },
        {
            "kind": "words",
            "title": "Say it in words",
            "instruction": "Say each word. The coach checks that sound only.",
            "words": practice_words,
            "your_words": yours,
        },
        {
            "kind": "sentence",
            "title": "Put it in a sentence",
            "instruction": "Now say the whole sentence at a relaxed pace.",
            "sentence": sentence,
        },
        {
            "kind": "review",
            "title": "How did that go?",
            "instruction": "Your coach compares today with your history.",
        },
    ]

    return {
        "has_history": bool(stats),
        "observations": len(observations),
        "focus": {
            "phoneme": focus,
            "label": label,
            "name": entry.get("name", ""),
            "category": entry.get("category", ""),
            "why": why,
            "reason": f"You chose {label}, so that is what we will practise." if why == "chosen" else _reason_text(stat, why, focus),
            "stats": stat.as_dict() if stat else None,
            "placement": entry.get("placement", ""),
            "steps": entry.get("steps", []),
            "confused_with": entry.get("common_substitutions", []),
            "why_wrong": entry.get("why_wrong", ""),
            "minimal_pairs": pairs,
            "your_words": yours,
            "words": practice_words,
            "sentence": sentence,
        },
        "also_work_on": [
            {**s.as_dict()} for s in stats if s.phoneme != focus and s.status in ("needs_work", "getting_there")
        ][:3],
        "strengths": [s.as_dict() for s in stats if s.status == "solid"][:5],
        "mastery": [s.as_dict() for s in stats][:14],
        "session": session,
    }


def template_briefing(plan: dict[str, Any]) -> str:
    """The coach's opening note when no language model is available."""
    focus = plan["focus"]
    if not plan["has_history"]:
        return (
            f"Welcome. Before I can tailor anything I need to hear you, so we will start with {focus['label']}, "
            "a sound most learners find tricky. Do the short session below and I will remember how it goes."
        )
    strengths = plan["strengths"]
    praise = f"Your {strengths[0].get('label') or strengths[0]['phoneme']} is solid. " if strengths else ""
    return f"{praise}{focus['reason']} Today's session is short and only about that one sound."


def session_outcome(before: float | None, after_clean: int, after_total: int) -> dict[str, Any]:
    """Compare the session's tries with the sound's history (rates are 0-1)."""
    if after_total == 0:
        return {"verdict": "no_data", "rate": None}
    rate = after_clean / after_total
    if before is None:
        verdict = "baseline"
    elif rate >= before + 0.15:
        verdict = "better"
    elif rate <= before - 0.15:
        verdict = "worse"
    else:
        verdict = "same"
    return {"verdict": verdict, "rate": round(rate, 3), "before": None if before is None else round(before, 3)}
