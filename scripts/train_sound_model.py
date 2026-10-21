"""
Train the sound classifier: the model that turns the phoneme recogniser's evidence into
"how likely is this sound to be rated clean".

    python scripts/train_sound_model.py prepare --dataset l2arctic --split train
    python scripts/train_sound_model.py prepare --dataset l2arctic --split validation
    python scripts/train_sound_model.py prepare --dataset l2arctic --split test
    python scripts/train_sound_model.py train --profile south_asian      # writes a candidate
    python scripts/train_sound_model.py promote --profile south_asian    # only if it beat the current one

Data:

* L2-ARCTIC (CC BY-NC 4.0; the manually annotated subset, mirrored as
  chikingsley/l2-arctic-manual-v5.0-16k): 24 speakers of six first languages, among
  them four Hindi speakers, with every sound marked as said right, distorted,
  replaced or dropped by trained annotators. Its fixed speaker split keeps the
  validation (SVBI) and test (TNI) Hindi speakers out of training.
* speechocean762 (Apache-2.0, cached by scripts/eval_speechocean.py prepare).
* Recordings learners chose to give (backend/contributions.py), once a person has
  reviewed them (scripts/review_clips.py). Learners are split by a hash of their
  contributor id, so nobody's voice is in both training and test.

Needs scikit-learn and pyarrow (requirements-dev.txt), and the phoneme model
(scripts/export_phoneme_model.py). The app itself needs only numpy to run the result.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import gop, phonetics, sound_model  # noqa: E402
from backend.audio import decode_audio, normalize_loudness  # noqa: E402
from backend.config import settings  # noqa: E402

CACHE = Path.home() / ".cache" / "pronunciation_coach" / "eval"
L2ARCTIC = "chikingsley/l2-arctic-manual-v5.0-16k"
SPEECHOCEAN = "mispeech/speechocean762"
CANDIDATES = CACHE / "sound_models"
MODELS_DIR = Path(sound_model.MODELS_DIR)


# --- data ------------------------------------------------------------------------------


@dataclass
class Utterance:
    """One recording with an expert label for every expected sound."""

    id: str
    dataset: str
    speaker: str
    first_language: str
    phonemes: list[str]  # expected sounds, in the app's IPA
    # Rating of each sound on a 0-1 scale: 1 clean, 0.5 accented or distorted, 0 wrong (replaced or dropped).
    labels: list[float]
    weight: float = 1.0
    audio: bytes | None = field(default=None, repr=False)
    suffix: str = ".wav"


def _read_parquet(path: str, columns: list[str] | None = None) -> list[dict]:
    try:
        import pyarrow.parquet as pq
    except ImportError:
        import polars as pl

        frame = pl.read_parquet(path)
        return (frame.select(columns) if columns else frame).to_dicts()
    return pq.read_table(path, columns=columns).to_pylist()


def _l2arctic_label(event: dict) -> float | None:
    """0-1 rating of one canonical sound from its L2-ARCTIC annotation (None: not a scored sound)."""
    kind = event.get("error_type")
    if not event.get("canonical_phoneme") or kind not in ("correct", "substitution", "deletion"):
        return None
    if kind == "correct":
        return 1.0
    if kind == "deletion":
        return 0.0
    raw = (event.get("perceived_raw") or "").strip()
    # "T*" is the right sound said in a distorted way (often a retroflex t or d); "err" is a sound the
    # annotator could not name. Both are "accented", like speechocean762's middle rating.
    if raw.endswith("*") or raw.lower() == "err" or event.get("perceived_phoneme") == event.get("canonical_phoneme"):
        return 0.5
    return 0.0


def load_l2arctic(split: str, with_audio: bool = False) -> list[Utterance]:
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(L2ARCTIC, f"data/{split}-00000-of-00001.parquet", repo_type="dataset", cache_dir=str(CACHE))
    columns = ["speaker_id", "native_language", "utterance_id", "manual_events"] + (["audio"] if with_audio else [])
    out = []
    for row in _read_parquet(path, columns):
        phonemes, labels = [], []
        for event in row["manual_events"]:
            label = _l2arctic_label(event)
            if label is None:
                continue
            ipa = phonetics._from_arpabet([event["canonical_raw"].strip()]).phonemes
            if len(ipa) != 1:
                phonemes = []
                break
            phonemes.append(ipa[0])
            labels.append(label)
        if not phonemes:
            continue
        out.append(
            Utterance(
                id=f"{row['speaker_id']}-{row['utterance_id']}",
                dataset="l2arctic",
                speaker=row["speaker_id"],
                first_language=row["native_language"],
                phonemes=phonemes,
                labels=labels,
                audio=row["audio"]["bytes"] if with_audio else None,
                suffix=".flac",
            )
        )
    return out


def load_speechocean(split: str, limit: int | None = None) -> list[Utterance]:
    """speechocean762 sentences whose phoneme posteriors scripts/eval_speechocean.py already cached."""
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(SPEECHOCEAN, f"data/{split}-00000-of-00001.parquet", repo_type="dataset", cache_dir=str(CACHE))
    rows = _read_parquet(path, ["words", "speaker"] if _has_column(path, "speaker") else ["words"])
    out = []
    for index, row in enumerate(rows):
        if limit and len(out) >= limit:
            break
        phonemes, labels = [], []
        for word in row["words"]:
            phones = [p for p in word["phones"] if p]
            ipa = phonetics._from_arpabet(phones).phonemes
            if len(ipa) != len(phones) or len(phones) != len(word["phones-accuracy"]):
                phonemes = []
                break
            phonemes.extend(ipa)
            labels.extend(min(1.0, max(0.0, float(r) / 2.0)) for r in word["phones-accuracy"])
        if phonemes:
            out.append(
                Utterance(
                    id=f"{split}-{index:05d}",
                    dataset="speechocean",
                    speaker=str(row.get("speaker", f"{split}-{index:05d}")),
                    first_language="Chinese",
                    phonemes=phonemes,
                    labels=labels,
                )
            )
    return out


def _has_column(path: str, name: str) -> bool:
    try:
        import pyarrow.parquet as pq

        return name in pq.read_schema(path).names
    except ImportError:
        return False


def posteriors_path(utt: Utterance, split: str) -> Path:
    if utt.dataset == "speechocean":
        return CACHE / "runs" / split / f"{utt.id}.phonemes.npy"  # the cache eval_speechocean.py writes
    folder = CACHE / "runs" / ("contrib" if utt.dataset == "contrib" else f"{utt.dataset}-{split}")
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{utt.id}.phonemes.npy"


def prepare(dataset: str, split: str) -> None:
    """Run the phoneme recogniser once over every recording and cache its output."""
    if dataset == "speechocean":
        raise SystemExit("prepare: speechocean762 is prepared by scripts/eval_speechocean.py prepare")
    if dataset == "native":
        prepare_native()
        return
    from backend.enhance import enhance
    from backend.phoneme_model import PhonemeRecognizer

    if dataset == "contrib":
        # Learners' recordings are stored as recorded, so they go through the app's own cleanup first.
        utterances = [(utt, path) for utt, path, _split in contribution_audio()]
    else:
        utterances = [(utt, None) for utt in load_l2arctic(split, with_audio=True)]
    recognizer = None
    started, done = time.perf_counter(), 0
    for utt, path in utterances:
        target = posteriors_path(utt, split)
        if target.exists():
            continue
        if recognizer is None:
            recognizer = PhonemeRecognizer(settings.phoneme_model_dir, settings.phoneme_threads)
        if path is not None:
            samples = decode_audio(path.read_bytes(), path.suffix, 60.0)
            if settings.noise_cleanup:
                samples, _ = enhance(samples, neural=settings.noise_neural)
        else:
            samples = decode_audio(utt.audio or b"", utt.suffix, 60.0)
        samples, _gain = normalize_loudness(samples)
        np.save(target, recognizer.log_probs(samples).astype(np.float16))
        done += 1
        if done % 50 == 0:
            print(f"  {done} prepared ({(time.perf_counter() - started) / done:.2f}s each)", flush=True)
    where = dataset if dataset == "contrib" else f"{dataset}/{split}"
    print(f"prepared {done} new recordings of {where} in {time.perf_counter() - started:.0f}s")


# --- correct native speech: the false-alarm check ----------------------------------------------

# Every practice sentence read by four native voices (Kokoro). The British voices are scored
# against the British target, as a British learner would be. Synthetic speech is not human
# speech, but it is said correctly, so a sound model should flag almost nothing in it.
NATIVE_VOICES = (("af_heart", "american"), ("am_michael", "american"), ("bf_emma", "british"), ("bm_george", "british"))
NATIVE_DIR = CACHE / "runs" / "native"
# Cut-offs are chosen to keep false alarms low on two voices, and judged on the other two, which
# the choice never saw. The check allows a little slack over the tuning limits.
NATIVE_TUNE = ("af_heart", "bf_emma")
NATIVE_CHECK = ("am_michael", "bm_george")
# Shares of the sounds in correct native speech a model may flag: all flags, "Fix this", and any one
# sound's flags (sounds heard at least SOUND_MIN_COUNT times). The per-sound limit is what stops a model
# that flags /ð/ because the group often gets it wrong, however well it was said.
TUNE_LIMITS = {"flagged": 0.02, "fix": 0.005, "sound_flagged": 0.10, "sound_fix": 0.03}
CHECK_LIMITS = {"flagged": 0.03, "fix": 0.01, "sound_flagged": 0.15, "sound_fix": 0.05}
SOUND_MIN_COUNT = 20


def prepare_native() -> None:
    """Synthesise the app's practice sentences with native voices and cache the phoneme posteriors."""
    from backend import contributions
    from backend.enhance import enhance
    from backend.phoneme_model import PhonemeRecognizer
    from backend.tts import KokoroVoice

    sentences, _words = contributions.practice_content()
    NATIVE_DIR.mkdir(parents=True, exist_ok=True)
    manifest, recognizer, done, started = [], None, 0, time.perf_counter()
    for voice_name, accent in NATIVE_VOICES:
        voice = None
        for text in sentences:
            target = NATIVE_DIR / f"{voice_name}-{hashlib.sha1(text.encode()).hexdigest()[:10]}.phonemes.npy"
            manifest.append({"file": target.name, "text": text, "voice": voice_name, "accent": accent})
            if target.exists():
                continue
            voice = voice or KokoroVoice(voice_name, cache_dir=NATIVE_DIR / "clips")
            recognizer = recognizer or PhonemeRecognizer(settings.phoneme_model_dir, settings.phoneme_threads)
            samples = decode_audio(voice.synthesize(text, 1.0), ".wav", 60.0)
            if settings.noise_cleanup:
                samples, _ = enhance(samples, neural=settings.noise_neural)
            samples, _gain = normalize_loudness(samples)
            np.save(target, recognizer.log_probs(samples).astype(np.float16))
            done += 1
    (NATIVE_DIR / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    print(f"native check set: {len(manifest)} recordings ({done} new, {time.perf_counter() - started:.0f}s)")


class _Recorder:
    """Stands in for a sound model inside backend.acoustic.analyse, to capture the evidence for every sound."""

    def __init__(self) -> None:
        self.results: list[gop.PhonemeScore] = []

    def score(self, results):
        self.results = list(results)
        return [1.0] * len(self.results)


_NATIVE: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray] | None] = {}


def native_table() -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """(features, sound, voice) for every sound of the native check set, found the way the app finds them."""
    if "table" in _NATIVE:
        return _NATIVE["table"]
    from backend import acoustic

    manifest_path = NATIVE_DIR / "manifest.json"
    if not manifest_path.exists():
        _NATIVE["table"] = None
        return None
    inventory = _inventory()
    xs, sounds, voices = [], [], []
    for item in json.loads(manifest_path.read_text(encoding="utf-8")):
        path = NATIVE_DIR / item["file"]
        if not path.exists():
            continue
        recorder = _Recorder()
        acoustic.analyse(phonetics.tokenize(item["text"]), np.load(path).astype(np.float32), inventory, item["accent"],
                         model=recorder)  # type: ignore[arg-type]
        if recorder.results:
            xs.append(sound_model.features(recorder.results))
            sounds.extend(r.phoneme for r in recorder.results)
            voices.extend([item["voice"]] * len(recorder.results))
    _NATIVE["table"] = (np.concatenate(xs), np.asarray(sounds), np.asarray(voices)) if xs else None
    return _NATIVE["table"]


def _default_curve(x: np.ndarray) -> np.ndarray:
    from backend import acoustic

    return 1.0 / (1.0 + np.exp(-(acoustic.GOP_SLOPE * x[:, 0] + acoustic.GOP_OFFSET)))


def native_shares(prob: np.ndarray, sounds: np.ndarray, flag: float = 0.80, fix: float = 0.70) -> dict:
    """Shares of correct native sounds flagged below `flag` and `fix`, overall and for the worst sound."""
    flagged, fixed = prob < flag, prob < fix
    per_flag, per_fix = {}, {}
    for sound in np.unique(sounds):
        rows = sounds == sound
        if rows.sum() >= SOUND_MIN_COUNT:
            per_flag[sound], per_fix[sound] = float(flagged[rows].mean()), float(fixed[rows].mean())
    worst = max(per_flag, key=per_flag.get) if per_flag else ""
    worst_fix = max(per_fix, key=per_fix.get) if per_fix else ""
    return {
        "sounds": int(len(prob)),
        "flagged": float(flagged.mean()) if len(prob) else 0.0,
        "fix": float(fixed.mean()) if len(prob) else 0.0,
        "sound_flagged": per_flag.get(worst, 0.0),
        "worst_sound": worst,
        "sound_fix": per_fix.get(worst_fix, 0.0),
        "worst_fix_sound": worst_fix,
    }


def within(shares: dict, limits: dict) -> bool:
    return all(shares[k] <= limits[k] for k in ("flagged", "fix", "sound_flagged", "sound_fix"))


def native_check(model: sound_model.SoundModel | None, voices=NATIVE_CHECK) -> dict:
    """How much correct native speech (the check voices) a model flags on the app's scale; None: the default curve."""
    table = native_table()
    if table is None:
        return {}
    x, sounds, who = table
    rows = np.isin(who, voices)
    prob = model.predict(x[rows]) if model is not None else _default_curve(x[rows])
    return native_shares(prob, sounds[rows])


# --- learners' recordings ---------------------------------------------------------------------


def contributor_split(contributor: str) -> str:
    """Every recording of one learner lands in the same split: 10% test, 10% validation, 80% train."""
    bucket = int(hashlib.sha1(contributor.encode()).hexdigest()[:8], 16) % 10
    return "test" if bucket == 0 else "validation" if bucket == 1 else "train"


def _contrib_utterance(meta: dict) -> Utterance:
    return Utterance(id=meta["clip"], dataset="contrib", speaker=meta["contributor"],
                     first_language=meta.get("first_language") or "", phonemes=[], labels=[])


def contribution_audio():
    """(utterance without labels, audio path, split) for every reviewed recording."""
    from scripts import review_clips

    for item in review_clips.reviewed():
        yield _contrib_utterance(item["meta"]), item["audio"], contributor_split(item["meta"]["contributor"])


def load_contributions() -> dict[str, list[Utterance]]:
    """Reviewed recordings with the reviewer's rating for each sound, split by contributor.

    The expected sounds are found again the way the app finds them (backend.acoustic picks each
    word's pronunciation from the audio), so the features match what the app computes. A word
    whose sounds no longer match what was reviewed (for example after a phoneme model update)
    still shapes its neighbours' features but is not used as a label.
    """
    from backend import acoustic
    from scripts import review_clips

    inventory = _inventory()
    out: dict[str, list[Utterance]] = {"train": [], "validation": [], "test": []}
    for item in review_clips.reviewed():
        meta, review = item["meta"], item["review"]
        utt = _contrib_utterance(meta)
        path = posteriors_path(utt, "")
        if not path.exists():
            continue
        tokens = phonetics.tokenize(meta["text"])
        heard = acoustic.analyse(tokens, np.load(path).astype(np.float32), inventory, meta.get("accent", "american"))
        if heard is None:
            continue
        ratings = {w["index"]: w for w in review.get("words", [])}
        by_position = [w["index"] for w in meta["words"]]  # the target words, in order
        for position, word in enumerate(heard):
            if word is None:
                continue
            phonemes = [p.phoneme for p in word.phonemes]
            reviewed_word = ratings.get(by_position[position]) if position < len(by_position) else None
            if reviewed_word and reviewed_word["phonemes"] == phonemes:
                labels = [float(r) for r in reviewed_word["ratings"]]
            else:
                labels = [float("nan")] * len(phonemes)
            utt.phonemes.extend(phonemes)
            utt.labels.extend(labels)
        if utt.phonemes and not all(np.isnan(utt.labels)):
            out[contributor_split(meta["contributor"])].append(utt)
    return out


# --- feature tables: one row per expected sound ------------------------------------------------


@dataclass
class Table:
    x: np.ndarray  # (rows, features)
    y: np.ndarray  # expert rating, 0-1
    weight: np.ndarray
    language: np.ndarray  # first language of the speaker
    speaker: np.ndarray
    utterance: np.ndarray

    def __len__(self) -> int:
        return len(self.y)

    def take(self, rows) -> "Table":
        return Table(*(getattr(self, f)[rows] for f in ("x", "y", "weight", "language", "speaker", "utterance")))

    def weighted(self, factor: float, mask: np.ndarray | None = None) -> "Table":
        weight = self.weight.copy()
        weight[mask if mask is not None else slice(None)] *= factor
        return Table(self.x, self.y, weight, self.language, self.speaker, self.utterance)

    @staticmethod
    def join(tables: list["Table"]) -> "Table":
        tables = [t for t in tables if len(t)]
        if not tables:
            return Table(np.zeros((0, len(sound_model.FEATURE_NAMES))), *(np.zeros(0) for _ in range(5)))
        return Table(*(np.concatenate([getattr(t, f) for t in tables]) for f in ("x", "y", "weight", "language", "speaker", "utterance")))


def _inventory() -> gop.Inventory:
    return gop.load_inventory(Path(settings.phoneme_model_dir) / "vocab.json")


def build_table(utterances: list[Utterance], split: str, name: str, rebuild: bool = False) -> Table:
    """Features and labels for every sound, cached per dataset and split."""
    cache = CACHE / "features" / f"{name}.npz"
    if cache.exists() and not rebuild:
        data = np.load(cache, allow_pickle=False)
        if list(data["names"]) == sound_model.FEATURE_NAMES and int(data["count"]) == len(utterances):
            return Table(data["x"], data["y"], data["weight"], data["language"], data["speaker"], data["utterance"])
    inventory = _inventory()
    xs, ys, weights, languages, speakers, ids = [], [], [], [], [], []
    missing = 0
    for utt in utterances:
        path = posteriors_path(utt, split)
        labels = [inventory.index.get(p) for p in utt.phonemes]
        if not path.exists() or any(label is None for label in labels):
            missing += 1
            continue
        results = gop.score_sequence(labels, np.load(path).astype(np.float32), inventory)
        if len(results) != len(utt.labels):
            missing += 1
            continue
        xs.append(sound_model.features(results))
        ys.extend(utt.labels)
        weights.extend([utt.weight] * len(results))
        languages.extend([utt.first_language] * len(results))
        speakers.extend([utt.speaker] * len(results))
        ids.extend([utt.id] * len(results))
    if missing:
        print(f"  {name}: {missing} of {len(utterances)} recordings skipped (not prepared or unknown sounds)")
    table = Table(
        np.concatenate(xs) if xs else np.zeros((0, len(sound_model.FEATURE_NAMES))),
        np.asarray(ys, dtype=np.float64),
        np.asarray(weights, dtype=np.float64),
        np.asarray(languages, dtype=str),
        np.asarray(speakers, dtype=str),
        np.asarray(ids, dtype=str),
    )
    # Unlabelled sounds shape their neighbours' features but are not training rows.
    table = table.take(~np.isnan(table.y))
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cache, names=np.asarray(sound_model.FEATURE_NAMES), count=len(utterances), x=table.x, y=table.y,
                        weight=table.weight, language=table.language, speaker=table.speaker, utterance=table.utterance)
    return table


# --- metrics ------------------------------------------------------------------------------------

WRONG = 0.001  # rated "wrong" (replaced or dropped); accented sounds (0.5) are not counted as slips
FLAG, FIX = 0.80, 0.70  # the app's cut-offs (backend.pronunciation.PHONEME_ERROR / PHONEME_FIX)


def auc(scores: np.ndarray, positives: np.ndarray, weight: np.ndarray | None = None) -> float:
    """Chance that a wrong sound scores lower than a clean one (ties count half)."""
    from sklearn.metrics import roc_auc_score

    if positives.all() or not positives.any():
        return float("nan")
    return float(roc_auc_score(positives, -scores, sample_weight=weight))


def pcc(x: np.ndarray, y: np.ndarray) -> float:
    if len(x) < 3 or np.std(x) == 0 or np.std(y) == 0:
        return float("nan")
    return float(np.corrcoef(x, y)[0, 1])


def evaluate(prob: np.ndarray, table: Table) -> dict:
    """How well app-scale probabilities match the experts on one set of sounds."""
    wrong = table.y <= WRONG
    flagged, fix = prob < FLAG, prob < FIX

    def share(mask: np.ndarray, of: np.ndarray) -> float:
        return float(mask[of].mean()) if of.any() else float("nan")

    return {
        "sounds": int(len(table)),
        "wrong": int(wrong.sum()),
        "auc": auc(prob, wrong),
        "pcc": pcc(prob, table.y),
        "flagged_share": float(flagged.mean()) if len(prob) else float("nan"),
        "flag_precision": share(wrong, flagged),
        "flag_recall": share(flagged, wrong),
        "fix_precision": share(wrong, fix),
        "fix_recall": share(fix, wrong),
    }


# --- candidate models --------------------------------------------------------------------------


# Which features a candidate may use. "full" includes which sound it is; a model can then learn
# "this group often gets /ð/ wrong" and flag a /ð/ that was said well. "no-identity" must judge
# from the audio evidence and the context alone.
IDENTITY = [n for n in sound_model.FEATURE_NAMES if n.startswith(("sound_", "class_"))]
FEATURE_SETS = {
    "full": [],
    "no-identity": IDENTITY,
    "acoustic": [*IDENTITY, "previous_vowel", "next_vowel"],
}


def _allowed(excluded: list[str]) -> np.ndarray:
    return np.array([name not in excluded for name in sound_model.FEATURE_NAMES])


def _expand(table: Table) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Soft labels as two weighted rows: (clean, weight * rating) and (wrong, weight * (1 - rating))."""
    x = np.concatenate([table.x, table.x])
    y = np.concatenate([np.ones(len(table)), np.zeros(len(table))])
    w = np.concatenate([table.weight * table.y, table.weight * (1.0 - table.y)])
    keep = w > 0
    return x[keep], y[keep], w[keep]


def fit_sigmoid(table: Table, allowed: np.ndarray | None = None) -> dict:
    from sklearn.linear_model import LogisticRegression

    x, y, w = _expand(table)
    model = LogisticRegression(C=100.0, max_iter=1000).fit(x[:, :1], y, sample_weight=w)
    return {"slope": float(model.coef_[0, 0]), "offset": float(model.intercept_[0])}


def fit_logistic(table: Table, allowed: np.ndarray | None = None) -> dict:
    from sklearn.linear_model import LogisticRegression

    x, y, w = _expand(table)
    allowed = allowed if allowed is not None else np.ones(x.shape[1], dtype=bool)
    mean, scale = x.mean(axis=0), x.std(axis=0)
    mean[~allowed], scale[~allowed] = 0.0, 1.0
    scale[scale == 0] = 1.0
    model = LogisticRegression(C=1.0, max_iter=3000).fit(((x - mean) / scale)[:, allowed], y, sample_weight=w)
    coef = np.zeros(x.shape[1])
    coef[allowed] = model.coef_[0]
    return {"mean": mean.tolist(), "scale": scale.tolist(), "coef": coef.tolist(), "intercept": float(model.intercept_[0])}


def fit_trees(table: Table, allowed: np.ndarray | None = None) -> dict:
    """Gradient-boosted trees, exported as plain arrays the app evaluates with numpy."""
    from sklearn.ensemble import HistGradientBoostingClassifier

    x, y, w = _expand(table)
    if allowed is not None:
        x = x.copy()
        x[:, ~allowed] = 0.0  # a constant column can't be split on
    model = HistGradientBoostingClassifier(
        learning_rate=0.06, max_iter=500, max_leaf_nodes=15, min_samples_leaf=40, l2_regularization=1.0,
        early_stopping=True, validation_fraction=0.15, n_iter_no_change=25, random_state=0,
    ).fit(x, y, sample_weight=w)
    trees = []
    for predictors in model._predictors:  # one tree per boosting round (binary: one per round)
        nodes = predictors[0].nodes
        trees.append({
            "feature": nodes["feature_idx"].astype(int).tolist(),
            "threshold": nodes["num_threshold"].astype(float).tolist(),
            "left": nodes["left"].astype(int).tolist(),
            "right": nodes["right"].astype(int).tolist(),
            "missing_left": nodes["missing_go_to_left"].astype(bool).tolist(),
            "leaf": nodes["is_leaf"].astype(bool).tolist(),
            "value": nodes["value"].astype(float).tolist(),
        })
    params = {"baseline": float(np.ravel(model._baseline_prediction)[0]), "trees": trees}
    # The exported arrays must give exactly what scikit-learn gives.
    sample = x[: min(len(x), 5000)]
    ours = _model("check", "trees", params).raw(sample)
    theirs = model.predict_proba(sample)[:, 1]
    if not np.allclose(ours, theirs, atol=1e-6):
        raise RuntimeError(f"tree export differs from scikit-learn (max {np.abs(ours - theirs).max():.2e})")
    return params


FITTERS = {"sigmoid": fit_sigmoid, "logistic": fit_logistic, "trees": fit_trees}


def _model(profile: str, kind: str, params: dict, calibration: dict | None = None,
           remap: dict | None = None, **extra) -> sound_model.SoundModel:
    spec = {
        "format": sound_model.FORMAT, "profile": profile, "kind": kind, "features": sound_model.FEATURE_NAMES,
        "params": params, "calibration": calibration, "remap": remap or {"x": [0.0, 1.0], "y": [0.0, 1.0]}, **extra,
    }
    return sound_model.SoundModel(spec)


def confident_rows(table: Table, kind: str, folds: int = 5, cap: float = 0.1, allowed: np.ndarray | None = None) -> np.ndarray:
    """Rows to keep after dropping likely label mistakes (confident learning, Northcutt et al. 2021).

    Every sound gets an out-of-fold prediction. A sound labelled clean whose predicted chance of
    being wrong is at least the average the model gives truly wrong sounds (or the reverse) is a
    likely annotation mistake or a bad recording. At most `cap` of each label is dropped,
    surest first; accented (0.5) labels are kept.
    """
    from sklearn.model_selection import GroupKFold

    prob = np.zeros(len(table))
    for train_rows, test_rows in GroupKFold(n_splits=folds).split(table.x, groups=table.utterance):
        params = FITTERS[kind](table.take(train_rows), allowed)
        prob[test_rows] = _model("fold", kind, params).raw(table.x[test_rows])
    clean, wrong = table.y >= 1 - WRONG, table.y <= WRONG
    keep = np.ones(len(table), dtype=bool)
    if not clean.any() or not wrong.any():
        return keep
    clean_bar, wrong_bar = prob[clean].mean(), (1 - prob[wrong]).mean()
    for labelled, suspicious, margin in (
        (clean, clean & (1 - prob >= wrong_bar), 1 - prob),
        (wrong, wrong & (prob >= clean_bar), prob),
    ):
        rows = np.nonzero(suspicious)[0]
        rows = rows[np.argsort(-margin[rows])][: int(cap * labelled.sum())]
        keep[rows] = False
    return keep


@dataclass
class Fitted:
    name: str
    kind: str
    train_set: str
    features: str
    cleaned: bool
    params: dict
    rows: int
    dropped: int = 0
    scores: dict = field(default_factory=dict)
    calibration: dict | None = None
    cutoffs: tuple[float, float] = (0.80, 0.70)
    native: dict = field(default_factory=dict)


def calibrate(raw: np.ndarray, table: Table) -> dict:
    from sklearn.isotonic import IsotonicRegression

    iso = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip").fit(raw, table.y, sample_weight=table.weight)
    x, index = np.unique(iso.X_thresholds_, return_index=True)
    return {"x": [round(float(v), 6) for v in x], "y": [round(float(v), 6) for v in iso.y_thresholds_[index]]}


def choose_cutoffs(prob: np.ndarray, table: Table, native_prob: np.ndarray | None = None,
                   native_sounds: np.ndarray | None = None, fix_precision: float = 0.6) -> tuple[float, float] | None:
    """(flag, fix) cut-offs on calibrated probabilities, or None when no cut-off keeps native speech clean.

    flag: of the cut-offs that flag little enough correct native speech (TUNE_LIMITS, tuning voices),
    the one that best separates wrong sounds on validation (F1). fix: the loosest cut-off below it whose
    flags are right at least `fix_precision` of the time and that stays within the "Fix this" limits.
    """
    wrong = table.y <= WRONG
    w = table.weight

    def stats(cut: float) -> tuple[float, float]:
        flagged = prob < cut
        tp = float(w[flagged & wrong].sum())
        return tp / max(1e-9, float(w[flagged].sum())), tp / max(1e-9, float(w[wrong].sum()))

    def clean(cut: float, tier: str) -> bool:
        if native_prob is None or native_sounds is None:
            return True
        shares = native_shares(native_prob, native_sounds, flag=cut, fix=cut)
        return shares["flagged"] <= TUNE_LIMITS[tier] and shares["sound_flagged"] <= TUNE_LIMITS[f"sound_{tier}"]

    grid = np.round(np.arange(0.01, 0.96, 0.01), 2)
    best, best_f1 = None, -1.0
    for cut in grid:
        if not clean(float(cut), "flagged"):
            break  # flags only grow with the cut-off
        p, r = stats(float(cut))
        f1 = 0.0 if p + r == 0 else 2 * p * r / (p + r)
        if f1 > best_f1:
            best, best_f1 = float(cut), f1
    if best is None:
        return None
    fix = None
    for cut in grid[grid <= best - 0.02]:
        if not clean(float(cut), "fix"):
            break
        if stats(float(cut))[0] >= fix_precision:
            fix = float(cut)
    if fix is None:
        fix = float(grid[0]) if best - 0.02 >= grid[0] else round(best / 2, 3)
    return best, fix


def flag_scores(prob: np.ndarray, table: Table, cut: float) -> dict:
    """Precision, recall and F1 of flagging below `cut` (calibrated scale)."""
    wrong = table.y <= WRONG
    flagged = prob < cut
    precision = float(wrong[flagged].mean()) if flagged.any() else 0.0
    recall = float(flagged[wrong].mean()) if wrong.any() else 0.0
    return {"precision": precision, "recall": recall, "f1": 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)}


# --- profiles ------------------------------------------------------------------------------------

SOUTH_ASIAN = ["Hindi", "Urdu", "Bengali", "Gujarati", "Marathi", "Punjabi", "Tamil", "Telugu"]
PROFILES = {
    "south_asian": {
        # Learners who get this model (backend.coach_tools.LANGUAGES). The labelled data is from Hindi
        # speakers; the sounds Indian English varieties share (th as t/d, v and w, retroflex t and d)
        # are what make it fit the others better than a model of Mandarin speakers.
        "first_languages": SOUTH_ASIAN,
        "target": SOUTH_ASIAN,  # rows from these speakers are the group the model is judged on
        "target_weight": 3.0,
    },
}


def load_tables(rebuild: bool = False) -> dict[str, Table]:
    tables = {f"l2arctic-{s}": build_table(load_l2arctic(s), s, f"l2arctic-{s}", rebuild) for s in ("train", "validation", "test")}
    for split in ("train", "test"):
        tables[f"speechocean-{split}"] = build_table(load_speechocean(split), split, f"speechocean-{split}", rebuild)
    tables.update(load_contribution_tables(rebuild))
    return tables


def load_contribution_tables(rebuild: bool = False) -> dict[str, Table]:
    """Reviewed learner recordings (scripts/review_clips.py), when any have been downloaded."""
    from scripts import review_clips

    if not (review_clips.LOCAL / "clips").exists():
        return {}
    tables = {}
    for split, utterances in load_contributions().items():
        if utterances:
            # Reviews are added over time, so this cache is always rebuilt.
            tables[f"contrib-{split}"] = build_table(utterances, split, f"contrib-{split}", rebuild=True)
    return tables


def target_mask(table: Table, profile: dict) -> np.ndarray:
    return np.isin(table.language, profile["target"])


def train_sets(tables: dict[str, Table], profile: dict) -> dict[str, Table]:
    # A third set, the target group's speakers alone, was tried and dropped: with two speakers it did
    # as well on them but much worse on everyone else.
    l2 = tables["l2arctic-train"]
    mine = tables.get("contrib-train", Table.join([]))
    l2_weighted = l2.weighted(profile["target_weight"], target_mask(l2, profile))
    return {
        "l2arctic": Table.join([l2_weighted, mine]),
        "l2arctic+speechocean": Table.join([l2_weighted, tables["speechocean-train"].weighted(0.5), mine]),
    }


def validation_set(tables: dict[str, Table], profile: dict) -> Table:
    val = Table.join([tables["l2arctic-validation"], tables.get("contrib-validation", Table.join([]))])
    return val.weighted(profile["target_weight"], target_mask(val, profile))


def test_sets(tables: dict[str, Table], profile: dict) -> dict[str, Table]:
    l2 = tables["l2arctic-test"]
    out = {
        "target (L2-ARCTIC, held-out speaker)": l2.take(target_mask(l2, profile)),
        "all L2-ARCTIC test speakers": l2,
        "speechocean762 test": tables["speechocean-test"],
    }
    if "contrib-test" in tables and len(tables["contrib-test"]):
        out["learners (held-out contributors)"] = tables["contrib-test"]
    return out


def current_probabilities(profile_name: str, x: np.ndarray) -> tuple[str, np.ndarray]:
    """What the app uses for this group today: the installed model, or the default curve."""
    from backend import acoustic

    path = MODELS_DIR / f"{profile_name}.json"
    if path.exists():
        model = sound_model.load(path)
        return f"installed {model.kind} {model.version}", model.predict(x)
    return "default curve", 1.0 / (1.0 + np.exp(-(acoustic.GOP_SLOPE * x[:, 0] + acoustic.GOP_OFFSET)))


def _app_model(profile_name: str, fit: Fitted) -> sound_model.SoundModel:
    flag_cut, fix_cut = fit.cutoffs
    remap = {"x": [0.0, fix_cut, flag_cut, 1.0], "y": [0.0, FIX, FLAG, 1.0]}
    return _model(profile_name, fit.kind, fit.params, fit.calibration, remap)


def train(profile_name: str, kinds: list[str], rebuild: bool = False, clean: bool = False) -> Path:
    profile = PROFILES[profile_name]
    tables = load_tables(rebuild)
    sets = train_sets(tables, profile)
    val = validation_set(tables, profile)
    target = target_mask(val, profile)
    for name, table in sets.items():
        print(f"train set {name}: {len(table)} sounds, {int((table.y <= WRONG).sum())} rated wrong")
    print(f"validation: {len(val)} sounds ({int(target.sum())} from the target group)")
    native = native_table()
    if native is None:
        print("native check set missing: run `prepare --dataset native` (cut-offs are then not limited by false alarms)")
        native_x = native_sounds = None
    else:
        tune = np.isin(native[2], NATIVE_TUNE)
        native_x, native_sounds = native[0][tune], native[1][tune]
        default = native_check(None)
        print(f"native speech, default curve: {default['flagged']:.1%} flagged, {default['fix']:.1%} Fix this "
              f"(worst sound /{default['worst_sound']}/ {default['sound_flagged']:.0%})")

    fitted: list[Fitted] = []
    for set_name, table in sets.items():
        for kind in kinds:
            for features, excluded in FEATURE_SETS.items():
                if kind == "sigmoid" and features != "full":
                    continue  # the curve uses only the GOP
                allowed = _allowed(excluded)
                for cleaned in (False, True) if clean else (False,):
                    started = time.perf_counter()
                    rows = confident_rows(table, kind, allowed=allowed) if cleaned else np.ones(len(table), dtype=bool)
                    params = FITTERS[kind](table.take(rows), allowed)
                    name = f"{kind}/{features}/{set_name}{'/cleaned' if cleaned else ''}"
                    fit = Fitted(name, kind, set_name, features, cleaned, params, int(rows.sum()), int((~rows).sum()))
                    raw_val = _model(profile_name, kind, params).raw(val.x)
                    fit.calibration = calibrate(raw_val, val)
                    calibrated = _model(profile_name, kind, params, fit.calibration)
                    val_prob = calibrated.calibrated(val.x)
                    native_prob = calibrated.calibrated(native_x) if native_x is not None else None
                    cutoffs = choose_cutoffs(val_prob, val, native_prob, native_sounds)
                    fit.scores = {"auc_target": auc(raw_val[target], val.y[target] <= WRONG), "auc_all": auc(raw_val, val.y <= WRONG)}
                    if cutoffs is None:
                        print(f"  {name:<44} AUC target {fit.scores['auc_target']:.3f}  no cut-off keeps native speech clean")
                        continue
                    fit.cutoffs = cutoffs
                    at_target = flag_scores(val_prob[target], val.take(target), cutoffs[0])
                    at_all = flag_scores(val_prob, val, cutoffs[0])
                    fit.scores |= {"f1_target": at_target["f1"], "recall_target": at_target["recall"],
                                   "precision_target": at_target["precision"], "f1_all": at_all["f1"]}
                    fit.native = native_check(_app_model(profile_name, fit))
                    fitted.append(fit)
                    print(f"  {name:<44} AUC target {fit.scores['auc_target']:.3f}  at its cut-off ({cutoffs[0]:.2f}): "
                          f"target recall {at_target['recall']:.2f} precision {at_target['precision']:.2f} F1 {at_target['f1']:.3f}, "
                          f"all F1 {at_all['f1']:.3f}; unseen native voices flagged {fit.native.get('flagged', 0):.1%} "
                          f"(/{fit.native.get('worst_sound', '')}/ {fit.native.get('sound_flagged', 0):.0%})"
                          f"  ({time.perf_counter() - started:.0f}s)", flush=True)

    def selection(fit: Fitted) -> float:
        return float(np.nanmean([fit.scores["f1_target"], fit.scores["f1_all"]]))

    if not fitted:
        raise SystemExit("no candidate could keep correct native speech clean: nothing written")
    fitted.sort(key=lambda f: -selection(f))
    best = fitted[0]
    flag_cut, fix_cut = best.cutoffs
    print(f"\nchosen on validation: {best.name} (mean F1 {selection(best):.3f} at its cut-off)")
    print(f"cut-offs: flagged below {flag_cut:.2f}, Fix this below {fix_cut:.2f} (mapped to {FLAG} and {FIX})")

    candidate = _app_model(profile_name, best)
    test = compare_on_tests(profile_name, candidate, tables, profile)
    print_comparison(test)

    stamp = time.strftime("%Y-%m-%d")
    spec = candidate.spec | {
        "first_languages": profile["first_languages"],
        "trained_on": {"set": best.train_set, "features": best.features, "cleaned_labels": best.cleaned, "sounds": best.rows,
                       "dropped": best.dropped,
                       "data": sorted({"L2-ARCTIC (CC BY-NC 4.0)"} | ({"speechocean762"} if "speechocean" in best.train_set else set())
                                      | ({"reviewed learner recordings"} if "contrib-train" in tables else set()))},
        "validation": {"selection": best.name, **best.scores, "cutoffs": {"flag": flag_cut, "fix": fix_cut},
                       "native_limits": {"tune": TUNE_LIMITS, "check": CHECK_LIMITS},
                       "candidates": [{"name": f.name, "score": round(selection(f), 4), **f.scores, "native": f.native} for f in fitted]},
        "test": test,
    }
    spec["version"] = f"{stamp}-{hashlib.sha1(json.dumps(spec['params'], sort_keys=True).encode()).hexdigest()[:7]}"
    CANDIDATES.mkdir(parents=True, exist_ok=True)
    out = CANDIDATES / f"{profile_name}.json"
    out.write_text(json.dumps(_finite(spec), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\ncandidate written to {out} ({out.stat().st_size / 1e6:.1f} MB)")
    return out


def compare_on_tests(profile_name: str, candidate: sound_model.SoundModel, tables: dict[str, Table], profile: dict) -> dict:
    test = {}
    for name, table in test_sets(tables, profile).items():
        label, current = current_probabilities(profile_name, table.x)
        test[name] = {"candidate": evaluate(candidate.predict(table.x), table), "current": evaluate(current, table), "current_is": label}
    path = MODELS_DIR / f"{profile_name}.json"
    installed = sound_model.load(path) if path.exists() else None
    native_new = native_check(candidate)
    if native_new:
        test[NATIVE_ROW] = {"candidate": native_new, "current": native_check(installed),
                            "current_is": "installed model" if installed else "default curve"}
    return test


NATIVE_ROW = "correct native speech (unseen voices)"


def _finite(value):
    """The spec with NaN metrics (nothing flagged, no wrong sounds) as null, so the file is strict JSON."""
    if isinstance(value, dict):
        return {k: _finite(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_finite(v) for v in value]
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value


def print_comparison(test: dict) -> None:
    print(f"\n{'test set':<40}{'':>11}{'AUC':>7}{'PCC':>7}{'flag P':>8}{'flag R':>8}{'fix P':>7}{'fix R':>7}")
    for name, result in test.items():
        for who in ("current", "candidate"):
            m = result[who]
            if name == NATIVE_ROW:
                print(f"{name if who == 'current' else '':<40}{who:>11}   flags {m['flagged']:.1%} of sounds, Fix this {m['fix']:.1%}; "
                      f"worst sound /{m['worst_sound']}/ {m['sound_flagged']:.0%} flagged, /{m['worst_fix_sound']}/ {m['sound_fix']:.0%} Fix this")
                continue
            print(f"{name if who == 'current' else '':<40}{who:>11}{m['auc']:>7.3f}{m['pcc']:>7.3f}"
                  f"{m['flag_precision']:>8.3f}{m['flag_recall']:>8.3f}{m['fix_precision']:>7.3f}{m['fix_recall']:>7.3f}")


# The candidate replaces what the app uses only when it is clearly better for its group and no
# worse for anyone else.
MIN_TARGET_GAIN = 0.005
MAX_OTHER_LOSS = 0.005


def promotion_verdict(test: dict) -> tuple[bool, list[str]]:
    reasons, ok = [], True
    native = test.get(NATIVE_ROW)
    if native is None:
        ok = False
        reasons.append("no native check set: run `prepare --dataset native` first")
    elif not within(native["candidate"], CHECK_LIMITS):
        ok = False
        m = native["candidate"]
        reasons.append(f"correct native speech: flags {m['flagged']:.1%} (limit {CHECK_LIMITS['flagged']:.0%}), Fix this {m['fix']:.1%} "
                       f"(limit {CHECK_LIMITS['fix']:.0%}), /{m['worst_sound']}/ {m['sound_flagged']:.0%} "
                       f"(limit {CHECK_LIMITS['sound_flagged']:.0%}), /{m['worst_fix_sound']}/ {m['sound_fix']:.0%} Fix this "
                       f"(limit {CHECK_LIMITS['sound_fix']:.0%})")
    else:
        reasons.append(f"correct native speech: within the limits ({native['candidate']['flagged']:.1%} flagged)")
    for name, result in test.items():
        if name == NATIVE_ROW:
            continue
        new, now = result["candidate"], result["current"]
        gain = new["auc"] - now["auc"]
        if name.startswith("target") or name.startswith("learners"):
            # Clearly better at telling wrong from right, and catches at least as many real slips.
            if not gain >= MIN_TARGET_GAIN or not new["flag_recall"] >= now["flag_recall"]:
                ok = False
                reasons.append(f"{name}: AUC {gain:+.3f} (needs +{MIN_TARGET_GAIN}), slips caught "
                               f"{now['flag_recall']:.0%} -> {new['flag_recall']:.0%} (may not fall)")
            else:
                reasons.append(f"{name}: AUC {gain:+.3f}, slips caught {now['flag_recall']:.0%} -> {new['flag_recall']:.0%}")
        elif name.startswith("all L2"):
            if not gain >= -MAX_OTHER_LOSS:
                ok = False
                reasons.append(f"{name}: AUC {gain:+.3f} (may not drop more than {MAX_OTHER_LOSS})")
    return ok, reasons


def promote(profile_name: str) -> bool:
    candidate_path = CANDIDATES / f"{profile_name}.json"
    if not candidate_path.exists():
        raise SystemExit(f"no candidate for {profile_name}: run train first")
    spec = json.loads(candidate_path.read_text(encoding="utf-8"))
    candidate = sound_model.SoundModel(spec)
    tables = load_tables()
    test = compare_on_tests(profile_name, candidate, tables, PROFILES[profile_name])
    print_comparison(test)
    ok, reasons = promotion_verdict(test)
    for line in reasons:
        print("  " + line)
    if not ok:
        print(f"\nnot promoted: the app keeps {next(iter(test.values()))['current_is']}")
        return False
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    target = MODELS_DIR / f"{profile_name}.json"
    target.write_text(candidate_path.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"\npromoted {spec['kind']} {spec['version']} to {target}")
    return True


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # IPA symbols on a Windows console
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    parser.add_argument("command", choices=["prepare", "train", "promote"])
    parser.add_argument("--dataset", default="l2arctic", choices=["l2arctic", "contrib", "native"])
    parser.add_argument("--split", default="train", choices=["train", "validation", "test"])
    parser.add_argument("--profile", default="south_asian", choices=sorted(PROFILES))
    parser.add_argument("--kinds", default="sigmoid,logistic,trees", help="train: model kinds to compare")
    parser.add_argument("--rebuild", action="store_true", help="recompute cached feature tables")
    parser.add_argument("--clean", action="store_true", help="train: also try confident-learning label cleaning")
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args.dataset, args.split)
    elif args.command == "train":
        train(args.profile, [k.strip() for k in args.kinds.split(",") if k.strip()], args.rebuild, args.clean)
    else:
        sys.exit(0 if promote(args.profile) else 1)


if __name__ == "__main__":
    main()
