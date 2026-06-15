"""FastAPI backend + custom frontend for the Progressive Translation Card Stack.

Off-Brand: this is a fully custom HTML/CSS/JS frontend (no Gradio UI), served
straight from FastAPI. Off-the-Grid: every model runs locally (Qwen2.5-3B via
llama.cpp, Kokoro-82M via onnxruntime) — no cloud APIs.
"""
from __future__ import annotations
import hashlib
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config
import llm
import tts
import translate
import examples

app = FastAPI(title="Progressive Translation Card Stack")


class TranslateReq(BaseModel):
    text: str
    source: str = "English"
    target: str = "Spanish"


class TTSReq(BaseModel):
    text: str
    lang: str = "English"


def _llm_label(backend: str) -> str:
    if backend != "llama":
        return "mock"
    import re
    name = re.sub(r"-(Q\d|q\d|f16|bf16|fp16).*", "",
                  config.LLM_FILE.replace(".gguf", ""))
    return f"{name} · llama.cpp"


def _tts_label(backend: str) -> str:
    return {"qwen3": "Qwen3-TTS-1.7B", "remote": "Qwen3-TTS-1.7B (remote)",
            "kokoro": "Kokoro-82M", "beep": "fallback"}.get(backend, backend)


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


@app.get("/")
def index():
    return FileResponse(str(config.STATIC_DIR / "index.html"))


app.mount("/static", StaticFiles(directory=str(config.STATIC_DIR)), name="static")


if __name__ == "__main__":
    import uvicorn
    # Warm up models so the first request is fast.
    print("[startup] llm:", llm.backend(), "| tts:", tts.backend())
    uvicorn.run(app, host="127.0.0.1", port=7860)
