# Project Context

## Purpose

**Lingo Bridge** is a *Progressive Translation Card Stack* built for the Hugging
Face "Build Small Hackathon". It turns a single sentence into a visible **and
audible** 7-layer progressive translation: the source language gradually becomes
the target language, one phrase-type at a time. The result is shown as an
interactive 3D card stack plus a 2D parallel-sets visualization, with per-layer
text-to-speech.

The product goal is for it to feel like an **interactive language toy**, not a
normal translator. Build priority order: clarity first, then visual impact.

Status: mid-build. Where source-file comments disagree with this document, this
document and the capability specs under `openspec/specs/` are the source of
truth (the code still carries some stale comments, e.g. older model names).

## Tech Stack

- **Language / runtime:** Python 3.11, served by **FastAPI** + uvicorn (port
  7860 locally). Deliberately *not* Gradio (targets the "Off-Brand" bonus).
- **Text model:** `Qwen3-4B-Instruct-2507` (Q4_K_M GGUF, repo
  `unsloth/Qwen3-4B-Instruct-2507-GGUF`) run via **llama.cpp**
  (`llama-cpp-python`). A deterministic mock backend is the fallback when no
  GGUF is present.
- **TTS model:** target is `Qwen3-TTS-12Hz-1.7B` (the **CustomVoice** variant,
  which ships preset speaker voices). Interim/current engine is **Kokoro-82M**
  via `kokoro-onnx` (Apache-2.0, torch-free), pluggable via env `TTS_ENGINE`.
- **Frontend:** fully custom **WebGL** (Three.js, vendored locally) 3D card
  stack + a 2D parallel-sets (SVG) view. Lives under `static/`.
- **Deployment:** **Modal.com** (serverless GPU), app name `lingo-bridge`,
  file `modal_app.py`. Models live in a Modal Volume `lingua-models`.

## Project Conventions

### Code Style

- Small, single-responsibility modules at repo root: `config.py`, `llm.py`,
  `translate.py`, `tts.py`, `examples.py`, `app.py`, `modal_app.py`.
- All configuration is env-driven through `config.py`
  (`LINGO_MODELS_DIR`, `LINGO_AUDIO_DIR`, `LINGO_STATIC_DIR`,
  `LINGO_LLM_REPO`/`LINGO_LLM_FILE`, `LINGO_LLM_THREADS`,
  `LINGO_GPU_LAYERS`, `TTS_ENGINE`).
- Keep LLM JSON simple and **validate model output before rendering**.
- Every backend that can fail has a graceful fallback (mock LLM, beep/silence
  TTS) so the app and frontend always work.

### Architecture

- **One** structured LLM call decomposes + aligns the sentence into phrase
  "units"; **plain Python** then builds the 7 layers and all the cross-layer
  links deterministically. This keeps JSON small and makes every visual link
  valid by construction.
- Backend API (FastAPI, `app.py`):
  - `GET /api/status`
  - `POST /api/translate {text, source, target}`
  - `POST /api/tts {text, lang}`
  - `GET /api/examples[?random=true]`
  - `GET /audio/{name}`
  - `GET /` (serves the custom frontend)

### Ownership boundary

- The **frontend (`static/*`) is owned by a separate coding agent and must not
  be edited** by anyone else. Application source files (`*.py`, `*.sh`,
  `requirements.txt`, etc.) are likewise out of scope for spec/doc work — only
  files under `openspec/` are edited here.

### Testing

- No formal test suite yet. Validation is empirical: the decompose+align prompt
  was tested across 7 cases and passed 7/7 both at full precision (HF Inference
  Providers) and at Q4 locally. Ad-hoc test scripts (`_modeltest.py`,
  `_q4test.py`) exist at repo root.

## Important Constraints

- **Hackathon model-size rule:** each model must be **≤32B parameters
  per model** (not summed); multiple models are allowed.
- **Languages: exactly 10** (the Qwen3-TTS supported set): English, Spanish,
  French, Italian, Portuguese, German, Russian, Japanese, Korean, Chinese.
  Hindi was dropped because Qwen3-TTS does not support it.
- **Cost guards on Modal:** `min_containers=0` (scale-to-zero),
  `max_containers=1`, `scaledown_window=120`; dev budget cap **$50**.
- Currently on **T4** GPU; moving to **L4** (needed for Qwen3-TTS /
  FlashAttention-2, also speeds up the LLM).
- `llama-cpp-python` is installed from a **prebuilt CUDA wheel** (cu125 index)
  on a CUDA runtime base image — compiling from source on a GPU-less builder
  fails.

## Targeted Bonus Quests

- **Off-Brand** — fully custom UI (no Gradio).
- **Llama Champion** — llama.cpp.
- **Field Notes** — blog write-up (`BLOG.md`).
- **Sharing is Caring** — agent trace.
- **Tiny Titan** — ≤4B per model (both models qualify).

## External Dependencies

- Hugging Face Hub (model download), `llama-cpp-python` cu125 prebuilt wheel
  index, `kokoro-onnx` + onnxruntime, `qwen-tts` (pins `transformers==4.57.3`,
  `accelerate==1.12.0`; optional flash-attn), Three.js (vendored locally under
  `static/vendor/three`), Modal.com.
- Live URL: https://uiharu-kazari--lingo-bridge-web.modal.run
