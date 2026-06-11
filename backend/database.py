"""
Database configuration and models.
"""

import os
import logging
from datetime import datetime, timezone
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from pydantic import BaseModel, ConfigDict
from typing import List, Optional

logger = logging.getLogger("pronunciation_coach.database")

# Load Neon database URL from environment, or use SQLite for local testing if not set
DATABASE_URL = os.getenv("NEON_DATABASE_URL", "sqlite:///./pronunciation_coach.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    records = relationship("PronunciationRecord", back_populates="user")


class PronunciationRecord(Base):
    __tablename__ = "pronunciation_records"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    target_text = Column(Text, nullable=False)
    transcribed_text = Column(Text, nullable=False)
    score = Column(Float, nullable=False)
    accuracy = Column(Float, nullable=False)
    difficulty = Column(String, default="Intermediate")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="records")
    mistakes = relationship("PhonemeMistake", back_populates="record", cascade="all, delete-orphan")


class PhonemeMistake(Base):
    __tablename__ = "phoneme_mistakes"
    id = Column(Integer, primary_key=True, index=True)
    record_id = Column(Integer, ForeignKey("pronunciation_records.id"))
    word = Column(String, nullable=False)
    expected_phoneme = Column(String, nullable=False)
    actual_phoneme = Column(String, nullable=False)

    record = relationship("PronunciationRecord", back_populates="mistakes")

def init_db():
    try:
        Base.metadata.create_all(bind=engine)
        logger.info(f"Database initialized. Tables created.")
    except Exception as e:
        logger.error(f"Error initializing database: {e}")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

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
    difficulty: str
    created_at: datetime
    mistakes: List[PhonemeMistakeSchema] = []

    model_config = ConfigDict(from_attributes=True)

class UserHistoryResponse(BaseModel):
    username: str
    records: List[PronunciationRecordSchema]
    
class AnalyticsResponse(BaseModel):
    average_score: float
    total_practice_sessions: int
    score_trend: List[dict] # {date, avg_score}
    top_weaknesses: List[dict] # {phoneme, count}
