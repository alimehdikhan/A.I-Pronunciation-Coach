#!/usr/bin/env bash
# Quick smoke test for the /api/evaluate endpoint.
# Usage: ./scripts/test_evaluate.sh path/to/audio.wav ["Target sentence."] [base_url]

set -euo pipefail

AUDIO_FILE="${1:-}"
TARGET_TEXT="${2:-Today is a beautiful day.}"
BASE_URL="${3:-http://localhost:8000}"

if [ -z "$AUDIO_FILE" ] || [ ! -f "$AUDIO_FILE" ]; then
    echo "Usage: $0 path/to/audio.wav [\"Target sentence.\"] [base_url]" >&2
    echo "Record yourself saying the target sentence (any format ffmpeg can read)." >&2
    exit 1
fi

curl --fail-with-body -sS \
    -F "audio=@${AUDIO_FILE}" \
    -F "target_text=${TARGET_TEXT}" \
    -F "difficulty=intermediate" \
    "${BASE_URL}/api/evaluate"
echo
