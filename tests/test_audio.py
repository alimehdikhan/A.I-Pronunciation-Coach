"""Audio decoding, limits and loudness normalisation."""

import subprocess

import numpy as np
import pytest

from backend.audio import AudioError, decode_audio, normalize_loudness, resolve_ffmpeg
from tests.conftest import wav_bytes


def rms(samples):
    return float(np.sqrt(np.mean(samples ** 2)))


def test_wav_fast_path_decodes_16k_mono_and_stereo():
    mono = decode_audio(wav_bytes(seconds=1.0, amplitude=0.1), ".wav", 60)
    stereo = decode_audio(wav_bytes(seconds=1.0, amplitude=0.1, channels=2), ".wav", 60)

    assert mono.dtype == np.float32 and mono.size == 16000
    assert stereo.size == 16000
    assert abs(rms(mono) - 0.1 / np.sqrt(2)) < 0.005


def test_ffmpeg_path_resamples_other_formats(tmp_path):
    data = wav_bytes(seconds=1.0, rate=44100)  # not 16 kHz: goes through ffmpeg

    samples = decode_audio(data, ".wav", 60)

    assert abs(samples.size - 16000) < 50


def test_compressed_upload_decodes(tmp_path):
    source = tmp_path / "tone.wav"
    source.write_bytes(wav_bytes(seconds=1.0))
    webm = tmp_path / "tone.webm"
    subprocess.run([resolve_ffmpeg(), "-y", "-loglevel", "error", "-i", str(source), "-c:a", "libopus", str(webm)], check=True)

    samples = decode_audio(webm.read_bytes(), ".webm", 60)

    assert abs(samples.size - 16000) < 400


def test_too_long_recordings_are_rejected():
    with pytest.raises(AudioError) as caught:
        decode_audio(wav_bytes(seconds=3.0), ".wav", 2)
    assert caught.value.status_code == 413

    with pytest.raises(AudioError) as caught:
        decode_audio(wav_bytes(seconds=3.0, rate=44100), ".wav", 2)
    assert caught.value.status_code == 413


def test_garbage_and_playlists_are_rejected(tmp_path):
    with pytest.raises(AudioError):
        decode_audio(b"definitely not audio", ".webm", 60)
    # An HLS playlist pointing at a local file must not be followed.
    secret = tmp_path / "secret.wav"
    secret.write_bytes(wav_bytes(seconds=1.0))
    playlist = f"#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:{secret.as_posix()}\n#EXT-X-ENDLIST\n"
    with pytest.raises(AudioError):
        decode_audio(playlist.encode(), ".webm", 60)


def test_quiet_speech_is_boosted_and_loud_speech_untouched():
    t = np.arange(32000) / 16000
    speech = (np.sin(2 * np.pi * 200 * t) * (np.sin(2 * np.pi * 1.5 * t) > 0)).astype(np.float32)

    voiced = speech != 0
    quiet, gain = normalize_loudness(speech * 0.01)
    assert gain > 15
    assert 0.08 < rms(quiet[voiced]) < 0.12  # speech lands near -20 dBFS
    assert np.abs(quiet).max() < 1.0

    very_quiet, gain = normalize_loudness(speech * 0.001)
    assert gain == 24.1  # capped at +24 dB so noise isn't blown up

    loud, gain = normalize_loudness(speech * 0.5)
    assert gain == 0.0
    assert np.allclose(loud, speech * 0.5 - (speech * 0.5).mean(), atol=1e-6)


def test_silence_is_not_amplified():
    silence = np.zeros(16000, dtype=np.float32)
    out, gain = normalize_loudness(silence)
    assert gain == 0.0 and not out.any()


def test_gain_is_capped_and_peaks_are_limited():
    t = np.arange(16000) / 16000
    spiky = (np.sin(2 * np.pi * 200 * t) * 0.001).astype(np.float32)
    spiky[8000] = 0.2  # a click far above the speech level

    out, gain = normalize_loudness(spiky)

    assert gain <= 24.1
    assert np.abs(out).max() <= 1.0  # the click is soft-limited, never wrapped
