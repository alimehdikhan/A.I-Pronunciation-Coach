"""Noise reduction and the background-voice gate, on synthetic speech-like audio."""

import numpy as np

from backend.enhance import SAMPLE_RATE, enhance, estimate_snr

RNG = np.random.default_rng(7)


def voiced(seconds: float, level: float, pitch: float = 140.0) -> np.ndarray:
    """Harmonic bursts with a syllable-like rhythm: enough like speech for level-based processing."""
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    tone = sum(np.sin(2 * np.pi * pitch * k * t) / k for k in range(1, 12))
    syllables = 0.5 * (1 + np.sin(2 * np.pi * 3.5 * t - np.pi / 2))
    signal = tone * syllables
    return (signal / np.sqrt(np.mean(signal**2)) * level).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)


def room(noise_level: float, seconds: float) -> np.ndarray:
    return (RNG.standard_normal(int(seconds * SAMPLE_RATE)) * noise_level).astype(np.float32)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64))))


def test_clean_speech_is_left_untouched():
    clip = np.concatenate([silence(0.4), voiced(1.5, 0.1), silence(0.4)]) + room(0.0005, 2.3)

    out, info = enhance(clip)

    assert info["denoised"] is False and info["background_voices"] == 0
    assert np.array_equal(out, clip.astype(np.float32))


def test_a_noisy_room_is_quietened_between_words_and_the_voice_survives():
    speech = np.concatenate([silence(0.5), voiced(1.5, 0.1), silence(0.5), voiced(1.0, 0.1), silence(0.5)])
    noisy = speech + room(0.03, speech.size / SAMPLE_RATE)
    assert estimate_snr(noisy)[0] < 24

    out, info = enhance(noisy)

    gap = slice(int(0.1 * SAMPLE_RATE), int(0.4 * SAMPLE_RATE))
    assert info["denoised"] is True
    assert rms(out[gap]) < 0.5 * rms(noisy[gap])  # the hiss in a pause drops by at least 6 dB
    voice = slice(int(0.7 * SAMPLE_RATE), int(1.9 * SAMPLE_RATE))
    assert rms(out[voice]) > 0.5 * rms(noisy[voice])  # while the voice stays at a similar level
    assert out.shape == noisy.shape and out.dtype == np.float32


def test_a_much_quieter_second_voice_is_turned_down():
    near = voiced(1.2, 0.12, pitch=130)
    far = voiced(1.2, 0.012, pitch=210)  # 20 dB below, as if across the room
    clip = np.concatenate([silence(0.3), near, silence(0.6), far, silence(0.3)])
    clip = clip + room(0.0004, clip.size / SAMPLE_RATE)

    out, info = enhance(clip)

    far_part = slice(int(2.3 * SAMPLE_RATE), int(3.3 * SAMPLE_RATE))
    near_part = slice(int(0.5 * SAMPLE_RATE), int(1.3 * SAMPLE_RATE))
    assert info["background_voices"] == 1
    assert rms(out[far_part]) < 0.2 * rms(clip[far_part])
    assert rms(out[near_part]) > 0.95 * rms(clip[near_part])


def test_short_silent_and_odd_input_is_returned_safely():
    for clip in (np.zeros(100, dtype=np.float32), silence(1.0), room(0.5, 1.0), np.full(16000, 0.2, dtype=np.float32)):
        out, info = enhance(clip)
        assert out.shape == clip.shape and np.all(np.isfinite(out)) and "denoised" in info


def test_the_method_used_is_reported_and_the_spectral_filter_can_be_forced():
    speech = np.concatenate([silence(0.5), voiced(1.5, 0.1), silence(0.5)])
    noisy = speech + room(0.03, speech.size / SAMPLE_RATE)

    _, forced = enhance(noisy, neural=False)
    _, auto = enhance(noisy)

    assert forced["method"] == "spectral"
    assert auto["method"] in ("spectral", "rnnoise")  # RNNoise only where the wheel is installed
    assert enhance(speech + room(0.0003, speech.size / SAMPLE_RATE))[1]["method"] is None  # clean: untouched
