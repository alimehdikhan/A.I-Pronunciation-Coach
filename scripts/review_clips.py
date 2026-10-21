"""
Review recordings learners gave ("Help improve Vocaly AI"), so they can train the scorer.

A learner's own "I said it right" is a hint, not a label: people often can't hear their own
slips. So a recording trains the scorer only after a person has listened to it and marked
every sound. The review page doesn't show what the app decided, so it can't sway the reviewer.

    python scripts/review_clips.py pull                  # download the private dataset (after `hf auth login`)
    python scripts/review_clips.py page --count 40       # writes review.html (in the cache): disputed recordings first
    # open review.html in a browser, mark the sounds, press "Download labels"
    python scripts/review_clips.py upload labels.json    # store the labels in the dataset
    python scripts/train_sound_model.py prepare --dataset contrib
    python scripts/train_sound_model.py train --profile south_asian

`pull` also deletes local copies of recordings that learners have since withdrawn, so run it
before every review and every training run. The review page holds learners' voices: keep it
out of the repository (it is written to the cache by default) and delete it when you are done.
"""

from __future__ import annotations

import argparse
import base64
import html
import json
import random
import sys
from pathlib import Path
from typing import Any, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.config import settings  # noqa: E402

CACHE = Path.home() / ".cache" / "pronunciation_coach" / "eval"
LOCAL = CACHE / "contributions"
REPO_TYPE = "dataset"
# Stored as the 0-1 rating the training uses: 1 clean, 0.5 accented (the right sound, with an accent), 0 wrong.
RATINGS = {"right": 1.0, "accent": 0.5, "wrong": 0.0}


def _token() -> str | None:
    """PRONUNCIATION_COACH_DATASET_TOKEN if set, otherwise the token of `hf auth login`."""
    return settings.hf_token or None


def _need_repo() -> None:
    if not settings.dataset_repo:
        raise SystemExit("Set PRONUNCIATION_COACH_DATASET_REPO (e.g. you/vocaly-recordings) in .env, and sign in with `hf auth login`.")


def pull() -> None:
    """Download the dataset, and delete local files that are no longer in it."""
    from huggingface_hub import HfApi, snapshot_download

    _need_repo()
    api = HfApi(token=_token())
    remote = set(api.list_repo_files(settings.dataset_repo, repo_type=REPO_TYPE))
    snapshot_download(settings.dataset_repo, repo_type=REPO_TYPE, token=_token(), local_dir=str(LOCAL))
    removed = 0
    for path in (LOCAL / "clips").glob("*/*"):
        if path.relative_to(LOCAL).as_posix() not in remote:
            path.unlink()
            removed += 1
    for folder in (LOCAL / "clips").glob("*"):
        if folder.is_dir() and not any(folder.iterdir()):
            folder.rmdir()
    print(f"{sum(1 for _ in clips())} recordings in {LOCAL}" + (f"; removed {removed} withdrawn files" if removed else ""))


def clips() -> Iterator[dict[str, Any]]:
    """Every downloaded recording with its metadata, disputes and review."""
    for meta_path in sorted((LOCAL / "clips").glob("*/*.json")):
        if ".dispute-" in meta_path.name or meta_path.name.endswith(".review.json"):
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        folder, clip = meta_path.parent, meta_path.stem
        audio = folder / meta.get("audio", f"{clip}.flac")
        if not audio.exists():
            continue
        review_path = folder / f"{clip}.review.json"
        yield {
            "meta": meta,
            "audio": audio,
            "disputes": [json.loads(p.read_text(encoding="utf-8")) for p in folder.glob(f"{clip}.dispute-*.json")],
            "review": json.loads(review_path.read_text(encoding="utf-8")) if review_path.exists() else None,
        }


def reviewed() -> Iterator[dict[str, Any]]:
    """Recordings a person marked as usable, with a rating for every sound."""
    for item in clips():
        review = item["review"]
        if review and review.get("usable") and item["meta"].get("quality", {}).get("usable", False):
            yield item


# --- the review page ------------------------------------------------------------------------------


def _choose(count: int, seed: int) -> list[dict[str, Any]]:
    todo = [c for c in clips() if c["review"] is None and c["meta"].get("words")]
    random.Random(seed).shuffle(todo)
    # Disputed recordings first, then those with a flagged sound, then the rest.
    todo.sort(key=lambda c: (not c["disputes"], not any(s.get("tier") for w in c["meta"]["words"] for s in w["sounds"])))
    return todo[:count]


PAGE_STYLE = """
:root { --bg:#f6f6f4; --card:#fff; --ink:#1d1d1f; --muted:#6e6e73; --line:#e3e3e0; --right:#e9f6ec; --accent:#fff4d6; --wrong:#fde7e7; }
@media (prefers-color-scheme: dark) { :root { --bg:#111113; --card:#1c1c1f; --ink:#f2f2f2; --muted:#a1a1a6; --line:#2e2e33;
  --right:#173322; --accent:#3a3015; --wrong:#3d1c1c; } }
* { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui, sans-serif }
main { max-width:860px; margin:0 auto; padding:24px 16px 120px } h1 { font-size:22px; margin:0 0 4px } p { color:var(--muted); margin:0 0 16px }
.clip { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; margin:12px 0 }
.top { display:flex; gap:12px; align-items:center; flex-wrap:wrap } .text { font-weight:600; font-size:17px } .lang { color:var(--muted); font-size:13px }
audio { width:100%; margin:10px 0 } .words { display:flex; flex-wrap:wrap; gap:10px }
.word { border:1px solid var(--line); border-radius:10px; padding:6px 8px } .word button.play { all:unset; cursor:pointer; font-weight:600 }
.sound { all:unset; cursor:pointer; display:inline-block; min-width:28px; text-align:center; margin:4px 2px 0; padding:2px 6px; border-radius:6px;
  background:var(--right); font-family:ui-monospace, monospace } .sound[data-r="accent"] { background:var(--accent) } .sound[data-r="wrong"] { background:var(--wrong) }
label.unusable { color:var(--muted); font-size:13px; margin-left:auto } footer { position:fixed; inset:auto 0 0 0; background:var(--card); border-top:1px solid var(--line);
  padding:12px 16px; display:flex; gap:12px; justify-content:center; align-items:center } footer input { padding:8px 10px; border-radius:8px; border:1px solid var(--line);
  background:var(--bg); color:var(--ink) } footer button { padding:9px 16px; border-radius:9px; border:0; background:#0a7cff; color:#fff; font-weight:600; cursor:pointer }
"""

PAGE_SCRIPT = """
const next = { right: 'accent', accent: 'wrong', wrong: 'right' };
document.querySelectorAll('.sound').forEach(b => b.addEventListener('click', () => { b.dataset.r = next[b.dataset.r]; b.title = b.dataset.r; }));
document.querySelectorAll('button.play').forEach(b => b.addEventListener('click', () => {
  const audio = b.closest('.clip').querySelector('audio'); const start = parseFloat(b.dataset.start), end = parseFloat(b.dataset.end);
  if (isNaN(start)) { audio.currentTime = 0; audio.play(); return; }
  audio.currentTime = Math.max(0, start - 0.15); audio.play();
  const stop = () => { if (audio.currentTime >= end + 0.15) { audio.pause(); audio.removeEventListener('timeupdate', stop); } };
  audio.addEventListener('timeupdate', stop);
}));
document.getElementById('save').addEventListener('click', () => {
  const reviewer = document.getElementById('reviewer').value.trim();
  if (!reviewer) { document.getElementById('reviewer').focus(); return; }
  const labels = {};
  document.querySelectorAll('.clip').forEach(c => {
    labels[c.dataset.clip] = { contributor: c.dataset.contributor, usable: !c.querySelector('.unusable input').checked,
      words: [...c.querySelectorAll('.word')].map(w => ({ index: +w.dataset.index, phonemes: [...w.querySelectorAll('.sound')].map(s => s.dataset.p),
        ratings: [...w.querySelectorAll('.sound')].map(s => s.dataset.r) })) };
  });
  const blob = new Blob([JSON.stringify({ reviewer, labels }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'labels.json'; a.click();
});
"""


def page(count: int, out: Path, seed: int = 0) -> None:
    chosen = _choose(count, seed)
    if not chosen:
        raise SystemExit("Nothing to review: run `pull` first, or every downloaded recording has a review.")
    parts = []
    for item in chosen:
        meta = item["meta"]
        kind = "audio/flac" if item["audio"].suffix == ".flac" else "audio/wav"
        data = base64.b64encode(item["audio"].read_bytes()).decode()
        words = []
        for w in meta["words"]:
            if not w["sounds"]:
                continue
            starts = [s["start"] for s in w["sounds"] if s.get("start") is not None]
            ends = [s["end"] for s in w["sounds"] if s.get("end") is not None]
            chips = "".join(
                f'<button class="sound" data-p="{html.escape(s["phoneme"])}" data-r="right" title="right">/{html.escape(s["phoneme"])}/</button>'
                for s in w["sounds"]
            )
            words.append(
                f'<div class="word" data-index="{w["index"]}"><button class="play" data-start="{min(starts) if starts else "NaN"}" '
                f'data-end="{max(ends) if ends else "NaN"}">{html.escape(w["word"])} ▸</button><br>{chips}</div>'
            )
        parts.append(
            f'<section class="clip" data-clip="{meta["clip"]}" data-contributor="{meta["contributor"]}">'
            f'<div class="top"><span class="text">{html.escape(meta["text"])}</span>'
            f'<span class="lang">{html.escape(meta.get("first_language") or "first language not given")}</span>'
            f'<label class="unusable"><input type="checkbox"> Not usable (noise, other speech, wrong sentence)</label></div>'
            f'<audio controls preload="none" src="data:{kind};base64,{data}"></audio><div class="words">{"".join(words)}</div></section>'
        )
    document = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>Review recordings</title><style>{PAGE_STYLE}</style></head><body><main>"
        "<h1>Review recordings</h1><p>Play each word (tap its name), then tap a sound to cycle it: "
        "<b>right</b> → <b>accented</b> (the right sound, with an accent) → <b>wrong</b> (another sound, or dropped). "
        "Untouched sounds count as right. Judge against clear American or British English.</p>"
        f'{"".join(parts)}</main><footer><input id="reviewer" placeholder="Your name or initials" aria-label="Reviewer">'
        f'<button id="save">Download labels</button></footer><script>{PAGE_SCRIPT}</script></body></html>'
    )
    out.write_text(document, encoding="utf-8")
    print(f"wrote {out} with {len(chosen)} recordings ({sum(1 for c in chosen if c['disputes'])} disputed)")


# --- storing the labels ----------------------------------------------------------------------------


def upload(labels_path: Path) -> None:
    from datetime import datetime, timezone

    from huggingface_hub import CommitOperationAdd, HfApi

    _need_repo()
    data = json.loads(labels_path.read_text(encoding="utf-8"))
    reviewer = str(data.get("reviewer", "")).strip()[:40] or "unknown"
    api = HfApi(token=_token())
    remote = set(api.list_repo_files(settings.dataset_repo, repo_type=REPO_TYPE))
    operations, skipped = [], 0
    for clip, label in data.get("labels", {}).items():
        contributor = str(label.get("contributor", ""))
        if f"clips/{contributor}/{clip}.json" not in remote:
            skipped += 1  # withdrawn since the page was made
            continue
        review = {
            "clip": clip,
            "reviewer": reviewer,
            "date": datetime.now(timezone.utc).date().isoformat(),
            "usable": bool(label.get("usable")),
            "words": [
                {"index": int(w["index"]), "phonemes": list(w["phonemes"]), "ratings": [RATINGS[r] for r in w["ratings"]]}
                for w in label.get("words", [])
            ],
        }
        operations.append(CommitOperationAdd(
            path_in_repo=f"clips/{contributor}/{clip}.review.json",
            path_or_fileobj=json.dumps(review, ensure_ascii=False).encode("utf-8"),
        ))
    if operations:
        api.create_commit(settings.dataset_repo, operations, repo_type=REPO_TYPE,
                          commit_message=f"Reviews of {len(operations)} recordings by {reviewer}")
    print(f"stored {len(operations)} reviews" + (f"; skipped {skipped} withdrawn recordings" if skipped else ""))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("pull")
    p = sub.add_parser("page")
    p.add_argument("--count", type=int, default=40)
    p.add_argument("--out", type=Path, default=LOCAL / "review.html")
    p.add_argument("--seed", type=int, default=0)
    u = sub.add_parser("upload")
    u.add_argument("labels", type=Path)
    args = parser.parse_args()
    if args.command == "pull":
        pull()
    elif args.command == "page":
        page(args.count, args.out, args.seed)
    else:
        upload(args.labels)


if __name__ == "__main__":
    main()
