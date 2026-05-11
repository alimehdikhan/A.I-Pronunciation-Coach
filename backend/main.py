"""
FastAPI Backend for AI Pronunciation Coach.

The API accepts short browser-recorded audio clips, transcribes them with
Whisper, and compares the result against a target sentence.
"""

from contextlib import asynccontextmanager
import logging
import os
from threading import Lock
import tempfile
from typing import Any, Dict, Optional, Tuple

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.agent import CodeFlowAgent


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("pronunciation_coach")

DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:8000",
    "http://localhost:5500",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:5500",
]
ALLOWED_AUDIO_EXTENSIONS = {
    ".flac",
    ".m4a",
    ".mp3",
    ".mp4",
    ".mpeg",
    ".mpga",
    ".oga",
    ".ogg",
    ".opus",
    ".wav",
    ".webm",
}
ALLOWED_AUDIO_CONTENT_TYPES = {
    "application/octet-stream",
    "audio/flac",
    "audio/m4a",
    "audio/mp3",
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg",
    "audio/opus",
    "audio/wav",
    "audio/wave",
    "audio/webm",
    "video/mp4",
    "video/webm",
    "x-audio/wav",
}
CHUNK_SIZE = 1024 * 1024
MAX_UPLOAD_BYTES = int(os.getenv("PRONUNCIATION_COACH_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "base")
PRONUNCIATION_LANGUAGE = os.getenv("PRONUNCIATION_LANGUAGE", "eng-Latn")
LOAD_MODELS_ON_STARTUP = os.getenv("PRONUNCIATION_COACH_LOAD_MODELS_ON_STARTUP", "1").lower() not in {
    "0",
    "false",
    "no",
}

asr_model: Optional[Any] = None
pronunciation_scorer: Optional[Any] = None
model_lock = Lock()


def parse_cors_origins() -> list[str]:
    """Read comma-separated CORS origins from the environment."""
    raw_origins = os.getenv("PRONUNCIATION_COACH_CORS_ORIGINS")
    if not raw_origins:
        return DEFAULT_CORS_ORIGINS

    origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
    return origins or DEFAULT_CORS_ORIGINS


def load_models() -> None:
    """Load heavy model dependencies lazily so imports and tests stay lightweight."""
    global asr_model, pronunciation_scorer

    if asr_model is None:
        from backend.models import WhisperASR

        logger.info("Loading Whisper ASR model '%s'...", WHISPER_MODEL_SIZE)
        asr_model = WhisperASR(model_size=WHISPER_MODEL_SIZE)

    if pronunciation_scorer is None:
        from backend.pronunciation import PronunciationScorer

        logger.info("Loading pronunciation scorer for '%s'...", PRONUNCIATION_LANGUAGE)
        pronunciation_scorer = PronunciationScorer(language=PRONUNCIATION_LANGUAGE)

    logger.info("Models loaded successfully.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize optional heavyweight resources during application startup."""
    if LOAD_MODELS_ON_STARTUP:
        await run_in_threadpool(load_models)
    else:
        logger.warning("Model startup loading is disabled by environment configuration.")
    yield


app = FastAPI(
    title="AI Pronunciation Coach API",
    description="Real-time pronunciation feedback using Whisper ASR",
    version="1.0.0",
    lifespan=lifespan,
)

origins = parse_cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials="*" not in origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_models() -> Tuple[Any, Any]:
    """Return loaded models or report a clear service-unavailable response."""
    if asr_model is None or pronunciation_scorer is None:
        raise HTTPException(status_code=503, detail="Speech models are still loading. Please try again shortly.")
    return asr_model, pronunciation_scorer


def get_upload_suffix(audio: UploadFile) -> str:
    """Validate an uploaded audio file and return a safe suffix for temp storage."""
    if not audio.filename:
        raise HTTPException(status_code=400, detail="No audio file provided.")

    suffix = os.path.splitext(audio.filename)[1].lower()
    if suffix not in ALLOWED_AUDIO_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_AUDIO_EXTENSIONS))
        raise HTTPException(status_code=400, detail=f"Unsupported audio file type. Allowed extensions: {allowed}.")

    content_type = (audio.content_type or "").lower()
    if content_type and content_type not in ALLOWED_AUDIO_CONTENT_TYPES and not content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail=f"Unsupported audio content type: {content_type}.")

    return suffix


async def save_upload_to_temp(audio: UploadFile) -> str:
    """Stream an UploadFile to a temp file with size and empty-file validation."""
    suffix = get_upload_suffix(audio)
    tmp_file_path: Optional[str] = None
    total_size = 0

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
            tmp_file_path = tmp_file.name
            while True:
                chunk = await audio.read(CHUNK_SIZE)
                if not chunk:
                    break

                total_size += len(chunk)
                if total_size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Audio file is too large.")

                tmp_file.write(chunk)

        if total_size == 0:
            raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")

        return tmp_file_path
    except Exception:
        remove_temp_file(tmp_file_path)
        raise
    finally:
        await audio.close()


def remove_temp_file(path: Optional[str]) -> None:
    """Best-effort cleanup for uploaded temp files."""
    if not path:
        return

    try:
        if os.path.exists(path):
            os.unlink(path)
    except OSError:
        logger.warning("Failed to remove temporary upload file: %s", path, exc_info=True)


def transcribe_file(model: Any, audio_path: str) -> Dict[str, Any]:
    """Run Whisper behind a lock to avoid unsafe concurrent model access."""
    with model_lock:
        return model.transcribe(audio_path)


@app.get("/")
async def root() -> FileResponse:
    """Serve the frontend application at the site root."""
    return FileResponse(os.path.join(frontend_dir, "index.html"))


@app.get("/health")
async def health_check() -> Dict[str, Any]:
    """Check whether speech models are ready."""
    models_loaded = asr_model is not None and pronunciation_scorer is not None
    return {
        "status": "healthy" if models_loaded else "loading",
        "models_loaded": models_loaded,
        "model_size": WHISPER_MODEL_SIZE,
        "language": PRONUNCIATION_LANGUAGE,
    }


@app.get("/api/agent/analyze")
async def analyze_codebase() -> JSONResponse:
    """Run a conservative code-flow analysis and return findings."""
    try:
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        agent = CodeFlowAgent(root=project_root)
        report = await run_in_threadpool(agent.analyze_project)
        return JSONResponse(content={"success": True, "report": report})
    except Exception as exc:
        logger.exception("Agent analysis failed")
        raise HTTPException(status_code=500, detail=f"Agent analysis failed: {exc}") from exc


@app.post("/api/evaluate")
async def evaluate_pronunciation(
    audio: UploadFile = File(...),
    target_text: Optional[str] = Form(None),
) -> Dict[str, Any]:
    """
    Evaluate pronunciation from an audio file against a required target text.
    """
    tmp_file_path: Optional[str] = None
    try:
        reference_text = (target_text or "").strip()
        if not reference_text:
            raise HTTPException(status_code=400, detail="target_text is required for pronunciation evaluation.")

        asr, scorer = get_models()
        tmp_file_path = await save_upload_to_temp(audio)

        transcription_result = await run_in_threadpool(transcribe_file, asr, tmp_file_path)
        transcribed_text = str(transcription_result.get("text", "")).strip()

        score_result = await run_in_threadpool(
            scorer.score_pronunciation,
            reference_text,
            transcribed_text,
        )

        return {
            "success": True,
            "transcription": transcribed_text,
            "reference_text": reference_text,
            "score": score_result["score"],
            "accuracy": score_result["accuracy"],
            "feedback": score_result["feedback"],
            "phoneme_analysis": score_result.get("phoneme_analysis", {}),
            "word_level_scores": score_result.get("word_level_scores", []),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error processing audio in /api/evaluate")
        raise HTTPException(status_code=500, detail="Error processing audio. See server logs for details.") from exc
    finally:
        remove_temp_file(tmp_file_path)


@app.post("/api/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)) -> Dict[str, Any]:
    """Transcribe an audio file without pronunciation evaluation."""
    tmp_file_path: Optional[str] = None
    try:
        asr, _ = get_models()
        tmp_file_path = await save_upload_to_temp(audio)

        result = await run_in_threadpool(transcribe_file, asr, tmp_file_path)
        return {
            "success": True,
            "transcription": str(result.get("text", "")).strip(),
            "language": result.get("language", "en"),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error in /api/transcribe")
        raise HTTPException(status_code=500, detail="Error transcribing audio. See server logs for details.") from exc
    finally:
        remove_temp_file(tmp_file_path)


frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    print("Starting AI Pronunciation Coach API...")
    print("Server will be available at: http://localhost:8000")
    print("API documentation at: http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000)
