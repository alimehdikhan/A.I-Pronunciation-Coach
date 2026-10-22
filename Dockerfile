# syntax=docker/dockerfile:1
#
# Built in stages so a deploy rebuilds only what changed: the base (system and Python packages, the models)
# and the pre-rendered voice clips don't depend on the app's code, so Docker reuses them from its cache, and a
# code change rebuilds only the last few small layers. Nothing is ever chown'ed after the fact: a recursive
# chown copies every file it touches (here, more than a gigabyte of models) into a new layer.

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
# 2. Base: system and Python packages, and the models (none of the app's code)
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS base

# Hugging Face passes Space variables as build args. WHISPER_MODEL_SIZE is the local Whisper used without a
# Groq key; with one, speech is recognised on Groq and the local Whisper is only its fallback (FALLBACK_WHISPER).
ARG WHISPER_MODEL_SIZE=base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    XDG_CACHE_HOME=/app/.cache \
    NLTK_DATA=/app/.cache/nltk_data \
    PRONUNCIATION_COACH_SQLITE_URL=sqlite:////app/data/pronunciation_coach.db \
    PRONUNCIATION_COACH_TTS_DIR=/app/.cache/piper \
    PRONUNCIATION_COACH_ASR_DIR=/app/.cache/whisper \
    PRONUNCIATION_COACH_PHONEME_DIR=/app/.cache/phonemes \
    PRONUNCIATION_COACH_KOKORO_DIR=/app/.cache/kokoro \
    PRONUNCIATION_COACH_LOG_FORMAT=json \
    WHISPER_MODEL_SIZE=${WHISPER_MODEL_SIZE} \
    PRONUNCIATION_LANGUAGE=eng-Latn \
    PORT=7860

# ffmpeg decodes uploaded recordings (webm/ogg/m4a); short browser recordings arrive as WAV.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces runs containers as UID 1000. The user exists before anything is downloaded, so the
# models are its own from the start (the app writes new voice clips next to them).
RUN useradd --create-home --uid 1000 app \
    && mkdir -p /app/data /app/.cache \
    && chown app:app /app /app/data /app/.cache
WORKDIR /app

# Python packages (root), before the models and the code so neither invalidates them.
# faster-whisper runs on CTranslate2, so there is no PyTorch to install.
COPY backend/requirements.txt backend/requirements-voice.txt backend/
RUN pip install --upgrade pip \
    && pip install -r backend/requirements.txt \
    && (pip install -r backend/requirements-voice.txt || echo "WARNING: Kokoro not installed; the app will use the Piper voice")

USER app

# CMUDict, the local Whisper (Groq's fallback; `base` by default, PRELOAD_WHISPER=none leaves it out and it
# downloads when first needed) and the Piper voice (Kokoro's fallback and the "Quick" voice).
ARG PRELOAD_WHISPER=base
ARG PRELOAD_VOICE=en_US-lessac-medium
RUN python -m nltk.downloader -q -d "$NLTK_DATA" cmudict \
    && if [ "$PRELOAD_WHISPER" != "none" ]; then \
         HF_HUB_DISABLE_XET=1 python -c "from faster_whisper.utils import download_model; download_model('$PRELOAD_WHISPER', cache_dir='$PRONUNCIATION_COACH_ASR_DIR')"; \
       fi \
    && if [ -n "$PRELOAD_VOICE" ]; then \
         mkdir -p "$PRONUNCIATION_COACH_TTS_DIR" \
         && python -c "from pathlib import Path; from piper.download_voices import download_voice; download_voice('$PRELOAD_VOICE', Path('$PRONUNCIATION_COACH_TTS_DIR'))"; \
       fi

# Acoustic sound scoring: the int8 phoneme model (about 355 MB) that scripts/export_phoneme_model.py produces
# from Meta's wav2vec 2.0 espeak model, fetched from the Hub so the build needs no PyTorch. A failed download
# does not fail the build: the app then scores from Whisper's words only and /health reports
# "acoustic_scoring": false. PRELOAD_PHONEMES=0 skips it.
ARG PRELOAD_PHONEMES=1
ARG PHONEME_MODEL_REPO=Alimehdi973/wav2vec2-espeak-onnx-int8
RUN if [ "$PRELOAD_PHONEMES" = "1" ]; then \
      HF_HUB_DISABLE_XET=1 python -c "from huggingface_hub import snapshot_download; snapshot_download('$PHONEME_MODEL_REPO', local_dir='$PRONUNCIATION_COACH_PHONEME_DIR', allow_patterns=['phonemes.onnx', 'vocab.json', 'MODEL'])" \
      || echo "WARNING: phoneme model not downloaded; scoring will use Whisper's words only"; \
    fi

# The Kokoro voice's two model files (about 350 MB). Best effort: without them the app speaks with the Piper
# voice. PRELOAD_KOKORO=0 skips them.
ARG PRELOAD_KOKORO=1
ARG KOKORO_RELEASE=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
RUN if [ "$PRELOAD_KOKORO" = "1" ]; then \
      ( mkdir -p "$PRONUNCIATION_COACH_KOKORO_DIR" \
        && python -c "import urllib.request as u, sys; base, out = sys.argv[1], sys.argv[2]; [u.urlretrieve(base + '/' + f, out + '/' + f) for f in ('kokoro-v1.0.onnx', 'voices-v1.0.bin')]" "$KOKORO_RELEASE" "$PRONUNCIATION_COACH_KOKORO_DIR" \
      ) || { echo "WARNING: Kokoro voice not installed; the app will use the Piper voice"; rm -rf "$PRONUNCIATION_COACH_KOKORO_DIR"; }; \
    fi

# ---------------------------------------------------------------------------
# 3. Voice clips: the fixed spoken content (phrase library, example words, practice sentences) rendered
#    with Kokoro, so it plays at once instead of being synthesised on a small CPU while the learner waits.
#    Only the files it reads are copied, so this stage is rebuilt only when the phrases, the sounds'
#    examples or the voice code change, never for other code. Best effort, capped at 20 minutes: a clip
#    that was not reached is rendered on first use.
# ---------------------------------------------------------------------------
FROM base AS voice
ARG PRERENDER_VOICE=1
COPY --chown=app:app backend/__init__.py backend/tts.py backend/observability.py backend/phoneme_kb.py backend/
COPY --chown=app:app scripts/prerender_voice.py scripts/
COPY --chown=app:app frontend/src/lib/sentences.ts frontend/src/lib/sentences.ts
RUN mkdir -p "$PRONUNCIATION_COACH_KOKORO_DIR/clips" \
    && if [ "$PRERENDER_VOICE" = "1" ] && [ -f "$PRONUNCIATION_COACH_KOKORO_DIR/voices-v1.0.bin" ]; then \
         timeout 1200 python scripts/prerender_voice.py \
         || echo "WARNING: voice pre-render stopped early; remaining clips render on demand"; \
       fi

# ---------------------------------------------------------------------------
# 4. Runtime: the base, plus the code, the built frontend and the voice clips
# ---------------------------------------------------------------------------
FROM base AS runtime
COPY --chown=app:app backend/ backend/
COPY --chown=app:app --from=frontend /app/frontend/dist frontend/dist
COPY --chown=app:app --from=voice /app/.cache/kokoro/clips /app/.cache/kokoro/clips

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"7860\")}/health', timeout=4)"

# The platform's reverse proxy sets X-Forwarded-For; uvicorn resolves client IPs from it.
CMD ["sh", "-c", "exec python -m uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-7860} --proxy-headers --forwarded-allow-ips='*' --timeout-graceful-shutdown 20"]
