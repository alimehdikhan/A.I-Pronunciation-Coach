"""
Clean a recording before the models hear it.

Two steps, both plain numpy so the server needs nothing new installed:

1. Spectral noise reduction. The room's noise spectrum is learned from the
   quietest part of the recording itself (fans, hiss, hum, traffic) and removed
   with a smoothed Wiener-style gain. It only runs when the recording is audibly
   noisy: clean speech is returned untouched, because any filter costs a little
   accuracy on the fricatives the pronunciation scorer cares about.
2. A dominant-voice gate. The learner sits closest to the microphone, so they are
   the loudest talker. Stretches of speech far quieter than that (people talking
   behind them, a TV in the next room) are turned down. Someone talking at the
   same time as the learner cannot be separated by loudness; that needs a model.

``scripts/eval_noise.py`` measures what this does to scoring accuracy.
"""

from __future__ import annotations

import ctypes
import importlib.util
import logging
import sys
import threading
from pathlib import Path

import numpy as np

logger = logging.getLogger("pronunciation_coach.enhance")

SAMPLE_RATE = 16000

FRAME = 512  # 32 ms analysis window
HOP = 128  # 75 % overlap: smooth gains without audible frame edges
NOISE_FRACTION = 0.2  # the quietest fifth of frames is taken to be noise only
CLEAN_SNR_DB = 24.0  # at or above this the recording is left alone
NEURAL_BELOW_DB = 15.0  # the neural denoiser only for clearly noisy rooms; milder noise gets the gentler filter
OVER_SUBTRACTION = 1.6
GAIN_FLOOR = 0.18  # about -15 dB: never silence a band completely (that sounds like gargling)

LEVEL_FRAME = SAMPLE_RATE // 50  # 20 ms
ACTIVE_ABOVE_NOISE_DB = 9.0
RUN_GAP_FRAMES = 12  # pauses shorter than 240 ms stay inside one stretch of speech
BACKGROUND_BELOW_DB = 18.0  # a stretch this far under the learner's level is somebody else
BACKGROUND_MIN_FRAMES = 15  # and at least 0.3 s long: shorter dips are the learner's own soft words
BACKGROUND_GAIN = 0.08


def _levels_db(samples: np.ndarray) -> np.ndarray:
    count = samples.size // LEVEL_FRAME
    if count == 0:
        return np.empty(0)
    frames = samples[: count * LEVEL_FRAME].reshape(count, LEVEL_FRAME)
    return 10 * np.log10(np.mean(frames.astype(np.float64) ** 2, axis=1) + 1e-12)


def estimate_snr(samples: np.ndarray) -> tuple[float, float]:
    """(speech-to-noise ratio in dB, noise floor in dB) from the frame levels alone."""
    levels = _levels_db(samples)
    if levels.size < 10:
        return 99.0, -120.0
    noise = float(np.percentile(levels, 10))
    speech = float(np.percentile(levels, 95))
    return speech - noise, noise


def _stft(samples: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    window = np.hanning(FRAME + 1)[:-1].astype(np.float32)
    padded = np.pad(samples, (FRAME // 2, FRAME), mode="reflect")
    count = 1 + (padded.size - FRAME) // HOP
    index = np.arange(FRAME)[None, :] + HOP * np.arange(count)[:, None]
    return np.fft.rfft(padded[index] * window, axis=1), window


def _istft(spectrum: np.ndarray, window: np.ndarray, length: int) -> np.ndarray:
    frames = np.fft.irfft(spectrum, n=FRAME, axis=1).astype(np.float32) * window
    size = HOP * (spectrum.shape[0] - 1) + FRAME
    out = np.zeros(size, dtype=np.float32)
    norm = np.zeros(size, dtype=np.float32)
    for i in range(spectrum.shape[0]):
        out[i * HOP : i * HOP + FRAME] += frames[i]
        norm[i * HOP : i * HOP + FRAME] += window**2
    out /= np.maximum(norm, 1e-6)
    return out[FRAME // 2 : FRAME // 2 + length]


def _smooth(gain: np.ndarray) -> np.ndarray:
    """3x3 box average: isolated bins flickering open and shut are what sounds like "musical noise"."""
    padded = np.pad(gain, 1, mode="edge")
    total = sum(padded[dy : dy + gain.shape[0], dx : dx + gain.shape[1]] for dy in range(3) for dx in range(3))
    return total / 9.0


# --- RNNoise: a small recurrent network trained to separate speech from everyday noise ---------
#
# The same engine Jitsi and many call apps use. It copes with noise that changes (keys, fans
# speeding up, traffic, a TV) which a spectral filter cannot follow. It works at 48 kHz on 10 ms
# frames, so the 16 kHz recording is resampled around it. Installed from the ``pyrnnoise`` wheel,
# which bundles the C library; when it is missing the spectral filter below is used instead.

RNN_RATE = 48000
RNN_FRAME = 480
RNN_WARMUP_SECONDS = 0.4  # its recurrent state needs a moment to settle on the room
_rnnoise = None
_rnnoise_lock = threading.Lock()


def _load_rnnoise():
    """The loaded library, or False when it is not installed. Cached after the first call."""
    global _rnnoise
    if _rnnoise is not None:
        return _rnnoise
    with _rnnoise_lock:
        if _rnnoise is not None:
            return _rnnoise
        _rnnoise = False
        try:
            spec = importlib.util.find_spec("pyrnnoise")  # located, not imported: its package pulls in plotting libraries
            names = {"win32": "rnnoise.dll", "darwin": "librnnoise.dylib"}.get(sys.platform, "librnnoise.so")
            if spec is None or not spec.submodule_search_locations:
                return _rnnoise
            path = Path(next(iter(spec.submodule_search_locations))) / names
            if not path.is_file():
                return _rnnoise
            lib = ctypes.CDLL(str(path))
            lib.rnnoise_create.argtypes = [ctypes.c_void_p]
            lib.rnnoise_create.restype = ctypes.c_void_p
            lib.rnnoise_destroy.argtypes = [ctypes.c_void_p]
            lib.rnnoise_get_frame_size.restype = ctypes.c_int
            lib.rnnoise_process_frame.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_float), ctypes.POINTER(ctypes.c_float)]
            lib.rnnoise_process_frame.restype = ctypes.c_float
            if lib.rnnoise_get_frame_size() != RNN_FRAME:
                return _rnnoise
            _rnnoise = lib
        except Exception:
            logger.warning("RNNoise could not be loaded; using the spectral filter", exc_info=True)
    return _rnnoise


def neural_available() -> bool:
    return bool(_load_rnnoise())


def _kaiser_lowpass(cutoff: float, rate: int, taps: int = 121) -> np.ndarray:
    t = np.arange(taps) - (taps - 1) / 2
    kernel = np.sinc(2 * cutoff / rate * t) * np.kaiser(taps, 8.6)
    return (kernel / kernel.sum()).astype(np.float32)


_UP = _kaiser_lowpass(7600, RNN_RATE)
_DOWN = _kaiser_lowpass(7200, RNN_RATE)


def _to_48k(samples: np.ndarray) -> np.ndarray:
    stuffed = np.zeros(samples.size * 3, dtype=np.float32)
    stuffed[::3] = samples * 3.0
    return np.convolve(stuffed, _UP, mode="same").astype(np.float32)


def _to_16k(samples: np.ndarray) -> np.ndarray:
    return np.convolve(samples, _DOWN, mode="same")[::3].astype(np.float32)


def neural_denoise(samples: np.ndarray) -> np.ndarray:
    """Run the recording through RNNoise. Raises if the library is unavailable."""
    lib = _load_rnnoise()
    if not lib:
        raise RuntimeError("RNNoise is not installed")
    warm = int(RNN_WARMUP_SECONDS * SAMPLE_RATE)
    lead = samples[:warm][::-1] if samples.size > warm else samples[::-1]
    signal = np.concatenate([lead, samples]).astype(np.float32)
    wide = _to_48k(signal) * 32768.0  # the library works in 16-bit units
    frames = -(-wide.size // RNN_FRAME)
    padded = np.zeros(frames * RNN_FRAME, dtype=np.float32)
    padded[: wide.size] = wide
    state = lib.rnnoise_create(None)
    try:
        for i in range(frames):
            view = padded[i * RNN_FRAME : (i + 1) * RNN_FRAME]
            ptr = view.ctypes.data_as(ctypes.POINTER(ctypes.c_float))
            lib.rnnoise_process_frame(state, ptr, ptr)
    finally:
        lib.rnnoise_destroy(state)
    narrow = _to_16k(padded[: wide.size] / 32768.0)
    return narrow[lead.size : lead.size + samples.size]


def reduce_noise(samples: np.ndarray) -> np.ndarray:
    spectrum, window = _stft(samples)
    power = np.abs(spectrum) ** 2
    energy = power.sum(axis=1)
    quiet = max(8, int(NOISE_FRACTION * energy.size))
    noise = power[np.argsort(energy)[:quiet]].mean(axis=0) + 1e-12
    gain = np.clip(1.0 - OVER_SUBTRACTION * noise[None, :] / (power + 1e-12), GAIN_FLOOR, 1.0)
    gain = np.clip(_smooth(gain), GAIN_FLOOR, 1.0)
    return _istft(spectrum * gain, window, samples.size)


def mute_background_voices(samples: np.ndarray, noise_db: float) -> tuple[np.ndarray, int]:
    """Turn down stretches of speech much quieter than the learner. Returns (samples, stretches muted)."""
    levels = _levels_db(samples)
    if levels.size < 10:
        return samples, 0
    active = levels > noise_db + ACTIVE_ABOVE_NOISE_DB
    if active.sum() < 5:
        return samples, 0
    reference = float(np.percentile(levels[active], 90))

    # Join frames into stretches of speech, closing short pauses.
    runs: list[list[int]] = []
    for index in np.flatnonzero(active):
        if runs and index - runs[-1][1] <= RUN_GAP_FRAMES:
            runs[-1][1] = int(index)
        else:
            runs.append([int(index), int(index)])

    out = samples.copy()
    muted = 0
    ramp = np.linspace(0.0, 1.0, LEVEL_FRAME // 2, dtype=np.float32)
    for start, end in runs:
        run_levels = levels[start : end + 1][active[start : end + 1]]
        if end - start + 1 < BACKGROUND_MIN_FRAMES or run_levels.mean() >= reference - BACKGROUND_BELOW_DB:
            continue
        first, last = start * LEVEL_FRAME, (end + 1) * LEVEL_FRAME
        envelope = np.full(last - first, BACKGROUND_GAIN, dtype=np.float32)
        fade = min(ramp.size, envelope.size // 2)
        down = 1.0 - (1.0 - BACKGROUND_GAIN) * ramp[:fade]  # 1 -> BACKGROUND_GAIN
        envelope[:fade] = down
        envelope[envelope.size - fade :] = down[::-1]  # BACKGROUND_GAIN -> 1
        out[first:last] *= envelope
        muted += 1
    return out, muted


def enhance(samples: np.ndarray, *, neural: bool = True) -> tuple[np.ndarray, dict]:
    """Return (cleaned samples, what was done). Never raises: on any problem the input is returned.

    ``neural=False`` forces the spectral filter (used to compare the two in the evaluation).
    """
    info = {"snr_db": None, "denoised": False, "method": None, "background_voices": 0}
    if samples.size < SAMPLE_RATE // 3:
        return samples, info
    try:
        snr, noise_db = estimate_snr(samples)
        info["snr_db"] = round(float(snr), 1)
        out = samples.astype(np.float32, copy=False)
        if snr < CLEAN_SNR_DB:
            if neural and snr < NEURAL_BELOW_DB and neural_available():
                try:
                    out = neural_denoise(out)
                    info["method"] = "rnnoise"
                except Exception:
                    logger.warning("RNNoise failed; using the spectral filter", exc_info=True)
            if info["method"] is None:
                out = reduce_noise(out)
                info["method"] = "spectral"
            info["denoised"] = True
            _, noise_db = estimate_snr(out)
        out, muted = mute_background_voices(out, noise_db)
        info["background_voices"] = muted
        if not np.all(np.isfinite(out)):
            return samples, {**info, "denoised": False, "method": None, "background_voices": 0}
        return out.astype(np.float32, copy=False), info
    except Exception:  # an enhancement bug must never cost the learner their attempt
        return samples, {"snr_db": None, "denoised": False, "method": None, "background_voices": 0}
