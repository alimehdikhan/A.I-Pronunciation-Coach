# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# 1. Build the React frontend
# ---------------------------------------------------------------------------
FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# 2. Python runtime (serves the API and the built frontend)
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS runtime

# Hugging Face passes Space variables as build args, so a WHISPER_MODEL_SIZE
# variable set on the Space is baked into the image (no download per restart).
ARG WHISPER_MODEL_SIZE=base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    XDG_CACHE_HOME=/app/.cache \
    NLTK_DATA=/app/.cache/nltk_data \
    NEON_DATABASE_URL=sqlite:////app/data/pronunciation_coach.db \
    PRONUNCIATION_COACH_TTS_DIR=/app/.cache/piper \
    PRONUNCIATION_COACH_ASR_DIR=/app/.cache/whisper     PRONUNCIATION_COACH_PHONEME_DIR=/app/.cache/phonemes \
    PRONUNCIATION_COACH_LOG_FORMAT=json \
    WHISPER_MODEL_SIZE=${WHISPER_MODEL_SIZE} \
    PRONUNCIATION_LANGUAGE=eng-Latn \
    PORT=7860

# ffmpeg decodes uploaded recordings (webm/ogg/m4a); browser recordings arrive as WAV.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so code changes don't invalidate this layer.
# faster-whisper runs on CTranslate2, so there is no PyTorch to install.
COPY backend/requirements.txt backend/
RUN pip install --upgrade pip \
    && pip install -r backend/requirements.txt

# Bake CMUDict, the Whisper weights and the coach's neural voice into the
# image for fast cold starts. PRELOAD_WHISPER defaults to WHISPER_MODEL_SIZE;
# pass PRELOAD_WHISPER=none or an empty PRELOAD_VOICE to skip a download.
ARG PRELOAD_WHISPER=
ARG PRELOAD_VOICE=en_US-lessac-medium
RUN python -m nltk.downloader -q -d "$NLTK_DATA" cmudict \
    && model="${PRELOAD_WHISPER:-$WHISPER_MODEL_SIZE}" \
    && if [ "$model" != "none" ]; then \
         HF_HUB_DISABLE_XET=1 python -c "from faster_whisper.utils import download_model; download_model('$model', cache_dir='$PRONUNCIATION_COACH_ASR_DIR')"; \
       fi \
    && if [ -n "$PRELOAD_VOICE" ]; then \
         mkdir -p "$PRONUNCIATION_COACH_TTS_DIR" \
         && python -c "from pathlib import Path; from piper.download_voices import download_voice; download_voice('$PRELOAD_VOICE', Path('$PRONUNCIATION_COACH_TTS_DIR'))"; \
       fi

# Acoustic sound scoring: download the int8 phoneme model (about 355 MB) that
# scripts/export_phoneme_model.py produces from Meta's wav2vec 2.0 espeak model.
# It is fetched from the Hub, like the Whisper weights, so the build needs no
# PyTorch. A failed download does not fail the build: the app then scores from
# Whisper's words only and /health reports "acoustic_scoring": false.
# Pass PRELOAD_PHONEMES=0 to skip it (Hugging Face passes Space variables as
# build args, so a Space variable of the same name works too).
ARG PRELOAD_PHONEMES=1
ARG PHONEME_MODEL_REPO=Alimehdi973/wav2vec2-espeak-onnx-int8
RUN if [ "$PRELOAD_PHONEMES" = "1" ]; then \
      HF_HUB_DISABLE_XET=1 python -c "from huggingface_hub import snapshot_download; snapshot_download('$PHONEME_MODEL_REPO', local_dir='$PRONUNCIATION_COACH_PHONEME_DIR', allow_patterns=['phonemes.onnx', 'vocab.json', 'MODEL'])" \
      || echo "WARNING: phoneme model not downloaded; scoring will use Whisper's words only"; \
    fi

COPY backend/ backend/
COPY --from=frontend /app/frontend/dist frontend/dist

# Hugging Face Spaces runs containers as UID 1000.
RUN useradd --create-home --uid 1000 app \
    && mkdir -p /app/data \
    && chown -R app:app /app
USER app

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"7860\")}/health', timeout=4)"

# The platform's reverse proxy sets X-Forwarded-For; uvicorn resolves client IPs from it.
CMD ["sh", "-c", "exec python -m uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-7860} --proxy-headers --forwarded-allow-ips='*' --timeout-graceful-shutdown 20"]
