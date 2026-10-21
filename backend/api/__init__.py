"""HTTP API routers."""

from backend.api import (
    auth,
    baseline,
    coach,
    contribute,
    disputes,
    gd,
    health,
    interview,
    journey,
    learner,
    library,
    listeners,
    listening,
    progress,
    progress_clips,
    sharing,
    speaking,
    speech,
    voice,
)

# Open without an account: health checks, signing in or up, and the share links teachers open.
# The voice socket checks the account itself, from its first message (a browser WebSocket can't send headers).
public_routers = (
    health.router,
    auth.router,
    sharing.public_router,
    voice.router,
)

# Everything a learner uses needs a signed-in account (backend.api.deps.require_account).
routers = (
    speech.router,
    library.router,
    progress.router,
    coach.router,
    journey.router,
    disputes.router,
    contribute.router,
    listening.router,
    learner.router,
    speaking.router,
    interview.router,
    gd.router,
    listeners.router,
    progress_clips.router,
    baseline.router,
    sharing.router,
)
