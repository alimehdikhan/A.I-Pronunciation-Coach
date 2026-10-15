"""The abuse filter: clear abuse is caught in its usual disguises, ordinary text is not."""

import pytest

from backend.moderation import is_abusive


@pytest.mark.parametrize(
    "text",
    [
        "madarchod",
        "mader chod",
        "m a d a r c h o d",
        "you are stupid",
        "fuuuuck you",
        "f.u.c.k",
        "sh1t",
        "what a bitch",
        "dumb coach",
        "bhenchod",
        "gandu hai tu",
        "shut up",
        "SHUT UP!!",
    ],
)
def test_abuse_is_caught(text):
    assert is_abusive(text)


@pytest.mark.parametrize(
    "text",
    [
        "How do I say class",
        "Scunthorpe",
        "assistant",
        "pass the salt",
        "Can you help me with the th sound?",
        "mitochondria",
        "classic",
        "hello world",
        "Where should I start?",
        "bass guitar",
        "assess",
        "Thank you coach",
        "I hate this word",
        "I am stupid at the r sound",
        "",
    ],
)
def test_ordinary_text_is_not(text):
    assert not is_abusive(text)
