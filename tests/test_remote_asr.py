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


def groq(monkeypatch, *responses, speech=((0.0, 2.0),)):
    monkeypatch.setattr(groq_asr, "speech_spans", lambda audio: list(speech))
    monkeypatch.setattr(groq_asr.time, "sleep", lambda seconds: None)
    hosted = groq_asr.GroqWhisper("whisper-large-v3", "test-key")
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


def test_when_groq_cannot_answer_the_learner_is_told_to_try_again(monkeypatch):
    hosted = groq(monkeypatch, httpx.ConnectError("down"), httpx.Response(503))
    with pytest.raises(CodedHTTPException) as raised:
        hosted.transcribe(np.zeros(16000 * 2, np.float32))
    assert raised.value.status_code == 503 and raised.value.code == "busy"
    # A refused request (a bad key) is not asked again.
    hosted = groq(monkeypatch, httpx.Response(401))
    with pytest.raises(CodedHTTPException):
        hosted.transcribe(np.zeros(16000 * 2, np.float32))
    assert len(hosted._client.calls) == 1


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
