"""HTTP API routers."""

from backend.api import health, library, progress, speech

routers = (health.router, speech.router, library.router, progress.router)
