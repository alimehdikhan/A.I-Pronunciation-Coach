"""
Render the app's fixed spoken content with Kokoro ahead of time.

Kokoro sounds the most natural of the free voices but is slow on a small CPU,
so the phrase library, the example and minimal-pair words and every sound's
practice sentence are rendered once into the voice's clip cache. At runtime
only text a user types themselves is synthesised live.

    python scripts/prerender_voice.py                 # render what is missing
    python scripts/prerender_voice.py --dry-run       # just count
    python scripts/prerender_voice.py --out clips/    # a portable folder

The cache key is (voice, rate, text), so the rates below must match what the web
app asks for: listen = 1.0 x the 0.95 default speed setting, "Slowly" = 0.7 x,
word chips = 0.85 x. Change them here if those multipliers change.
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

SETTINGS_RATE = 0.95
PHRASE_RATES = (round(1.0 * SETTINGS_RATE, 2), round(0.7 * SETTINGS_RATE, 2))
CHIP_RATES = (round(0.85 * SETTINGS_RATE, 2), round(0.75 * SETTINGS_RATE, 2))


def library_phrases() -> list[str]:
    source = (ROOT / "frontend" / "src" / "lib" / "sentences.ts").read_text(encoding="utf-8")
    pattern = re.compile(r"\['(?:beginner|intermediate|advanced)',\s*'[^']*',\s*'((?:[^'\\]|\\.)*)'\]")
    return [m.group(1).replace("\\'", "'") for m in pattern.finditer(source)]


def sound_content() -> tuple[list[str], list[str]]:
    from backend.phoneme_kb import PHONEMES

    words: list[str] = []
    sentences: list[str] = []
    for entry in PHONEMES.values():
        words += [w.lower() for w in entry.get("examples", [])]
        for pair in entry.get("minimal_pairs", []):
            words += [w.lower() for w in pair]
        if entry.get("practice_sentence"):
            sentences.append(entry["practice_sentence"])
    return sorted(set(words)), sorted(set(sentences))


def jobs() -> list[tuple[str, float]]:
    words, sentences = sound_content()
    items: list[tuple[str, float]] = []
    items += [(text, rate) for text in library_phrases() for rate in PHRASE_RATES]
    items += [(text, rate) for text in words for rate in CHIP_RATES[:1]]
    items += [(text, rate) for text in sentences for rate in CHIP_RATES[:1]]
    return list(dict.fromkeys(items))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--out", type=Path, default=None, help="clip folder (default: the voice's own cache)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    todo = jobs()
    print(f"{len(todo)} clips: phrases at {PHRASE_RATES}, words and sentences at {CHIP_RATES[0]}")
    if args.dry_run:
        return

    from backend.tts import KokoroVoice

    voice = KokoroVoice(args.voice, cache_dir=args.out)
    started = time.perf_counter()
    rendered = skipped = 0
    for index, (text, rate) in enumerate(todo, 1):
        if args.limit and rendered >= args.limit:
            break
        if voice.has_clip(text, rate):
            skipped += 1
            continue
        voice.synthesize(text, rate)
        rendered += 1
        if rendered % 10 == 0:
            per = (time.perf_counter() - started) / rendered
            print(f"  {index}/{len(todo)} (rendered {rendered}, {per:.1f}s each, about {(len(todo) - index) * per / 60:.0f} min left)", flush=True)
    print(f"done: {rendered} rendered, {skipped} already cached, {time.perf_counter() - started:.0f}s")


if __name__ == "__main__":
    main()
