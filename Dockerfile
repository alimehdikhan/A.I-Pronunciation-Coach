FROM python:3.11-slim

# Install system dependencies (ffmpeg is required by Whisper for audio decoding)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first to leverage Docker layer caching —
# only re-installs when requirements.txt changes.
COPY backend/requirements.txt backend/
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r backend/requirements.txt

# Copy the rest of the application
COPY . .

# Hugging Face Spaces requires port 7860
EXPOSE 7860

ENV WHISPER_MODEL_SIZE=base
ENV PRONUNCIATION_LANGUAGE=eng-Latn

# Using python -m uvicorn ensures the correct module resolution
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]