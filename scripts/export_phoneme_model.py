"""
Export the phoneme recogniser to ONNX (int8) so the app can run it without PyTorch.

The model is Meta's wav2vec 2.0 CTC model fine-tuned to emit espeak IPA
phonemes (facebook/wav2vec2-lv-60-espeak-cv-ft). It hears the sounds that were
actually produced, with no language model to "correct" them into the intended
word, which is what pronunciation scoring needs.

Needs torch, transformers, onnx and onnxruntime (build time only):

    python scripts/export_phoneme_model.py OUT_DIR

Writes OUT_DIR/phonemes.onnx (log-probabilities, int8 weights) and
OUT_DIR/vocab.json.
"""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
from pathlib import Path

MODEL_ID = "facebook/wav2vec2-lv-60-espeak-cv-ft"
# Pinned so every build exports the same weights.
REVISION = "ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4"


def export(out_dir: Path, cache_dir: str | None = None, quantize: bool = True) -> Path:
    import torch
    from huggingface_hub import snapshot_download
    from transformers import Wav2Vec2ForCTC

    out_dir.mkdir(parents=True, exist_ok=True)
    source = Path(snapshot_download(MODEL_ID, revision=REVISION, cache_dir=cache_dir))
    model = Wav2Vec2ForCTC.from_pretrained(source).eval()

    class LogProbs(torch.nn.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, input_values):
            return torch.log_softmax(self.inner(input_values).logits, dim=-1)

    with tempfile.TemporaryDirectory() as tmp:
        fp32 = Path(tmp) / "phonemes.fp32.onnx"
        with torch.no_grad():
            torch.onnx.export(
                LogProbs(model),
                (torch.zeros(1, 16000),),
                str(fp32),
                input_names=["input_values"],
                output_names=["log_probs"],
                dynamic_axes={"input_values": {0: "batch", 1: "samples"}, "log_probs": {0: "batch", 1: "frames"}},
                opset_version=17,
                dynamo=False,
            )
        target = out_dir / "phonemes.onnx"
        if quantize:
            from onnxruntime.quantization import QuantType, quantize_dynamic

            # Weights of the transformer's matrix multiplies dominate the size and
            # the CPU time; the convolutional feature encoder stays in float.
            quantize_dynamic(str(fp32), str(target), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"])
        else:
            shutil.copyfile(fp32, target)

    shutil.copyfile(source / "vocab.json", out_dir / "vocab.json")
    (out_dir / "MODEL").write_text(json.dumps({"model": MODEL_ID, "revision": REVISION, "int8": quantize}) + "\n")
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--cache-dir", default=None)
    parser.add_argument("--fp32", action="store_true", help="skip int8 quantisation")
    args = parser.parse_args()
    path = export(args.out_dir, args.cache_dir, quantize=not args.fp32)
    print(f"Wrote {path} ({path.stat().st_size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
