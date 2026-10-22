"""Tests for the FastAPI pronunciation coach API endpoints."""

import numpy as np
from fastapi.testclient import TestClient

from backend import main
from backend.api import speech
from backend.runtime import runtime
from tests.conftest import PROFILE_KEY, timed_words, wav_bytes

AUDIO = {"audio": ("sample.wav", wav_bytes(), "audio/wav")}
KEY = {"X-Profile-Key": PROFILE_KEY}


def evaluate(client, target, username=None, difficulty="intermediate", headers=None):
    data = {"target_text": target, "difficulty": difficulty}
    if username:
        data["username"] = username
    return client.post("/api/evaluate", data=data, files=AUDIO, headers=headers)


def test_health_reports_ready_models(client):
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["phoneme_backend"] == "cmudict"


def test_evaluate_returns_scores_metrics_and_words(client):
    response = evaluate(client, "Hello world")

    assert response.status_code == 200
    body = response.json()
    assert body["reference_text"] == "Hello world"
    assert body["transcription"] == "Hello world"
    assert body["score"] > 90
    assert set(body["metrics"]) == {"pronunciation", "fluency", "completeness", "clarity"}
    assert [w["display"] for w in body["words"]] == ["Hello", "world"]
    assert all(w["status"] == "correct" for w in body["words"])
    assert body["saved"] is False


def test_evaluate_detects_phoneme_substitution(client, fake_asr):
    fake_asr.text = "I sink three things"
    fake_asr.words = timed_words(fake_asr.text)

    body = evaluate(client, "I think three things.").json()

    think = body["words"][1]
    assert think["status"] == "mispronounced"
    assert {"op": "replace", "expected": "θ", "actual": "s", "tier": "fix"} in think["alignment"]
    assert body["weak_phonemes"] == ["θ"]
    assert body["insights"][0]["kind"] == "substitution"


def test_evaluate_requires_target_text(client):
    response = client.post("/api/evaluate", files=AUDIO)

    assert response.status_code == 400
    assert "target_text" in response.json()["detail"]


def test_evaluate_rejects_invalid_username(client):
    response = evaluate(client, "Hello world", username="<script>")

    assert response.status_code == 400


def test_history_analytics_and_practice_after_saved_attempts(client, fake_asr):
    fake_asr.text = "I sink three things"
    fake_asr.words = timed_words(fake_asr.text)
    first = evaluate(client, "I think three things.", username="Ada").json()
    assert first["saved"] is True

    fake_asr.text = "Hello world"
    fake_asr.words = timed_words(fake_asr.text)
    evaluate(client, "Hello world", username="Ada")

    history = client.get("/api/history/Ada").json()
    assert len(history["records"]) == 2
    assert history["records"][0]["target_text"] == "Hello world"
    assert history["records"][1]["mistakes"][0]["expected_phoneme"] == "θ"
    assert history["records"][0]["created_at"].endswith("+00:00")

    analytics = client.get("/api/analytics/Ada").json()
    assert analytics["total_practice_sessions"] == 2
    assert analytics["streak_days"] == 1
    assert analytics["top_weaknesses"][0]["phoneme"] == "θ"
    assert analytics["top_weaknesses"][0]["name"]
    assert "pronunciation" in analytics["metric_averages"]

    practice = client.get("/api/tutor/personalized-practice/Ada").json()
    assert practice["personalized"] is True
    assert practice["practices"][0]["target_phoneme"] == "θ"


def test_unknown_user_gets_empty_progress_and_default_drills(client):
    assert client.get("/api/history/Nobody").json()["records"] == []
    assert client.get("/api/analytics/Nobody").json()["total_practice_sessions"] == 0

    practice = client.get("/api/tutor/personalized-practice/Nobody").json()
    assert practice["personalized"] is False
    assert len(practice["practices"]) >= 3


def test_delete_history(client):
    evaluate(client, "Hello world", username="Grace", headers=KEY)

    assert client.delete("/api/history/Grace", headers=KEY).json() == {"deleted": 1}
    assert client.get("/api/history/Grace", headers=KEY).json()["records"] == []


def test_rate_limit_returns_429(client, monkeypatch):
    monkeypatch.setattr(speech.audio_rate_limiter, "limit", 1)

    assert evaluate(client, "Hello world").status_code == 200
    response = evaluate(client, "Hello world")

    assert response.status_code == 429
    assert "Retry-After" in response.headers


def test_transcribe_rejects_unsupported_file_type(client):
    response = client.post(
        "/api/transcribe",
        files={"audio": ("sample.txt", b"not audio", "text/plain")},
    )

    assert response.status_code == 400
    assert "Unsupported audio file type" in response.json()["detail"]


def test_model_not_ready_returns_503(monkeypatch):
    monkeypatch.setattr(runtime, "asr", None)
    monkeypatch.setattr(runtime, "scorer", None)
    client = TestClient(main.app)

    response = client.post("/api/transcribe", files=AUDIO)

    assert response.status_code == 503


def test_pronounce_returns_ipa_per_display_word(client):
    body = client.get("/api/pronounce", params={"text": "Beautiful day, 10 times"}).json()

    words = body["words"]
    assert [w["text"] for w in words] == ["Beautiful", "day,", "10", "times"]
    assert words[0]["ipa"] == "ˈbjutəfəl"
    assert words[2]["ipa"] == "tɛn"


def test_phoneme_library_endpoints(client):
    phonemes = client.get("/api/phonemes").json()["phonemes"]
    assert len(phonemes) == 41

    detail = client.get("/api/phonemes/θ").json()
    assert detail["symbol"] == "θ"
    assert detail["minimal_pairs"][0]["correct"]

    assert client.get("/api/phonemes/xyz").status_code == 404


def test_tutor_card_endpoint(client):
    card = client.get("/api/tutor/card", params={"word": "think", "expected": "θ", "actual": "s"}).json()

    assert card["phoneme"]["symbol"] == "θ"
    assert card["syllable_info"]["ipa"] == "θɪŋk"
    assert "/s/" in card["tutor_data"]["why_wrong"]


def test_unknown_api_route_returns_json_404(client):
    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.json()["detail"] == "Not found"


def test_silent_attempt_is_not_saved(client, fake_asr):
    fake_asr.text = ""
    fake_asr.words = []

    body = evaluate(client, "Hello world", username="Quiet").json()

    assert body["saved"] is False
    assert client.get("/api/history/Quiet").json()["records"] == []


def test_spa_fallback_serves_routes_but_404s_missing_files(client, tmp_path):
    from starlette.applications import Starlette

    from backend.main import SPAStaticFiles

    (tmp_path / "index.html").write_text("<html>app</html>", encoding="utf-8")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app-abc123.js").write_text("console.log(1)", encoding="utf-8")
    spa = Starlette()
    spa.mount("/", SPAStaticFiles(directory=str(tmp_path), html=True))
    web = TestClient(spa)

    route = web.get("/progress")
    assert route.status_code == 200 and "app" in route.text
    assert route.headers["cache-control"] == "no-cache"
    asset = web.get("/assets/app-abc123.js")
    assert "immutable" in asset.headers["cache-control"]
    assert web.get("/assets/missing-old.js").status_code == 404


def test_spa_unfingerprinted_files_are_revalidated(tmp_path):
    from starlette.applications import Starlette

    from backend.spa import SPAStaticFiles

    (tmp_path / "index.html").write_text("<html>app</html>", encoding="utf-8")
    (tmp_path / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    spa = Starlette()
    spa.mount("/", SPAStaticFiles(directory=str(tmp_path), html=True))

    assert TestClient(spa).get("/favicon.svg").headers["cache-control"] == "no-cache"


def test_spa_reloads_browsers_stuck_on_the_cached_legacy_page(tmp_path):
    from starlette.applications import Starlette

    from backend.spa import SPAStaticFiles

    (tmp_path / "index.html").write_text("<html>app</html>", encoding="utf-8")
    spa = Starlette()
    spa.mount("/", SPAStaticFiles(directory=str(tmp_path), html=True))
    web = TestClient(spa)

    script = web.get("/script.js")
    assert script.status_code == 200
    assert script.headers["content-type"].startswith("text/javascript")
    assert script.headers["clear-site-data"] == '"cache"'
    assert script.headers["cache-control"] == "no-store"
    assert "location.replace" in script.text and "_reload=" in script.text
    styles = web.get("/styles.css")
    assert styles.status_code == 200 and styles.headers["content-type"].startswith("text/css")
    assert styles.headers["clear-site-data"] == '"cache"'
    # Only the legacy page's own files are answered; other missing files still 404.
    assert web.get("/other.js").status_code == 404
    assert web.get("/assets/script.js").status_code == 404


class FakeVoice:
    def __init__(self):
        self.calls = []
        self.kept = {}

    def cached(self, text, rate=1.0):
        return self.kept.get((text, rate))

    def synthesize(self, text, rate=1.0, keep=True):
        self.calls.append((text, rate))
        clip = b"RIFF" + b"\x00" * 40
        if keep:
            self.kept[(text, rate)] = clip
        return clip


def test_tts_returns_wav_audio(client, monkeypatch):
    voice = FakeVoice()
    monkeypatch.setattr(runtime, "voice", voice)

    response = client.get("/api/tts", params={"text": "Today  is a beautiful day.", "rate": 0.7})

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content.startswith(b"RIFF")
    assert voice.calls == [("Today is a beautiful day.", 0.7)]
    assert client.get("/health").json()["tts_ready"] is True


def test_tts_unavailable_and_validation(client, monkeypatch):
    monkeypatch.setattr(runtime, "voice", None)
    assert client.get("/api/tts", params={"text": "Hello"}).status_code == 503

    monkeypatch.setattr(runtime, "voice", FakeVoice())
    assert client.get("/api/tts", params={"text": "x" * 400}).status_code == 422
    assert client.get("/api/tts", params={"text": "Hello", "rate": 5}).status_code == 422
    assert client.get("/api/tts", params={"text": "!!!"}).status_code == 400


class FakePhonemes:
    def __init__(self, fail=False):
        self.fail = fail
        self.calls = 0

    def log_probs(self, samples):
        self.calls += 1
        if self.fail:
            raise RuntimeError("onnx exploded")
        return np.zeros((10, 5), dtype=np.float32)


def test_evaluate_passes_acoustic_posteriors_to_the_scorer(client, monkeypatch):
    from backend.runtime import runtime

    fake = FakePhonemes()
    monkeypatch.setattr(runtime, "phonemes", fake)
    seen = {}
    original = runtime.scorer.score_pronunciation

    def spy(*args, **kwargs):
        seen["log_probs"] = args[5] if len(args) > 5 else kwargs.get("phoneme_log_probs")
        return original(*args, **kwargs)

    monkeypatch.setattr(runtime.scorer, "score_pronunciation", spy)

    response = client.post(
        "/api/evaluate",
        files={"audio": ("clip.wav", wav_bytes(), "audio/wav")},
        data={"target_text": "Hello world"},
    )

    assert response.status_code == 200 and fake.calls == 1
    assert seen["log_probs"] is not None and seen["log_probs"].shape == (10, 5)
    assert "phonemes;dur=" in response.headers["server-timing"]


def test_evaluate_survives_a_failing_phoneme_model(client, monkeypatch):
    from backend.runtime import runtime

    monkeypatch.setattr(runtime, "phonemes", FakePhonemes(fail=True))

    response = client.post(
        "/api/evaluate",
        files={"audio": ("clip.wav", wav_bytes(), "audio/wav")},
        data={"target_text": "Hello world"},
    )

    assert response.status_code == 200
    assert response.json()["score"] > 0


class BrokenVoice:
    def cached(self, text, rate=1.0):
        return None

    def synthesize(self, text, rate=1.0, keep=True):
        raise RuntimeError("kokoro exploded")


def test_a_failing_primary_voice_falls_back_to_piper(client, monkeypatch):
    piper = FakeVoice()
    monkeypatch.setattr(runtime, "voice", BrokenVoice())
    monkeypatch.setattr(runtime, "voice_engine", "kokoro")
    monkeypatch.setattr(speech, "get_fallback_voice", lambda: piper)

    response = client.get("/api/tts", params={"text": "Hello there"})

    assert response.status_code == 200 and response.content.startswith(b"RIFF")
    assert response.headers["x-voice-fallback"] == "piper"
    assert response.headers["cache-control"] == "no-store"  # do not pin the worse voice in caches
    assert piper.calls == [("Hello there", 1.0)]


def test_the_fallback_is_untouched_while_the_primary_voice_works(client, monkeypatch):
    primary = FakeVoice()
    monkeypatch.setattr(runtime, "voice", primary)
    monkeypatch.setattr(runtime, "voice_engine", "kokoro")

    def must_not_be_called():
        raise AssertionError("Piper must not be loaded while Kokoro works")

    monkeypatch.setattr(speech, "get_fallback_voice", must_not_be_called)

    response = client.get("/api/tts", params={"text": "Hello there"})

    assert response.status_code == 200 and "x-voice-fallback" not in response.headers
    # The text may be the learner's own, so only their browser may keep the clip.
    assert response.headers["cache-control"] == "private, max-age=604800"


def test_one_off_speech_is_never_kept(client, monkeypatch):
    voice = FakeVoice()
    monkeypatch.setattr(runtime, "voice", voice)
    live = {"text": "You mentioned leading a team of four.", "once": "true"}

    response = client.get("/api/tts", params=live)

    assert response.status_code == 200 and response.headers["cache-control"] == "private, no-store"
    assert voice.kept == {}


def test_rendered_speech_comes_back_without_rendering_again(client, monkeypatch):
    voice = FakeVoice()
    monkeypatch.setattr(runtime, "voice", voice)
    for _ in range(3):
        assert client.get("/api/tts", params={"text": "Good morning"}).status_code == 200
    assert voice.calls == [("Good morning", 1.0)]


def test_a_full_speech_queue_says_busy(client, monkeypatch):
    from backend.runtime import WorkGate

    monkeypatch.setattr(runtime, "voice", FakeVoice())
    gate = WorkGate(1, 0, observe=False)
    gate.running = 1  # one render under way and no room to wait
    monkeypatch.setattr(runtime, "tts_gate", gate)

    response = client.get("/api/tts", params={"text": "Hello there"})

    assert response.status_code == 503 and response.headers["retry-after"] == "5"


def test_when_both_voices_fail_the_client_gets_a_clean_error(client, monkeypatch):
    monkeypatch.setattr(runtime, "voice", BrokenVoice())
    monkeypatch.setattr(runtime, "voice_engine", "kokoro")
    monkeypatch.setattr(speech, "get_fallback_voice", lambda: BrokenVoice())

    assert client.get("/api/tts", params={"text": "Hello there"}).status_code == 500
    monkeypatch.setattr(speech, "get_fallback_voice", lambda: None)
    assert client.get("/api/tts", params={"text": "Hello there"}).status_code == 500


def test_piper_is_not_its_own_fallback(monkeypatch):
    from backend import runtime as runtime_module

    monkeypatch.setattr(runtime_module.runtime, "voice_engine", "piper")
    assert runtime_module.get_fallback_voice() is None


# --- choosing a coach voice -------------------------------------------------------


class ChoosyVoice:
    def __init__(self):
        self.calls = []

    def cached(self, text, rate=1.0, voice=None):
        return None

    def synthesize(self, text, rate=1.0, voice=None, keep=True):
        self.calls.append((text, rate, voice))
        return b"RIFF" + b"\x00" * 40


def test_the_voice_list_names_the_default_first(client, monkeypatch):
    monkeypatch.setattr(runtime, "voice", ChoosyVoice())
    monkeypatch.setattr(runtime, "voice_engine", "kokoro")

    body = client.get("/api/voices").json()

    assert body["engine"] == "kokoro" and body["default"] == "af_heart"
    ids = [v["id"] for v in body["voices"]]
    assert ids[0] == "af_heart" and "bm_george" in ids
    assert all({"id", "name", "accent", "gender"} <= set(v) for v in body["voices"])


def test_a_chosen_kokoro_voice_is_used_and_unknown_ones_are_ignored(client, monkeypatch):
    voice = ChoosyVoice()
    monkeypatch.setattr(runtime, "voice", voice)
    monkeypatch.setattr(runtime, "voice_engine", "kokoro")

    assert client.get("/api/tts", params={"text": "Hello there", "voice": "bf_emma"}).status_code == 200
    assert client.get("/api/tts", params={"text": "Hello there", "voice": "not_a_voice"}).status_code == 200
    assert client.get("/api/tts", params={"text": "Hello there", "voice": "../etc"}).status_code == 422

    assert [c[2] for c in voice.calls] == ["bf_emma", None]


def test_the_quick_voice_uses_piper(client, monkeypatch):
    primary, piper = ChoosyVoice(), FakeVoice()
    monkeypatch.setattr(runtime, "voice", primary)
    monkeypatch.setattr(runtime, "voice_engine", "kokoro")
    monkeypatch.setattr(speech, "get_quick_voice", lambda: piper)

    assert client.get("/api/tts", params={"text": "Hello there", "voice": "piper"}).status_code == 200
    assert piper.calls == [("Hello there", 1.0)] and primary.calls == []

    monkeypatch.setattr(speech, "get_quick_voice", lambda: None)  # Piper missing: default voice answers
    assert client.get("/api/tts", params={"text": "Hello there", "voice": "piper"}).status_code == 200
    assert len(primary.calls) == 1


def test_evaluate_reports_what_was_done_about_the_room(client):
    body = evaluate(client, "Hello world").json()
    cleanup = body["audio_cleanup"]
    assert set(cleanup) == {"snr_db", "denoised", "method", "background_voices"}

    from backend.config import settings

    object.__setattr__(settings, "noise_cleanup", False)  # Settings is frozen; flip it for this test only
    try:
        assert evaluate(client, "Hello world").json()["audio_cleanup"] is None
    finally:
        object.__setattr__(settings, "noise_cleanup", True)
