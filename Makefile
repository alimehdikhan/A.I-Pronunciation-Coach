.PHONY: install install-api install-web dev-api dev-web build run test lint typecheck check docker clean

PYTHON ?= python

install: install-api install-web

install-api:
	$(PYTHON) -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt

install-web:
	cd frontend && npm ci

# Development: run these in two terminals, then open http://localhost:5173
dev-api:
	$(PYTHON) -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000

dev-web:
	cd frontend && npm run dev

# Production-style: build the UI once, then FastAPI serves everything on :8000
build:
	cd frontend && npm run build

run: build
	$(PYTHON) -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

test:
	PRONUNCIATION_COACH_LOAD_MODELS_ON_STARTUP=0 PYTHONPATH=. $(PYTHON) -m pytest -q

lint:
	ruff check backend/ tests/

typecheck:
	cd frontend && npm run typecheck

check: lint test typecheck

docker:
	docker build -t pronunciation-coach .

clean:
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
	rm -rf .pytest_cache .ruff_cache htmlcov .coverage frontend/dist
