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
    __table_args__ = (Index("ix_users_email", "email", unique=True),)

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    # SHA-256 of the browser's profile key; NULL until a browser claims the name.
    key_hash = Column(String(64), nullable=True)
    email = Column(String(254), nullable=True)
    # What people see. Unlike `username` (the unique handle history is stored
    # under) it may repeat; NULL means "same as username".
    display_name = Column(String(60), nullable=True)
    # "scrypt$<n>$<salt hex>$<hash hex>"; see backend.security.hash_password.
    password_hash = Column(String(200), nullable=True)

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
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User", back_populates="records")
    mistakes = relationship("PhonemeMistake", back_populates="record", cascade="all, delete-orphan")
    observations = relationship("PhonemeObservation", back_populates="record", cascade="all, delete-orphan")


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

    record = relationship("PronunciationRecord", back_populates="observations")


# Columns added after the first release. create_all() never alters existing
# tables, so add any that are missing with a plain ALTER TABLE.
ADDED_COLUMNS = {
    "pronunciation_records": ["pronunciation", "fluency", "completeness", "clarity"],
    "users": ["key_hash", "email", "password_hash", "display_name"],
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
    created_at: datetime
    mistakes: List[PhonemeMistakeSchema] = []

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> str:
        return as_utc(value).isoformat()


class UserHistoryResponse(BaseModel):
    username: str
    records: List[PronunciationRecordSchema]


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
