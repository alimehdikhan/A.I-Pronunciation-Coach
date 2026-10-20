"""HTTP API routers."""

from backend.api import (
    auth,
    baseline,
    coach,
    disputes,
    health,
    journey,
    learner,
    library,
    listening,
    progress,
    sharing,
    speaking,
    speech,
    voice,
)

routers = (
    health.router,
    speech.router,
    library.router,
    progress.router,
    coach.router,
    journey.router,
    voice.router,
    auth.router,
    disputes.router,
    listening.router,
    learner.router,
    speaking.router,
    baseline.router,
    sharing.router,
)
