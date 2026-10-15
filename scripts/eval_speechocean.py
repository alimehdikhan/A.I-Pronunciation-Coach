"""
Measure scoring against human ratings on speechocean762.

speechocean762 (Apache-2.0) holds 5,000 English sentences read by Mandarin
speakers, rated by experts per sentence (0-10), word (0-10) and phone (0-2).
Model outputs are cached, so trying a scoring change only re-runs the scorer.

    python scripts/eval_speechocean.py prepare --split test --limit 500
    python scripts/eval_speechocean.py report  --split test --limit 500
    python scripts/eval_speechocean.py calibrate --split train --limit 700   # after prepare --no-asr

Needs pyarrow and scipy (pip install pyarrow scipy), and the phoneme model
(scripts/export_phoneme_model.py) for the acoustic scores.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import phonetics  # noqa: E402
from backend.audio import decode_audio  # noqa: E402
from backend.config import settings  # noqa: E402

CACHE = Path.home() / ".cache" / "pronunciation_coach" / "eval"
DATASET = "mispeech/speechocean762"


# --- data ------------------------------------------------------------------------


def load_split(split: str, limit: int | None) -> list[dict]:
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(DATASET, f"data/{split}-00000-of-00001.parquet", repo_type="dataset", cache_dir=str(CACHE))
    table = pq.read_table(path)
    indices = list(range(table.num_rows))
    if limit and limit < len(indices):
        step = len(indices) / limit
        indices = [int(i * step) for i in range(limit)]  # spread over all speakers
    rows = []
    for index in indices:
        row = table.slice(index, 1).to_pylist()[0]
        row["id"] = f"{split}-{index:05d}"
        rows.append(row)
    return rows


def run_dir(split: str) -> Path:
    path = CACHE / "runs" / split
    path.mkdir(parents=True, exist_ok=True)
    return path


def samples_of(row: dict) -> np.ndarray:
    return decode_audio(row["audio"]["bytes"], ".wav", 60.0)


# --- prepare: run the models once --------------------------------------------------


def prepare(rows: list[dict], split: str, whisper_size: str, phonemes: bool, use_asr: bool = True) -> None:
    from backend.audio import normalize_loudness

    out = run_dir(split)
    asr = recognizer = None
    started, done = time.perf_counter(), 0
    for row in rows:
        asr_path = out / f"{row['id']}.asr-{whisper_size}.json"
        phon_path = out / f"{row['id']}.phonemes.npy"
        need_asr = use_asr and not asr_path.exists()
        need_phon = phonemes and not phon_path.exists()
        if not (need_asr or need_phon):
            continue
        samples, _gain = normalize_loudness(samples_of(row))
        if need_asr:
            if asr is None:
                from backend.asr import WhisperASR

                asr = WhisperASR(whisper_size, download_root=settings.asr_dir, beam_size=settings.asr_beam_size)
            asr_path.write_text(json.dumps(asr.transcribe(samples)), encoding="utf-8")
        if need_phon:
            if recognizer is None:
                from backend.phoneme_model import PhonemeRecognizer

                recognizer = PhonemeRecognizer(settings.phoneme_model_dir)
            np.save(phon_path, recognizer.log_probs(samples).astype(np.float16))
        done += 1
        if done % 25 == 0:
            rate = (time.perf_counter() - started) / done
            print(f"  {done} prepared ({rate:.2f}s each)", flush=True)
    print(f"prepared {done} new utterances in {time.perf_counter() - started:.0f}s")


# --- metrics -------------------------------------------------------------------------


def pcc(x, y) -> float:
    from scipy.stats import pearsonr

    x, y = np.asarray(x, float), np.asarray(y, float)
    keep = np.isfinite(x) & np.isfinite(y)
    return float(pearsonr(x[keep], y[keep])[0]) if keep.sum() > 2 else float("nan")


def auc(scores, positives) -> float:
    """Probability that a positive (mispronounced) item scores lower than a negative one."""
    from scipy.stats import rankdata

    scores, positives = np.asarray(scores, float), np.asarray(positives, bool)
    n_pos, n_neg = positives.sum(), (~positives).sum()
    if not n_pos or not n_neg:
        return float("nan")
    ranks = rankdata(-scores)  # higher rank = lower score
    return float((ranks[positives].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def canonical_phones(word: dict) -> list[str]:
    return list(phonetics._from_arpabet([p for p in word["phones"] if p]).phonemes)


# --- report ----------------------------------------------------------------------------


def report(rows: list[dict], split: str, whisper_size: str) -> dict:
    from backend import gop
    from backend.pronunciation import PronunciationScorer

    out = run_dir(split)
    vocab = Path(settings.phoneme_model_dir) / "vocab.json"
    inventory = gop.load_inventory(vocab) if vocab.is_file() else None
    scorer = PronunciationScorer(inventory=inventory)
    sentence = {"human_accuracy": [], "human_total": [], "human_fluency": [], "pronunciation": [], "score": [], "fluency": []}
    word_human, word_ours = [], []
    phone_human, phone_ours = [], []
    used = 0
    for row in rows:
        asr_path = out / f"{row['id']}.asr-{whisper_size}.json"
        if not asr_path.exists():
            continue
        asr = json.loads(asr_path.read_text(encoding="utf-8"))
        log_probs = None
        phon_path = out / f"{row['id']}.phonemes.npy"
        if phon_path.exists():
            log_probs = np.load(phon_path).astype(np.float32)
        result = scorer.score_pronunciation(
            row["text"], asr["text"], "intermediate", asr["words"], asr["duration"], phoneme_log_probs=log_probs
        )
        used += 1
        sentence["human_accuracy"].append(row["accuracy"])
        sentence["human_total"].append(row["total"])
        sentence["human_fluency"].append(row["fluency"])
        sentence["pronunciation"].append(result["metrics"]["pronunciation"])
        sentence["score"].append(result["score"])
        sentence["fluency"].append(result["metrics"]["fluency"] if result["metrics"]["fluency"] is not None else np.nan)

        ours = [w for w in result["words"] if w["reference"]]
        if len(ours) != len(row["words"]):
            continue
        for mine, theirs in zip(ours, row["words"], strict=True):
            word_human.append(theirs["accuracy"])
            word_ours.append(mine["score"] if mine["score"] is not None else 0.0)
            expected = canonical_phones(theirs)
            mine_phones = mine.get("phonemes") or []
            if [p["phoneme"] for p in mine_phones] == expected:
                phone_human.extend(theirs["phones-accuracy"])
                phone_ours.extend(p["score"] for p in mine_phones)

    metrics = {
        "utterances": used,
        "sentence_accuracy_pcc": pcc(sentence["pronunciation"], sentence["human_accuracy"]),
        "sentence_total_pcc": pcc(sentence["score"], sentence["human_total"]),
        "sentence_fluency_pcc": pcc(sentence["fluency"], sentence["human_fluency"]),
        "word_accuracy_pcc": pcc(word_ours, word_human),
        "words": len(word_human),
        "phone_accuracy_pcc": pcc(phone_ours, phone_human),
        "phone_mispronounced_auc": auc(phone_ours, np.asarray(phone_human) < 0.5),
        "phones": len(phone_human),
    }
    for key, value in metrics.items():
        print(f"{key:>26}: {value:.3f}" if isinstance(value, float) else f"{key:>26}: {value}")
    return metrics


# --- calibrate: fit the GOP -> score mapping on the training split ----------------------


def calibrate(rows: list[dict], split: str) -> dict:
    """Fit sigmoid(slope * gop + offset) to human phone ratings, then the word aggregation.

    Uses the dataset's canonical phones (not Whisper), so it measures only how
    well the acoustic model's GOP tracks human judgements of each sound.
    """
    from scipy.optimize import minimize

    from backend import gop

    out = run_dir(split)
    vocab = Path(settings.phoneme_model_dir) / "vocab.json"
    inventory = gop.load_inventory(vocab)
    phone_gop, phone_human, word_slices, word_human = [], [], [], []
    used = skipped = 0
    for row in rows:
        path = out / f"{row['id']}.phonemes.npy"
        if not path.exists():
            continue
        words = row["words"]
        labels, bounds = [], []
        ok = True
        for word in words:
            phones = phonetics._from_arpabet([p for p in word["phones"] if p]).phonemes
            ids = [inventory.index.get(ph) for ph in phones]
            if not phones or any(i is None for i in ids) or len(phones) != len(word["phones-accuracy"]):
                ok = False
                break
            bounds.append((len(labels), len(labels) + len(ids)))
            labels.extend(ids)
        if not ok or not labels:
            skipped += 1
            continue
        log_probs = np.load(path).astype(np.float32)
        results = gop.score_sequence(labels, log_probs, inventory)
        base = len(phone_gop)
        for r in results:
            phone_gop.append(r.gop)
        for word, (lo, hi) in zip(words, bounds, strict=True):
            phone_human.extend(word["phones-accuracy"])
            word_slices.append((base + lo, base + hi))
            word_human.append(word["accuracy"])
        used += 1

    g = np.maximum(np.asarray(phone_gop), -30.0)
    y = np.asarray(phone_human, float) / 2.0

    def loss(params):
        z = params[0] * g + params[1]
        # soft-label cross-entropy, written stably
        return float(np.mean(np.logaddexp(0, z) - y * z))

    fit = minimize(loss, x0=np.array([0.5, 2.0]), method="Nelder-Mead")
    slope, offset = float(fit.x[0]), float(fit.x[1])
    prob = 1.0 / (1.0 + np.exp(-(slope * g + offset)))

    def word_scores(weight_min: float) -> np.ndarray:
        scores = []
        for lo, hi in word_slices:
            chunk = prob[lo:hi]
            scores.append((weight_min * chunk.min() + (1 - weight_min) * chunk.mean()))
        return np.asarray(scores)

    best_w, best_pcc = 0.0, -1.0
    for w in np.linspace(0, 1, 21):
        value = pcc(word_scores(float(w)), word_human)
        if value > best_pcc:
            best_w, best_pcc = float(w), value

    # The probability below which a sound is reported as a slip: the cut-off
    # that best separates sounds the experts marked wrong (rating < 0.5 of 2).
    wrong = y < 0.25
    best_t, best_f1 = 0.5, -1.0
    for threshold in np.linspace(0.05, 0.95, 91):
        flagged = prob < threshold
        tp = float(np.sum(flagged & wrong))
        precision = tp / max(1, int(flagged.sum()))
        recall = tp / max(1, int(wrong.sum()))
        f1 = 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)
        if f1 > best_f1:
            best_t, best_f1 = float(threshold), f1

    result = {
        "utterances": used,
        "skipped": skipped,
        "phones": len(g),
        "gop_slope": round(slope, 3),
        "gop_offset": round(offset, 3),
        "phone_pcc": round(pcc(prob, y), 3),
        "phone_auc": round(auc(prob, y < 0.25), 3),
        "word_min_weight": round(best_w, 2),
        "word_pcc": round(best_pcc, 3),
        "word_pcc_mean_only": round(pcc(word_scores(0.0), word_human), 3),
        "word_pcc_min_only": round(pcc(word_scores(1.0), word_human), 3),
        "error_threshold": round(best_t, 2),
        "error_f1": round(best_f1, 3),
        "wrong_share": round(float(wrong.mean()), 3),
    }
    for key, value in result.items():
        print(f"{key:>20}: {value}")
    return result


# --- fit: least-squares blend of the text and acoustic word scores ---------------------


def fit_blend(rows: list[dict], split: str, whisper_size: str) -> dict:
    """Regress the experts' word ratings on the two word scores (needs both caches)."""
    from backend import gop
    from backend.pronunciation import PronunciationScorer

    out = run_dir(split)
    vocab = Path(settings.phoneme_model_dir) / "vocab.json"
    scorer = PronunciationScorer(inventory=gop.load_inventory(vocab))
    text, acoustic, human = [], [], []
    used = 0
    for row in rows:
        asr_path = out / f"{row['id']}.asr-{whisper_size}.json"
        phon_path = out / f"{row['id']}.phonemes.npy"
        if not (asr_path.exists() and phon_path.exists()):
            continue
        asr = json.loads(asr_path.read_text(encoding="utf-8"))
        result = scorer.score_pronunciation(
            row["text"], asr["text"], "intermediate", asr["words"], asr["duration"],
            phoneme_log_probs=np.load(phon_path).astype(np.float32),
        )
        ours = [w for w in result["words"] if w["reference"]]
        if len(ours) != len(row["words"]):
            continue
        used += 1
        for mine, theirs in zip(ours, row["words"], strict=True):
            if mine.get("text_score") is None:
                continue
            text.append(mine["text_score"])
            acoustic.append(mine["acoustic_score"])
            human.append(theirs["accuracy"] * 10.0)

    t, a, y = np.asarray(text), np.asarray(acoustic), np.asarray(human)
    design = np.column_stack([np.ones_like(t), t, a])
    (c0, c1, c2), *_ = np.linalg.lstsq(design, y, rcond=None)
    blend = np.clip(c0 + c1 * t + c2 * a, 0, 100)
    summary = {
        "utterances": used,
        "words": len(y),
        "intercept": round(float(c0), 3),
        "text_weight": round(float(c1), 3),
        "acoustic_weight": round(float(c2), 3),
        "pcc_text": round(pcc(t, y), 3),
        "pcc_acoustic": round(pcc(a, y), 3),
        "pcc_blend": round(pcc(blend, y), 3),
    }
    for key, value in summary.items():
        print(f"{key:>16}: {value}")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    parser.add_argument("command", choices=["prepare", "report", "calibrate", "fit"])
    parser.add_argument("--split", default="test", choices=["test", "train"])
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--whisper", default="base")
    parser.add_argument("--no-phonemes", action="store_true")
    parser.add_argument("--no-asr", action="store_true", help="prepare: skip Whisper (calibrating sounds only)")
    args = parser.parse_args()
    rows = load_split(args.split, args.limit)
    if args.command == "calibrate":
        calibrate(rows, args.split)
    elif args.command == "fit":
        fit_blend(rows, args.split, args.whisper)
    elif args.command == "prepare":
        prepare(rows, args.split, args.whisper, phonemes=not args.no_phonemes, use_asr=not args.no_asr)
    else:
        report(rows, args.split, args.whisper)


if __name__ == "__main__":
    main()
