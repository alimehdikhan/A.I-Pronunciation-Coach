"""
Choose the cut-off for "Say just this word" (backend.pronunciation.ALONE_SLIP_BELOW).

For every minimal pair in the knowledge base (think/sink, very/berry, ...) a Kokoro
voice says both words on their own. Each recording is scored against the first word,
through the same decode, Whisper and phoneme pipeline the app uses, and the sound the
pair differs in is read off. A good cut-off flags the substituted word and passes
the correct one.

    python scripts/eval_confirm.py --voices am_michael,af_heart --pairs 3

Synthetic speech is not learner speech: treat the rates as a sanity check, not as
recall on real users. Needs the Whisper model, the phoneme model and Kokoro.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import gop, phonetics  # noqa: E402
from backend.config import settings  # noqa: E402
from backend.phoneme_kb import PHONEMES  # noqa: E402
from backend.pronunciation import ALONE_SLIP_BELOW, ALONE_WHISPER_BELOW, _heard_instead  # noqa: E402

OUT = Path.home() / ".cache" / "pronunciation_coach" / "eval" / "confirm.json"


def pairs(per_sound: int) -> list[tuple[str, str, str]]:
    """(sound, correct word, substituted word) where the words differ at that sound."""
    out = []
    for symbol, entry in PHONEMES.items():
        kept = 0
        for correct, wrong in entry.get("minimal_pairs", []):
            if kept >= per_sound:
                break
            ops = phonetics.compare_words(correct.lower(), wrong.lower()).ops
            if any(e == symbol and kind in ("replace", "delete") for kind, e, _a in ops):
                out.append((symbol, correct.lower(), wrong.lower()))
                kept += 1
    return out


def measure(voices: list[str], per_sound: int) -> list[dict]:
    from backend.api.speech import _prepare
    from backend.asr import WhisperASR
    from backend.phoneme_model import PhonemeRecognizer
    from backend.pronunciation import PronunciationScorer
    from backend.tts import KokoroVoice

    asr = WhisperASR(settings.whisper_model_size, download_root=settings.asr_dir, beam_size=settings.asr_beam_size)
    recognizer = PhonemeRecognizer(settings.phoneme_model_dir)
    scorer = PronunciationScorer(inventory=gop.load_inventory(Path(settings.phoneme_model_dir) / "vocab.json"))
    voice = KokoroVoice(voices[0])
    rows, started = [], time.perf_counter()
    todo = pairs(per_sound)
    for voice_id in voices:
        for symbol, correct, wrong in todo:
            for said, slip in ((correct, False), (wrong, True)):
                samples, _gain, _cleanup = _prepare(voice.synthesize(said, 1.0, voice_id), ".wav")
                heard = asr.transcribe(samples)
                text = str(heard.get("text", "")).strip()
                log_probs = recognizer.log_probs(samples) if text else None
                result = scorer.score_pronunciation(correct, text, "intermediate", heard.get("words"), heard.get("duration"), log_probs)
                entry = next((w for w in result["words"] if w["reference"]), {})
                sound = next((p for p in entry.get("phonemes") or [] if p["phoneme"] == symbol), None)
                rows.append({
                    "voice": voice_id, "sound": symbol, "target": correct, "said": said, "slip": slip,
                    "heard": text, "score": None if sound is None else sound["score"],
                    "whisper_differs": _heard_instead(entry, symbol) is not None,
                })
        print(f"  {voice_id} done ({time.perf_counter() - started:.0f}s)", flush=True)
    return rows


def summarise(rows: list[dict]) -> None:
    scored = [r for r in rows if r["score"] is not None]
    slips = [r for r in scored if r["slip"]]
    clean = [r for r in scored if not r["slip"]]
    print(f"{len(clean)} correct and {len(slips)} substituted recordings scored ({len(rows) - len(scored)} not heard)")
    print(f"median score: correct {np.median([r['score'] for r in clean]):.1f}, substituted {np.median([r['score'] for r in slips]):.1f}")
    def rate(group: list[dict], cut: float, whisper: bool) -> float:
        return float(np.mean([(r["score"] < 100 * cut) or (whisper and r["whisper_differs"]) for r in group]))

    def app_rule(r: dict) -> bool:
        return r["score"] < 100 * ALONE_SLIP_BELOW or (r["whisper_differs"] and r["score"] < 100 * ALONE_WHISPER_BELOW)

    print(f"the app's rule (sound < {ALONE_SLIP_BELOW}, or Whisper differs and sound < {ALONE_WHISPER_BELOW}): "
          f"caught {np.mean([app_rule(r) for r in slips]):.2f}, false alarm {np.mean([app_rule(r) for r in clean]):.2f}")
    for voice in sorted({r["voice"] for r in scored}):
        s_v = [r for r in slips if r["voice"] == voice]
        c_v = [r for r in clean if r["voice"] == voice]
        print(f"  {voice}: caught {np.mean([app_rule(r) for r in s_v]):.2f}, false alarm {np.mean([app_rule(r) for r in c_v]):.2f}")
    print(f"{'cut':>5} | {'sound only':^21} | {'sound or Whisper':^21}")
    print(f"{'':>5} | {'caught':>9} {'false alarm':>11} | {'caught':>9} {'false alarm':>11}")
    for cut in (0.80, 0.85, 0.88, 0.90, 0.92, 0.94, 0.95, 0.96, 0.97):
        print(f"{cut:>5.2f} | {rate(slips, cut, False):>9.2f} {rate(clean, cut, False):>11.2f} | "
              f"{rate(slips, cut, True):>9.2f} {rate(clean, cut, True):>11.2f}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    parser.add_argument("--voices", default="am_michael,af_heart")
    parser.add_argument("--pairs", type=int, default=3, help="minimal pairs per sound")
    parser.add_argument("--cached", action="store_true", help="summarise the last run without re-scoring")
    args = parser.parse_args()
    if args.cached:
        rows = json.loads(OUT.read_text(encoding="utf-8"))
    else:
        rows = measure(args.voices.split(","), args.pairs)
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    summarise(rows)


if __name__ == "__main__":
    main()
