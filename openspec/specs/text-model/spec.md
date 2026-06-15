# text-model Specification

## Purpose

Provide the small local language model that performs the decompose-and-align
step, plus a deterministic fallback so the system always works. The model and
its runtime are chosen to satisfy the hackathon size rules and the "Llama
Champion" / "Tiny Titan" bonus quests.

## Requirements

### Requirement: Qwen3-4B-Instruct via llama.cpp

The system SHALL use `Qwen3-4B-Instruct-2507` (Q4_K_M GGUF, repo
`unsloth/Qwen3-4B-Instruct-2507-GGUF`) run via `llama-cpp-python`. The
**non-thinking Instruct** variant is required so the model does not emit
`<think>` blocks that would break JSON parsing.

#### Scenario: Model loaded when GGUF present

- **WHEN** the configured GGUF file exists at the models path
- **THEN** the model is loaded via `llama-cpp-python` and the backend reports
  `llama`

#### Scenario: JSON-only chat completion

- **WHEN** a chat-JSON request is made
- **THEN** the model is called with a JSON response format and the output is
  parsed into a single JSON object (stripping any code fences and isolating the
  outermost `{...}`)

### Requirement: Model selection justified empirically

The chosen model SHALL be the one that passed the decompose+align prompt on all
7 evaluation cases — both at full precision (via HF Inference Providers) and at
Q4 locally.

#### Scenario: Evaluation criterion

- **WHEN** a candidate text model is evaluated
- **THEN** it must pass 7/7 of the decompose+align test cases at full precision
  and at Q4 to be eligible

### Requirement: Deterministic mock fallback

The system SHALL fall back to a deterministic mock backend when no model is
present or the model cannot be loaded, so the rest of the app continues to
function.

#### Scenario: No model available

- **WHEN** the GGUF file is missing or loading fails
- **THEN** the backend reports `mock` and decomposition is produced
  deterministically without an LLM

### Requirement: Env-driven model configuration

Model repo, file, thread count, and GPU layer offload SHALL be configurable via
environment variables so the same code runs on local Metal and on a Modal GPU.

#### Scenario: Override via environment

- **WHEN** `LINGUA_LLM_REPO`, `LINGUA_LLM_FILE`, `LINGUA_LLM_THREADS`, or
  `LINGUA_GPU_LAYERS` are set
- **THEN** the model loader uses those values (e.g. `-1` GPU layers offloads all
  layers to the GPU, `0` runs on CPU)
