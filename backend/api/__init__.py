"""HTTP API routers."""

from backend.api import auth, coach, health, library, progress, speech

routers = (health.router, speech.router, library.router, progress.router, coach.router, auth.router)
