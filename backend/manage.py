"""
Operator commands.

    python -m backend.manage unlock "<username>"   release a claimed name so the next browser can claim it
    python -m backend.manage users                 list users, attempt counts and claim status
    python -m backend.manage disputes [--out FILE] export "I think this is wrong" reports as CSV (no names, no audio)
"""

from __future__ import annotations

import argparse
import csv
import sys

from sqlalchemy import func, select, update

from backend.database import PronunciationRecord, SessionLocal, User, init_db


def unlock(username: str) -> int:
    with SessionLocal() as db:
        changed = db.execute(update(User).where(User.username == username).values(key_hash=None)).rowcount
        db.commit()
    print(f"Released {username!r}." if changed else f"No user named {username!r}.")
    return 0 if changed else 1


def users() -> int:
    with SessionLocal() as db:
        rows = db.execute(
            select(User.username, User.key_hash.is_not(None), func.count(PronunciationRecord.id))
            .outerjoin(PronunciationRecord, PronunciationRecord.user_id == User.id)
            .group_by(User.id)
            .order_by(User.username)
        ).all()
    for name, claimed, attempts in rows:
        print(f"{name:<40} {attempts:>6} attempts   {'claimed' if claimed else 'unclaimed'}")
    return 0


DISPUTE_FIELDS = ("dispute_id", "attempt_id", "created_at", "sentence", "word", "expected", "detected", "gop", "score", "tier", "reason")


def disputes(out: str | None) -> int:
    """Disputed sounds as CSV, for recalibrating the cut-offs (scripts/eval_speechocean.py tiers)."""
    from backend.repositories import dispute_rows

    with SessionLocal() as db:
        rows = dispute_rows(db)
    handle = open(out, "w", newline="", encoding="utf-8") if out else sys.stdout
    try:
        writer = csv.DictWriter(handle, fieldnames=DISPUTE_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    finally:
        if out:
            handle.close()
    if out:
        print(f"Wrote {len(rows)} disputes to {out}.", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m backend.manage", description=__doc__.split("\n\n")[0].strip())
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("unlock", help="release a claimed name").add_argument("username")
    sub.add_parser("users", help="list users")
    sub.add_parser("disputes", help="export disputed sounds as CSV").add_argument("--out", help="file to write (default: stdout)")
    args = parser.parse_args(argv)
    init_db()
    if args.command == "unlock":
        return unlock(args.username)
    if args.command == "disputes":
        return disputes(args.out)
    return users()


if __name__ == "__main__":
    sys.exit(main())
