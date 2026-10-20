"""HTTP errors with a stable machine-readable code, so the UI can say exactly what went wrong.

The response body is ``{"detail": <sentence for people>, "code": <one of CODES>}``; headers
such as ``Retry-After`` are kept.
"""

from __future__ import annotations

from fastapi import HTTPException

CODES = frozenset({
    "models_loading",  # 503: speech models are still loading (Retry-After)
    "busy",  # 503: too many recordings queued (Retry-After)
    "rate_limited",  # 429: too many requests from this client (Retry-After)
    "upload_too_large",  # 413: the file is bigger than the upload limit
    "recording_too_long",  # 413: longer than the recording limit
    "too_short",  # 400: under MIN_AUDIO_SECONDS
    "audio_empty",  # 400: an empty file
    "audio_unreadable",  # 400: could not be decoded
    "unsupported_audio",  # 400: wrong file type
})


class CodedHTTPException(HTTPException):
    def __init__(self, status_code: int, detail: str, code: str, headers: dict[str, str] | None = None):
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code
