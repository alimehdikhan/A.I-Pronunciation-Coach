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


def _states(labels: Sequence[int], scores: np.ndarray, blank: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Each state's emission per frame, and which label states may skip the blank before them."""
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
    return emit, skip


def _forward(labels: Sequence[int], emit: np.ndarray, skip: np.ndarray) -> tuple[np.ndarray, float]:
    frames, n_states = emit.shape
    alpha = np.full((frames, n_states), NEG_INF)
    alpha[0, 0] = emit[0, 0]
    if labels:
        alpha[0, 1] = emit[0, 1]
    for t in range(1, frames):
        prev = alpha[t - 1]
        stay_or_step = np.logaddexp(prev, np.concatenate(([NEG_INF], prev[:-1])))
        # (Sliced to the state count: with no labels there is a single state.)
        skipped = np.where(skip, np.concatenate(([NEG_INF, NEG_INF], prev[:-2]))[:n_states], NEG_INF)
        alpha[t] = emit[t] + np.logaddexp(stay_or_step, skipped)
    final = alpha[-1, -1] if not labels else np.logaddexp(alpha[-1, -1], alpha[-1, -2])
    return alpha, float(final)


def ctc_forward_backward(labels: Sequence[int], scores: np.ndarray, blank: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """Log-space CTC forward (alpha) and backward (beta) over states [blank, l0, blank, l1, ..., blank].

    alpha[t, s] includes the emission at t; beta[t, s] covers frames t..T-1
    including the emission at t, so log P = logsumexp(alpha[t] + beta[t] - emit[t]).
    """
    emit, skip = _states(labels, scores, blank)
    frames, n_states = emit.shape
    alpha, final = _forward(labels, emit, skip)

    beta = np.full((frames, n_states), NEG_INF)
    beta[-1, -1] = emit[-1, -1]
    if labels:
        beta[-1, -2] = emit[-1, -2]
    skip_from = np.concatenate((skip[2:], [False, False]))[:n_states]  # state s may jump to s+2
    for t in range(frames - 2, -1, -1):
        nxt = beta[t + 1]
        stay_or_step = np.logaddexp(nxt, np.concatenate((nxt[1:], [NEG_INF])))
        skipped = np.where(skip_from, np.concatenate((nxt[2:], [NEG_INF, NEG_INF]))[:n_states], NEG_INF)
        beta[t] = emit[t] + np.logaddexp(stay_or_step, skipped)

    return alpha, beta, final


def sequence_log_likelihood(labels: Sequence[int], scores: np.ndarray, blank: np.ndarray) -> float:
    """log P of `labels` (the forward pass alone)."""
    emit, skip = _states(labels, scores, blank)
    return _forward(labels, emit, skip)[1]


# Paths through a replaced stretch that carry less than exp(-REPLACE_MARGIN) of the reference are left
# out of `replaced_log_likelihood`. Even all of them together are far below what a double can add to the
# reference, so the result is the same as computing the whole sequence again.
REPLACE_MARGIN = 60.0


def replaced_log_likelihood(
    labels: Sequence[int],
    alpha: np.ndarray,
    beta: np.ndarray,
    start: int,
    end: int,
    segment: Sequence[int],
    scores: np.ndarray,
    blank: np.ndarray,
    reference: float,
    margin: float = REPLACE_MARGIN,
) -> float:
    """log P of `labels` with positions [start, end) replaced by `segment`, from the alpha and beta of `labels`.

    Nothing before or after the replaced stretch changes, so the forward variables of the states before it
    (alpha) and the backward variables of the states after it (beta) are reused, and only the stretch's own
    states are computed: over the frames where a path through it can come within `margin` of `reference`
    (each path's mass is at most what it carries in and out, since emissions are probabilities). A result
    far below `reference` may be underestimated, never overestimated; one near or above it is exact.
    Returns -inf when no frame qualifies.
    """
    n = len(labels)
    return stretch_log_likelihood(
        segment,
        scores,
        blank,
        reference,
        into_blank=alpha[:, 2 * start],
        into_label=alpha[:, 2 * start - 1] if start > 0 else None,
        before=labels[start - 1] if start > 0 else None,
        out_of=beta[:, 2 * end + 1] if end < n else None,
        after=labels[end] if end < n else None,
        margin=margin,
    )


def stretch_log_likelihood(
    segment: Sequence[int],
    scores: np.ndarray,
    blank: np.ndarray,
    reference: float,
    *,
    into_blank: np.ndarray,
    into_label: np.ndarray | None,
    before: int | None,
    out_of: np.ndarray | None,
    after: int | None,
    margin: float = REPLACE_MARGIN,
) -> float:
    """The core of `replaced_log_likelihood`, from the columns it reads: the alpha of the blank before the
    stretch (`into_blank`) and of the label before it (`into_label`, label `before`; None at the start),
    and the beta of the first label after it (`out_of`, label `after`; None at the end)."""
    m = len(segment)
    if m == 0:
        raise ValueError("the replacement needs at least one label")
    frames = scores.shape[0]
    floor = reference - margin
    seg = np.asarray(segment)
    start_of_sequence = into_label is None
    end_of_sequence = out_of is None

    # What steps into the stretch: the blank before it, or (skipping that blank) a different label before it.
    if into_label is not None and segment[0] == before:
        into_label = None
    source = into_blank if into_label is None else np.logaddexp(into_blank, into_label)
    # What it steps out to: the first label after it (from its last blank, or skipping that blank).
    skip_out = not end_of_sequence and segment[-1] != after

    # The first frame: a path must leave the prefix late enough to still come within the margin.
    if start_of_sequence:
        lo = 0
    else:
        reach = np.zeros(frames) if end_of_sequence else np.maximum.accumulate(out_of[::-1])[::-1]
        later = reach if end_of_sequence else np.concatenate((reach[1:], [NEG_INF]))
        ok = np.nonzero(source + later >= floor)[0]
        if ok.size == 0 or ok[0] + 1 >= frames:
            return NEG_INF
        lo = int(ok[0]) + 1
    # The last frame: a path must enter the suffix early enough.
    if out_of is None:
        hi = frames - 1
    else:
        so_far = np.zeros(frames) if start_of_sequence else np.concatenate(([NEG_INF], np.maximum.accumulate(source)[:-1]))
        ok = np.nonzero(so_far[:-1] + out_of[1:] >= floor)[0]
        ok = ok[ok >= lo]
        if ok.size == 0:
            return NEG_INF
        hi = int(ok[-1])
    if hi < lo:
        return NEG_INF

    width = 2 * m
    emit = np.empty((hi - lo + 1, width))
    emit[:, 0::2] = scores[lo : hi + 1][:, seg]
    emit[:, 1::2] = blank[lo : hi + 1, None]
    skip = np.zeros(width, dtype=bool)
    skip[2::2] = seg[1:] != seg[:-1]

    total = NEG_INF
    prev = np.full(width, NEG_INF)
    for t in range(lo, hi + 1):
        if t == 0:
            cur = np.full(width, NEG_INF)
            cur[0] = emit[0, 0]  # a path may start on the first label
        else:
            step = np.concatenate(([into_blank[t - 1]], prev[:-1]))
            skipped = np.where(skip, np.concatenate(([NEG_INF, NEG_INF], prev[:-2])), NEG_INF)
            if into_label is not None:
                skipped[0] = into_label[t - 1]
            cur = emit[t - lo] + np.logaddexp(np.logaddexp(prev, step), skipped)
        if out_of is not None and t < frames - 1:
            leaving = np.logaddexp(cur[-1], cur[-2]) if skip_out else cur[-1]
            total = np.logaddexp(total, leaving + out_of[t + 1])
        prev = cur
    if out_of is None:
        total = np.logaddexp(prev[-1], prev[-2])
    return float(total)


class ForwardPass:
    """The alpha of a label sequence, filled in only as far as it is read.

    Changing the labels from some position on keeps every state before it (alpha there depends only on
    what comes before), so a search that changes one word at a time, left to right, computes each state
    about once instead of a whole pass per change. Filled states equal `ctc_forward_backward`'s alpha.
    """

    def __init__(
        self,
        labels: Sequence[int],
        scores: np.ndarray,
        blank: np.ndarray,
        alpha: np.ndarray | None = None,
        longest: int | None = None,
    ):
        """`alpha`: the sequence's full alpha when it is already known (from `ctc_forward_backward`).
        `longest`: the most labels the sequence will ever hold, so changing it never moves what is kept."""
        self.scores, self.blank = scores, blank
        self.labels = list(labels)
        states = 2 * max(len(self.labels), longest or 0) + 1
        self.alpha = np.full((scores.shape[0], states), NEG_INF)
        self.done = -1  # states up to here are filled
        if alpha is not None:
            self.alpha[:, : alpha.shape[1]] = alpha
            self.done = alpha.shape[1] - 1

    def column(self, state: int) -> np.ndarray:
        self._fill(state)
        return self.alpha[:, state]

    def replace(self, start: int, end: int, segment: Sequence[int]) -> None:
        """Positions [start, end) become `segment`; states up to the blank before `start` are kept."""
        self.labels = self.labels[:start] + list(segment) + self.labels[end:]
        if 2 * len(self.labels) + 1 > self.alpha.shape[1]:
            grown = np.full((self.alpha.shape[0], 2 * len(self.labels) + 1), NEG_INF)
            grown[:, : self.alpha.shape[1]] = self.alpha
            self.alpha = grown
        self.done = min(self.done, 2 * start)

    def _fill(self, upto: int) -> None:
        if upto <= self.done:
            return
        a, b = self.done + 1, upto + 1
        alpha = self.alpha
        # Emissions and skips of just these states (state 2i+1 is label i, even states are blanks).
        emit = np.empty((alpha.shape[0], b - a))
        skip = np.zeros(b - a, dtype=bool)
        for k, s in enumerate(range(a, b)):
            if s % 2 == 0:
                emit[:, k] = self.blank
            else:
                i = s // 2
                emit[:, k] = self.scores[:, self.labels[i]]
                skip[k] = i > 0 and self.labels[i] != self.labels[i - 1]
        for s in range(a, b):
            alpha[0, s] = emit[0, s - a] if s <= 1 else NEG_INF  # paths start on the first blank or label
        # Each state reads itself and the two before it, so only those columns are read, never the whole row.
        lo = max(a - 2, 0)
        pad = np.full(2 - (a - lo), NEG_INF)
        for t in range(1, alpha.shape[0]):
            prev = alpha[t - 1, lo:b] if pad.size == 0 else np.concatenate((pad, alpha[t - 1, lo:b]))
            stay_or_step = np.logaddexp(prev[2:], prev[1:-1])
            skipped = np.where(skip, prev[:-2], NEG_INF)
            alpha[t, a:b] = emit[t] + np.logaddexp(stay_or_step, skipped)
        self.done = upto


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
    # Alternatives' emissions, frame by frame: (T, K, K), counting only sounds the expected phoneme doesn't
    # accept. Taken per frame for the positions, never all at once: (n, K, T) grows with the square of the length.
    by_frame = np.ascontiguousarray(np.moveaxis(exclusive, 2, 0))

    blank_before = 2 * idx  # state index of the blank before position i
    label_before = 2 * idx - 1
    blank_after = 2 * idx + 2
    label_after = 2 * idx + 3

    # Entering or leaving position i, an alternative may skip the neighbouring blank unless it is the
    # neighbouring label itself: per position that is one value for every alternative but (at most) one.
    # Computed per position and spread out, which equals the elementwise sum (logaddexp(x, -inf) is x).
    rows_in = idx[1:]
    cols_in = lab[:-1]
    rows_out = idx[:-1]
    cols_out = lab[1:]

    # gamma[i, a]: paths in the substituted label state at time t.
    gamma = np.full((n, n_alt), NEG_INF)
    sub = np.full((n, n_alt), NEG_INF)
    for t in range(frames):
        if t == 0:
            enter = np.where(idx[:, None] == 0, 0.0, NEG_INF) * np.ones((1, n_alt))
        else:
            via_blank = alpha[t - 1, blank_before]
            via_label = np.where(idx > 0, alpha[t - 1, np.maximum(label_before, 0)], NEG_INF)
            enter = np.empty((n, n_alt))
            enter[:] = np.logaddexp(via_blank, via_label)[:, None]
            enter[0] = via_blank[0]  # the first position has no label before it
            enter[rows_in, cols_in] = via_blank[1:]
        gamma = by_frame[t][lab] + np.logaddexp(enter, gamma)
        if t == frames - 1:
            leave = np.where(idx[:, None] == n - 1, 0.0, NEG_INF) * np.ones((1, n_alt))
        else:
            via_blank = beta[t + 1, blank_after]
            via_label = np.where(idx < n - 1, beta[t + 1, np.minimum(label_after, 2 * n)], NEG_INF)
            leave = np.empty((n, n_alt))
            leave[:] = np.logaddexp(via_blank, via_label)[:, None]
            leave[n - 1] = via_blank[n - 1]  # the last position has no label after it
            leave[rows_out, cols_out] = via_blank[:-1]
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
