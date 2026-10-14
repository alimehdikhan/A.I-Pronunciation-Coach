"""
Operator commands.

    python -m backend.manage unlock "<username>"   release a claimed name so the next browser can claim it
    python -m backend.manage users                 list users, attempt counts and claim status
"""

from __future__ import annotations

import argparse
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m backend.manage", description=__doc__.split("\n\n")[0].strip())
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("unlock", help="release a claimed name").add_argument("username")
    sub.add_parser("users", help="list users")
    args = parser.parse_args(argv)
    init_db()
    return unlock(args.username) if args.command == "unlock" else users()


if __name__ == "__main__":
    sys.exit(main())
