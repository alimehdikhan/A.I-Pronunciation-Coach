"""Serving the built React app (frontend/dist) as a single-page app."""

from __future__ import annotations

from pathlib import Path

from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles

from backend.security import build_spa_csp

# The pre-React page loaded these two files and was served without
# Cache-Control, so some browsers still show it from their cache. Its requests
# for them are the only way to reach those browsers: purge the cache, then
# reload once into a fresh URL (which can't be a cache hit) to get the app.
_LEGACY_RELOAD = (
    "if (!/[?&]_reload=/.test(location.search)) "
    "location.replace(location.pathname + '?_reload=' + Date.now());\n"
)
LEGACY_FILES = {
    "script.js": ("text/javascript", _LEGACY_RELOAD),
    "styles.css": ("text/css", ""),
}


def _legacy_response(path: str) -> Response:
    media_type, body = LEGACY_FILES[path]
    return Response(body, media_type=media_type, headers={"Cache-Control": "no-store", "Clear-Site-Data": '"cache"'})


class SPAStaticFiles(StaticFiles):
    """Serve built assets, falling back to index.html for client-side routes.

    The app shell gets a strict Content-Security-Policy: either a fixed `csp`,
    or one derived from the current index.html (refreshed after a rebuild)
    when `frame_ancestors` is given.
    """

    def __init__(self, *args, csp: str | None = None, frame_ancestors: str | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self.csp = csp
        self.frame_ancestors = frame_ancestors
        self._derived: tuple[int, str] | None = None

    async def get_response(self, path: str, scope):
        path = path.replace("\\", "/")  # StaticFiles normalises with os.sep on Windows
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            response = None
        if response is None or response.status_code == 404:
            if path in LEGACY_FILES:
                return _legacy_response(path)
            # Missing files (e.g. stale chunks after a deploy) must 404; only
            # extension-less client routes fall back to the app shell.
            if "." in path.rsplit("/", 1)[-1]:
                raise StarletteHTTPException(status_code=404)
            response = await super().get_response("index.html", scope)
            self._shell_headers(response)
        elif path.startswith("assets/"):
            # Vite fingerprints asset filenames, so they can be cached forever.
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif path in ("", ".", "index.html"):
            self._shell_headers(response)
        else:
            # Unfingerprinted files (favicon, ...): always revalidate, so no
            # browser keeps a copy on its own heuristics after a deploy.
            response.headers["Cache-Control"] = "no-cache"
        return response

    def _policy(self) -> str | None:
        if self.csp or self.frame_ancestors is None or self.directory is None:
            return self.csp
        index = Path(self.directory) / "index.html"
        try:
            version = index.stat().st_mtime_ns
        except OSError:
            return None
        if self._derived is None or self._derived[0] != version:
            self._derived = (version, build_spa_csp(index, self.frame_ancestors))
        return self._derived[1]

    def _shell_headers(self, response) -> None:
        response.headers["Cache-Control"] = "no-cache"
        policy = self._policy()
        if policy:
            response.headers["Content-Security-Policy"] = policy
