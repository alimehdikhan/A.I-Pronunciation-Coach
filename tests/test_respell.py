"""Pronunciations in plain letters."""

import pytest

from backend.respell import respell


@pytest.mark.parametrize(
    ("word", "expected"),
    [
        ("think", "thingk"),
        ("the", "thuh"),
        ("about", "uh-BOWT"),
        ("path", "path"),
        ("thin", "thin"),
        ("beautiful", "BYOO-tuh-fuhl"),
        ("ship", "ship"),
        ("sheep", "sheep"),
    ],
)
def test_words_are_spelled_the_way_they_sound(word, expected):
    assert respell(word) == expected


def test_unknown_words_give_nothing_instead_of_a_guess():
    assert respell("zzqxkv") is None


def test_the_pronounce_endpoint_carries_the_respelling(client):
    body = client.get("/api/pronounce", params={"text": "Think about the thin path."}).json()
    assert [w["respelling"] for w in body["words"]] == ["thingk", "uh-BOWT", "thuh", "thin", "path"]
