""""I think this is wrong": disputes are stored for the learner's own sounds only, and exported without names."""

import csv
import io

import pytest
from sqlalchemy import func, select

from backend import manage
from backend.api import disputes as disputes_api
from backend.database import Dispute
from backend.repositories import delete_history, find_user, save_attempt
from tests.conftest import OTHER_KEY, PROFILE_KEY
from tests.test_tiers import BORDERLINE, CLEAN, SURE, score

KEY = {"X-Profile-Key": PROFILE_KEY}


@pytest.fixture()
def attempt_id(client, monkeypatch, session_factory):
    disputes_api.dispute_rate_limiter.reset()
    db = session_factory()
    record_id = save_attempt(db, "Asha", PROFILE_KEY, "I think so.", "I think so", score(monkeypatch, [SURE, CLEAN, CLEAN, BORDERLINE]))
    db.close()
    return record_id


def dispute(client, record_id, headers=KEY, **changes):
    body = {"username": "Asha", "record_id": record_id, "word": "think", "expected": "θ", "detected": "s", "gop": -12.5,
            "reason": "said_correctly", **changes}
    return client.post("/api/disputes", json=body, headers=headers)


def test_a_dispute_stores_what_the_scorer_reported_and_no_audio(client, attempt_id, session_factory):
    response = dispute(client, attempt_id)

    assert response.status_code == 200 and response.json()["tier"] == "fix"
    db = session_factory()
    row = db.scalar(select(Dispute))
    assert (row.word, row.expected_phoneme, row.detected_phoneme, row.gop, row.tier, row.reason) == (
        "think", "θ", "s", -12.5, "fix", "said_correctly"
    )
    assert row.score == pytest.approx(100 * SURE, abs=0.1)  # from the saved attempt, not the client
    assert not any("audio" in c.name for c in Dispute.__table__.columns)
    db.close()


def test_disputing_again_updates_the_reason_and_a_borderline_sound_keeps_its_tier(client, attempt_id, session_factory):
    dispute(client, attempt_id)
    dispute(client, attempt_id, reason="accent_normal")
    dispute(client, attempt_id, expected="k", detected="?", reason=None)

    db = session_factory()
    rows = {r.expected_phoneme: (r.tier, r.reason) for r in db.scalars(select(Dispute))}
    assert rows == {"θ": ("fix", "accent_normal"), "k": ("check", None)}
    db.close()


def test_only_the_owner_can_dispute_and_only_sounds_in_the_attempt(client, attempt_id):
    assert dispute(client, attempt_id, headers={"X-Profile-Key": OTHER_KEY}).status_code == 403
    assert dispute(client, attempt_id + 1).status_code == 404
    assert dispute(client, attempt_id, word="sink").status_code == 404
    assert dispute(client, attempt_id, reason="the app is bad").status_code == 422


def test_disputes_are_rate_limited(client, attempt_id, monkeypatch):
    monkeypatch.setattr(disputes_api.dispute_rate_limiter, "limit", 1)
    assert dispute(client, attempt_id).status_code == 200
    assert dispute(client, attempt_id).status_code == 429


def test_deleting_history_deletes_disputes(client, attempt_id, session_factory):
    dispute(client, attempt_id)
    db = session_factory()
    delete_history(db, find_user(db, "Asha"))
    assert db.scalar(select(func.count()).select_from(Dispute)) == 0
    db.close()


def test_the_export_is_a_csv_without_names(client, attempt_id, session_factory, monkeypatch, capsys):
    dispute(client, attempt_id)
    monkeypatch.setattr(manage, "SessionLocal", session_factory)
    monkeypatch.setattr(manage, "init_db", lambda: True)

    assert manage.main(["disputes"]) == 0

    rows = list(csv.DictReader(io.StringIO(capsys.readouterr().out)))
    assert len(rows) == 1
    assert rows[0]["sentence"] == "I think so." and rows[0]["expected"] == "θ" and rows[0]["reason"] == "said_correctly"
    assert "Asha" not in ",".join(rows[0].values()) and "username" not in rows[0]
