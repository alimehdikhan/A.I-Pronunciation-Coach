#!/usr/bin/env bash
# Quick smoke test for the /api/evaluate endpoint.
# Usage: ./scripts/test_evaluate.sh [path/to/audio.wav]

set -euo pipefail

AUDIO_FILE="${1:-tests/sample.wav}"

if [ ! -f "$AUDIO_FILE" ]; then
    echo "Error: Audio file not found: $AUDIO_FILE"
    echo "Usage: $0 [path/to/audio.wav]"
    exit 1
fi

curl -v \
    -F "audio=@${AUDIO_FILE}" \
    -F "target_text=Today is a beautiful day." \
    http://localhost:8000/api/evaluate
