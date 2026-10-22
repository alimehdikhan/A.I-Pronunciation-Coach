"""Speech recognition on Groq's hosted Whisper large (backend.groq_asr). Groq is never reached: its HTTP client
is replaced by a stand-in."""

import httpx
import numpy as np
import pytest

from backend import groq_asr
from backend import runtime as runtime_module
from backend.config import settings
from backend.errors import CodedHTTPException
from backend.runtime import runtime
from tests.conftest import FakeASR, timed_words, wav_bytes

GROQ_REPLY = {
    "language": "english",
    "segments": [
        {"start": 0.0, "end": 2.0, "text": " I think so.", "no_speech_prob": 0.01},
        {"start": 2.0, "end": 4.0, "text": " Thank you.", "no_speech_prob": 0.9},  # invented over silence
    ],
    "words": [
        {"word": "I", "start": 0.1, "end": 0.3},
        {"word": "think", "start": 0.4, "end": 0.8},
        {"word": "so.", "start": 0.9, "end": 1.2},
        {"word": "Thank", "start": 2.5, "end": 2.8},
        {"word": "you.", "start": 2.9, "end": 3.2},
        {"word": " ", "start": 3.3, "end": 3.4},
    ],
}


class StandInClient:
    """Answers like Groq would: one response per call, in order."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def post(self, url, headers=None, data=None, files=None):
        self.calls.append(data)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def groq(monkeypatch, *responses, speech=((0.0, 2.0),), local=None):
    monkeypatch.setattr(groq_asr, "speech_spans", lambda audio: list(speech))
    monkeypatch.setattr(groq_asr.time, "sleep", lambda seconds: None)
    hosted = groq_asr.GroqWhisper("whisper-large-v3", "test-key", fallback=lambda: local)
    hosted._client = StandInClient(*responses)
    return hosted


def test_words_over_silence_are_dropped_and_the_text_follows_the_words():
    result = groq_asr.timed_words(GROQ_REPLY, duration=4.0, speech=[(0.0, 2.0)])
    assert [w["word"] for w in result["words"]] == ["I", "think", "so."]
    assert result["text"] == "I think so." and all(w["probability"] is None for w in result["words"])
    # Outside every stretch of speech: dropped even when Whisper was sure it was speech.
    sure = {**GROQ_REPLY, "segments": [{**s, "no_speech_prob": 0.0} for s in GROQ_REPLY["segments"]]}
    assert [w["word"] for w in groq_asr.timed_words(sure, 4.0, [(0.0, 2.0)])["words"]] == ["I", "think", "so."]


def test_a_recording_is_transcribed_on_groq_with_the_prompt(monkeypatch):
    hosted = groq(monkeypatch, httpx.Response(200, json=GROQ_REPLY))
    result = hosted.transcribe(np.zeros(16000 * 4, np.float32), prompt="Um, uh")
    assert result["text"] == "I think so." and result["duration"] == 4.0
    sent = hosted._client.calls[0]
    assert sent["model"] == "whisper-large-v3" and sent["prompt"] == "Um, uh"
    assert sent["timestamp_granularities[]"] == ["word", "segment"]


def test_silence_is_never_sent(monkeypatch):
    hosted = groq(monkeypatch, speech=())
    assert hosted.transcribe(np.zeros(16000 * 3, np.float32))["words"] == []
    assert hosted._client.calls == []
    assert hosted.transcribe(np.zeros(1000, np.float32))["text"] == ""  # a click


def test_a_busy_groq_is_asked_once_more(monkeypatch):
    hosted = groq(monkeypatch, httpx.Response(429, headers={"retry-after": "1"}), httpx.Response(200, json=GROQ_REPLY))
    assert hosted.transcribe(np.zeros(16000 * 2, np.float32))["text"] == "I think so."
    assert len(hosted._client.calls) == 2


def test_when_groq_cannot_answer_the_local_whisper_does(monkeypatch):
    local = FakeASR("I think so", timed_words("I think so"))
    hosted = groq(monkeypatch, httpx.ConnectError("down"), httpx.Response(503), local=local)
    result = hosted.transcribe(np.zeros(16000 * 2, np.float32), prompt="Um")
    assert result["text"] == "I think so" and len(local.calls) == 1 and local.prompts == ["Um"]
    assert result["words"][0]["probability"] is not None  # the local Whisper's confidences are kept
    # For a while Groq is left alone: the next recording goes straight to the local Whisper.
    hosted.transcribe(np.zeros(16000 * 2, np.float32))
    assert len(hosted._client.calls) == 2 and len(local.calls) == 2


def test_a_lasting_limit_is_not_asked_again_and_pauses_groq_for_as_long(monkeypatch):
    local = FakeASR()
    hosted = groq(monkeypatch, httpx.Response(429, headers={"retry-after": "120"}), local=local)
    hosted.transcribe(np.zeros(16000 * 2, np.float32))
    assert len(hosted._client.calls) == 1 and len(local.calls) == 1
    assert hosted._paused_until - groq_asr.time.monotonic() > 100


def test_groq_is_asked_again_once_the_pause_is_over(monkeypatch):
    local = FakeASR()
    hosted = groq(monkeypatch, httpx.Response(401), httpx.Response(200, json=GROQ_REPLY), local=local)
    hosted.transcribe(np.zeros(16000 * 2, np.float32))  # a refused request (a bad key) is not asked again
    assert len(hosted._client.calls) == 1 and len(local.calls) == 1
    hosted._paused_until = 0.0
    assert hosted.transcribe(np.zeros(16000 * 2, np.float32))["text"] == "I think so."


def test_without_a_local_whisper_the_learner_is_told_to_try_again(monkeypatch):
    hosted = groq(monkeypatch, httpx.ConnectError("down"), httpx.Response(503), local=None)
    with pytest.raises(CodedHTTPException) as raised:
        hosted.transcribe(np.zeros(16000 * 2, np.float32))
    assert raised.value.status_code == 503 and raised.value.code == "busy"


def test_the_local_whisper_loads_once_and_only_when_asked(monkeypatch):
    built = []
    monkeypatch.setattr(runtime_module, "_build_local_asr", lambda: built.append(1) or FakeASR())
    monkeypatch.setattr(runtime_module, "_local_asr_missing", False)
    monkeypatch.setattr(runtime, "local_asr", None)
    assert built == []
    first, second = runtime_module.get_local_asr(), runtime_module.get_local_asr()
    assert first is second and built == [1]


def test_a_local_whisper_that_cannot_load_is_not_tried_on_every_request(monkeypatch):
    attempts = []

    def broken():
        attempts.append(1)
        raise RuntimeError("model files missing")

    monkeypatch.setattr(runtime_module, "_build_local_asr", broken)
    monkeypatch.setattr(runtime_module, "_local_asr_missing", False)
    monkeypatch.setattr(runtime, "local_asr", None)
    assert runtime_module.get_local_asr() is None and runtime_module.get_local_asr() is None
    assert attempts == [1]


@pytest.mark.parametrize(
    ("engine", "key", "expected"),
    [("auto", "k", "groq"), ("auto", "", "local"), ("local", "k", "local"), ("groq", "k", "groq"), ("groq", "", "local")],
)
def test_groq_is_used_whenever_a_key_is_set(engine, key, expected):
    before = (settings.asr_engine, settings.groq_api_key)
    object.__setattr__(settings, "asr_engine", engine)
    object.__setattr__(settings, "groq_api_key", key)
    try:
        assert runtime_module.asr_engine() == expected
    finally:
        object.__setattr__(settings, "asr_engine", before[0])
        object.__setattr__(settings, "groq_api_key", before[1])


class HostedASR(FakeASR):
    remote = True


def test_every_recording_works_with_the_hosted_recogniser(client, monkeypatch):
    hosted = HostedASR("I think so", timed_words("I think so"))
    monkeypatch.setattr(runtime, "asr", hosted)
    practice = client.post("/api/evaluate", data={"target_text": "I think so"}, files={"audio": ("a.wav", wav_bytes(), "audio/wav")})
    speaking = client.post(
        "/api/speak/evaluate", data={"prompt_id": "int-about"}, files={"audio": ("a.wav", wav_bytes(seconds=3), "audio/wav")}
    )
    assert practice.status_code == 200 and speaking.status_code == 200 and len(hosted.calls) == 2


class BusyASR(FakeASR):
    remote = True

    def transcribe(self, audio, language="en", prompt=None):
        raise CodedHTTPException(503, "Speech recognition is busy right now.", "busy", {"Retry-After": "5"})


def test_a_busy_recogniser_reaches_the_learner_as_busy(client, monkeypatch):
    monkeypatch.setattr(runtime, "asr", BusyASR())
    response = client.post("/api/evaluate", data={"target_text": "Hello"}, files={"audio": ("a.wav", wav_bytes(), "audio/wav")})
    assert response.status_code == 503 and response.json()["code"] == "busy"


def test_with_groq_the_fallback_is_the_small_whisper(monkeypatch):
    import backend.asr

    sizes = []

    class Recorder:
        def __init__(self, model_size, **kwargs):
            sizes.append(model_size)

        def warm_up(self):
            pass

    monkeypatch.setattr(backend.asr, "WhisperASR", Recorder)
    before = (settings.groq_api_key, settings.whisper_model_size)
    object.__setattr__(settings, "whisper_model_size", "medium")  # a Space variable left over from before
    try:
        object.__setattr__(settings, "groq_api_key", "k")
        runtime_module._build_local_asr()
        object.__setattr__(settings, "groq_api_key", "")
        runtime_module._build_local_asr()
    finally:
        object.__setattr__(settings, "groq_api_key", before[0])
        object.__setattr__(settings, "whisper_model_size", before[1])
    assert sizes == ["base", "medium"]
