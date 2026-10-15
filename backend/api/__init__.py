"""HTTP API routers."""

from backend.api import auth, coach, health, journey, library, progress, speech

routers = (
    health.router,
    speech.router,
    library.router,
    progress.router,
    coach.router,
    journey.router,
    auth.router,
)
