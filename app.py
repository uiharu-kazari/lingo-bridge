"""FastAPI backend + custom frontend for the Progressive Translation Card Stack.

Off-Brand: this is a fully custom HTML/CSS/JS frontend (no Gradio UI), served
straight from FastAPI. Off-the-Grid: every model runs locally (Qwen2.5-3B via
llama.cpp, Kokoro-82M via onnxruntime) — no cloud APIs.
"""
from __future__ import annotations
import hashlib
import urllib.request
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import gradio as gr
from huggingface_hub import hf_hub_download

import config
import llm
import tts
import translate
import examples


def download_models_if_needed():
    import os
    if os.environ.get("LINGO_REMOTE_URL"):
        # Thin proxy deployment (HF Space): models live on the Modal backend.
        print("[startup] remote mode: skipping model downloads")
        return
    # Ensure directories exist
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    config.KOKORO_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Download LLM if needed
    if not config.LLM_PATH.exists():
        print(f"[startup] LLM not found at {config.LLM_PATH}. Downloading from {config.LLM_REPO}...")
        try:
            hf_hub_download(
                repo_id=config.LLM_REPO,
                filename=config.LLM_FILE,
                local_dir=str(config.MODELS_DIR),
                local_dir_use_symlinks=False
            )
            print("[startup] LLM downloaded successfully.")
        except Exception as e:
            print(f"[startup] Failed to download LLM: {e}")

    # 2. Download Kokoro ONNX model if needed
    if not config.KOKORO_MODEL.exists():
        print(f"[startup] Kokoro ONNX model not found at {config.KOKORO_MODEL}. Downloading...")
        try:
            base = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
            urllib.request.urlretrieve(f"{base}/kokoro-v1.0.onnx", str(config.KOKORO_MODEL))
            print("[startup] Kokoro ONNX model downloaded successfully.")
        except Exception as e:
            print(f"[startup] Failed to download Kokoro ONNX model: {e}")

    # 3. Download Kokoro voices if needed
    if not config.KOKORO_VOICES.exists():
        print(f"[startup] Kokoro voices not found at {config.KOKORO_VOICES}. Downloading...")
        try:
            base = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
            urllib.request.urlretrieve(f"{base}/voices-v1.0.bin", str(config.KOKORO_VOICES))
            print("[startup] Kokoro voices downloaded successfully.")
        except Exception as e:
            print(f"[startup] Failed to download Kokoro voices: {e}")


app = FastAPI(title="Lingo Bridge")


class TranslateReq(BaseModel):
    text: str
    source: str = "English"
    target: str = "Spanish"


class TTSReq(BaseModel):
    text: str
    lang: str = "English"


def _llm_label(backend: str) -> str:
    if backend == "remote":
        return "Qwen3-4B (remote)"
    if backend != "llama":
        return "mock"
    import re
    name = re.sub(r"-(Q\d|q\d|f16|bf16|fp16).*", "",
                  config.LLM_FILE.replace(".gguf", ""))
    return f"{name} · llama.cpp"


def _tts_label(backend: str) -> str:
    return {"voxcpm": "VoxCPM2", "remote": "VoxCPM2 (remote)",
            "beep": "fallback"}.get(backend, backend)


@app.get("/api/status")
def status():
    llm_b, tts_b = llm.backend(), tts.backend()
    return {
        "llm_backend": llm_b,
        "llm_model": config.LLM_FILE,
        "llm_label": _llm_label(llm_b),
        "tts_backend": tts_b,
        "tts_label": _tts_label(tts_b),
        "languages": list(config.LANGUAGES.keys()),
        "layer_labels": config.LAYER_LABELS,
    }


@app.get("/api/examples")
def api_examples(random: bool = False):
    """Curated demo sentences.

    `?random=true` returns a single random pick. When a precomputed result is
    available it is returned under `result` (full translation JSON) so the UI
    can render it WITHOUT any LLM call; otherwise it falls back to a lightweight
    `example` (text + langs) that the client would translate live.
    """
    import random as _r
    if random:
        results = examples.cached_results()
        if results:
            return {"result": _r.choice(results)}
        items = examples.available()
        return {"example": _r.choice(items) if items else None}
    return {"examples": examples.available()}


@app.post("/api/translate")
def api_translate(req: TranslateReq):
    if not req.text.strip():
        raise HTTPException(400, "empty text")
    if req.source not in config.LANGUAGES or req.target not in config.LANGUAGES:
        raise HTTPException(400, "unsupported language")
    try:
        result = translate.progressive_translate(req.text, req.source, req.target)
    except Exception as e:
        raise HTTPException(500, f"translation failed: {e}")
    return JSONResponse(result)


@app.post("/api/tts")
def api_tts(req: TTSReq):
    path = tts.synthesize(req.text, req.lang)
    name = config.Path(path).name
    return {"url": f"/audio/{name}"}


@app.get("/audio/{name}")
def get_audio(name: str):
    p = config.AUDIO_CACHE / name
    if not p.exists():
        raise HTTPException(404, "not found")
    return FileResponse(str(p), media_type="audio/wav")

@app.on_event("startup")
def startup_event():
    # Download models if needed at application startup
    download_models_if_needed()
    # Warm up models so the first request is fast
    print("[startup] Warming up models...")
    print("[startup] llm:", llm.backend(), "| tts:", tts.backend())


app.mount("/static", StaticFiles(directory=str(config.STATIC_DIR)), name="static")

# Define Gradio Blocks that embed our custom UI in an iframe
gradio_css = """
body, html, gradio-app, .gradio-container {
    background-color: #030408 !important;
    background: #030408 !important;
    margin: 0 !important;
    padding: 0 !important;
    max-width: 100% !important;
    width: 100% !important;
    border: none !important;
}
.gradio-container {
    max-width: 100% !important;
    width: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
}
iframe {
    width: 100% !important;
    height: 84vh !important;
    border: none !important;
    margin: 0 !important;
    padding: 0 !important;
    display: block !important;
}
footer {
    background-color: #030408 !important;
    background: #030408 !important;
    color: #687190 !important;
    border-top: 1px solid rgba(150, 170, 255, 0.12) !important;
    padding: 10px 0 !important;
    text-align: center !important;
    font-size: 12px !important;
}
footer a {
    color: #1fe0d0 !important;
    text-decoration: none !important;
}
footer a:hover {
    text-decoration: underline !important;
}
"""

with gr.Blocks(title="Lingo Bridge", css=gradio_css) as demo:
    gr.HTML(
        "<iframe src='/static/index.html' style='width: 100%; height: 84vh; border: none; margin: 0; padding: 0; display: block;'></iframe>"
    )

# Mount the Gradio app to the root path "/" of the FastAPI app
# Since our custom routes are defined BEFORE this mount, they will be matched first!
app = gr.mount_gradio_app(app, demo, path="/")


if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", "7860"))
    uvicorn.run(app, host="0.0.0.0", port=port)

