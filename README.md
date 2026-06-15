---
title: Lingo Bridge
emoji: 🌉
colorFrom: purple
colorTo: indigo
sdk: docker
app_port: 7860
pinned: true
license: apache-2.0
short_description: Watch & hear a sentence gradually become another language.
tags:
  - track:wood
  - sponsor:openbmb
  - sponsor:modal
  - achievement:offbrand
  - achievement:llama
  - achievement:tinytitan
  - achievement:fieldnotes
  - minicpm
  - small-models
  - translation
  - tts
---

# 🌉 Lingo Bridge

> **Watch and hear** a sentence gradually become another language — phrase by phrase, layer by layer.

Most translators show you a destination. **Lingo Bridge shows you the journey.** One sentence becomes a **seven-stage transformation** from the source language to the target — meaning crosses first, then actions, then time words, then grammar glue, and finally the word order rearranges into something natural — rendered as an interactive **3D card stack** and **spoken aloud at every stage**. A language *toy*, not a translator.

## 🎬 Demo

▶ **[Demo video](docs/demo.mp4)**  ·  📣 **Social posts:** [X/Twitter](https://x.com/auracanvas/status/2066666490871558485) · [Bluesky](https://bsky.app/profile/auracanvas.bsky.social/post/3moehclek7k26)

![Lingo Bridge](docs/poster.png)

## 💡 The idea & tech (write-up)

A single structured call to a **small text model (Qwen3-4B-Instruct, via llama.cpp)** decomposes the sentence into aligned phrase *units* `{source, target, type, order_target}`. The seven progressive layers, the purple→cyan colours, and the phrase-to-phrase links are then built **deterministically in Python** — so the JSON stays simple and **every link is valid by construction**. Phrases flip to the target language *by type* (so each layer is one coherent move, never random words), and word order migrates near the end, producing crossing ribbons. Each layer is spoken by **OpenBMB VoxCPM2** (a TTS model built on the **MiniCPM-4** backbone, 30 languages). The UI is a fully custom **Three.js** card stack mounted inside a Gradio Space; the GPU models run on **Modal** (scale-to-zero), with the demo examples pre-rendered (layers + audio) so they play instantly.

## 🧠 Models — each well under the 32B cap

| Role | Model | Size | Runtime |
|------|-------|------|---------|
| Text (decompose + align) | [`Qwen/Qwen3-4B-Instruct-2507`](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) (Q4_K_M GGUF) | **4B** | llama.cpp |
| Speech (per-layer TTS) | [`openbmb/VoxCPM2`](https://huggingface.co/openbmb/VoxCPM2) — built on **MiniCPM-4** | **2B** | voxcpm (GPU) |

## 🌍 Languages (10)

English · Spanish · French · Italian · Portuguese · German · Russian · Japanese · Korean · Chinese — any pair, either direction.

## 🏆 What we're entered for

- **Track — Thousand Token Wood** (a delightful, AI-native language toy).
- 🎨 **Off Brand** (`achievement:offbrand`) — a fully custom Three.js UI, far past the default Gradio look, mounted via `gr.mount_gradio_app`.
- 🦙 **Llama Champion** (`achievement:llama`) — the text model (Qwen3-4B) runs through the **llama.cpp** runtime.
- 🐜 **Tiny Titan** (`achievement:tinytitan`) — every model is ≤4B (Qwen3-4B + VoxCPM2 2B).
- 📓 **Field Notes** (`achievement:fieldnotes`) — see *What I learned* below.
- 🎬 **Best Demo** — app + demo video + social post.
- 🏅 **Bonus Quest Champion** — multiple bonus criteria met.
- **OpenBMB · Best MiniCPM Build** — speech by **VoxCPM2 (MiniCPM-4 backbone)**.
- **Modal · Best Use of Modal** — Qwen3-4B + VoxCPM2 run on Modal (L4, scale-to-zero); see Architecture.

## 📓 What I learned (field notes)

- **Push structure into Python, not the prompt.** Asking the LLM for the full 7-layer graph produced broken links. Asking for *one* thing — aligned phrase units `{source, target, type, order_target}` — and building the layers deterministically in Python made **every link valid by construction**. The model does the part only a model can; code does the rest.
- **Small genuinely won on latency.** Qwen3-4B nailed the decomposition across all 10 languages. I tried NVIDIA's Nemotron-9B-v2 for a sponsor prize, but its hybrid-Mamba decode took >120s for a single interactive translation — unusable for a *toy*. The 4B model was both good enough and fast enough.
- **VoxCPM2 reads mixed-language text directly.** No language tag needed, which is exactly what the hybrid intermediate layers (half source, half target) require — a per-language TTS would have choked on them. Reusing one anchor clip kept the narrator voice consistent across layers.
- **Thin Space + Modal GPU is the right split.** A free CPU Space serving the custom UI and proxying model calls to a scale-to-zero Modal L4 keeps the Space light and the GPU cheap, while pre-rendering the demo examples (layers **and** audio) makes the toy feel instant even on a cold backend.

## 🏗️ Architecture

A thin **Gradio Space (free CPU)** serves the custom UI and **proxies model calls to a Modal L4 GPU** that runs Qwen3-4B (llama.cpp) + VoxCPM2. The Space stays light and the GPU scales to zero. The 🎲 *Surprise me* examples are pre-rendered (layers **and** VoxCPM2 audio baked in), so the demo is instant even on a cold backend.

## ▶️ Run / deploy

```bash
# GPU backend on Modal (Qwen3-4B + VoxCPM2):
modal run modal_app.py::download_models && modal deploy modal_app.py
# Local (no GPU) — proxy everything to the Modal backend, no model loads locally:
LINGO_REMOTE_URL=https://uiharu-kazari--lingo-bridge-web.modal.run \
TTS_ENGINE=remote LINGO_TTS_REMOTE_URL=https://uiharu-kazari--lingo-bridge-web.modal.run \
python3 app.py
```

## ✅ Entry checklist

- **REQ-01 ≤32B/model** — Qwen3-4B + VoxCPM2 (2B). ✓
- **REQ-02 Gradio Space in the org** — Docker Space `build-small-hackathon/lingo-bridge`. ✓
- **REQ-03 Demo video** — [docs/demo.mp4](docs/demo.mp4). ✓
- **REQ-04 Social post** — [X](https://x.com/auracanvas/status/2066666490871558485) · [Bluesky](https://bsky.app/profile/auracanvas.bsky.social/post/3moehclek7k26). ✓
- **REQ-05 ZeroGPU limit** — n/a (GPU on Modal, not ZeroGPU). ✓
- **REQ-06 README tags + write-up** — above. ✓
