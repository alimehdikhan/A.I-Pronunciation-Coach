"""
Data access for users, attempts and progress analytics.

Analytics are computed with SQL aggregates instead of loading every attempt,
so they stay fast for users with thousands of sessions.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

from sqlalchemy import case, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from backend import contributions
from backend.database import (
    BaselineRecording,
    Dispute,
    InterviewSession,
    ListenerAnswer,
    ListenerClip,
    PasswordReset,
    PerceptionTrial,
    PhonemeMistake,
    PhonemeObservation,
    ProgressClip,
    PronunciationRecord,
    Share,
    ShareComment,
    User,
    UserKey,
    as_utc,
    utcnow,
)
from backend.phoneme_kb import get_phoneme
from backend.security import hash_profile_key, profile_key_matches

METRICS = ("pronunciation", "fluency", "completeness", "clarity")
# Attempts that count toward mastery, streaks and goals (careful speech under "natural speed" does not).
COUNTED = or_(PronunciationRecord.counted.is_(None), PronunciationRecord.counted.is_(True))
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
    # What this learner heard in other people's recordings goes with the account.
    db.execute(delete(ListenerAnswer).where(ListenerAnswer.listener_id == user.id))
    db.execute(delete(UserKey).where(UserKey.user_id == user.id))
    db.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
    db.delete(user)
    db.commit()


def find_or_create_user(db: Session, username: str, key: str | None) -> User:
    """The learner with this name, claimed by this browser if new; raises ProfileLocked if it isn't theirs."""
    user = find_user(db, username)
    if user is None:
        user = User(username=username, key_hash=hash_profile_key(key) if key else None)
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            user = find_user(db, username)
            authorize(db, user, key)
        return user
    authorize(db, user, key)
    return user


def learner_profile(user: User | None) -> dict[str, Any]:
    from backend import learners

    return {
        "first_language": user.first_language if user else None,
        "goal": learners.clean_goal(user.goal if user else None),
        "tip_language": learners.clean_tip_language(user.tip_language if user else None),
    }


def save_attempt(
    db: Session,
    username: str,
    key: str | None,
    reference_text: str,
    transcription: str,
    result: dict[str, Any],
    counted: bool = True,
    clip_id: str | None = None,
) -> int:
    """Persist an evaluated attempt and its phoneme mistakes; returns the record id.

    `clip_id` names the recording kept to improve the scorer (backend.contributions), if any.
    """
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
        wpm=(result.get("speech") or {}).get("wpm"),
        counted=counted,
        clip_id=clip_id,
    )
    for word in result.get("words", []):
        if word.get("status") != "mispronounced":
            continue
        for op in word.get("alignment", []):
            # Mistakes are the slips the learner should fix; borderline ("check") ones are only observations.
            if op["op"] in ("replace", "delete") and op["expected"] and op.get("tier") != "check":
                record.mistakes.append(
                    PhonemeMistake(word=word["reference"], expected_phoneme=op["expected"], actual_phoneme=op["actual"] or "")
                )
    for word in result.get("words", []):
        if not word.get("reference") or word.get("status") in ("missing", "extra"):
            continue
        detailed = word.get("phonemes")
        if detailed:
            for sound in detailed:
                tier = sound.get("tier")
                record.observations.append(
                    PhonemeObservation(
                        phoneme=sound["phoneme"],
                        word=word["reference"],
                        ok=not sound.get("flagged") or tier == "check",
                        score=sound.get("score"),
                        tier=tier,
                    )
                )
        else:
            for op in word.get("alignment", []):
                if op["op"] == "insert" or not op["expected"]:
                    continue
                record.observations.append(
                    PhonemeObservation(
                        phoneme=op["expected"], word=word["reference"], ok=op["op"] == "equal", tier=op.get("tier")
                    )
                )
    db.add(record)
    db.commit()
    return record.id


class RecordNotFound(Exception):
    """No attempt with that id belongs to this learner."""


def resolve_checks(db: Session, user: User, record_id: int, word: str, verdicts: dict[str, tuple[str, str]]) -> int:
    """Replace an attempt's borderline ("check") sounds in `word` with what saying the word alone showed.

    `verdicts` maps a sound to (verdict, what it sounded like): "slip" makes the observation a
    miss (tier "slip") and records the mistake; "fine" clears it (tier "fine"); anything else
    leaves it as it was. Returns how many observations changed.
    """
    record = db.scalar(select(PronunciationRecord).where(PronunciationRecord.id == record_id, PronunciationRecord.user_id == user.id))
    if record is None:
        raise RecordNotFound()
    rows = db.scalars(
        select(PhonemeObservation).where(
            PhonemeObservation.record_id == record.id,
            func.lower(PhonemeObservation.word) == word.lower(),
            PhonemeObservation.tier == "check",
            PhonemeObservation.phoneme.in_(list(verdicts)),
        )
    ).all()
    changed = 0
    for row in rows:
        verdict, sounded_like = verdicts[row.phoneme]
        if verdict == "slip":
            row.ok, row.tier = False, "slip"
            record.mistakes.append(PhonemeMistake(word=row.word or word, expected_phoneme=row.phoneme, actual_phoneme=sounded_like))
        elif verdict == "fine":
            row.ok, row.tier = True, "fine"
        else:
            continue
        changed += 1
    db.commit()
    return changed


def save_dispute(
    db: Session,
    user: User,
    record_id: int,
    word: str,
    expected: str,
    detected: str,
    gop: float | None,
    reason: str | None,
) -> Dispute:
    """Store (or update) a learner's dispute of one flagged sound in their own attempt.

    The tier and score come from what was saved with the attempt, not from the client.
    """
    record = db.scalar(select(PronunciationRecord).where(PronunciationRecord.id == record_id, PronunciationRecord.user_id == user.id))
    if record is None:
        raise RecordNotFound()
    saved = db.scalar(
        select(PhonemeObservation).where(
            PhonemeObservation.record_id == record.id,
            func.lower(PhonemeObservation.word) == word.lower(),
            PhonemeObservation.phoneme == expected,
        ).order_by(PhonemeObservation.ok, PhonemeObservation.id)
    )
    if saved is None:
        raise RecordNotFound()
    dispute = db.scalar(
        select(Dispute).where(Dispute.record_id == record.id, Dispute.word == saved.word, Dispute.expected_phoneme == expected)
    )
    if dispute is None:
        dispute = Dispute(record_id=record.id, user_id=user.id, word=saved.word or word, expected_phoneme=expected)
        db.add(dispute)
    dispute.detected_phoneme = detected
    dispute.gop = gop
    dispute.score = saved.score
    dispute.tier = saved.tier or ("fix" if not saved.ok else None)
    dispute.reason = reason
    db.commit()
    return dispute


def dispute_rows(db: Session) -> list[dict[str, Any]]:
    """Every dispute with its attempt's sentence, oldest first (for the CSV export). No names."""
    rows = db.execute(
        select(Dispute, PronunciationRecord.target_text)
        .join(PronunciationRecord, Dispute.record_id == PronunciationRecord.id)
        .order_by(Dispute.created_at, Dispute.id)
    ).all()
    return [
        {
            "dispute_id": d.id,
            "attempt_id": d.record_id,
            "created_at": as_utc(d.created_at).isoformat() if d.created_at else "",
            "sentence": text,
            "word": d.word,
            "expected": d.expected_phoneme,
            "detected": d.detected_phoneme,
            "gop": d.gop,
            "score": d.score,
            "tier": d.tier,
            "reason": d.reason or "",
        }
        for d, text in rows
    ]


def baseline_rows(db: Session, user: User) -> list[BaselineRecording]:
    return list(db.scalars(select(BaselineRecording).where(BaselineRecording.user_id == user.id)))


def save_baseline(
    db: Session, user: User, round_number: int, sentence_index: int, result: dict[str, Any], audio: bytes, audio_type: str
) -> BaselineRecording:
    """Store (or replace) one sentence of a round, with its audio (the caller has the learner's consent)."""
    row = db.scalar(
        select(BaselineRecording).where(
            BaselineRecording.user_id == user.id,
            BaselineRecording.round == round_number,
            BaselineRecording.sentence_index == sentence_index,
        )
    )
    if row is None:
        row = BaselineRecording(user_id=user.id, round=round_number, sentence_index=sentence_index)
        db.add(row)
    row.score = result.get("score")
    row.pronunciation = (result.get("metrics") or {}).get("pronunciation")
    row.audio, row.audio_type, row.consent_at, row.created_at = audio, audio_type, utcnow(), utcnow()
    db.commit()
    return row


def delete_baseline_audio(db: Session, user: User) -> int:
    """Remove every stored recording's audio; the scores stay."""
    count = db.execute(
        update(BaselineRecording)
        .where(BaselineRecording.user_id == user.id, BaselineRecording.audio.is_not(None))
        .values(audio=None, audio_type=None)
        .execution_options(synchronize_session=False)
    ).rowcount
    db.commit()
    return int(count or 0)


# --- Mock interviews (text only) --------------------------------------------------


def create_interview(
    db: Session,
    user: User,
    kind: str,
    role: str,
    level: str,
    questions: list[Any],
    keep: int,
    context: dict[str, str] | None = None,
) -> InterviewSession:
    """Start a saved interview; only the newest `keep` interviews are kept.

    `questions` holds bank question ids, or whole questions worded for this candidate (for their job, or
    from their CV). `context` is the company and job title they gave, if any.
    """
    row = InterviewSession(
        user_id=user.id, interview_type=kind, role=role, level=level,
        questions=json.dumps(questions, ensure_ascii=False), answers="{}",
        context=json.dumps(context, ensure_ascii=False) if context else None,
    )
    db.add(row)
    db.flush()
    stale = select(InterviewSession.id).where(InterviewSession.user_id == user.id).order_by(
        InterviewSession.created_at.desc(), InterviewSession.id.desc()
    ).offset(keep)
    db.execute(delete(InterviewSession).where(InterviewSession.id.in_(stale)).execution_options(synchronize_session=False))
    db.commit()
    return row


def interview_rows(db: Session, user: User, limit: int = 20) -> list[InterviewSession]:
    """The learner's interviews, newest first."""
    return list(
        db.scalars(
            select(InterviewSession)
            .where(InterviewSession.user_id == user.id)
            .order_by(InterviewSession.created_at.desc(), InterviewSession.id.desc())
            .limit(limit)
        )
    )


def find_interview(db: Session, user: User, session_id: int) -> InterviewSession | None:
    return db.scalar(select(InterviewSession).where(InterviewSession.id == session_id, InterviewSession.user_id == user.id))


def save_interview_answer(db: Session, row: InterviewSession, index: int, answer: dict[str, Any]) -> None:
    """Store (or replace) the answer to question `index`.

    `row` was read before the answer was scored, which takes a while; another answer to the same
    interview may have been saved since. Re-read it first so that answer isn't overwritten.
    """
    db.refresh(row)
    answers = json.loads(row.answers or "{}")
    answers[str(index)] = answer
    row.answers = json.dumps(answers, ensure_ascii=False)
    row.updated_at = utcnow()
    db.commit()


def delete_interview(db: Session, user: User, session_id: int) -> bool:
    count = db.execute(
        delete(InterviewSession)
        .where(InterviewSession.id == session_id, InterviewSession.user_id == user.id)
        .execution_options(synchronize_session=False)
    ).rowcount
    db.commit()
    return bool(count)


def save_perception(db: Session, user: User, trials: list[dict[str, Any]]) -> None:
    """Store listening-drill answers (correctness decided here, not by the client)."""
    for t in trials:
        db.add(PerceptionTrial(
            user_id=user.id, phoneme=t["phoneme"], other=t["other"], word=t["word"], chosen=t["chosen"],
            correct=t["word"] == t["chosen"], voice=t.get("voice"),
        ))
    db.commit()


PERCEPTION_RECENT = 200  # answers per learner that count; old ones fade out as the ear improves


def perception_stats(db: Session, user: User) -> list[dict[str, Any]]:
    """Share of listening trials heard right, per contrast, over the latest answers; weakest first."""
    recent = (
        select(PerceptionTrial.phoneme, PerceptionTrial.other, PerceptionTrial.correct)
        .where(PerceptionTrial.user_id == user.id)
        .order_by(PerceptionTrial.created_at.desc(), PerceptionTrial.id.desc())
        .limit(PERCEPTION_RECENT)
        .subquery()
    )
    rows = db.execute(
        select(recent.c.phoneme, recent.c.other, func.count(), func.sum(case((recent.c.correct, 1), else_=0)))
        .group_by(recent.c.phoneme, recent.c.other)
    ).all()
    stats = [
        {"phoneme": p, "other": o, "trials": int(n), "correct": int(c or 0), "accuracy": round(int(c or 0) / int(n), 3)}
        for p, o, n, c in rows
    ]
    return sorted(stats, key=lambda s: (s["accuracy"], -s["trials"]))


def mistake_pairs(db: Session, user: User, limit: int = 300) -> list[tuple[str, str]]:
    """(expected, heard) for the learner's latest "Fix this" slips: what each sound turned into."""
    rows = db.execute(
        select(PhonemeMistake.expected_phoneme, PhonemeMistake.actual_phoneme)
        .join(PronunciationRecord, PhonemeMistake.record_id == PronunciationRecord.id)
        .where(PronunciationRecord.user_id == user.id)
        .order_by(PronunciationRecord.created_at.desc())
        .limit(limit)
    ).all()
    return [(e, a) for e, a in rows if e and a]


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
            .options(selectinload(PronunciationRecord.mistakes), selectinload(PronunciationRecord.comments))
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
    """Delete every attempt (the name stays claimed by its owner), and any recordings given to improve the scorer."""
    record_ids = select(PronunciationRecord.id).where(PronunciationRecord.user_id == user.id)
    count = db.scalar(select(func.count()).select_from(PronunciationRecord).where(PronunciationRecord.user_id == user.id))
    contributions.stop(db, user)
    db.execute(delete(Dispute).where(Dispute.user_id == user.id).execution_options(synchronize_session=False))
    db.execute(delete(BaselineRecording).where(BaselineRecording.user_id == user.id).execution_options(synchronize_session=False))
    db.execute(delete(ShareComment).where(ShareComment.record_id.in_(record_ids)).execution_options(synchronize_session=False))
    db.execute(delete(Share).where(Share.user_id == user.id).execution_options(synchronize_session=False))
    db.execute(delete(PerceptionTrial).where(PerceptionTrial.user_id == user.id).execution_options(synchronize_session=False))
    db.execute(delete(InterviewSession).where(InterviewSession.user_id == user.id).execution_options(synchronize_session=False))
    # Recordings shared with real listeners belong to the attempts, so they go too, with what listeners heard.
    clip_ids = select(ListenerClip.id).where(ListenerClip.user_id == user.id)
    db.execute(delete(ListenerAnswer).where(ListenerAnswer.clip_id.in_(clip_ids)).execution_options(synchronize_session=False))
    db.execute(delete(ListenerClip).where(ListenerClip.user_id == user.id).execution_options(synchronize_session=False))
    db.execute(delete(ProgressClip).where(ProgressClip.user_id == user.id).execution_options(synchronize_session=False))
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
        .where(PronunciationRecord.user_id == user.id, COUNTED)
        .order_by(PronunciationRecord.created_at.desc(), PhonemeObservation.id.desc())
        .limit(limit)
    ).all()
    return [(p, bool(ok), s, w or "", t) for p, ok, s, w, t in rows]


def weakness_rows(db: Session, user: User, limit: int) -> list[tuple[str, int]]:
    count = func.count(PhonemeMistake.id)
    rows = db.execute(
        select(PhonemeMistake.expected_phoneme, count)
        .join(PronunciationRecord, PhonemeMistake.record_id == PronunciationRecord.id)
        .where(PronunciationRecord.user_id == user.id, COUNTED)
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
        stamps = db.scalars(select(created).where(PronunciationRecord.user_id == user_id, COUNTED))
        return sorted({(as_utc(stamp) - offset).date() for stamp in stamps})
    values = db.scalars(select(day).where(PronunciationRecord.user_id == user_id, COUNTED).distinct())
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
        "perception": perception_stats(db, user),
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
