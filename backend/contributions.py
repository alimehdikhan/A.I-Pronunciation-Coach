"""
"Help improve Vocaly AI": practice recordings learners choose to give, to train the scorer.

Off unless the learner turns it on, and only for practice sentences: never interviews, group
discussions, free speaking or conversations, where people say personal things. Each recording
must pass backend.quality first, so only clean recordings of the right sentence are kept.

Kept per recording: the audio (16 kHz mono FLAC), the sentence, the transcript, what the scorer
reported for each sound, the learner's first language and the date. Not kept: name, username,
email or IP address. Recordings are filed under a random contributor id (never the user id),
so all of one learner's recordings can be deleted when they ask.

Recordings wait in a local folder and are uploaded in batches to a private Hugging Face dataset
(PRONUNCIATION_COACH_DATASET_REPO, written with PRONUNCIATION_COACH_DATASET_TOKEN); without them the feature is off. The
uploader refuses to write to a dataset that is not private. Deleting a learner's recordings
also rewrites the dataset's history, so old versions of the files are gone too.

Layout of the dataset:

    clips/<contributor>/<clip>.flac          the audio
    clips/<contributor>/<clip>.json          sentence, scores, quality checks
    clips/<contributor>/<clip>.dispute-<n>.json   the learner said a flagged sound was right
    clips/<contributor>/<clip>.review.json   a person's label for every sound (scripts/review_clips.py)
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
import shutil
import subprocess
import threading
import wave
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from backend import quality
from backend.audio import SAMPLE_RATE, decode_audio, resolve_ffmpeg
from backend.config import settings
from backend.database import ContributionWithdrawal, PronunciationRecord, SessionLocal, User, utcnow

logger = logging.getLogger("pronunciation_coach.contributions")

REPO_TYPE = "dataset"
# Files per upload commit; Hugging Face recommends batching instead of one commit per file.
BATCH_FILES = 400
_lock = threading.Lock()


def enabled() -> bool:
    return bool(settings.dataset_repo and settings.hf_token)


def new_contributor_id() -> str:
    return secrets.token_hex(8)


def new_clip_id() -> str:
    return secrets.token_hex(8)


def _spool() -> Path:
    path = Path(settings.contrib_dir) / "pending"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _withdrawn(db: Session, contributor: str | None = None) -> set[str]:
    query = select(ContributionWithdrawal.contributor_id)
    if contributor is not None:
        query = query.where(ContributionWithdrawal.contributor_id == contributor)
    return set(db.scalars(query))


def _valid_id(value: str) -> bool:
    return 8 <= len(value) <= 32 and all(c in "0123456789abcdef" for c in value)


# --- which recordings may be given ----------------------------------------------------------------

_SENTENCES_TS = Path(settings.frontend_dir).parent / "src" / "lib" / "sentences.ts"


@lru_cache(maxsize=1)
def practice_content() -> tuple[tuple[str, ...], tuple[str, ...]]:
    """The app's own practice sentences and single words, as written (sorted)."""
    from backend import baseline
    from backend.phoneme_kb import PHONEMES

    sentences: set[str] = set(baseline.SENTENCES)
    words: set[str] = set()
    for entry in PHONEMES.values():
        words.update(entry.get("examples", []))
        for pair in entry.get("minimal_pairs", []):
            words.update(pair)
        if entry.get("practice_sentence"):
            sentences.add(entry["practice_sentence"])
    for path in (_SENTENCES_TS, Path(__file__).resolve().parent.parent / "frontend" / "src" / "lib" / "sentences.ts"):
        if path.is_file():
            # The same pattern as scripts/prerender_voice.py: ['level', 'topic', 'sentence'].
            pattern = re.compile(r"\['(?:beginner|intermediate|advanced)',\s*'[^']*',\s*'((?:[^'\\]|\\.)*)'\]")
            sentences.update(m.group(1).replace("\\'", "'") for m in pattern.finditer(path.read_text(encoding="utf-8")))
            break
    return tuple(sorted(sentences)), tuple(sorted(words))


@lru_cache(maxsize=1)
def _known() -> tuple[frozenset[str], frozenset[str]]:
    """The app's own practice sentences and words, normalised (never text a learner typed, which may be personal)."""
    from backend import phonetics

    sentences, single = practice_content()
    normal = frozenset(" ".join(phonetics.tokenize(s)) for s in sentences)
    words = set(single)
    for sentence in normal:
        words.update(sentence.split())
    return normal, frozenset(" ".join(phonetics.tokenize(w)) for w in words)


def known_text(text: str) -> bool:
    """A practice sentence or word from the app itself."""
    from backend import phonetics

    normal = " ".join(phonetics.tokenize(text))
    sentences, words = _known()
    return bool(normal) and (normal in sentences or normal in words)


def given_today(db: Session, user: User) -> int:
    start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    count = db.scalar(
        select(func.count()).select_from(PronunciationRecord).where(
            PronunciationRecord.user_id == user.id,
            PronunciationRecord.clip_id.is_not(None),
            PronunciationRecord.created_at >= start.replace(tzinfo=None),
        )
    )
    return int(count or 0)


def giving(db: Session, user: User | None, text: str) -> bool:
    """Should this attempt's recording be offered to the dataset (before the quality checks)?"""
    return bool(
        enabled()
        and user is not None
        and user.contributor_id
        and user.contribute_at
        and known_text(text)
        and given_today(db, user) < settings.contrib_daily_limit
    )


# --- what is kept -----------------------------------------------------------------------------


def assess_upload(upload: tuple[bytes, str] | None, suffix: str, result: dict[str, Any]) -> tuple[np.ndarray | None, dict[str, Any]]:
    """Decode the raw upload (before cleanup and gain) and run the quality checks on it."""
    if upload is None:
        return None, {"usable": False, "problems": ["no_audio"]}
    try:
        samples = decode_audio(upload[0], suffix or ".wav", quality.MAX_SECONDS + 1)
    except Exception:
        return None, {"usable": False, "problems": ["unreadable"]}
    return samples, quality.assess(samples, result)


def describe(
    clip_id: str,
    contributor: str,
    *,
    text: str,
    transcript: str,
    first_language: str | None,
    accent: str,
    difficulty: str,
    result: dict[str, Any],
    checks: dict[str, Any],
    sound_model: str | None,
    phoneme_model: str | None,
) -> dict[str, Any]:
    """The clip's metadata: no name, username, email or IP address."""
    words = []
    for w in result.get("words", []):
        if not w.get("reference"):
            continue
        words.append({
            "index": w["index"],
            "word": w["reference"],
            "status": w["status"],
            "score": w.get("score"),
            "sounds": [
                {k: s.get(k) for k in ("phoneme", "score", "gop", "tier", "alternative", "start", "end")}
                for s in w.get("phonemes") or []
            ],
        })
    return {
        "clip": clip_id,
        "contributor": contributor,
        "date": datetime.now(timezone.utc).date().isoformat(),
        "text": text,
        "transcript": transcript,
        "first_language": first_language,
        "accent": accent,
        "difficulty": difficulty,
        "sample_rate": SAMPLE_RATE,
        "score": result.get("score"),
        "metrics": result.get("metrics"),
        "words": words,
        "quality": checks,
        "models": {"sound_model": sound_model, "phoneme_model": phoneme_model},
    }


def _write_audio(samples: np.ndarray, base: Path) -> Path:
    """FLAC (lossless, about half the size of WAV) through ffmpeg, or WAV when that fails."""
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
    target = base.with_suffix(".flac")
    try:
        command = [resolve_ffmpeg(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                   "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "1", "-i", "-", "-c:a", "flac", str(target)]
        subprocess.run(command, input=pcm, capture_output=True, timeout=30, check=True)
        return target
    except Exception:
        logger.warning("FLAC encoding failed; keeping the recording as WAV", exc_info=True)
        target.unlink(missing_ok=True)
    target = base.with_suffix(".wav")
    with wave.open(str(target), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(pcm)
    return target


def keep(samples: np.ndarray, meta: dict[str, Any], sessions=None) -> None:
    """Queue one recording and its metadata for the next upload (runs after the response is sent)."""
    contributor, clip_id = meta["contributor"], meta["clip"]
    if not (_valid_id(contributor) and _valid_id(clip_id)):
        raise ValueError("invalid contributor or clip id")
    with (sessions or SessionLocal)() as db:
        if _withdrawn(db, contributor):
            return
    with _lock:
        folder = _spool() / contributor
        folder.mkdir(parents=True, exist_ok=True)
        audio = _write_audio(samples, folder / clip_id)
        meta = {**meta, "audio": audio.name}
        (folder / f"{clip_id}.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")


def add_dispute(contributor: str, clip_id: str, dispute: dict[str, Any]) -> None:
    """The learner said a flagged sound in a given recording was right: a hint for reviewers, not a label."""
    if not (_valid_id(contributor) and _valid_id(clip_id)):
        return
    with _lock:
        folder = _spool() / contributor
        folder.mkdir(parents=True, exist_ok=True)
        payload = {**dispute, "date": datetime.now(timezone.utc).date().isoformat()}
        (folder / f"{clip_id}.dispute-{secrets.token_hex(3)}.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def withdraw(db: Session, contributor: str) -> None:
    """Delete everything this contributor gave: queued files now, uploaded ones on the next upload run.

    The request is stored in the database (the caller commits), so it survives a restart.
    """
    if not _valid_id(contributor):
        return
    with _lock:
        shutil.rmtree(_spool() / contributor, ignore_errors=True)
    if not _withdrawn(db, contributor):
        db.add(ContributionWithdrawal(contributor_id=contributor))


def stop(db: Session, user: User) -> int:
    """Turn giving off and delete every recording this learner gave; returns how many attempts had one.

    Used by the Settings switch, deleting history and deleting the account. The caller commits.
    """
    given = db.scalar(
        select(func.count()).select_from(PronunciationRecord).where(
            PronunciationRecord.user_id == user.id, PronunciationRecord.clip_id.is_not(None)
        )
    )
    if user.contributor_id:
        withdraw(db, user.contributor_id)
    user.contributor_id = None
    user.contribute_at = None
    db.execute(
        update(PronunciationRecord)
        .where(PronunciationRecord.user_id == user.id, PronunciationRecord.clip_id.is_not(None))
        .values(clip_id=None)
        .execution_options(synchronize_session=False)
    )
    return int(given or 0)


def pending_count() -> int:
    return sum(1 for path in _spool().glob("*/*.json") if ".dispute-" not in path.name)


# --- upload -------------------------------------------------------------------------------------


def _api():
    from huggingface_hub import HfApi

    return HfApi(token=settings.hf_token)


def _ensure_private_repo(api) -> bool:
    from huggingface_hub.errors import RepositoryNotFoundError

    try:
        info = api.repo_info(settings.dataset_repo, repo_type=REPO_TYPE)
    except RepositoryNotFoundError:
        api.create_repo(settings.dataset_repo, repo_type=REPO_TYPE, private=True, exist_ok=True)
        info = api.repo_info(settings.dataset_repo, repo_type=REPO_TYPE)
    if not info.private:
        logger.error("Dataset %s is public: learner recordings are NOT uploaded until it is made private.", settings.dataset_repo)
        return False
    return True


def _delete_withdrawn(api, db: Session) -> None:
    from huggingface_hub.errors import EntryNotFoundError

    due = list(db.scalars(select(ContributionWithdrawal).where(ContributionWithdrawal.done_at.is_(None))))
    if not due:
        return
    files = set(api.list_repo_files(settings.dataset_repo, repo_type=REPO_TYPE))
    deleted = False
    for row in due:
        if any(f.startswith(f"clips/{row.contributor_id}/") for f in files):
            try:
                api.delete_folder(f"clips/{row.contributor_id}", settings.dataset_repo, repo_type=REPO_TYPE,
                                  commit_message="Delete recordings a learner withdrew")
                deleted = True
            except EntryNotFoundError:
                pass
    if deleted:
        # Without this the deleted audio would still be in the dataset's earlier commits.
        api.super_squash_history(settings.dataset_repo, repo_type=REPO_TYPE, commit_message="Recordings learners gave")
    for row in due:
        row.done_at = utcnow()
    db.commit()


def flush(sessions=None) -> int:
    """Delete withdrawn recordings from the dataset, then upload queued ones. Returns files uploaded."""
    if not enabled():
        return 0
    from huggingface_hub import CommitOperationAdd

    with (sessions or SessionLocal)() as db:
        due = db.scalar(select(func.count()).select_from(ContributionWithdrawal).where(ContributionWithdrawal.done_at.is_(None)))
    if not due and not any(path.is_file() for path in _spool().glob("*/*")):
        return 0  # nothing to do: don't call the Hub
    api = _api()
    if not _ensure_private_repo(api):
        return 0
    uploaded = 0
    with (sessions or SessionLocal)() as db:
        _delete_withdrawn(api, db)
        withdrawn = _withdrawn(db)
    while True:
        with _lock:
            root = _spool()
            for folder in root.iterdir():
                if folder.name in withdrawn:  # queued just before the learner withdrew
                    shutil.rmtree(folder, ignore_errors=True)
            batch = sorted(p for p in root.glob("*/*") if p.is_file())[:BATCH_FILES]
        if not batch:
            return uploaded
        operations = [CommitOperationAdd(path_in_repo=f"clips/{p.parent.name}/{p.name}", path_or_fileobj=str(p)) for p in batch]
        clips = sum(1 for p in batch if p.suffix == ".json" and ".dispute-" not in p.name)
        api.create_commit(settings.dataset_repo, operations, repo_type=REPO_TYPE,
                          commit_message=f"Add {clips} recording{'s' if clips != 1 else ''}")
        with _lock:
            for path in batch:
                path.unlink(missing_ok=True)
            for folder in root.iterdir():
                if folder.is_dir() and not any(folder.iterdir()):
                    folder.rmdir()
        uploaded += len(batch)


async def run_uploader(stop: asyncio.Event) -> None:
    """Upload every few minutes until `stop` is set, then once more."""
    from fastapi.concurrency import run_in_threadpool

    interval = max(60.0, settings.contrib_upload_minutes * 60.0)
    while True:
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass
        try:
            count = await run_in_threadpool(flush)
            if count:
                logger.info("Uploaded %d files of learner recordings to %s", count, settings.dataset_repo)
        except Exception:
            logger.warning("Uploading learner recordings failed; will retry", exc_info=True)
        if stop.is_set():
            return
