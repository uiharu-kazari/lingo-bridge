"""Thin wrapper around a local GGUF model via llama-cpp-python.

Falls back to a deterministic mock so the rest of the app (and the whole
frontend) works even before the model has been downloaded/compiled.
"""
from __future__ import annotations
import json
import threading
import config

_llm = None
_backend = None  # "llama" | "mock"
_lock = threading.Lock()  # llama.cpp is not safe under concurrent calls


def _load():
    global _llm, _backend
    if _backend is not None:
        return
    if config.LLM_PATH.exists():
        try:
            from llama_cpp import Llama
            _llm = Llama(
                model_path=str(config.LLM_PATH),
                n_ctx=config.LLM_CTX,
                n_threads=config.LLM_THREADS,
                n_gpu_layers=config.LLM_GPU_LAYERS,
                verbose=False,
            )
            _backend = "llama"
            accel = "GPU" if config.LLM_GPU_LAYERS != 0 else "CPU"
            print(f"[llm] loaded {config.LLM_FILE} "
                  f"(n_gpu_layers={config.LLM_GPU_LAYERS}, {accel})")
            return
        except Exception as e:  # pragma: no cover
            print(f"[llm] failed to load llama.cpp ({e}); using mock")
    else:
        print("[llm] GGUF not found; using mock backend")
    _backend = "mock"


def backend() -> str:
    _load()
    return _backend


def chat_json(system: str, user: str, max_tokens: int = 1024) -> dict:
    """Run a chat completion that must return a single JSON object."""
    _load()
    if _backend == "llama":
        out = _llm.create_chat_completion(
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.3,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        text = out["choices"][0]["message"]["content"]
        return _parse_json(text)
    raise RuntimeError("mock backend has no chat_json; handled in translate.py")


def _parse_json(text: str) -> dict:
    text = text.strip()
    # Strip code fences if the model added them.
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
    # Grab the outermost {...}.
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1:
        text = text[start : end + 1]
    return json.loads(text)
