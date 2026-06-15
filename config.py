"""Central configuration for the Progressive Translation Card Stack app."""
import os
from pathlib import Path

ROOT = Path(__file__).parent
# MODELS_DIR / AUDIO_CACHE can be redirected via env (e.g. a Modal Volume).
MODELS_DIR = Path(os.environ.get("LINGUA_MODELS_DIR", ROOT / "models"))
AUDIO_CACHE = Path(os.environ.get("LINGUA_AUDIO_DIR", ROOT / "audio_cache"))
STATIC_DIR = Path(os.environ.get("LINGUA_STATIC_DIR", ROOT / "static"))

# ---- Text model (llama.cpp / GGUF) -----------------------------------------
# Override repo/file via env so the same code can serve a smaller model on a
# CPU deployment (Modal) and the 3B locally on Metal.
LLM_REPO = os.environ.get("LINGUA_LLM_REPO", "unsloth/Qwen3-4B-Instruct-2507-GGUF")
LLM_FILE = os.environ.get("LINGUA_LLM_FILE", "Qwen3-4B-Instruct-2507-Q4_K_M.gguf")
LLM_PATH = MODELS_DIR / LLM_FILE
LLM_CTX = 4096
LLM_THREADS = int(os.environ.get("LINGUA_LLM_THREADS", "6"))
LLM_GPU_LAYERS = int(os.environ.get("LINGUA_GPU_LAYERS", "-1"))  # -1=all (Metal/CUDA), 0=CPU

# ---- TTS: Qwen3-TTS (target, GPU) — engine selected by TTS_ENGINE env -------
# TTS_ENGINE=qwen3 uses Qwen3-TTS-12Hz-1.7B-CustomVoice (preset speakers, 10
# languages) via the `qwen-tts` package; default "kokoro" runs everywhere.
QWEN3_TTS_REPO = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
QWEN3_TTS_DIR = MODELS_DIR / "qwen3-tts"
QWEN3_SPEAKER = os.environ.get("QWEN3_SPEAKER", "Ryan")  # speaks all 10 langs
QWEN3_ATTN = os.environ.get("QWEN3_ATTN", "sdpa")        # sdpa | flash_attention_2

# TTS_ENGINE=remote proxies /api/tts to a deployed instance (so a GPU-less
# machine can use the same Qwen3-TTS audio as production while developing).
TTS_REMOTE_URL = os.environ.get(
    "LINGUA_TTS_REMOTE_URL", "https://uiharu-kazari--lingua-stack-web.modal.run"
)

# ---- TTS: Kokoro-82M via onnxruntime (interim / fallback) -------------------
KOKORO_DIR = MODELS_DIR / "kokoro"
KOKORO_MODEL = KOKORO_DIR / "kokoro-v1.0.onnx"
KOKORO_VOICES = KOKORO_DIR / "voices-v1.0.bin"

# The seven progressive layers (back -> front).
LAYER_LABELS = [
    "Original",            # 1 source sentence
    "Concept",             # 2 early concept translation
    "Action / Feeling",    # 3 action / feeling translation
    "Time / Context",      # 4 time / context translation
    "Grammar Bridge",      # 5 connector / grammar bridge
    "Mostly Target",       # 6 mostly target language
    "Final",               # 7 final natural target sentence
]

# Which phrase TYPE flips to the target language at which layer index (0-based).
# Phrases of the same type flip together => "same layer = related phrases".
FLIP_SCHEDULE = {
    "concept": 1,
    "action": 2,
    "time": 3,
    "connector": 4,
    "other": 5,
}
# Layer index at which word ORDER migrates to the target arrangement.
REORDER_AT = 5  # layers 0..4 keep source order; 5,6 use target order

# The 10 languages supported by Qwen3-TTS (the target speech model).
# name -> (ISO code, espeak lang code, kokoro voice or None)
# Kokoro (the interim TTS) only covers 7 of these; Korean/German/Russian have no
# Kokoro voice yet (voice=None) and will speak via fallback until Qwen3-TTS lands.
LANGUAGES = {
    "English":    ("en", "en-us", "af_heart"),
    "Spanish":    ("es", "es",    "ef_dora"),
    "French":     ("fr", "fr-fr", "ff_siwis"),
    "Italian":    ("it", "it",    "if_sara"),
    "Portuguese": ("pt", "pt-br", "pf_dora"),
    "German":     ("de", "de",    None),
    "Russian":    ("ru", "ru",    None),
    "Japanese":   ("ja", "ja",    "jf_alpha"),
    "Korean":     ("ko", "ko",    None),
    "Chinese":    ("zh", "cmn",   "zf_xiaobei"),
}
DEFAULT_VOICE = "af_heart"
