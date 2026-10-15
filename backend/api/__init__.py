"""HTTP API routers."""

from backend.api import auth, coach, health, journey, library, progress, speech, voice

routers = (
    health.router,
    speech.router,
    library.router,
    progress.router,
    coach.router,
    journey.router,
    voice.router,
    auth.router,
)
