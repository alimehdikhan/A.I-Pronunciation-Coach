FROM python:3.11-slim

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 7860

ENV WHISPER_MODEL_SIZE=base
ENV PRONUNCIATION_LANGUAGE=eng-Latn

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]