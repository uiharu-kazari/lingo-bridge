# deployment Specification

## Purpose

Deploy Lingo Bridge to serverless GPU infrastructure with strict cost controls
suitable for a hackathon dev budget, while supporting the GPU features the
target models need.

## Requirements

### Requirement: Modal serverless deployment

The system SHALL deploy on Modal.com as app `lingo-bridge` (file
`modal_app.py`), serving the FastAPI app as an ASGI app, with model weights
stored in a Modal Volume named `lingua-models`.

#### Scenario: Deploy and serve

- **WHEN** the app is deployed to Modal
- **THEN** the FastAPI app is served as an ASGI web endpoint backed by the
  `lingua-models` Volume
- **AND** it is reachable at the live URL
  `https://uiharu-kazari--lingo-bridge-web.modal.run`

### Requirement: Cost guards

The deployment SHALL enforce cost guards: scale-to-zero (`min_containers=0`),
`max_containers=1`, and `scaledown_window=120`. The dev budget cap is $50.

#### Scenario: Idle cost is zero

- **WHEN** there are no requests for longer than the scaledown window
- **THEN** the container stops and idle cost is zero, never fanning out beyond a
  single container

### Requirement: GPU tier supports target models

The deployment SHALL run on a GPU capable of the target workload. It currently
runs on **T4** and is moving to **L4**, which is required for Qwen3-TTS /
FlashAttention-2 and also speeds up the LLM.

#### Scenario: GPU upgrade for Qwen3-TTS

- **WHEN** Qwen3-TTS (requiring FlashAttention-2) is enabled
- **THEN** the deployment runs on an L4 GPU

### Requirement: Prebuilt CUDA wheel for llama.cpp

`llama-cpp-python` SHALL be installed from a prebuilt CUDA wheel (cu125 index)
on a CUDA runtime base image, because compiling from source on a GPU-less
builder fails.

#### Scenario: Image build uses prebuilt wheel

- **WHEN** the Modal image is built
- **THEN** `llama-cpp-python` is installed from the cu125 prebuilt wheel index
  on a CUDA runtime base image (no source compilation)
