#!/usr/bin/env bash
# One-time setup: install deps + download local models (~2.5 GB).
set -e
cd "$(dirname "$0")"

echo ">> Installing Python deps"
# On Apple Silicon, build llama.cpp with Metal:
CMAKE_ARGS="-DGGML_METAL=on" pip install "llama-cpp-python>=0.3.0"
pip install kokoro-onnx onnxruntime soundfile fastapi uvicorn pydantic huggingface_hub numpy

echo ">> Downloading text model (Qwen2.5-3B-Instruct GGUF, ~2.1 GB)"
python3 - <<'PY'
from huggingface_hub import hf_hub_download
hf_hub_download("Qwen/Qwen2.5-3B-Instruct-GGUF",
               "qwen2.5-3b-instruct-q4_k_m.gguf", local_dir="models")
PY

echo ">> Downloading TTS model (Kokoro-82M ONNX, ~350 MB)"
mkdir -p models/kokoro
base="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
curl -L -o models/kokoro/kokoro-v1.0.onnx  "$base/kokoro-v1.0.onnx"
curl -L -o models/kokoro/voices-v1.0.bin   "$base/voices-v1.0.bin"

echo ">> Done. Run ./run.sh"
