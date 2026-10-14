#!/usr/bin/env bash
# Build script for platforms without Docker (e.g. Render native Python).
set -euo pipefail

pip install --upgrade pip
pip install -r backend/requirements.txt
python -m nltk.downloader -q cmudict

if command -v npm >/dev/null 2>&1; then
  (cd frontend && npm ci --no-audit --no-fund && npm run build)
else
  echo "npm not found: skipping frontend build (the API will still run)." >&2
fi
