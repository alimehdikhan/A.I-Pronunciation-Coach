.PHONY: install run test lint format clean

install:
	pip install -r backend/requirements.txt
	pip install -r backend/requirements-dev.txt

run:
	python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

test:
	pytest -q

lint:
	ruff check backend/ tests/

format:
	ruff check backend/ tests/ --fix
	ruff format backend/ tests/

clean:
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type d -name .pytest_cache -exec rm -rf {} +
	rm -rf htmlcov .coverage
