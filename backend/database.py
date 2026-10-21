"""
Database configuration, models and API schemas.

SQLite (default, local) and PostgreSQL (e.g. Neon, via NEON_DATABASE_URL) are
supported. Schema changes are additive only: missing columns and indexes are
created at startup and existing data is never rewritten or dropped.
"""

import logging
import os
from datetime import datetime, timezone
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, field_serializer
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    create_engine,
    event,
    inspect,
    text,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

logger = logging.getLogger("pronunciation_coach.database")

# The names a PostgreSQL URL is commonly stored under. NEON_DATABASE_URL is the
# documented one; Neon's own dashboard snippets use DATABASE_URL.
DATABASE_ENV_NAMES = ("NEON_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL", "POSTGRESQL_URL", "POSTGRES_PRISMA_URL")
DEFAULT_SQLITE_URL = "sqlite:///./pronunciation_coach.db"


def _clean_url(value: str) -> str:
    """Accept what people actually paste: quoted, or the whole `psql '...'` command."""
    value = value.strip()
    if value.lower().startswith("psql "):
        value = value[5:].strip()
    value = value.strip("'\"").strip()
    if value.startswith("postgres://"):  # legacy scheme that SQLAlchemy 2 rejects
        value = "postgresql://" + value[len("postgres://"):]
    if value.startswith("postgresql://"):
        # A bare scheme picks whichever driver the installed SQLAlchemy prefers (psycopg 3 from
        # 2.1 on), which is not the one in requirements.txt; name the driver we ship.
        value = "postgresql+psycopg2://" + value[len("postgresql://"):]
    return value


def resolve_database_url(env: "dict[str, str] | os._Environ[str]" = os.environ) -> tuple[str, str]:
    """(url, source): the first PostgreSQL URL found, else any other URL, else local SQLite.

    A SQLite value under one of these names never hides a PostgreSQL URL under
    another, so a platform default cannot silently override a real database.
    """
    found = [(name, _clean_url(env.get(name) or "")) for name in DATABASE_ENV_NAMES]
    found = [(name, url) for name, url in found if url]
    for name, url in found:
        if not url.startswith("sqlite"):
            return url, name
    if found:
        return found[0][1], found[0][0]
    return _clean_url(env.get("PRONUNCIATION_COACH_SQLITE_URL") or "") or DEFAULT_SQLITE_URL, "default"


DATABASE_URL, DATABASE_SOURCE = resolve_database_url()

IS_SQLITE = DATABASE_URL.startswith("sqlite")


def _engine_options() -> dict:
    if IS_SQLITE:
        return {"connect_args": {"check_same_thread": False, "timeout": 15}, "pool_pre_ping": True}
    # Serverless Postgres (Neon) closes idle connections; recycle before it does.
    return {"pool_pre_ping": True, "pool_size": 5, "max_overflow": 10, "pool_recycle": 300, "pool_timeout": 10}


engine = create_engine(DATABASE_URL, **_engine_options())


def _sqlite_pragmas(dbapi_connection, _record) -> None:
    """WAL lets reads proceed during writes; foreign keys keep rows consistent."""
    cursor = dbapi_connection.cursor()
    try:
        if not DATABASE_URL.endswith(":memory:"):
            cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
    finally:
        cursor.close()


if IS_SQLITE:
    event.listen(engine, "connect", _sqlite_pragmas)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)

Base = declarative_base()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    # Accounts have an email and password; guest profiles leave both NULL.
    __table_args__ = (
        Index("ix_users_email", "email", unique=True),
        Index("ix_users_google_sub", "google_sub", unique=True),
    )

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    # SHA-256 of the browser's profile key; NULL until a browser claims the name.
    key_hash = Column(String(64), nullable=True)
    email = Column(String(254), nullable=True)
    # What people see. Unlike `username` (the unique handle history is stored
    # under) it may repeat; NULL means "same as username".
    display_name = Column(String(60), nullable=True)
    # "scrypt$<n>$<salt hex>$<hash hex>"; see backend.security.hash_password. An account made with
    # Google and no password holds backend.oauth.GOOGLE_ONLY, which no password matches.
    password_hash = Column(String(200), nullable=True)
    # The Google account id ("sub") for "Continue with Google"; NULL when it was never used.
    google_sub = Column(String(255), nullable=True)
    # The learner profile (backend.learners): first language from a fixed list, goal
    # ("understood" or "accent") and the language tips are written in.
    first_language = Column(String(30), nullable=True)
    goal = Column(String(12), nullable=True)
    tip_language = Column(String(12), nullable=True)
    # "Help improve Vocaly AI" (backend.contributions): when the learner agreed to give practice
    # recordings, and the random id they are filed under (never the user id). NULL when off.
    contribute_at = Column(DateTime, nullable=True)
    contributor_id = Column(String(32), nullable=True)

    records = relationship("PronunciationRecord", back_populates="user", cascade="all, delete-orphan")
    keys = relationship("UserKey", back_populates="user", cascade="all, delete-orphan")


class UserKey(Base):
    """A signed-in device: the SHA-256 of a browser's profile key, bound to an account.

    Signing in adds a row, signing out deletes it, so one account can be open on
    several devices and each device can leave on its own.
    """

    __tablename__ = "user_keys"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    key_hash = Column(String(64), nullable=False, unique=True, index=True)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User", back_populates="keys")


class PronunciationRecord(Base):
    __tablename__ = "pronunciation_records"
    __table_args__ = (Index("ix_pronunciation_records_user_created", "user_id", "created_at"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    target_text = Column(Text, nullable=False)
    transcribed_text = Column(Text, nullable=False)
    score = Column(Float, nullable=False)
    accuracy = Column(Float, nullable=False)
    difficulty = Column(String, default="Intermediate")
    # Added in v2; nullable so rows written by v1 stay valid.
    pronunciation = Column(Float, nullable=True)
    fluency = Column(Float, nullable=True)
    completeness = Column(Float, nullable=True)
    clarity = Column(Float, nullable=True)
    # Speaking rate, and whether the attempt counts toward mastery, streaks and goals. With
    # "natural speed" on, careful (slow) speech is saved with counted=False. NULL = counted.
    wpm = Column(Float, nullable=True)
    counted = Column(Boolean, nullable=True)
    # The recording given to improve the scorer (backend.contributions), if this attempt's was kept.
    clip_id = Column(String(32), nullable=True)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User", back_populates="records")
    mistakes = relationship("PhonemeMistake", back_populates="record", cascade="all, delete-orphan")
    observations = relationship("PhonemeObservation", back_populates="record", cascade="all, delete-orphan")
    comments = relationship("ShareComment", back_populates="record", cascade="all, delete-orphan", order_by="ShareComment.id")


class PhonemeMistake(Base):
    __tablename__ = "phoneme_mistakes"
    __table_args__ = (Index("ix_phoneme_mistakes_record", "record_id"),)

    id = Column(Integer, primary_key=True, index=True)
    record_id = Column(Integer, ForeignKey("pronunciation_records.id"))
    word = Column(String, nullable=False)
    expected_phoneme = Column(String, nullable=False)
    actual_phoneme = Column(String, nullable=False)

    record = relationship("PronunciationRecord", back_populates="mistakes")


class PhonemeObservation(Base):
    """One sound the learner attempted in one recording, whether or not it was clean.

    PhonemeMistake only keeps the slips, which is not enough to say how often a
    sound goes right. These rows give the coach a clean-rate per sound.
    """

    __tablename__ = "phoneme_observations"
    __table_args__ = (Index("ix_phoneme_observations_record", "record_id"),)

    id = Column(Integer, primary_key=True, index=True)
    record_id = Column(Integer, ForeignKey("pronunciation_records.id"), nullable=False)
    phoneme = Column(String(8), nullable=False, index=True)
    word = Column(String, nullable=True)
    ok = Column(Boolean, nullable=False)
    # Probability (0-100) the sound would be rated clean; NULL without acoustic scoring.
    score = Column(Float, nullable=True)
    # "fix" or "check" for a flagged sound (see backend.pronunciation.PHONEME_FIX), NULL when
    # clean or saved before tiers. A "check" sound is stored with ok=True: borderline slips
    # don't count against mastery.
    tier = Column(String(8), nullable=True)

    record = relationship("PronunciationRecord", back_populates="observations")


class PerceptionTrial(Base):
    """One listening-drill answer: which word of a minimal pair was played, and what the learner picked."""

    __tablename__ = "perception_trials"
    __table_args__ = (Index("ix_perception_trials_user_created", "user_id", "created_at"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    phoneme = Column(String(8), nullable=False)  # the sound being trained
    other = Column(String(8), nullable=False)  # the sound it is confused with
    word = Column(String(40), nullable=False)  # the word that was played
    chosen = Column(String(40), nullable=False)  # the word the learner picked
    correct = Column(Boolean, nullable=False)
    voice = Column(String(24), nullable=True)
    created_at = Column(DateTime, default=utcnow)


class BaselineRecording(Base):
    """One "before and after" sentence: its score and, only with the learner's consent, the audio.

    Round 0 is the baseline; later rounds are the re-recordings. Deleting stored audio clears
    `audio` and keeps the score.
    """

    __tablename__ = "baseline_recordings"
    __table_args__ = (Index("ix_baseline_user_round", "user_id", "round", "sentence_index", unique=True),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    round = Column(Integer, nullable=False)
    sentence_index = Column(Integer, nullable=False)
    score = Column(Float, nullable=True)
    pronunciation = Column(Float, nullable=True)
    audio = Column(LargeBinary, nullable=True)
    audio_type = Column(String(40), nullable=True)
    # When the learner agreed to store this audio (required to store it at all).
    consent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)


class Share(Base):
    """A read-only link to one attempt for a teacher: the audio (stored with consent) and the analysis.

    Only the SHA-256 of the link's token is kept. The link stops working after `expires_at`,
    when the audio is deleted; the teacher's comments stay on the attempt.
    """

    __tablename__ = "shares"

    id = Column(Integer, primary_key=True, index=True)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    record_id = Column(Integer, ForeignKey("pronunciation_records.id"), nullable=False)
    audio = Column(LargeBinary, nullable=True)
    audio_type = Column(String(40), nullable=True)
    snapshot = Column(Text, nullable=False)  # JSON: transcript and analysis, no name
    consent_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    expires_at = Column(DateTime, nullable=False)
    revoked = Column(Boolean, nullable=False, default=False)


class ShareComment(Base):
    """A teacher's text comment, left through a share link; it belongs to the attempt."""

    __tablename__ = "share_comments"
    __table_args__ = (Index("ix_share_comments_record", "record_id"),)

    id = Column(Integer, primary_key=True, index=True)
    share_id = Column(Integer, ForeignKey("shares.id"), nullable=True)
    record_id = Column(Integer, ForeignKey("pronunciation_records.id"), nullable=False)
    author = Column(String(40), nullable=True)
    text = Column(String(1000), nullable=False)
    created_at = Column(DateTime, default=utcnow)

    record = relationship("PronunciationRecord", back_populates="comments")


class PasswordReset(Base):
    """A single-use password reset link: only the SHA-256 of its token is kept."""

    __tablename__ = "password_resets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    created_at = Column(DateTime, default=utcnow)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)


class Dispute(Base):
    """A learner's "I think this is wrong" on one flagged sound, kept for recalibration.

    Only what the scorer reported is stored, never audio.
    """

    __tablename__ = "disputes"
    __table_args__ = (Index("ix_disputes_record_sound", "record_id", "word", "expected_phoneme", unique=True),)

    id = Column(Integer, primary_key=True, index=True)
    record_id = Column(Integer, ForeignKey("pronunciation_records.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    word = Column(String(40), nullable=False)
    expected_phoneme = Column(String(8), nullable=False)
    # What the scorer said it sounded like: a sound, "?" (no English sound) or "" (dropped).
    detected_phoneme = Column(String(8), nullable=False, default="")
    gop = Column(Float, nullable=True)
    # Probability (0-100) the sound would be rated clean, as saved with the attempt.
    score = Column(Float, nullable=True)
    tier = Column(String(8), nullable=True)
    # "said_correctly", "accent_normal" or NULL.
    reason = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=utcnow)


class InterviewSession(Base):
    """One mock interview: the questions asked and, per question, the latest scored answer.

    Text only: the transcript and the feedback, never audio. Deleted with the learner's
    history or account, or one at a time.
    """

    __tablename__ = "interview_sessions"
    __table_args__ = (Index("ix_interview_sessions_user_created", "user_id", "created_at"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # backend.interview.TYPES: "full", "hr", "behavioural", "technical", "phone", "university" or "visa".
    interview_type = Column(String(16), nullable=True)
    role = Column(String(20), nullable=False)
    level = Column(String(10), nullable=False)
    questions = Column(Text, nullable=False)  # JSON: the question ids, in order
    answers = Column(Text, nullable=False, default="{}")  # JSON: {question index: stored answer}
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow)


class ProgressClip(Base):
    """One recording of the "Day 1 vs Day 30" interview answer: round 0 is day one, then one round per month.

    Stored only with consent; the measures (pace, fillers, pauses, sound score) are kept with it so the
    rounds can be compared, and the video of the two is made in the browser, never on the server.
    """

    __tablename__ = "progress_clips"
    __table_args__ = (Index("ix_progress_clips_user_round", "user_id", "round", unique=True),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    round = Column(Integer, nullable=False)
    prompt_id = Column(String(20), nullable=False)
    audio = Column(LargeBinary, nullable=True)
    audio_type = Column(String(40), nullable=True)
    transcript = Column(Text, nullable=False)
    measures = Column(Text, nullable=False)  # JSON: delivery, sound score, slips
    consent_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=utcnow)


class ListenerClip(Base):
    """One practice recording a learner chose to play to other learners (anonymously), for 30 days.

    The audio is stored only with consent and is deleted when the clip expires, is deleted by its
    owner, or is reported. The sentence comes from the saved attempt, never from the client.
    """

    __tablename__ = "listener_clips"
    __table_args__ = (Index("ix_listener_clips_user", "user_id"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    record_id = Column(Integer, ForeignKey("pronunciation_records.id"), nullable=True)
    target_text = Column(String(500), nullable=False)
    audio = Column(LargeBinary, nullable=True)
    audio_type = Column(String(40), nullable=True)
    consent_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    expires_at = Column(DateTime, nullable=False)
    # Reported by a listener: no longer played to anyone.
    hidden = Column(Boolean, nullable=False, default=False)


class ListenerAnswer(Base):
    """What one listener heard in one clip: per word, heard or not (the typed text itself is not shown to the owner)."""

    __tablename__ = "listener_answers"
    __table_args__ = (Index("ix_listener_answers_clip_listener", "clip_id", "listener_id", unique=True),)

    id = Column(Integer, primary_key=True, index=True)
    clip_id = Column(Integer, ForeignKey("listener_clips.id"), nullable=False)
    listener_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    words_total = Column(Integer, nullable=False)
    words_heard = Column(Integer, nullable=False)
    # JSON: [{"word": target word, "heard": bool, "as": what was typed instead or null}]
    words = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utcnow)


class ContributionWithdrawal(Base):
    """A learner took back the recordings they gave (backend.contributions).

    Kept in the database, not on the server's disk, so the deletion from the dataset still
    happens after a restart. `done_at` is set once the files are gone from the dataset and its
    history. The row itself holds only the random contributor id.
    """

    __tablename__ = "contribution_withdrawals"

    id = Column(Integer, primary_key=True, index=True)
    contributor_id = Column(String(32), nullable=False, unique=True, index=True)
    requested_at = Column(DateTime, default=utcnow)
    done_at = Column(DateTime, nullable=True)


# Columns added after the first release. create_all() never alters existing
# tables, so add any that are missing with a plain ALTER TABLE.
ADDED_COLUMNS = {
    "pronunciation_records": ["pronunciation", "fluency", "completeness", "clarity", "wpm", "counted", "clip_id"],
    "users": [
        "key_hash", "email", "password_hash", "display_name", "first_language", "goal", "tip_language",
        "contribute_at", "contributor_id", "google_sub",
    ],
    "phoneme_observations": ["tier"],
    "interview_sessions": ["interview_type"],
}


def migrate_added_columns(bind=None) -> None:
    bind = bind or engine
    inspector = inspect(bind)
    with bind.begin() as conn:
        for table, columns in ADDED_COLUMNS.items():
            if not inspector.has_table(table):
                continue
            existing = {col["name"] for col in inspector.get_columns(table)}
            model_table = Base.metadata.tables[table]
            for column in columns:
                if column not in existing:
                    column_type = model_table.c[column].type.compile(dialect=bind.dialect)
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}"))
                    logger.info("Added column %s.%s", table, column)


def migrate_indexes(bind=None) -> None:
    """create_all() only indexes new tables; add missing indexes to existing ones."""
    bind = bind or engine
    with bind.begin() as conn:
        for table in Base.metadata.sorted_tables:
            for index in table.indexes:
                index.create(bind=conn, checkfirst=True)


def init_db(bind=None) -> bool:
    bind = bind or engine
    try:
        Base.metadata.create_all(bind=bind)
        migrate_added_columns(bind)
        migrate_indexes(bind)
        logger.info("Database ready (%s), URL taken from %s.", bind.dialect.name, DATABASE_SOURCE)
        if bind.dialect.name == "sqlite" and (os.getenv("SPACE_ID") or os.path.exists("/.dockerenv")):
            logger.warning(
                "Using SQLite inside a container: accounts and history are LOST whenever it is replaced. "
                "Set NEON_DATABASE_URL (or DATABASE_URL) to a PostgreSQL URL to keep them."
            )
        return True
    except Exception:
        logger.exception("Error initializing database")
        return False


def check_db() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        logger.warning("Database health check failed", exc_info=True)
        return False


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def as_utc(value: datetime) -> datetime:
    """SQLite drops tzinfo; timestamps are always written in UTC."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


# Pydantic Models for API serialization
class PhonemeMistakeSchema(BaseModel):
    word: str
    expected_phoneme: str
    actual_phoneme: str

    model_config = ConfigDict(from_attributes=True)


class ShareCommentSchema(BaseModel):
    author: Optional[str] = None
    text: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> str:
        return as_utc(value).isoformat()


class PronunciationRecordSchema(BaseModel):
    id: int
    target_text: str
    transcribed_text: str
    score: float
    accuracy: float
    difficulty: Optional[str] = None
    pronunciation: Optional[float] = None
    fluency: Optional[float] = None
    completeness: Optional[float] = None
    clarity: Optional[float] = None
    wpm: Optional[float] = None
    counted: Optional[bool] = None
    created_at: datetime
    mistakes: List[PhonemeMistakeSchema] = []
    # Teachers' comments left through a share link.
    comments: List[ShareCommentSchema] = []

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> str:
        return as_utc(value).isoformat()


class UserHistoryResponse(BaseModel):
    username: str
    records: List[PronunciationRecordSchema]
    # Matching attempts in all (before limit/offset), so a client can page.
    total: int = 0


class TrendPoint(BaseModel):
    date: str
    score: float
    pronunciation: Optional[float] = None
    fluency: Optional[float] = None
    completeness: Optional[float] = None
    clarity: Optional[float] = None


class WeaknessSchema(BaseModel):
    phoneme: str
    count: int
    name: Optional[str] = None
    label: Optional[str] = None


class AnalyticsResponse(BaseModel):
    average_score: float
    best_score: float
    total_practice_sessions: int
    practice_days: int
    streak_days: int
    sessions_this_week: int
    metric_averages: dict
    score_trend: List[TrendPoint]
    top_weaknesses: List[WeaknessSchema]
    # Added after v2: first attempts against the latest, a twelve-week calendar, per-sound
    # mastery (weakest first) and the words that went wrong most often.
    improvement: Optional[dict] = None
    daily_activity: List[dict] = []
    sound_mastery: List[dict] = []
    tricky_words: List[dict] = []
    # Listening drills: share heard right per contrast (separate from how the sounds are said).
    perception: List[dict] = []
