"""Tests for the FastAPI pronunciation coach API endpoints."""

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
    assert {"op": "replace", "expected": "θ", "actual": "s"} in think["alignment"]
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


class FakeVoice:
    def __init__(self):
        self.calls = []

    def synthesize(self, text, rate=1.0):
        self.calls.append((text, rate))
        return b"RIFF" + b"\x00" * 40


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
