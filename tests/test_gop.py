"""GOP maths checked against brute-force CTC path enumeration on tiny inputs."""

import itertools

import numpy as np
import pytest

from backend import gop

VOCAB = {"<pad>": 0, "a": 1, "b": 2, "c": 3, "x": 4}
TOKENS = {"a": ("a",), "b": ("b",), "c": ("c",)}  # "x" falls into the OTHER bucket


def random_log_probs(frames, seed):
    rng = np.random.default_rng(seed)
    logits = rng.normal(size=(frames, len(VOCAB))) * 2
    return logits - np.logaddexp.reduce(logits, axis=1, keepdims=True)


def collapse(path):
    out = []
    for i, token in enumerate(path):
        if token != 0 and (i == 0 or token != path[i - 1]):
            out.append(token)
    return tuple(out)


def brute_log_likelihood(tokens, log_probs):
    """log P(token sequence) by summing every frame-level path that collapses to it."""
    frames = log_probs.shape[0]
    total = -np.inf
    for path in itertools.product(range(len(VOCAB)), repeat=frames):
        if collapse(path) == tuple(tokens):
            total = np.logaddexp(total, sum(log_probs[t, s] for t, s in enumerate(path)))
    return total


def to_tokens(labels, inventory):
    # Each class here holds exactly one token.
    return [next(iter(inventory.token_sets[label])) for label in labels]


@pytest.mark.parametrize("labels", [[0], [0, 1], [0, 0], [0, 1, 0], [2, 1, 1], [1, 0, 2]])
def test_forward_backward_matches_brute_force(labels):
    inventory = gop.Inventory(VOCAB, TOKENS)
    log_probs = random_log_probs(6, seed=len(labels) * 7 + labels[0])
    scores, blank = inventory.emissions(log_probs)

    alpha, beta, total = gop.ctc_forward_backward(labels, scores, blank)

    assert total == pytest.approx(brute_log_likelihood(to_tokens(labels, inventory), log_probs), abs=1e-9)
    # alpha * beta / emission sums to the total at every frame.
    emit = np.empty_like(alpha)
    emit[:, 0::2] = blank[:, None]
    emit[:, 1::2] = scores[:, labels]
    per_frame = np.logaddexp.reduce(alpha + beta - emit, axis=1)
    assert np.allclose(per_frame, total)


@pytest.mark.parametrize("labels", [[0, 1, 2], [0, 0], [1, 2, 1], [2]])
def test_gop_is_the_exact_posterior_of_each_expected_phoneme(labels):
    inventory = gop.Inventory(VOCAB, TOKENS)
    log_probs = random_log_probs(6, seed=sum(labels) + 3)
    scores = gop.score_sequence(labels, log_probs, inventory)

    total = brute_log_likelihood(to_tokens(labels, inventory), log_probs)
    for i, result in enumerate(scores):
        outcomes = {}
        for alt in range(len(inventory.labels)):
            variant = list(labels)
            variant[i] = alt
            outcomes[inventory.labels[alt]] = brute_log_likelihood(to_tokens(variant, inventory), log_probs)
        outcomes[gop.DELETED] = brute_log_likelihood(to_tokens(labels[:i] + labels[i + 1:], inventory), log_probs)
        denominator = np.logaddexp.reduce(list(outcomes.values()))

        assert result.gop == pytest.approx(min(0.0, total - denominator), abs=1e-9)
        del outcomes[inventory.labels[labels[i]]]
        best = max(outcomes, key=outcomes.get)
        assert result.best_alternative == best
        assert result.alternative_gop == pytest.approx(outcomes[best] - denominator, abs=1e-9)


def test_clear_substitution_is_diagnosed():
    """Audio that plainly says "a c" when "a b" was expected."""
    inventory = gop.Inventory(VOCAB, TOKENS)
    frames = [0, 1, 1, 0, 3, 3, 0]  # blank a a blank c c blank
    log_probs = np.full((len(frames), len(VOCAB)), np.log(0.01))
    for t, token in enumerate(frames):
        log_probs[t, token] = np.log(0.96)

    first, second = gop.score_sequence([0, 1], log_probs, inventory)

    assert first.gop > np.log(0.9)
    assert second.gop < np.log(0.05)
    assert second.best_alternative == "c"
    assert first.start == pytest.approx(0.02) and first.end == pytest.approx(0.06)


def test_shared_tokens_do_not_count_against_the_expected_phoneme():
    """A flap is a fine /t/ and a fine /d/; hearing it must not suggest /t/ -> /d/."""
    vocab = {"<pad>": 0, "t": 1, "d": 2, "ɾ": 3}
    inventory = gop.Inventory(vocab, {"t": ("t", "ɾ"), "d": ("d", "ɾ")})
    log_probs = np.full((3, 4), np.log(0.01))
    log_probs[:, 0] = np.log(0.97)
    log_probs[1] = np.log([0.01, 0.01, 0.01, 0.97])

    (result,) = gop.score_sequence([0], log_probs, inventory)

    assert result.gop > np.log(0.9)
