"""Modal deployment for Lingua Stack — text model (Qwen3-4B) on a GPU.

Cost guards baked in:
  * gpu="T4"            cheapest capable GPU (~$0.59/hr while active)
  * scaledown_window=120  container stops 2 min after the last request
  * max_containers=1    hard ceiling — never fans out to many GPUs
  * min_containers=0    idle cost = $0

Usage:
  modal run   modal_app.py::download_models     # one-time: fill the Volume (CPU only)
  modal deploy modal_app.py                      # build image + deploy, prints URL
  modal app stop lingua-stack                     # tear everything down
"""
import modal

app = modal.App("lingua-stack")

MODELS = "/models"
vol = modal.Volume.from_name("lingua-models", create_if_missing=True)

CUDA = "12.5.1"
image = (
    modal.Image.from_registry(
        f"nvidia/cuda:{CUDA}-runtime-ubuntu22.04", add_python="3.11"
    )
    .apt_install("espeak-ng", "libgomp1", "ffmpeg", "libsndfile1")
    # Prebuilt CUDA wheel (no compile) — the cu125 index has 0.3.29, which has
    # Qwen3 architecture support. Runtime CUDA libs come from the base image;
    # the GPU driver (libcuda.so.1) is injected by Modal at runtime.
    .pip_install(
        "llama-cpp-python==0.3.29",
        extra_index_url="https://abetlen.github.io/llama-cpp-python/whl/cu125",
    )
    # Torch (CUDA build) for Qwen3-TTS, installed before qwen-tts so its
    # torchaudio dep is satisfied by the matched cu124 pair.
    .pip_install(
        "torch", "torchaudio",
        index_url="https://download.pytorch.org/whl/cu124",
    )
    # qwen-tts owns its transformers==4.57.3 / accelerate pins.
    .pip_install("qwen-tts")
    .pip_install(
        "kokoro-onnx>=0.4.0", "onnxruntime>=1.17", "soundfile>=0.12",
        "fastapi>=0.110", "uvicorn>=0.29", "pydantic>=2.0",
        "huggingface_hub>=0.24",
    )
    .env(
        {
            "LINGUA_MODELS_DIR": MODELS,
            "LINGUA_AUDIO_DIR": "/tmp/lingua_audio",
            "LINGUA_STATIC_DIR": "/root/static",
            "LINGUA_GPU_LAYERS": "-1",   # offload all LLM layers to the GPU
            "LINGUA_LLM_THREADS": "4",
            "TTS_ENGINE": "qwen3",       # Qwen3-TTS-1.7B-CustomVoice on the GPU
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
    print("downloading Qwen3-TTS-12Hz-1.7B-CustomVoice (~4.5 GB) ...")
    from huggingface_hub import snapshot_download
    snapshot_download(
        "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
        local_dir=os.path.join(MODELS, "qwen3-tts"),
    )
    kd = os.path.join(MODELS, "kokoro")
    os.makedirs(kd, exist_ok=True)
    base = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
    for f in ["kokoro-v1.0.onnx", "voices-v1.0.bin"]:
        dst = os.path.join(kd, f)
        if not os.path.exists(dst):
            print("downloading", f)
            urllib.request.urlretrieve(base + f, dst)
    shutil.rmtree(os.path.join(MODELS, ".cache"), ignore_errors=True)
    shutil.rmtree(os.path.join(MODELS, "qwen3-tts", ".cache"), ignore_errors=True)
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
