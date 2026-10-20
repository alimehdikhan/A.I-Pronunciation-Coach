"""Listening drills: contrasts, varied sessions, stored perception and the coach's ear-training block."""

import random

import pytest

from backend import listening, phonetics, teaching
from backend.api import listening as listening_api
from tests.conftest import PROFILE_KEY

KEY = {"X-Profile-Key": PROFILE_KEY}
VOICES = ["af_heart", "am_michael", "bf_emma", "piper"]


def test_every_pair_differs_at_exactly_its_sound():
    contrasts = listening.all_contrasts()
    assert len(contrasts[("θ", "s")].pairs) >= 5 and len(contrasts[("v", "w")].pairs) >= 5
    for (phoneme, other), contrast in contrasts.items():
        for a, b in contrast.pairs:
            ops = [op for op in phonetics.compare_words(a, b).ops if op[0] != "equal"]
            assert ops == [("replace", phoneme, other)], (a, b)


def test_a_session_varies_words_and_voices():
    contrast = listening.all_contrasts()[("θ", "s")]
    trials = listening.build_session([contrast], VOICES, rng=random.Random(3))

    assert len(trials) == listening.TRIALS
    assert len({tuple(t["words"]) for t in trials}) >= 5  # many words, not one pair
    assert len({t["voice"] for t in trials}) >= 3
    by_order = sorted(trials, key=lambda t: t["index"])
    for t in trials:
        assert t["word"] == t["words"][t["answer"]] and t["voice"] in VOICES
    # never the same voice twice in a row in generation order (the list is shuffled afterwards)
    assert [t["index"] for t in by_order] == list(range(listening.TRIALS))


def test_consecutive_voices_differ_before_shuffling(monkeypatch):
    monkeypatch.setattr(random.Random, "shuffle", lambda self, x: None)
    trials = listening.build_session([listening.all_contrasts()[("v", "w")]], VOICES, rng=random.Random(1))
    assert all(a["voice"] != b["voice"] for a, b in zip(trials, trials[1:], strict=False))


def test_one_voice_still_makes_a_session():
    trials = listening.build_session([listening.all_contrasts()[("v", "w")]], ["piper"], 8)
    assert len(trials) == 8 and {t["voice"] for t in trials} == {"piper"}


def test_the_learners_own_confusions_come_first_and_heard_contrasts_drop_out():
    chosen = listening.weakest_contrasts([("v", "w"), ("v", "w"), ("θ", "s")], focus=["r"])
    assert [(c.phoneme, c.other) for c in chosen] == [("v", "w"), ("θ", "s"), ("r", "l")]

    heard = [{"phoneme": "v", "other": "w", "trials": 20, "correct": 19, "accuracy": 0.95}]
    assert ("v", "w") not in [(c.phoneme, c.other) for c in listening.weakest_contrasts([("v", "w")], perception=heard)]


@pytest.fixture()
def voices(monkeypatch):
    def use(ids):
        monkeypatch.setattr(listening_api, "available_voices", lambda: [{"id": i} for i in ids])
        monkeypatch.setattr(listening_api, "_warm", lambda clips: None)
        listening_api.listen_rate_limiter.reset()

    use(VOICES)
    return use


def test_session_endpoint_and_the_few_voices_note(client, voices):
    body = client.get("/api/listen/session/Asha?focus=θ").json()
    assert len(body["trials"]) == 20 and body["note"] is None
    assert {c["phoneme"] for c in body["contrasts"]} == {"θ"}

    voices(["piper"])
    assert "few voices" in client.get("/api/listen/session/Asha").json()["note"]
    voices([])
    body = client.get("/api/listen/session/Asha").json()
    assert body["trials"] == [] and "not available" in body["note"]


def test_results_are_checked_saved_and_shown_on_progress(client, voices):
    answers = [
        {"phoneme": "θ", "other": "s", "word": "think", "chosen": "think", "voice": "af_heart"},
        {"phoneme": "θ", "other": "s", "word": "sink", "chosen": "think", "voice": "bf_emma"},
        {"phoneme": "θ", "other": "s", "word": "think", "chosen": "banana"},  # not a real pair: ignored
    ]
    # A guest gets the summary, nothing is stored.
    guest = client.post("/api/listen/results", json={"trials": answers}).json()
    assert guest["saved"] == 0 and guest["session"] == [{"phoneme": "θ", "other": "s", "trials": 2, "correct": 1, "accuracy": 0.5}]

    # A saved profile needs a first attempt to exist.
    from tests.conftest import wav_bytes

    client.post("/api/evaluate", data={"target_text": "Hello world.", "username": "Asha"},
                files={"audio": ("a.wav", wav_bytes(), "audio/wav")}, headers=KEY)
    saved = client.post("/api/listen/results", json={"username": "Asha", "trials": answers}, headers=KEY).json()
    assert saved["saved"] == 2
    analytics = client.get("/api/analytics/Asha", headers=KEY).json()
    assert analytics["perception"] == [{"phoneme": "θ", "other": "s", "trials": 2, "correct": 1, "accuracy": 0.5}]


def obs(phoneme, ok):
    return (phoneme, ok, None, "think", None)


def test_the_coach_trains_the_ear_first_when_the_learner_mishears():
    rows = [obs("θ", False)] * 4 + [obs("θ", True)]
    weak_ear = [{"phoneme": "θ", "other": "s", "trials": 12, "correct": 7, "accuracy": 0.583}]
    kinds = [s["kind"] for s in teaching.build_plan(rows, perception=weak_ear)["session"]]
    assert kinds == ["learn", "listen", "discriminate", "words", "sentence", "review"]

    good_ear = [{"phoneme": "θ", "other": "s", "trials": 12, "correct": 11, "accuracy": 0.917}]
    too_few = [{"phoneme": "θ", "other": "s", "trials": 4, "correct": 1, "accuracy": 0.25}]
    for perception in (good_ear, too_few, []):
        assert "discriminate" not in [s["kind"] for s in teaching.build_plan(rows, perception=perception)["session"]]
    stricter = teaching.build_plan(rows, perception=good_ear, perception_threshold=0.95)
    assert "discriminate" in [s["kind"] for s in stricter["session"]]
