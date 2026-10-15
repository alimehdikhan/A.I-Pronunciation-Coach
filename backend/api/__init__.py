"""HTTP API routers."""

from backend.api import coach, health, library, progress, speech

routers = (health.router, speech.router, library.router, progress.router, coach.router)
