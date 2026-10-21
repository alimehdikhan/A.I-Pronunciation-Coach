"""Trained sound models: the features, every model kind, the app's scale, and choosing a model by first language."""

import json
import math

import numpy as np
import pytest

from backend import acoustic, gop, learners, pronunciation, sound_model
from backend.acoustic import PhonemeResult, WordAcoustics
from backend.phonetics import primary_pronunciation
from backend.pronunciation import PronunciationScorer

IDENTITY = {"x": [0.0, 1.0], "y": [0.0, 1.0]}


def spec(kind="sigmoid", params=None, remap=IDENTITY, profile="south_asian", languages=("Hindi", "Urdu"), calibration=None):
    return {
        "format": sound_model.FORMAT, "profile": profile, "kind": kind, "features": sound_model.FEATURE_NAMES,
        "params": params if params is not None else {"slope": acoustic.GOP_SLOPE, "offset": acoustic.GOP_OFFSET},
        "calibration": calibration, "remap": remap, "first_languages": list(languages), "version": "test",
    }


def scores(*gops, alternative="s"):
    return [gop.PhonemeScore(p, g, alternative, g - 2.0, 0.1 * i, 0.1 * i + 0.08) for i, (p, g) in enumerate(gops)]


def test_features_describe_each_sound_and_its_neighbours():
    x = sound_model.features(scores(("θ", -6.0), ("ɪ", -0.5), ("ŋ", -float("inf"))))
    column = {name: i for i, name in enumerate(sound_model.FEATURE_NAMES)}
    assert x.shape == (3, len(sound_model.FEATURE_NAMES))
    assert list(x[:, column["gop"]]) == [-6.0, -0.5, sound_model.GOP_FLOOR]  # -inf is floored, never NaN
    assert x[1, column["previous_gop"]] == -6.0 and x[1, column["next_gop"]] == sound_model.GOP_FLOOR
    assert list(x[:, column["first"]]) == [1, 0, 0] and list(x[:, column["last"]]) == [0, 0, 1]
    assert x[0, column["sound_θ"]] == 1 and x[0, column["class_fricative"]] == 1 and x[1, column["class_vowel"]] == 1
    assert x[1, column["previous_vowel"]] == 0 and x[0, column["next_vowel"]] == 1
    assert not np.isnan(x).any()


def test_a_sigmoid_model_with_the_default_parameters_is_the_default_curve():
    model = sound_model.SoundModel(spec())
    results = scores(("θ", -9.0), ("ɪ", -0.2), ("s", -3.0))
    assert model.score(results) == pytest.approx([acoustic.acceptance(r.gop) for r in results])


def test_trees_follow_their_splits_and_send_missing_values_the_learned_way():
    gop_column = sound_model.FEATURE_NAMES.index("gop")
    tree = {"feature": [gop_column, 0, 0], "threshold": [-4.0, 0.0, 0.0], "left": [1, 0, 0], "right": [2, 0, 0],
            "missing_left": [True, False, False], "leaf": [False, True, True], "value": [0.0, -3.0, 2.0]}
    model = sound_model.SoundModel(spec("trees", {"baseline": 0.5, "trees": [tree]}))
    x = sound_model.features(scores(("θ", -9.0), ("ɪ", -0.2)))
    assert model.raw(x) == pytest.approx([1 / (1 + math.exp(2.5)), 1 / (1 + math.exp(-2.5))])
    x[0, gop_column] = np.nan
    assert model.raw(x)[0] == pytest.approx(1 / (1 + math.exp(2.5)))


def test_a_logistic_model_standardises_before_weighing():
    n = len(sound_model.FEATURE_NAMES)
    params = {"mean": [0.0] * n, "scale": [2.0] * n, "coef": [1.0] + [0.0] * (n - 1), "intercept": 1.0}
    model = sound_model.SoundModel(spec("logistic", params))
    assert model.raw(sound_model.features(scores(("θ", -4.0))))[0] == pytest.approx(1 / (1 + math.exp(1.0)))


def test_calibration_and_the_remap_put_the_models_cut_offs_on_the_apps_scale():
    remap = {"x": [0.0, 0.5, 0.65, 1.0], "y": [0.0, 0.70, 0.80, 1.0]}
    calibration = {"x": [0.0, 1.0], "y": [0.0, 1.0]}
    model = sound_model.SoundModel(spec(remap=remap, calibration=calibration))
    x = np.zeros((3, len(sound_model.FEATURE_NAMES)))
    for row, wanted in enumerate((0.5, 0.65, 0.9)):
        x[row, 0] = (math.log(wanted / (1 - wanted)) - acoustic.GOP_OFFSET) / acoustic.GOP_SLOPE
    assert model.predict(x) == pytest.approx([0.70, 0.80, 0.80 + 0.2 * (0.9 - 0.65) / 0.35])


def test_a_model_trained_on_other_features_is_refused():
    with pytest.raises(ValueError):
        sound_model.SoundModel({**spec(), "features": sound_model.FEATURE_NAMES[:-1]})


def test_the_model_is_chosen_by_first_language(tmp_path):
    (tmp_path / "south_asian.json").write_text(json.dumps(spec()), encoding="utf-8")
    (tmp_path / "broken.json").write_text("{not json", encoding="utf-8")
    assert sound_model.for_learner("Hindi", tmp_path).profile == "south_asian"
    assert sound_model.for_learner("French", tmp_path) is None and sound_model.for_learner(None, tmp_path) is None


def test_learners_get_the_model_unless_models_are_switched_off(monkeypatch):
    model = sound_model.SoundModel(spec())
    monkeypatch.setattr(sound_model, "installed", lambda directory=None: (model,))
    assert learners.sound_model_for("Urdu") is model and "Hindi" in learners.tuned_languages()
    assert learners.options()["tuned_languages"] == ["Hindi", "Urdu"]
    monkeypatch.setattr(learners, "settings", type("S", (), {"sound_models": False})())
    assert learners.sound_model_for("Urdu") is None and learners.tuned_languages() == []


def test_the_scorer_hands_the_model_to_the_sound_analysis_and_reports_it(monkeypatch):
    seen = {}
    model = sound_model.SoundModel(spec())

    def fake_analyse(tokens, log_probs, inventory, model=None):
        seen["model"] = model
        return [WordAcoustics(primary_pronunciation(t), [PhonemeResult(p, 0.99, -0.1, "s", None, None)
                                                         for p in primary_pronunciation(t).phonemes]) for t in tokens]

    monkeypatch.setattr(pronunciation, "analyse_acoustics", fake_analyse)
    scorer = PronunciationScorer(inventory=object())
    result = scorer.score_pronunciation("I think so.", "I think so", "intermediate", None, None, np.zeros((5, 3)), sound_model=model)
    assert seen["model"] is model and result["phoneme_analysis"]["sound_model"] == "south_asian"
    default = scorer.score_pronunciation("I think so.", "I think so", "intermediate", None, None, np.zeros((5, 3)))
    assert seen["model"] is None and default["phoneme_analysis"]["sound_model"] is None


def test_practice_uses_the_model_for_the_learners_first_language(client, monkeypatch):
    from backend.api import speech
    from backend.runtime import runtime
    from tests.conftest import PROFILE_KEY, wav_bytes

    key = {"X-Profile-Key": PROFILE_KEY}
    model = sound_model.SoundModel(spec())
    monkeypatch.setattr(sound_model, "installed", lambda directory=None: (model,))
    used = []
    original = runtime.scorer.score_pronunciation
    monkeypatch.setattr(runtime.scorer, "score_pronunciation", lambda *a, **k: used.append(a[-1]) or original(*a, **k))

    def attempt():
        return client.post("/api/evaluate", data={"target_text": "Hello world", "username": "Asha"},
                           files={"audio": ("a.wav", wav_bytes(), "audio/wav")}, headers=key)

    assert attempt().status_code == 200 and used[-1] is None  # no first language yet: the default curve
    client.put("/api/learner/Asha", json={"first_language": "Hindi"}, headers=key)
    assert attempt().status_code == 200 and used[-1] is model
    assert speech.learners is learners


def test_the_training_export_gives_exactly_what_scikit_learn_gives():
    pytest.importorskip("sklearn")
    from scripts import train_sound_model as training

    rng = np.random.default_rng(1)
    n = 600
    x = rng.normal(size=(n, len(sound_model.FEATURE_NAMES)))
    y = np.clip((x[:, 0] > 0).astype(float) * 0.8 + rng.uniform(0, 0.2, n), 0, 1)
    table = training.Table(x, y, np.ones(n), np.array(["Hindi"] * n), np.array(["s"] * n), np.array([f"u{i % 30}" for i in range(n)]))
    for kind in ("sigmoid", "logistic", "trees"):
        params = training.FITTERS[kind](table)  # the trees exporter checks itself against predict_proba
        model = training._model("south_asian", kind, params)
        assert model.raw(x).shape == (n,)
    keep = training.confident_rows(table, "logistic")
    assert keep.dtype == bool and keep.mean() > 0.8


def test_cut_offs_never_flag_much_correct_native_speech():
    pytest.importorskip("sklearn")
    from scripts import train_sound_model as training

    rng = np.random.default_rng(2)
    n = 2000
    wrong = rng.random(n) < 0.15
    prob = np.where(wrong, rng.uniform(0.0, 0.8, n), rng.uniform(0.5, 1.0, n))  # the best F1 cut-off is above 0.5
    table = training.Table(np.zeros((n, len(sound_model.FEATURE_NAMES))), np.where(wrong, 0.0, 1.0), np.ones(n),
                           np.array(["Hindi"] * n), np.array(["s"] * n), np.array([f"u{i % 50}" for i in range(n)]))
    unlimited = training.choose_cutoffs(prob, table)

    # Correct native speech in which /ð/ always scores low: the cut-off must drop below it.
    native_sounds = np.array(["ð", "s", "t", "ɪ"] * 100)
    native_prob = np.where(native_sounds == "ð", 0.45, 0.95)
    limited = training.choose_cutoffs(prob, table, native_prob, native_sounds)
    assert limited[0] < unlimited[0] and limited[0] <= 0.45 and limited[1] < limited[0]
    shares = training.native_shares(native_prob, native_sounds, flag=limited[0], fix=limited[1])
    assert shares["sound_flagged"] <= training.TUNE_LIMITS["sound_flagged"]

    # When even the lowest cut-off flags too much native speech, there is no usable cut-off.
    assert training.choose_cutoffs(prob, table, np.zeros(400), native_sounds) is None
