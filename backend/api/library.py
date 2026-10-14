"""Read-only learning content: pronunciations, the phoneme library and tutor cards.

Responses depend only on their inputs, so browsers and CDNs may cache them.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response

from backend import phonetics
from backend.config import settings
from backend.phoneme_kb import get_phoneme, list_phonemes
from backend.tutor import generate_tutor_card, phoneme_details

logger = logging.getLogger("pronunciation_coach.api.library")
router = APIRouter()

CACHEABLE = "public, max-age=3600, stale-while-revalidate=86400"


@router.get("/api/pronounce")
def pronounce_text(response: Response, text: str = Query(..., min_length=1, max_length=settings.max_target_chars)) -> dict[str, Any]:
    """IPA, syllables and stress for each word of a sentence (shown before recording)."""
    words = []
    for display in text.split():
        tokens = phonetics.tokenize(display)
        details = [phonetics.describe_word(token) for token in tokens]
        words.append({
            "text": display,
            "ipa": " ".join(d["ipa"] for d in details if d["ipa"]),
            "tokens": details,
        })
    response.headers["Cache-Control"] = CACHEABLE
    return {"text": text, "words": words}


@router.get("/api/phonemes")
def get_phoneme_list(response: Response) -> dict[str, Any]:
    """All English phonemes covered by the tutor, in chart order."""
    response.headers["Cache-Control"] = CACHEABLE
    return {"phonemes": list_phonemes()}


@router.get("/api/phonemes/{symbol}")
def get_phoneme_detail(symbol: str, response: Response) -> dict[str, Any]:
    """Full tutor entry for one phoneme."""
    if get_phoneme(symbol) is None:
        raise HTTPException(status_code=404, detail="Unknown phoneme")
    response.headers["Cache-Control"] = CACHEABLE
    return phoneme_details(symbol)


@router.get("/api/tutor/card")
def get_tutor_card(
    response: Response,
    word: str = Query(..., max_length=80),
    expected: str = Query(..., max_length=8),
    actual: str = Query("", max_length=8),
):
    """Generate an educational tutor card for a specific mispronunciation."""
    try:
        card = generate_tutor_card(word, expected, actual)
    except Exception as exc:
        logger.exception("Error generating tutor card")
        raise HTTPException(status_code=500, detail="Error generating tutor card") from exc
    response.headers["Cache-Control"] = CACHEABLE
    return card
