# AI Pronunciation Coach

A small FastAPI and static frontend application for practicing English pronunciation with Whisper transcription and pronunciation scoring.

## Project Layout

- `backend/` - FastAPI API, model wrapper, pronunciation scoring, and code-flow analyzer.
- `frontend/` - Static HTML, CSS, and JavaScript client.
- `tests/` - Lightweight pytest suite that avoids downloading or loading Whisper weights.

## Requirements

- Python 3.13
- `ffmpeg` available on `PATH` for Whisper audio decoding
- Optional for better English IPA transliteration: Flite `lex_lookup`

## Setup

```powershell
cd C:\Users\Dell\OneDrive\Desktop\pronunciation-coach
.\backend\venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\backend\venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
```

## Run

```powershell
.\backend\venv\Scripts\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000` in your browser.

## Configuration

- `WHISPER_MODEL_SIZE` - Whisper model size, default `base`.
- `PRONUNCIATION_LANGUAGE` - Epitran language code, default `eng-Latn`.
- `PRONUNCIATION_COACH_LOAD_MODELS_ON_STARTUP` - set to `0` to skip loading models at startup.
- `PRONUNCIATION_COACH_MAX_UPLOAD_BYTES` - upload limit in bytes, default `26214400`.
- `PRONUNCIATION_COACH_CORS_ORIGINS` - comma-separated allowed origins for separate frontend hosting.

## Verify

```powershell
.\backend\venv\Scripts\python.exe -m pytest -q
.\backend\venv\Scripts\python.exe -m py_compile backend\main.py backend\models.py backend\pronunciation.py backend\agent.py
.\backend\venv\Scripts\python.exe -m pip check
```
