"""
How well does the word-stress check (backend/stress.py) agree with expert ratings?

speechocean762 rates every word's stress (10 = right, 5 = wrong). For each word of two or
more syllables whose sounds the scorer aligned exactly as the dataset spells them, the
script compares "stress slip" with the experts and prints precision and recall for a
range of margins. Choose the margin on the train split, report it on test.

    python scripts/eval_stress.py --split train --limit 2500
    python scripts/eval_stress.py --split test --limit 500 --margin 1.5

Needs the cached phoneme posteriors (eval_speechocean.py prepare) and the audio.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT), str(ROOT / "scripts")]

import eval_speechocean as ev  # noqa: E402

from backend import acoustic, gop, phonetics, stress  # noqa: E402
from backend.audio import normalize_loudness  # noqa: E402
from backend.config import settings  # noqa: E402


def measure(rows: list[dict], split: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(margin toward a wrong syllable, heard != expected, experts said wrong) per multi-syllable word."""
    inventory = gop.load_inventory(Path(settings.phoneme_model_dir) / "vocab.json")
    out = ev.run_dir(split)
    margins, moved, wrong = [], [], []
    for row in rows:
        path = out / f"{row['id']}.phonemes.npy"
        tokens = phonetics.tokenize(row["text"])
        if not path.exists() or len(tokens) != len(row["words"]):
            continue
        heard = acoustic.analyse(tokens, np.load(path).astype(np.float32), inventory)
        if heard is None:
            continue
        samples, _gain = normalize_loudness(ev.samples_of(row))
        for mine, theirs in zip(heard, row["words"], strict=True):
            if mine is None or [p.phoneme for p in mine.phonemes] != ev.canonical_phones(theirs):
                continue
            phonemes = [{"phoneme": p.phoneme, "start": p.start, "end": p.end} for p in mine.phonemes]
            result = stress.word_stress(phonemes, phonetics.syllabify(mine.pronunciation), samples)
            if result is None:
                continue
            margins.append(result["margin"] if result["heard"] != result["expected"] else -1.0)
            moved.append(result["heard"] != result["expected"])
            wrong.append(theirs["stress"] < 10)
    return np.asarray(margins), np.asarray(moved), np.asarray(wrong)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    parser.add_argument("--split", default="train", choices=["train", "test"])
    parser.add_argument("--limit", type=int, default=2500)
    parser.add_argument("--margin", type=float, default=None, help="report this margin only")
    args = parser.parse_args()
    margins, moved, wrong = measure(ev.load_split(args.split, args.limit), args.split)
    print(f"{args.split}: {len(wrong)} multi-syllable words, {int(wrong.sum())} rated as wrong stress ({wrong.mean():.1%})")
    print(f"heard stress on another syllable at all: {moved.mean():.1%} of words; "
          f"agreement with the experts on 'right vs wrong': {np.mean(moved == wrong):.1%}")
    print(f"{'margin':>7} {'flagged':>8} {'precision':>10} {'recall':>7}")
    for margin in [args.margin] if args.margin is not None else (0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0):
        flagged = margins >= margin
        precision = wrong[flagged].mean() if flagged.any() else float("nan")
        recall = (flagged & wrong).sum() / max(1, wrong.sum())
        print(f"{margin:>7.1f} {int(flagged.sum()):>8} {precision:>10.3f} {recall:>7.3f}")


if __name__ == "__main__":
    main()
