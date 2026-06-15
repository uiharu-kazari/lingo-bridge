"""Modal deployment for Lingo Bridge — text model (Qwen3-4B) on a GPU.

Cost guards baked in:
  * gpu="T4"            cheapest capable GPU (~$0.59/hr while active)
  * scaledown_window=120  container stops 2 min after the last request
  * max_containers=1    hard ceiling — never fans out to many GPUs
  * min_containers=0    idle cost = $0

Usage:
  modal run   modal_app.py::download_models     # one-time: fill the Volume (CPU only)
  modal deploy modal_app.py                      # build image + deploy, prints URL
  modal app stop lingo-bridge                     # tear everything down
"""
import modal

app = modal.App("lingo-bridge")

MODELS = "/models"
vol = modal.Volume.from_name("lingua-models", create_if_missing=True)

CUDA = "12.5.1"
image = (
    modal.Image.from_registry(
        f"nvidia/cuda:{CUDA}-runtime-ubuntu22.04", add_python="3.11"
    )
    # build-essential: VoxCPM2 warms up via torch.compile (inductor), which
    # needs a host C/C++ compiler at runtime.
    .apt_install("libgomp1", "ffmpeg", "libsndfile1", "build-essential")
    # LLM: prebuilt CUDA wheel (no compile) — cu125 index has 0.3.29 (Qwen3
    # support). Runtime CUDA libs come from the base image.
    .pip_install(
        "llama-cpp-python==0.3.29",
        extra_index_url="https://abetlen.github.io/llama-cpp-python/whl/cu125",
    )
    # Torch (CUDA build) for VoxCPM2 (needs torch>=2.5), installed before voxcpm.
    .pip_install(
        "torch", "torchaudio",
        index_url="https://download.pytorch.org/whl/cu124",
    )
    # TTS: OpenBMB VoxCPM2 (sponsor model, 30 languages, Apache-2.0).
    .pip_install("voxcpm")
    .pip_install(
        "soundfile>=0.12", "fastapi>=0.110", "uvicorn>=0.29", "pydantic>=2.0",
        "huggingface_hub>=0.24",
    )
    .env(
        {
            "LINGO_MODELS_DIR": MODELS,
            "LINGO_AUDIO_DIR": "/tmp/lingo_audio",
            "LINGO_STATIC_DIR": "/root/static",
            "LINGO_GPU_LAYERS": "-1",   # offload all LLM layers to the GPU
            "LINGO_LLM_THREADS": "4",
            "TTS_ENGINE": "voxcpm",      # OpenBMB VoxCPM2 on the GPU
            "HF_HOME": f"{MODELS}/hf",   # cache VoxCPM2 weights in the Volume
            "CC": "gcc", "CXX": "g++",   # for torch.compile (inductor) at runtime
            # Skip the slow torch.compile warmup (minutes on cold start) — run
            # eager. Plenty fast for short TTS clips, and cold start stays sane.
            "TORCHDYNAMO_DISABLE": "1",
        }
    )
    .add_local_dir("static", remote_path="/root/static")
    .add_local_python_source(
        "config", "llm", "translate", "tts", "examples", "examples_cache", "app"
    )
)


@app.function(image=image, volumes={MODELS: vol}, timeout=1800)
def download_models():
    """Populate the Volume (CPU only — no GPU cost)."""
    import os, shutil, urllib.request
    from huggingface_hub import hf_hub_download

    os.makedirs(MODELS, exist_ok=True)
    print("downloading Qwen3-4B-Instruct-2507 Q4_K_M ...")
    hf_hub_download(
        "unsloth/Qwen3-4B-Instruct-2507-GGUF",
        "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
        local_dir=MODELS,
    )
    print("caching OpenBMB VoxCPM2 weights into the Volume (HF_HOME) ...")
    from huggingface_hub import snapshot_download
    snapshot_download("openbmb/VoxCPM2")  # respects HF_HOME=/models/hf
    shutil.rmtree(os.path.join(MODELS, ".cache"), ignore_errors=True)
    vol.commit()
    print("volume contents:", os.listdir(MODELS))


@app.function(
    image=image,
    volumes={MODELS: vol},
    gpu="L4",                # Ada: FlashAttention-2 capable, 24GB (LLM + TTS)
    scaledown_window=120,
    timeout=900,             # heavier cold start (torch + 4.5GB TTS model)
    max_containers=1,
)
@modal.concurrent(max_inputs=4)
@modal.asgi_app()
def web():
    from app import app as fastapi_app
    return fastapi_app
