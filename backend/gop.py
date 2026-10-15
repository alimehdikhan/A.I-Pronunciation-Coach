"""
Goodness of Pronunciation (GOP) from a CTC phoneme recogniser.

The recogniser outputs, for every 20 ms frame, a probability for each espeak
IPA token (plus the CTC blank). Tokens are grouped into the 41 phonemes the app
teaches; a token may belong to more than one phoneme (a flap "ɾ" is a fine /t/
or /d/, an r-coloured "ɑːɹ" covers /ɑ/ and /r/).

Scores follow the alignment-free GOP of Cao et al. (Interspeech 2024): for each
position i of the expected phoneme sequence L,

    GOP_i = log P(L | audio) - log Σ_a P(L with position i replaced by a | audio)

where a ranges over every phoneme, an "unknown sound" bucket and deletion.
GOP_i is the log-posterior of the expected phoneme given everything else, so 0
means certainly right; the strongest alternative is the diagnosis ("/θ/ came
out as /t/"). Every term comes from one forward and one backward pass over the
expected sequence, so scoring a sentence takes milliseconds.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping, Sequence

import numpy as np

NEG_INF = -np.inf
FRAME_SECONDS = 0.02  # wav2vec 2.0 emits one frame per 320 samples at 16 kHz

# Model tokens accepted for each phoneme (broad General American IPA, as in
# backend.phonetics). Reduced and r-coloured variants that espeak uses for the
# same phoneme are accepted too.
PHONEME_TOKENS: dict[str, tuple[str, ...]] = {
    "p": ("p", "pʰ", "ph"),
    "b": ("b",),
    "t": ("t", "tʰ", "th", "ɾ", "ʔ"),
    "d": ("d", "ɾ"),
    "k": ("k", "kʰ", "kh"),
    "g": ("ɡ",),
    "f": ("f",),
    "v": ("v",),
    "θ": ("θ",),
    "ð": ("ð",),
    "s": ("s",),
    "z": ("z",),
    "ʃ": ("ʃ",),
    "ʒ": ("ʒ",),
    "h": ("h",),
    "tʃ": ("tʃ",),
    "dʒ": ("dʒ",),
    "m": ("m",),
    "n": ("n", "n̩"),
    "ŋ": ("ŋ",),
    "l": ("l", "ɫ", "l̩", "əl"),
    "r": ("ɹ", "r", "ɻ", "ɑːɹ", "ɔːɹ", "oːɹ", "ɛɹ", "ɪɹ", "ʊɹ"),
    "w": ("w",),
    "j": ("j",),
    "i": ("iː", "i", "iə", "ɪɹ"),
    "ɪ": ("ɪ", "ᵻ", "ɪɹ"),
    "ɛ": ("ɛ", "e", "ɛɹ"),
    "æ": ("æ", "a"),
    "ɑ": ("ɑː", "ɑ", "ɒ", "ɑːɹ"),
    # Most Americans merge "caught" and "cot", so /ɑ/ is a fine /ɔ/.
    "ɔ": ("ɔː", "ɔ", "ɒ", "ɑː", "ɑ", "ɔːɹ", "oːɹ"),
    "ʊ": ("ʊ", "ʊɹ"),
    "u": ("uː", "u"),
    "ʌ": ("ʌ", "ɐ", "ə"),
    "ə": ("ə", "ɐ", "ᵻ", "ɪ", "ʌ", "əl"),
    "ɝ": ("ɜː", "ɜ", "ɚ"),
    "ɚ": ("ɚ", "ɜ", "ɜː", "aɪɚ"),
    "eɪ": ("eɪ", "e", "eː"),
    "aɪ": ("aɪ", "aɪɚ", "aɪə"),
    "ɔɪ": ("ɔɪ",),
    "aʊ": ("aʊ",),
    "oʊ": ("oʊ", "o", "oː", "əʊ", "oːɹ"),
}

BLANK_TOKEN = "<pad>"
SPECIAL_TOKENS = frozenset({"<pad>", "<s>", "</s>", "<unk>"})
OTHER = "?"  # any sound that isn't one of the 41 phonemes
DELETED = ""


@dataclass(frozen=True)
class PhonemeScore:
    """GOP for one expected phoneme."""

    phoneme: str
    gop: float  # log-posterior of the expected phoneme, <= 0
    best_alternative: str  # most likely other outcome: a phoneme, OTHER or DELETED
    alternative_gop: float  # its log-posterior
    start: float | None  # seconds, from the expected-sequence alignment
    end: float | None


class Inventory:
    """Maps model tokens to phoneme emission scores."""

    def __init__(self, vocab: Mapping[str, int], phoneme_tokens: Mapping[str, Sequence[str]] = PHONEME_TOKENS):
        self.phonemes = list(phoneme_tokens)
        self.index = {ph: i for i, ph in enumerate(self.phonemes)}
        self.blank_id = vocab[BLANK_TOKEN]
        token_sets = [frozenset(vocab[t] for t in tokens if t in vocab) for tokens in phoneme_tokens.values()]
        covered = frozenset().union(*token_sets)
        other = frozenset(i for t, i in vocab.items() if t not in SPECIAL_TOKENS and i not in covered)
        self.token_sets = [*token_sets, other]
        self.labels = [*self.phonemes, OTHER]
        self.other_index = len(self.phonemes)

    def emissions(self, log_probs: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """(T, K) log-scores per phoneme (plus OTHER) and (T,) blank log-probs."""
        log_probs = np.asarray(log_probs, dtype=np.float64)
        scores = np.stack([_logsumexp_cols(log_probs, sorted(ids)) for ids in self.token_sets], axis=1)
        return scores, log_probs[:, self.blank_id]

    def exclusive_emissions(self, log_probs: np.ndarray, expected: Iterable[int] | None = None) -> np.ndarray:
        """(K, K, T): scores of each alternative a, counting only tokens the expected phoneme c doesn't accept.

        An alternative must sound different from the expected phoneme, so tokens
        both accept (a flap for /t/ vs /d/) don't count against the expected one.
        Only the rows for `expected` phonemes are filled (all when None).
        """
        log_probs = np.asarray(log_probs, dtype=np.float64)
        k = len(self.token_sets)
        out = np.full((k, k, log_probs.shape[0]), NEG_INF)
        rows = range(k) if expected is None else sorted(set(expected))
        for c in rows:
            accepted = self.token_sets[c]
            for a, tokens in enumerate(self.token_sets):
                if a == c:
                    continue
                ids = sorted(tokens - accepted)
                if ids:
                    out[c, a] = _logsumexp_cols(log_probs, ids)
        return out


def load_inventory(vocab_path) -> Inventory:
    """An Inventory from the recogniser's vocab.json."""
    import json
    from pathlib import Path

    return Inventory(json.loads(Path(vocab_path).read_text(encoding="utf-8")))


def _logsumexp_cols(matrix: np.ndarray, columns: Sequence[int]) -> np.ndarray:
    if not columns:
        return np.full(matrix.shape[0], NEG_INF)
    selected = matrix[:, columns]
    peak = selected.max(axis=1)
    safe = np.where(np.isfinite(peak), peak, 0.0)
    with np.errstate(divide="ignore"):
        return safe + np.log(np.exp(selected - safe[:, None]).sum(axis=1))


def _lse(*arrays: np.ndarray) -> np.ndarray:
    result = arrays[0]
    for array in arrays[1:]:
        result = np.logaddexp(result, array)
    return result


def ctc_forward_backward(labels: Sequence[int], scores: np.ndarray, blank: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """Log-space CTC forward (alpha) and backward (beta) over states [blank, l0, blank, l1, ..., blank].

    alpha[t, s] includes the emission at t; beta[t, s] covers frames t..T-1
    including the emission at t, so log P = logsumexp(alpha[t] + beta[t] - emit[t]).
    """
    frames = scores.shape[0]
    n_states = 2 * len(labels) + 1
    emit = np.empty((frames, n_states))
    emit[:, 0::2] = blank[:, None]
    if labels:
        emit[:, 1::2] = scores[:, list(labels)]
    # A label state may skip the blank before it when the previous label differs.
    skip = np.zeros(n_states, dtype=bool)
    for i in range(1, len(labels)):
        skip[2 * i + 1] = labels[i] != labels[i - 1]

    alpha = np.full((frames, n_states), NEG_INF)
    alpha[0, 0] = emit[0, 0]
    if labels:
        alpha[0, 1] = emit[0, 1]
    for t in range(1, frames):
        prev = alpha[t - 1]
        stay_or_step = np.logaddexp(prev, np.concatenate(([NEG_INF], prev[:-1])))
        skipped = np.where(skip, np.concatenate(([NEG_INF, NEG_INF], prev[:-2])), NEG_INF)
        alpha[t] = emit[t] + np.logaddexp(stay_or_step, skipped)

    beta = np.full((frames, n_states), NEG_INF)
    beta[-1, -1] = emit[-1, -1]
    if labels:
        beta[-1, -2] = emit[-1, -2]
    skip_from = np.concatenate((skip[2:], [False, False]))  # state s may jump to s+2
    for t in range(frames - 2, -1, -1):
        nxt = beta[t + 1]
        stay_or_step = np.logaddexp(nxt, np.concatenate((nxt[1:], [NEG_INF])))
        skipped = np.where(skip_from, np.concatenate((nxt[2:], [NEG_INF, NEG_INF])), NEG_INF)
        beta[t] = emit[t] + np.logaddexp(stay_or_step, skipped)

    final = alpha[-1, -1] if not labels else np.logaddexp(alpha[-1, -1], alpha[-1, -2])
    return alpha, beta, float(final)


def sequence_log_likelihood(labels: Sequence[int], scores: np.ndarray, blank: np.ndarray) -> float:
    return ctc_forward_backward(labels, scores, blank)[2]


def score_sequence(
    labels: Sequence[int],
    log_probs: np.ndarray,
    inventory: Inventory,
    *,
    emissions: tuple[np.ndarray, np.ndarray] | None = None,
    exclusive: np.ndarray | None = None,
) -> list[PhonemeScore]:
    """Alignment-free GOP for every position of the expected phoneme sequence `labels`."""
    scores, blank = emissions if emissions is not None else inventory.emissions(log_probs)
    exclusive = exclusive if exclusive is not None else inventory.exclusive_emissions(log_probs, labels)
    frames, n_alt = scores.shape
    n = len(labels)
    if n == 0 or frames == 0:
        return []
    alpha, beta, total = ctc_forward_backward(labels, scores, blank)
    if not np.isfinite(total):
        return [
            PhonemeScore(inventory.labels[c], NEG_INF, DELETED, 0.0, None, None) for c in labels
        ]

    lab = np.asarray(labels)
    idx = np.arange(n)
    # Alternatives' emissions at each position: (n, K, T), counting only sounds
    # the expected phoneme doesn't accept.
    alt_emit = exclusive[lab]
    prev_lab = np.concatenate(([-1], lab[:-1]))
    next_lab = np.concatenate((lab[1:], [-1]))
    alts = np.arange(n_alt)
    can_skip_in = (alts[None, :] != prev_lab[:, None]) & (idx[:, None] > 0)  # from label i-1
    can_skip_out = (alts[None, :] != next_lab[:, None]) & (idx[:, None] < n - 1)  # to label i+1

    blank_before = 2 * idx  # state index of the blank before position i
    label_before = 2 * idx - 1
    blank_after = 2 * idx + 2
    label_after = 2 * idx + 3

    # gamma[i, a]: paths in the substituted label state at time t.
    gamma = np.full((n, n_alt), NEG_INF)
    sub = np.full((n, n_alt), NEG_INF)
    for t in range(frames):
        if t == 0:
            enter = np.where(idx[:, None] == 0, 0.0, NEG_INF) * np.ones((1, n_alt))
        else:
            via_blank = alpha[t - 1, blank_before][:, None]
            via_label = np.where(idx > 0, alpha[t - 1, np.maximum(label_before, 0)], NEG_INF)[:, None]
            enter = np.logaddexp(via_blank, np.where(can_skip_in, via_label, NEG_INF))
        gamma = alt_emit[:, :, t] + np.logaddexp(enter, gamma)
        if t == frames - 1:
            leave = np.where(idx[:, None] == n - 1, 0.0, NEG_INF) * np.ones((1, n_alt))
        else:
            via_blank = beta[t + 1, blank_after][:, None]
            via_label = np.where(idx < n - 1, beta[t + 1, np.minimum(label_after, 2 * n)], NEG_INF)[:, None]
            leave = np.logaddexp(via_blank, np.where(can_skip_out, via_label, NEG_INF))
        sub = np.logaddexp(sub, gamma + leave)

    deletion = np.array([_deletion_log_likelihood(i, labels, alpha, beta, blank) for i in range(n)])

    # Posterior of each outcome at each position (the expected phoneme's own
    # likelihood is the sequence total).
    sub[idx, lab] = total
    denominator = _lse(sub.max(axis=1) + np.log(np.exp(sub - sub.max(axis=1, keepdims=True)).sum(axis=1)), deletion)
    gop = total - denominator
    competitors = sub.copy()
    competitors[idx, lab] = NEG_INF
    best_alt = competitors.argmax(axis=1)
    best_sub = competitors[idx, best_alt]
    use_deletion = deletion > best_sub

    # Expected-sequence occupancy gives each phoneme's time span.
    emit_labels = scores[:, lab]  # (T, n)
    occupancy = alpha[:, 1::2] + beta[:, 1::2] - emit_labels - total  # (T, n) log posterior
    results = []
    for i, c in enumerate(labels):
        frames_on = np.nonzero(occupancy[:, i] > np.log(0.5))[0]
        if frames_on.size == 0:
            frames_on = np.array([int(np.argmax(occupancy[:, i]))])
        alt_label = DELETED if use_deletion[i] else inventory.labels[best_alt[i]]
        alt_score = (deletion[i] if use_deletion[i] else best_sub[i]) - denominator[i]
        results.append(
            PhonemeScore(
                phoneme=inventory.labels[c],
                gop=float(min(0.0, gop[i])),
                best_alternative=alt_label,
                alternative_gop=float(min(0.0, alt_score)),
                start=round(float(frames_on[0]) * FRAME_SECONDS, 3),
                end=round(float(frames_on[-1] + 1) * FRAME_SECONDS, 3),
            )
        )
    return results


def _deletion_log_likelihood(i: int, labels: Sequence[int], alpha: np.ndarray, beta: np.ndarray, blank: np.ndarray) -> float:
    """log P of the expected sequence with position i removed, from the full sequence's alpha/beta."""
    n = len(labels)
    frames = alpha.shape[0]
    if n == 1:
        return float(np.sum(blank))
    if i == n - 1:
        # Paths end in the previous label or the blank after it.
        return float(np.logaddexp(alpha[-1, 2 * i - 1], alpha[-1, 2 * i]))
    target = 2 * i + 3  # label i+1
    # Each path enters label i+1 exactly once: count it at that moment, coming
    # from the blank before position i (or straight from label i-1 if allowed).
    source = alpha[:-1, 2 * i]
    if i > 0 and labels[i + 1] != labels[i - 1]:
        source = np.logaddexp(source, alpha[:-1, 2 * i - 1])
    entries = source + beta[1:, target] if frames > 1 else np.array([NEG_INF])
    total = np.logaddexp.reduce(entries)
    if i == 0:
        total = np.logaddexp(total, beta[0, target])  # starts directly on label 1
    return float(total)
