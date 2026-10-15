"""The Kokoro engine's clip cache, tested with a fake synthesiser (no model files needed)."""

import io
import wave

import numpy as np
import pytest

from backend.tts import KokoroVoice


class FakeEngine:
    def __init__(self):
        self.calls = []

    def create(self, text, voice, speed, lang):
        self.calls.append((text, voice, speed, lang))
        return np.sin(np.linspace(0, 80, 2400)).astype(np.float32) * 0.2, 24000


def make_voice(cache_dir, engine, name="af_heart"):
    voice = object.__new__(KokoroVoice)  # skip loading real model files
    import threading
    from collections import OrderedDict

    voice.engine = engine
    voice.voice_name = name
    voice.lang = "en-gb" if name[:1] == "b" else "en-us"
    voice.model_file = "fake.onnx"
    voice.cache_dir = cache_dir
    voice._synth_lock = threading.Lock()
    voice._cache_lock = threading.Lock()
    voice._cache = OrderedDict()
    voice._cache_size = 8
    return voice


def test_renders_a_valid_wav_once_and_remembers_it(tmp_path):
    engine = FakeEngine()
    voice = make_voice(tmp_path, engine)

    first = voice.synthesize("Hello there.", 1.0)
    second = voice.synthesize("Hello there.", 1.0)

    assert first == second and len(engine.calls) == 1
    with wave.open(io.BytesIO(first)) as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 24000)
    assert engine.calls[0] == ("Hello there.", "af_heart", 1.0, "en-us")


def test_a_restarted_server_reads_clips_from_disk(tmp_path):
    first_engine, second_engine = FakeEngine(), FakeEngine()
    make_voice(tmp_path, first_engine).synthesize("Good morning.", 0.95)

    restarted = make_voice(tmp_path, second_engine)
    assert restarted.has_clip("Good morning.", 0.95)
    audio = restarted.synthesize("Good morning.", 0.95)

    assert second_engine.calls == [] and audio[:4] == b"RIFF"


def test_speed_and_voice_are_part_of_the_cache_key(tmp_path):
    engine = FakeEngine()
    voice = make_voice(tmp_path, engine)
    voice.synthesize("Same words.", 1.0)
    voice.synthesize("Same words.", 0.7)
    make_voice(tmp_path, engine, name="bf_emma").synthesize("Same words.", 1.0)

    assert [(c[2], c[3]) for c in engine.calls] == [(1.0, "en-us"), (0.7, "en-us"), (1.0, "en-gb")]
    assert len(list(tmp_path.glob("*.wav"))) == 3


def test_rate_is_clamped_to_the_supported_range(tmp_path):
    engine = FakeEngine()
    voice = make_voice(tmp_path, engine)
    voice.synthesize("Fast.", 9.0)
    voice.synthesize("Slow.", 0.01)
    assert [c[2] for c in engine.calls] == [1.6, 0.5]


def test_prerender_covers_the_fixed_content():
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location("prerender_voice", Path(__file__).parent.parent / "scripts" / "prerender_voice.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    phrases = module.library_phrases()
    assert len(phrases) >= 30 and "Today is a beautiful day." in phrases
    items = module.jobs()
    assert len(items) == len(set(items))  # no duplicates
    rates = {rate for _text, rate in items}
    assert {0.95, 0.66}.issubset(rates)
    assert any(text == "think" for text, _ in items) or any(text == "thought" for text, _ in items)
    assert pytest is not None


# --- choosing a voice --------------------------------------------------------------


def test_a_catalog_voice_can_be_chosen_per_clip(tmp_path):
    engine = FakeEngine()
    voice = make_voice(tmp_path, engine)

    voice.synthesize("Same words.", 1.0)
    voice.synthesize("Same words.", 1.0, "bm_george")
    voice.synthesize("Same words.", 1.0, "bm_george")  # remembered per voice

    assert [(c[1], c[3]) for c in engine.calls] == [("af_heart", "en-us"), ("bm_george", "en-gb")]
    assert voice.has_clip("Same words.", 1.0, "bm_george") and not voice.has_clip("Same words.", 1.0, "am_adam")


def test_an_unknown_voice_falls_back_to_the_default(tmp_path):
    engine = FakeEngine()
    voice = make_voice(tmp_path, engine)
    voice.synthesize("Hello.", 1.0, "../../etc/passwd")
    voice.synthesize("Hello.", 1.0, "zf_xiaobei")  # in the bundle, but not offered
    assert [c[1] for c in engine.calls] == ["af_heart"]


def test_the_default_voices_clips_keep_their_original_names(tmp_path):
    import hashlib

    engine = FakeEngine()
    make_voice(tmp_path, engine).synthesize("Good morning.", 0.95)
    legacy = hashlib.sha1("af_heart|0.95|Good morning.".encode()).hexdigest()
    assert (tmp_path / f"{legacy}.wav").is_file()  # clips rendered before voice choice still hit


def test_warm_up_renders_once_without_caching_and_never_raises(tmp_path):
    engine = FakeEngine()
    voice = make_voice(tmp_path, engine)
    voice.warm_up()
    assert len(engine.calls) == 1 and not list(tmp_path.glob("*.wav"))

    class Broken:
        def create(self, *args, **kwargs):
            raise RuntimeError("no session")

    make_voice(tmp_path, Broken()).warm_up()  # start-up must survive a failed warm-up
