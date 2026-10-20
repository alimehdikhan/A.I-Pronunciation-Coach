"""
Does prompting Whisper keep filler words ("um", "uh") that it usually drops?

Synthetic voices say sentences with fillers in them. Each clip is transcribed twice,
plainly and with a disfluent prompt (backend.speaking.FILLER_PROMPT), and the fillers
Whisper kept are counted against the fillers that were said.

    python scripts/eval_fillers.py

Synthetic speech says "um" more cleanly than people do, so treat the result as an upper
bound. Needs the Whisper model and Kokoro.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.config import settings  # noqa: E402
from backend.speaking import FILLER_PROMPT, count_fillers  # noqa: E402

SENTENCES = [
    "So, um, I think we should, uh, start the meeting now.",
    "Well, uh, my name is Priya and, um, I work in finance.",
    "I, um, have been working on the project for, uh, three months.",
    "Um, the main reason is, uh, that the deadline moved.",
    "Uh, could you, um, send me the report by Friday?",
    "I like, um, reading books and, uh, playing cricket.",
]
VOICES = ["af_heart", "am_michael", "bf_emma"]


def main() -> None:
    from backend.api.speech import _prepare
    from backend.asr import WhisperASR
    from backend.tts import KokoroVoice

    asr = WhisperASR(settings.whisper_model_size, download_root=settings.asr_dir, beam_size=settings.asr_beam_size)
    voice = KokoroVoice(VOICES[0])
    said = kept_plain = kept_prompted = invented = 0
    for voice_id in VOICES:
        for sentence in SENTENCES:
            samples, _gain, _cleanup = _prepare(voice.synthesize(sentence, 1.0, voice_id), ".wav")
            plain = asr.transcribe(samples)["text"]
            prompted = asr.transcribe(samples, prompt=FILLER_PROMPT)["text"]
            n_said = count_fillers(sentence)["count"]
            n_plain, n_prompted = count_fillers(plain)["count"], count_fillers(prompted)["count"]
            said += n_said
            kept_plain += min(n_plain, n_said)
            kept_prompted += min(n_prompted, n_said)
            invented += max(0, n_prompted - n_said)
            print(f"[{voice_id}] said {n_said} | plain {n_plain}: {plain!r} | prompted {n_prompted}: {prompted!r}", flush=True)
    print(f"\nfillers said: {said}; kept without a prompt: {kept_plain} ({kept_plain / said:.0%}); "
          f"with the prompt: {kept_prompted} ({kept_prompted / said:.0%}); extra fillers the prompt invented: {invented}")


if __name__ == "__main__":
    main()
