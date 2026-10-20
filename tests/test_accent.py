"""British English target: non-rhotic forms are accepted, British IPA and respelling are shown, American is untouched."""

import numpy as np

from backend import acoustic, gop, phonetics, pronunciation
from tests.conftest import timed_words, wav_bytes


def forms(word, accent):
    return ["".join(p.phonemes) for p in phonetics.accent_pronunciations(word, accent)]


def test_non_rhotic_forms_drop_r_only_before_a_consonant_or_the_end():
    assert forms("car", "british") == ["kɑr", "kɑ"]
    assert "bɛtə" in forms("better", "british")
    assert forms("red", "british") == ["rɛd"] and forms("very", "british") == ["vɛri"]  # r before a vowel stays
    assert forms("car", "american") == ["kɑr"]  # the American target is unchanged


def test_british_ipa_and_plain_letters(client):
    body = client.get("/api/pronounce", params={"text": "car go", "accent": "british"}).json()
    assert [w["ipa"] for w in body["words"]] == ["kɑ", "gəʊ"]
    assert [w["respelling"] for w in body["words"]] == ["kah", "goh"]
    american = client.get("/api/pronounce", params={"text": "car"}).json()
    assert american["words"][0]["ipa"] == "kɑr" and american["words"][0]["respelling"] == "kahr"


def test_a_british_target_offers_non_rhotic_candidates_to_the_sound_model():
    vocab = {"<pad>": 0, "k": 1, "ɑ": 2, "ɹ": 3}
    inventory = gop.Inventory(vocab)
    american = [("".join(p.phonemes)) for p, _labels in acoustic._candidates("car", inventory)]
    british = [("".join(p.phonemes)) for p, _labels in acoustic._candidates("car", inventory, "british")]
    assert american == ["kɑr"] and british == ["kɑr", "kɑ"]


def test_evaluate_passes_the_accent_to_the_scorer(client, fake_asr, monkeypatch):
    from backend.runtime import runtime

    seen = []
    fake_asr.text, fake_asr.words = "my car", timed_words("my car")
    monkeypatch.setattr(runtime, "phonemes", type("P", (), {"log_probs": lambda self, s: np.zeros((10, 5), np.float32)})())
    monkeypatch.setattr(runtime.scorer, "inventory", object())

    def fake_analyse(tokens, log_probs, inventory, accent="american"):
        seen.append(accent)
        return None

    monkeypatch.setattr(pronunciation, "analyse_acoustics", fake_analyse)
    for accent in ("british", "american"):
        client.post("/api/evaluate", data={"target_text": "My car.", "accent": accent}, files={"audio": ("a.wav", wav_bytes(), "audio/wav")})
    assert seen == ["british", "american"]
    bad = client.post("/api/evaluate", data={"target_text": "My car.", "accent": "klingon"}, files={"audio": ("a.wav", wav_bytes(), "audio/wav")})
    assert bad.status_code == 422
