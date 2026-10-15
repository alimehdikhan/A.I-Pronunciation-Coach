"""
Data access for users, attempts and progress analytics.

Analytics are computed with SQL aggregates instead of loading every attempt,
so they stay fast for users with thousands of sessions.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy import case, delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from backend.database import PhonemeMistake, PhonemeObservation, PronunciationRecord, User, UserKey, as_utc, utcnow
from backend.phoneme_kb import get_phoneme
from backend.security import hash_profile_key, profile_key_matches

METRICS = ("pronunciation", "fluency", "completeness", "clarity")
TREND_POINTS = 200


class ProfileLocked(Exception):
    """The name is claimed by another browser (profile key mismatch)."""


def find_user(db: Session, username: str) -> User | None:
    return db.scalar(select(User).where(User.username == username))


def has_device_key(db: Session, user: User, key: str | None) -> bool:
    """True when `key` belongs to a device signed in to this account."""
    if not key:
        return False
    digest = hash_profile_key(key)
    return db.scalar(select(UserKey.id).where(UserKey.user_id == user.id, UserKey.key_hash == digest)) is not None


def authorize(db: Session, user: User, key: str | None) -> None:
    """Check that `key` owns this profile, claiming it if nobody has yet.

    Unclaimed (legacy) profiles stay readable without a key, so older clients
    keep working; the first browser that presents a key takes ownership.
    Accounts (those with a password) are never readable without a matching
    key, and any signed-in device's key matches.
    """
    if user.password_hash is not None:
        if (user.key_hash and profile_key_matches(user.key_hash, key)) or has_device_key(db, user, key):
            return
        raise ProfileLocked()
    if user.key_hash is None:
        if not key:
            return
        claimed = db.execute(
            update(User)
            .where(User.id == user.id, User.key_hash.is_(None))
            .values(key_hash=hash_profile_key(key))
            .execution_options(synchronize_session=False)
        ).rowcount
        db.commit()
        db.refresh(user)
        if claimed:
            return
    if not profile_key_matches(user.key_hash, key) and not has_device_key(db, user, key):
        raise ProfileLocked()


# --- Accounts ---------------------------------------------------------------------


def find_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


def account_for_key(db: Session, key: str | None) -> User | None:
    """The account this device is signed in to, if any."""
    if not key:
        return None
    digest = hash_profile_key(key)
    via_device = db.scalar(
        select(User).join(UserKey, UserKey.user_id == User.id).where(UserKey.key_hash == digest, User.password_hash.is_not(None))
    )
    if via_device is not None:
        return via_device
    # The first account release kept the browser's key in users.key_hash with no
    # device row. Those accounts are still accounts: recognise them and move the
    # key into the device table so they behave like every other account from now on.
    legacy = db.scalar(select(User).where(User.key_hash == digest, User.password_hash.is_not(None)))
    if legacy is not None:
        add_device(db, legacy, key)
        db.commit()
    return legacy


def _unusable_key_hash() -> str:
    """A hash no browser can present: keeps an account from ever being "unclaimed"."""
    import secrets

    return hash_profile_key(secrets.token_urlsafe(32))


def add_device(db: Session, user: User, key: str) -> None:
    """Sign a device in: its key is stored in user_keys and nowhere else."""
    digest = hash_profile_key(key)
    if db.scalar(select(UserKey.id).where(UserKey.key_hash == digest)) is None:
        db.add(UserKey(user_id=user.id, key_hash=digest))
    if user.key_hash == digest or user.key_hash is None:
        user.key_hash = _unusable_key_hash()


def remove_device(db: Session, user: User, key: str) -> None:
    """Sign one device out."""
    digest = hash_profile_key(key)
    db.execute(delete(UserKey).where(UserKey.user_id == user.id, UserKey.key_hash == digest))
    if user.key_hash == digest:
        user.key_hash = _unusable_key_hash()


def drop_other_devices(db: Session, user: User, keep_key: str) -> None:
    """Sign every device out except `keep_key`."""
    digest = hash_profile_key(keep_key)
    db.execute(delete(UserKey).where(UserKey.user_id == user.id, UserKey.key_hash != digest))
    add_device(db, user, keep_key)


def delete_account(db: Session, user: User) -> None:
    delete_history(db, user)
    db.execute(delete(UserKey).where(UserKey.user_id == user.id))
    db.delete(user)
    db.commit()


def save_attempt(
    db: Session, username: str, key: str | None, reference_text: str, transcription: str, result: dict[str, Any]
) -> int:
    """Persist an evaluated attempt and its phoneme mistakes; returns the record id."""
    user = find_user(db, username)
    if user is None:
        user = User(username=username, key_hash=hash_profile_key(key) if key else None)
        db.add(user)
        try:
            db.flush()
        except IntegrityError:
            # Another request created the same user concurrently.
            db.rollback()
            user = find_user(db, username)
            authorize(db, user, key)
    else:
        authorize(db, user, key)

    metrics = result.get("metrics", {})
    record = PronunciationRecord(
        user_id=user.id,
        target_text=reference_text,
        transcribed_text=transcription,
        score=result["score"],
        accuracy=result["accuracy"],
        difficulty=result.get("difficulty", "intermediate"),
        pronunciation=metrics.get("pronunciation"),
        fluency=metrics.get("fluency"),
        completeness=metrics.get("completeness"),
        clarity=metrics.get("clarity"),
    )
    for word in result.get("words", []):
        if word.get("status") != "mispronounced":
            continue
        for op in word.get("alignment", []):
            if op["op"] in ("replace", "delete") and op["expected"]:
                record.mistakes.append(
                    PhonemeMistake(word=word["reference"], expected_phoneme=op["expected"], actual_phoneme=op["actual"] or "")
                )
    for word in result.get("words", []):
        if not word.get("reference") or word.get("status") in ("missing", "extra"):
            continue
        detailed = word.get("phonemes")
        if detailed:
            for sound in detailed:
                record.observations.append(
                    PhonemeObservation(
                        phoneme=sound["phoneme"], word=word["reference"], ok=not sound.get("flagged"), score=sound.get("score")
                    )
                )
        else:
            for op in word.get("alignment", []):
                if op["op"] == "insert" or not op["expected"]:
                    continue
                record.observations.append(
                    PhonemeObservation(phoneme=op["expected"], word=word["reference"], ok=op["op"] == "equal")
                )
    db.add(record)
    db.commit()
    return record.id


def _history_filters(
    user: User, min_score: float | None, max_score: float | None, text: str | None
) -> list[Any]:
    R = PronunciationRecord
    conditions: list[Any] = [R.user_id == user.id]
    if min_score is not None:
        conditions.append(R.score >= min_score)
    if max_score is not None:
        conditions.append(R.score <= max_score)
    if text:
        needle = text.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        if needle:
            conditions.append(func.lower(R.target_text).like(f"%{needle}%", escape="\\"))
    return conditions


def history(
    db: Session,
    user: User,
    limit: int,
    offset: int = 0,
    min_score: float | None = None,
    max_score: float | None = None,
    text: str | None = None,
) -> list[PronunciationRecord]:
    return list(
        db.scalars(
            select(PronunciationRecord)
            .options(selectinload(PronunciationRecord.mistakes))
            .where(*_history_filters(user, min_score, max_score, text))
            .order_by(PronunciationRecord.created_at.desc(), PronunciationRecord.id.desc())
            .offset(offset)
            .limit(limit)
        )
    )


def history_total(
    db: Session, user: User, min_score: float | None = None, max_score: float | None = None, text: str | None = None
) -> int:
    count = db.scalar(
        select(func.count()).select_from(PronunciationRecord).where(*_history_filters(user, min_score, max_score, text))
    )
    return int(count or 0)


def delete_history(db: Session, user: User) -> int:
    """Delete every attempt (the name stays claimed by its owner)."""
    record_ids = select(PronunciationRecord.id).where(PronunciationRecord.user_id == user.id)
    count = db.scalar(select(func.count()).select_from(PronunciationRecord).where(PronunciationRecord.user_id == user.id))
    db.execute(
        delete(PhonemeMistake).where(PhonemeMistake.record_id.in_(record_ids)).execution_options(synchronize_session=False)
    )
    db.execute(
        delete(PhonemeObservation)
        .where(PhonemeObservation.record_id.in_(record_ids))
        .execution_options(synchronize_session=False)
    )
    db.execute(
        delete(PronunciationRecord)
        .where(PronunciationRecord.user_id == user.id)
        .execution_options(synchronize_session=False)
    )
    db.commit()
    return int(count or 0)


def observations(db: Session, user: User, limit: int = 800) -> list[tuple[str, bool, float | None, str, Any]]:
    """The learner's most recent sound attempts, newest first."""
    rows = db.execute(
        select(
            PhonemeObservation.phoneme,
            PhonemeObservation.ok,
            PhonemeObservation.score,
            PhonemeObservation.word,
            PronunciationRecord.created_at,
        )
        .join(PronunciationRecord, PhonemeObservation.record_id == PronunciationRecord.id)
        .where(PronunciationRecord.user_id == user.id)
        .order_by(PronunciationRecord.created_at.desc(), PhonemeObservation.id.desc())
        .limit(limit)
    ).all()
    return [(p, bool(ok), s, w or "", t) for p, ok, s, w, t in rows]


def weakness_rows(db: Session, user: User, limit: int) -> list[tuple[str, int]]:
    count = func.count(PhonemeMistake.id)
    rows = db.execute(
        select(PhonemeMistake.expected_phoneme, count)
        .join(PronunciationRecord, PhonemeMistake.record_id == PronunciationRecord.id)
        .where(PronunciationRecord.user_id == user.id)
        .group_by(PhonemeMistake.expected_phoneme)
        .order_by(count.desc(), PhonemeMistake.expected_phoneme)
        .limit(limit)
    ).all()
    return [(symbol, int(n)) for symbol, n in rows]


def _local_days(db: Session, user_id: int, tz_offset: int) -> list[date]:
    """Distinct calendar days (in the user's timezone) with at least one attempt."""
    created = PronunciationRecord.created_at
    dialect = db.get_bind().dialect.name
    if dialect == "sqlite":
        day = func.date(created, f"{-tz_offset} minutes")
    elif dialect == "postgresql":
        day = func.date(created - func.make_interval(0, 0, 0, 0, 0, tz_offset))
    else:
        offset = timedelta(minutes=tz_offset)
        stamps = db.scalars(select(created).where(PronunciationRecord.user_id == user_id))
        return sorted({(as_utc(stamp) - offset).date() for stamp in stamps})
    values = db.scalars(select(day).where(PronunciationRecord.user_id == user_id).distinct())
    return sorted(value if isinstance(value, date) else date.fromisoformat(value) for value in values if value)


def _streak(days: list[date], today: date) -> int:
    if not days or (today - days[-1]).days > 1:
        return 0
    streak, expected = 0, days[-1]
    for day in reversed(days):
        if day != expected:
            break
        streak += 1
        expected = day - timedelta(days=1)
    return streak


ACTIVITY_DAYS = 84  # twelve weeks
IMPROVEMENT_WINDOW = 10
MASTERY_LISTED = 16
TRICKY_WORDS = 8


def _improvement(db: Session, user: User, total: int) -> dict[str, Any] | None:
    """Average of the first attempts against the latest ones, once there are enough to compare."""
    window = min(IMPROVEMENT_WINDOW, total // 2)
    if window < 3:
        return None
    R = PronunciationRecord
    first = db.scalars(select(R.score).where(R.user_id == user.id).order_by(R.created_at.asc(), R.id.asc()).limit(window)).all()
    recent = db.scalars(select(R.score).where(R.user_id == user.id).order_by(R.created_at.desc(), R.id.desc()).limit(window)).all()
    first_avg = sum(first) / len(first)
    recent_avg = sum(recent) / len(recent)
    return {
        "attempts": window,
        "first_average": round(first_avg, 1),
        "recent_average": round(recent_avg, 1),
        "change": round(recent_avg - first_avg, 1),
    }


def _daily_activity(db: Session, user: User, tz_offset: int, today: date) -> list[dict[str, Any]]:
    """Attempts per local calendar day for the last twelve weeks, oldest first, empty days included."""
    start = today - timedelta(days=ACTIVITY_DAYS - 1)
    cutoff = (utcnow() - timedelta(days=ACTIVITY_DAYS + 2)).replace(tzinfo=None)
    stamps = db.scalars(
        select(PronunciationRecord.created_at).where(
            PronunciationRecord.user_id == user.id, PronunciationRecord.created_at >= cutoff
        )
    ).all()
    offset = timedelta(minutes=tz_offset)
    counts: dict[date, int] = {}
    for stamp in stamps:
        day = (as_utc(stamp) - offset).date()
        if day >= start:
            counts[day] = counts.get(day, 0) + 1
    return [
        {"date": (start + timedelta(days=i)).isoformat(), "count": counts.get(start + timedelta(days=i), 0)}
        for i in range(ACTIVITY_DAYS)
    ]


def _sound_mastery(db: Session, user: User) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(per-sound mastery, the words that went wrong most often), from the attempt-level observations."""
    from collections import Counter

    from backend import teaching

    rows = observations(db, user)
    stats = [s for s in teaching.compute_mastery(rows) if s.attempts >= teaching.MIN_ATTEMPTS]
    stats.sort(key=lambda s: (s.clean_rate, -s.attempts))  # weakest first
    missed = Counter(word.lower() for _p, ok, _s, word, _t in rows if not ok and word)
    tricky = [{"word": word, "misses": count} for word, count in missed.most_common(TRICKY_WORDS) if count >= 2]
    return [s.as_dict() for s in stats[:MASTERY_LISTED]], tricky


def analytics(db: Session, user: User, tz_offset: int) -> dict[str, Any] | None:
    """Aggregated scores, streaks, trend and weaknesses; None when there are no attempts."""
    R = PronunciationRecord
    now = utcnow()
    week_ago = (now - timedelta(days=7)).replace(tzinfo=None)
    total, average, best, *metric_avgs, this_week = db.execute(
        select(
            func.count(R.id),
            func.avg(R.score),
            func.max(R.score),
            *(func.avg(getattr(R, metric)) for metric in METRICS),
            func.coalesce(func.sum(case((R.created_at >= week_ago, 1), else_=0)), 0),
        ).where(R.user_id == user.id)
    ).one()
    if not total:
        return None

    days = _local_days(db, user.id, tz_offset)
    today = (now - timedelta(minutes=tz_offset)).date()

    trend_rows = db.execute(
        select(R.created_at, R.score, *(getattr(R, metric) for metric in METRICS))
        .where(R.user_id == user.id)
        .order_by(R.created_at.desc(), R.id.desc())
        .limit(TREND_POINTS)
    ).all()

    weaknesses = []
    for symbol, count in weakness_rows(db, user, 8):
        entry = get_phoneme(symbol)
        weaknesses.append({
            "phoneme": symbol,
            "count": count,
            "name": entry["name"] if entry else None,
            "label": entry["label"] if entry else None,
        })

    mastery, tricky = _sound_mastery(db, user)
    return {
        "improvement": _improvement(db, user, int(total)),
        "daily_activity": _daily_activity(db, user, tz_offset, today),
        "sound_mastery": mastery,
        "tricky_words": tricky,
        "average_score": round(float(average), 1),
        "best_score": round(float(best), 1),
        "total_practice_sessions": int(total),
        "practice_days": len(days),
        "streak_days": _streak(days, today),
        "sessions_this_week": int(this_week),
        "metric_averages": {
            metric: round(float(value), 1) for metric, value in zip(METRICS, metric_avgs, strict=True) if value is not None
        },
        "score_trend": [
            {"date": as_utc(created).isoformat(), "score": score, **dict(zip(METRICS, values, strict=True))}
            for created, score, *values in reversed(trend_rows)
        ],
        "top_weaknesses": weaknesses,
    }
