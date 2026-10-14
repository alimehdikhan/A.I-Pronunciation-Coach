"""SQL analytics parity and additive migrations."""

import random
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from backend.database import Base, PhonemeMistake, PronunciationRecord, User, as_utc, init_db, utcnow
from backend.repositories import analytics

METRICS = ("pronunciation", "fluency", "completeness", "clarity")


def reference_analytics(records, tz_offset):
    """The original (pre-SQL) Python implementation, kept as the oracle."""
    records = sorted(records, key=lambda r: (as_utc(r.created_at), r.id))
    offset = timedelta(minutes=tz_offset)
    now = utcnow()
    local_days = sorted({(as_utc(r.created_at) - offset).date() for r in records})
    today = (now - offset).date()
    streak = 0
    if local_days and (today - local_days[-1]).days <= 1:
        expected = local_days[-1]
        for day in reversed(local_days):
            if day != expected:
                break
            streak += 1
            expected = day - timedelta(days=1)
    metric_averages = {}
    for metric in METRICS:
        values = [getattr(r, metric) for r in records if getattr(r, metric) is not None]
        if values:
            metric_averages[metric] = round(sum(values) / len(values), 1)
    return {
        "average_score": round(sum(r.score for r in records) / len(records), 1),
        "best_score": round(max(r.score for r in records), 1),
        "total_practice_sessions": len(records),
        "practice_days": len(local_days),
        "streak_days": streak,
        "sessions_this_week": sum(1 for r in records if now - as_utc(r.created_at) <= timedelta(days=7)),
        "metric_averages": metric_averages,
        "score_trend": [as_utc(r.created_at).isoformat() for r in records[-200:]],
    }


@pytest.fixture()
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'parity.db'}")
    init_db(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


@pytest.mark.parametrize("tz_offset", [0, 300, -330, -840, 720])
def test_sql_analytics_match_the_original_implementation(db, tz_offset):
    rng = random.Random(tz_offset)
    user = User(username="heavy")
    db.add(user)
    db.flush()
    now = utcnow()
    for _ in range(400):
        created = now - timedelta(minutes=rng.randint(0, 60 * 24 * 45))
        missing = rng.random() < 0.2  # v1 rows have no metric columns
        db.add(PronunciationRecord(
            user_id=user.id, target_text="t", transcribed_text="t", score=rng.uniform(30, 100),
            accuracy=50, created_at=created.replace(tzinfo=None),
            **{metric: None if missing else rng.uniform(30, 100) for metric in METRICS},
        ))
    db.commit()
    records = db.query(PronunciationRecord).all()

    expected = reference_analytics(records, tz_offset)
    actual = analytics(db, user, tz_offset)

    for key in ("average_score", "best_score", "total_practice_sessions", "practice_days", "streak_days", "sessions_this_week"):
        assert actual[key] == expected[key], key
    assert actual["metric_averages"] == pytest.approx(expected["metric_averages"], abs=0.051)
    assert [point["date"] for point in actual["score_trend"]] == expected["score_trend"]


def test_streak_counts_consecutive_local_days(db):
    user = User(username="streaky")
    db.add(user)
    db.flush()
    now = utcnow().replace(tzinfo=None)
    for days_ago in (0, 1, 2, 4):
        db.add(PronunciationRecord(user_id=user.id, target_text="t", transcribed_text="t", score=80, accuracy=80,
                                   created_at=now - timedelta(days=days_ago)))
    db.commit()

    result = analytics(db, user, 0)

    assert result["streak_days"] == 3 and result["practice_days"] == 4


def test_init_db_upgrades_a_legacy_database_without_losing_data(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:  # the v1 schema: no metric columns, no key_hash, no composite index
        conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR NOT NULL UNIQUE, created_at DATETIME)"))
        conn.execute(text(
            "CREATE TABLE pronunciation_records (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), "
            "target_text TEXT NOT NULL, transcribed_text TEXT NOT NULL, score FLOAT NOT NULL, accuracy FLOAT NOT NULL, "
            "difficulty VARCHAR, created_at DATETIME)"
        ))
        conn.execute(text(
            "CREATE TABLE phoneme_mistakes (id INTEGER PRIMARY KEY, record_id INTEGER REFERENCES pronunciation_records(id), "
            "word VARCHAR NOT NULL, expected_phoneme VARCHAR NOT NULL, actual_phoneme VARCHAR NOT NULL)"
        ))
        conn.execute(text("INSERT INTO users (id, username, created_at) VALUES (1, 'Ali', '2026-01-01 10:00:00')"))
        conn.execute(text(
            "INSERT INTO pronunciation_records (id, user_id, target_text, transcribed_text, score, accuracy, difficulty, created_at) "
            "VALUES (1, 1, 'Hello', 'Hello', 91.5, 90, 'beginner', '2026-01-01 10:05:00')"
        ))
        conn.execute(text("INSERT INTO phoneme_mistakes (record_id, word, expected_phoneme, actual_phoneme) VALUES (1, 'hello', 'h', '')"))

    assert init_db(engine) is True
    assert init_db(engine) is True  # idempotent

    inspector = inspect(engine)
    assert "key_hash" in {c["name"] for c in inspector.get_columns("users")}
    assert {"pronunciation", "clarity"} <= {c["name"] for c in inspector.get_columns("pronunciation_records")}
    assert "ix_pronunciation_records_user_created" in {i["name"] for i in inspector.get_indexes("pronunciation_records")}
    assert "ix_phoneme_mistakes_record" in {i["name"] for i in inspector.get_indexes("phoneme_mistakes")}

    session = sessionmaker(bind=engine)()
    user = session.query(User).one()
    assert user.username == "Ali" and user.key_hash is None
    record = session.query(PronunciationRecord).one()
    assert record.score == 91.5 and record.pronunciation is None
    assert session.query(PhonemeMistake).count() == 1
    assert analytics(session, user, 0)["total_practice_sessions"] == 1
    session.close()
    engine.dispose()


def test_models_declare_the_migrated_indexes():
    names = {index.name for table in Base.metadata.sorted_tables for index in table.indexes}
    assert {"ix_pronunciation_records_user_created", "ix_phoneme_mistakes_record"} <= names


def test_manage_unlock_releases_a_claimed_name(capsys):
    from backend import manage
    from backend.database import SessionLocal

    init_db()
    with SessionLocal() as session:
        session.add(User(username="Claimed Person", key_hash="a" * 64))
        session.commit()

    assert manage.main(["unlock", "Claimed Person"]) == 0
    assert manage.main(["unlock", "Nobody Here"]) == 1
    with SessionLocal() as session:
        assert session.query(User).filter_by(username="Claimed Person").one().key_hash is None
