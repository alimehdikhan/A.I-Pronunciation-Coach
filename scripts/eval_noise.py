"""
Measure what noise cleanup does to scoring accuracy on speechocean762.

Every utterance is scored several ways and compared with the human ratings:

    clean            the recording as it is
    clean+spectral   through the spectral filter (should change nothing)
    clean+rnnoise    through RNNoise (should change nothing)
    noisy            room noise plus a quieter second voice mixed in
    noisy+spectral   the noisy mix through the spectral filter
    noisy+rnnoise    the noisy mix through RNNoise (needs the pyrnnoise wheel, Linux)

    python scripts/eval_noise.py --limit 80 --snr 8

Needs the Whisper model, the phoneme model and scipy (pip install pyarrow scipy).
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import eval_speechocean as ev  # noqa: E402

from backend.audio import normalize_loudness  # noqa: E402
from backend.config import settings  # noqa: E402
from backend.enhance import enhance, neural_available  # noqa: E402


def pink_noise(n: int, rng: np.random.Generator) -> np.ndarray:
    spectrum = np.fft.rfft(rng.standard_normal(n))
    freqs = np.maximum(np.arange(spectrum.size), 1)
    noise = np.fft.irfft(spectrum / np.sqrt(freqs), n=n)
    return (noise / np.sqrt(np.mean(noise**2))).astype(np.float32)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64))) + 1e-9)


def make_noisy(clean: np.ndarray, other: np.ndarray, snr_db: float, voice_db: float, rng: np.random.Generator) -> np.ndarray:
    """Add steady room noise at `snr_db`, and another speaker `voice_db` below the learner."""
    speech = rms(clean)
    noise = pink_noise(clean.size, rng) * speech / 10 ** (snr_db / 20)
    background = np.resize(other, clean.size).astype(np.float32)
    background = background * speech / rms(background) / 10 ** (voice_db / 20)
    return (clean + noise + background).astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    parser.add_argument("--limit", type=int, default=80)
    parser.add_argument("--snr", type=float, default=8.0, help="room noise, dB below the speech")
    parser.add_argument("--voice", type=float, default=14.0, help="second voice, dB below the speech")
    parser.add_argument("--whisper", default="base")
    args = parser.parse_args()

    from backend import gop
    from backend.asr import WhisperASR
    from backend.phoneme_model import PhonemeRecognizer
    from backend.pronunciation import PronunciationScorer

    rows = ev.load_split("test", args.limit)
    asr = WhisperASR(args.whisper, download_root=settings.asr_dir, beam_size=settings.asr_beam_size)
    recognizer = PhonemeRecognizer(settings.phoneme_model_dir)
    vocab = Path(settings.phoneme_model_dir) / "vocab.json"
    scorer = PronunciationScorer(inventory=gop.load_inventory(vocab) if vocab.is_file() else None)
    rng = np.random.default_rng(11)

    if not neural_available():
        print("RNNoise is not installed here: pip install --no-deps pyrnnoise")
    conditions = ["clean", "clean+spectral", "clean+rnnoise", "noisy", "noisy+spectral", "noisy+rnnoise"]
    sentence = {c: ([], []) for c in conditions}
    words = {c: ([], []) for c in conditions}
    flagged = {"clean": 0, "noisy": 0, "rnnoise": 0, "voices_clean": 0, "voices_noisy": 0}
    started = time.perf_counter()

    for index, row in enumerate(rows):
        clean = ev.samples_of(row)
        other = ev.samples_of(rows[(index + 7) % len(rows)])
        noisy = make_noisy(clean, other, args.snr, args.voice, rng)
        spectral_clean, info_clean = enhance(clean, neural=False)
        spectral_noisy, info_noisy = enhance(noisy, neural=False)
        neural_clean, _ = enhance(clean)
        neural_noisy, info_neural = enhance(noisy)
        flagged["clean"] += info_clean["denoised"]
        flagged["noisy"] += info_noisy["denoised"]
        flagged["voices_clean"] += info_clean["background_voices"]
        flagged["voices_noisy"] += info_noisy["background_voices"]
        flagged["rnnoise"] += info_neural["method"] == "rnnoise"
        variants = {
            "clean": clean,
            "clean+spectral": spectral_clean,
            "clean+rnnoise": neural_clean,
            "noisy": noisy,
            "noisy+spectral": spectral_noisy,
            "noisy+rnnoise": neural_noisy,
        }

        for name, samples in variants.items():
            samples, _gain = normalize_loudness(samples)
            heard = asr.transcribe(samples)
            result = scorer.score_pronunciation(
                row["text"],
                heard["text"],
                "intermediate",
                heard["words"],
                heard["duration"],
                phoneme_log_probs=recognizer.log_probs(samples).astype(np.float32),
            )
            sentence[name][0].append(result["metrics"]["pronunciation"])
            sentence[name][1].append(row["accuracy"])
            ours = [w for w in result["words"] if w["reference"]]
            if len(ours) == len(row["words"]):
                for mine, theirs in zip(ours, row["words"], strict=True):
                    words[name][0].append(mine["score"] if mine["score"] is not None else 0.0)
                    words[name][1].append(theirs["accuracy"])
        if (index + 1) % 10 == 0:
            print(f"  {index + 1}/{len(rows)} ({(time.perf_counter() - started) / (index + 1):.1f}s each)", flush=True)

    print(f"\n{len(rows)} utterances, room noise {args.snr:.0f} dB under the speech, second voice {args.voice:.0f} dB under")
    print(f"{'condition':<16}{'sentence PCC':>14}{'word PCC':>12}")
    for name in conditions:
        s = ev.pcc(*sentence[name])
        w = ev.pcc(*words[name])
        print(f"{name:<16}{s:>14.3f}{w:>12.3f}")
    print(f"\nspectral filter ran on {flagged['clean']} clean and {flagged['noisy']} noisy recordings, RNNoise on {flagged['rnnoise']} noisy;")
    print(f"muted {flagged['voices_clean']} background stretches in clean, {flagged['voices_noisy']} in noisy")


if __name__ == "__main__":
    main()
