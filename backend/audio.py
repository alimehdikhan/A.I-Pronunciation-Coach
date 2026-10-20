"""
Audio ingestion: upload validation, decoding and loudness normalisation.

Browser recordings arrive as 16 kHz mono WAV (decoded without ffmpeg) or as
compressed webm/ogg/m4a uploads, which ffmpeg decodes under strict limits:
only audio demuxers, only local files, bounded duration and runtime.
"""

from __future__ import annotations

import io
import logging
import os
import shutil
import subprocess
import tempfile
import wave
from functools import lru_cache

import numpy as np
from fastapi import UploadFile

from backend.errors import CodedHTTPException

logger = logging.getLogger("pronunciation_coach.audio")

SAMPLE_RATE = 16000
CHUNK_SIZE = 1024 * 1024
FFMPEG_TIMEOUT_SECONDS = 30

ALLOWED_AUDIO_EXTENSIONS = {
    ".flac", ".m4a", ".mp3", ".mp4", ".mpeg", ".mpga", ".oga", ".ogg", ".opus", ".wav", ".webm",
}
ALLOWED_AUDIO_CONTENT_TYPES = {
    "audio/flac", "audio/m4a", "audio/mp3", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/opus",
    "audio/wav", "audio/wave", "audio/webm", "video/mp4", "video/webm", "x-audio/wav",
    "application/octet-stream",
}
# Demuxers ffmpeg may use. Excludes playlist/concat formats (hls, concat, ...)
# that could make it open other files or URLs named inside a crafted upload.
FFMPEG_FORMATS = "wav,ogg,matroska,webm,mp3,mov,mp4,m4a,flac,aac"

# Loudness normalisation (speech level ≈ -20 dBFS, at most +24 dB of gain).
TARGET_SPEECH_RMS = 0.1
MAX_GAIN = 16.0
LIMITER_KNEE = 0.9


class AudioError(CodedHTTPException):
    """A client-side problem with the uploaded audio."""

    def __init__(self, status_code: int, detail: str, code: str = "audio_unreadable"):
        super().__init__(status_code, detail, code)


def validate_upload(audio: UploadFile) -> str:
    """Check the filename and content type; returns the lower-case extension."""
    if not audio.filename:
        raise AudioError(status_code=400, detail="No audio file provided.", code="audio_empty")
    suffix = os.path.splitext(audio.filename)[1].lower()
    if suffix not in ALLOWED_AUDIO_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_AUDIO_EXTENSIONS))
        raise AudioError(status_code=400, detail=f"Unsupported audio file type. Allowed extensions: {allowed}.", code="unsupported_audio")
    content_type = (audio.content_type or "").split(";")[0].strip().lower()
    if content_type and content_type not in ALLOWED_AUDIO_CONTENT_TYPES and not content_type.startswith("audio/"):
        raise AudioError(status_code=400, detail="Unsupported audio content type.", code="unsupported_audio")
    return suffix


async def read_upload(audio: UploadFile, max_bytes: int) -> bytes:
    """Read an upload into memory, enforcing the size limit while streaming."""
    chunks: list[bytes] = []
    total = 0
    try:
        while chunk := await audio.read(CHUNK_SIZE):
            total += len(chunk)
            if total > max_bytes:
                raise AudioError(status_code=413, detail="Audio file is too large.", code="upload_too_large")
            chunks.append(chunk)
    finally:
        await audio.close()
    if total == 0:
        raise AudioError(status_code=400, detail="Uploaded audio file is empty.", code="audio_empty")
    return b"".join(chunks)


def _too_long(max_seconds: float) -> AudioError:
    return AudioError(status_code=413, detail=f"Recordings can be at most {max_seconds:g} seconds long.", code="recording_too_long")


def _decode_wav(data: bytes, max_seconds: float) -> np.ndarray | None:
    """Fast path for 16-bit PCM WAV at 16 kHz (what the web app uploads)."""
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return None
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            if wav.getsampwidth() != 2 or wav.getframerate() != SAMPLE_RATE or wav.getnchannels() > 2:
                return None
            if wav.getnframes() / SAMPLE_RATE > max_seconds:
                raise _too_long(max_seconds)
            channels = wav.getnchannels()
            frames = wav.readframes(wav.getnframes())
    except (wave.Error, EOFError):
        return None  # Unusual header (e.g. float or extensible WAV): let ffmpeg handle it.
    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels == 2:
        samples = samples.reshape(-1, 2).mean(axis=1)
    return samples


@lru_cache(maxsize=1)
def resolve_ffmpeg() -> str:
    """Find ffmpeg: system PATH first, then imageio-ffmpeg's bundled binary."""
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - depends on the host
        raise RuntimeError("ffmpeg was not found. Install ffmpeg or the imageio-ffmpeg package.") from exc


def _decode_ffmpeg(data: bytes, suffix: str, max_seconds: float) -> np.ndarray:
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        cmd = [
            resolve_ffmpeg(), "-nostdin", "-hide_banner", "-loglevel", "error",
            "-protocol_whitelist", "file", "-format_whitelist", FFMPEG_FORMATS,
            "-i", path, "-vn", "-sn", "-dn",
            # Decode a little past the limit so over-long clips are detectable.
            "-t", f"{max_seconds + 0.5:.2f}",
            "-f", "s16le", "-ac", "1", "-acodec", "pcm_s16le", "-ar", str(SAMPLE_RATE), "-",
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=FFMPEG_TIMEOUT_SECONDS, check=False)
        except subprocess.TimeoutExpired as exc:
            raise AudioError(status_code=400, detail="The audio file took too long to decode.") from exc
        if result.returncode != 0:
            logger.info("ffmpeg could not decode upload: %s", result.stderr.decode(errors="ignore")[-300:])
            raise AudioError(status_code=400, detail="Could not read that audio file. Try another recording.")
    finally:
        try:
            os.unlink(path)
        except OSError:
            logger.warning("Failed to remove temporary audio file %s", path)
    samples = np.frombuffer(result.stdout, dtype="<i2").astype(np.float32) / 32768.0
    if len(samples) > max_seconds * SAMPLE_RATE:
        raise _too_long(max_seconds)
    return samples


def decode_audio(data: bytes, suffix: str, max_seconds: float) -> np.ndarray:
    """Decode an upload to mono float32 PCM at 16 kHz."""
    samples = _decode_wav(data, max_seconds)
    if samples is None:
        samples = _decode_ffmpeg(data, suffix, max_seconds)
    return samples


def normalize_loudness(samples: np.ndarray) -> tuple[np.ndarray, float]:
    """Bring quiet speech up to a consistent level; returns (samples, gain in dB).

    The speech level is taken from the loud 20 ms frames, so silence around the
    phrase doesn't inflate the gain. Loud input is left alone; boosted peaks go
    through a soft limiter instead of clipping.
    """
    if samples.size < SAMPLE_RATE // 10:
        return samples, 0.0
    samples = samples - float(samples.mean())
    frame = SAMPLE_RATE // 50
    count = samples.size // frame
    levels = np.sqrt(np.mean(samples[: count * frame].reshape(count, frame) ** 2, axis=1))
    speech = max(float(np.percentile(levels, 95)), float(levels.max()) / 3)
    if speech < 1e-5:
        return samples, 0.0
    gain = min(MAX_GAIN, TARGET_SPEECH_RMS / speech)
    if gain <= 1.12:  # within 1 dB: not worth touching
        return samples, 0.0
    out = samples * gain
    over = np.abs(out) > LIMITER_KNEE
    if over.any():
        headroom = 1.0 - LIMITER_KNEE
        excess = (np.abs(out[over]) - LIMITER_KNEE) / headroom
        out[over] = np.sign(out[over]) * (LIMITER_KNEE + headroom * np.tanh(excess))
    return out.astype(np.float32, copy=False), round(20 * float(np.log10(gain)), 1)
