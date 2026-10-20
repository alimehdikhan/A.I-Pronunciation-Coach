"""Word stress (experimental): which syllable sounded stressed, and a slip only when every cue agrees."""

import numpy as np

from backend import pronunciation, stress
from tests.conftest import PROFILE_KEY, timed_words, wav_bytes
from tests.test_tiers import CLEAN, heard

RATE = 16000
SYLLABLES = [{"phonemes": ["v", "ɛ"], "stress": 1}, {"phonemes": ["r", "i"], "stress": 0}]


def tone(seconds, hz, amplitude):
    t = np.arange(int(seconds * RATE)) / RATE
    return (amplitude * np.sin(2 * np.pi * hz * t)).astype(np.float32)


def word(first, second):
    """Samples and timings for "very": each vowel is (seconds, pitch Hz, amplitude)."""
    gap = np.zeros(int(0.05 * RATE), np.float32)
    a, b = tone(*first), tone(*second)
    samples = np.concatenate([gap, a, gap, b, gap])
    a_start, b_start = 0.05, 0.05 + first[0] + 0.05
    phonemes = [
        {"phoneme": "v", "start": 0.0, "end": 0.05},
        {"phoneme": "ɛ", "start": a_start, "end": a_start + first[0]},
        {"phoneme": "r", "start": a_start + first[0], "end": b_start},
        {"phoneme": "i", "start": b_start, "end": b_start + second[0]},
    ]
    return phonemes, samples


def test_pitch_of_a_voiced_tone():
    assert abs(stress._pitch(tone(0.2, 180, 0.3)) - 180) < 10
    assert stress._pitch(np.zeros(3200, np.float32)) is None


def test_the_syllable_that_is_longer_louder_and_higher_sounds_stressed():
    phonemes, samples = word((0.08, 140, 0.05), (0.22, 240, 0.4))  # the second syllable wins on every cue
    result = stress.word_stress(phonemes, SYLLABLES, samples)
    assert result["expected"] == 0 and result["heard"] == 1 and result["error"] is True


def test_mixed_cues_are_not_called_a_slip():
    phonemes, samples = word((0.22, 140, 0.4), (0.08, 240, 0.05))  # longer and louder first, higher second
    result = stress.word_stress(phonemes, SYLLABLES, samples)
    assert result["error"] is False and result["heard"] == 0


def test_words_that_cannot_be_judged():
    phonemes, samples = word((0.1, 150, 0.2), (0.1, 150, 0.2))
    assert stress.word_stress(phonemes, SYLLABLES[:1], samples) is None  # one syllable
    untimed = [dict(p, start=None) if p["phoneme"] == "i" else p for p in phonemes]
    assert stress.word_stress(untimed, SYLLABLES, samples) is None


def test_the_stress_check_runs_only_when_asked(client, fake_asr, monkeypatch):
    from backend.runtime import runtime

    fake_asr.text, fake_asr.words = "very good", timed_words("very good")
    monkeypatch.setattr(runtime, "phonemes", type("P", (), {"log_probs": lambda self, s: np.zeros((10, 5), np.float32)})())
    monkeypatch.setattr(runtime.scorer, "inventory", object())
    monkeypatch.setattr(pronunciation, "analyse_acoustics", lambda tokens, lp, inv: [
        heard("very", [CLEAN] * 4), heard("good", [CLEAN] * 3)
    ])

    def evaluate(flag):
        data = {"target_text": "Very good.", "stress": "true" if flag else "false", "username": "Asha"}
        return client.post("/api/evaluate", data=data, files={"audio": ("a.wav", wav_bytes(), "audio/wav")},
                           headers={"X-Profile-Key": PROFILE_KEY}).json()

    off = evaluate(False)
    assert "stress" not in off["words"][0] and "_samples" not in off
    on = evaluate(True)
    assert set(on["words"][0]["stress"]) == {"expected", "heard", "margin", "error", "prominence"}
    assert "stress" not in on["words"][1]  # one syllable
