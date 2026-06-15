# tts Specification

## Purpose

Speak each translation layer aloud so the progressive translation is audible as
well as visible. The engine is pluggable so the interim Kokoro engine can be
swapped for the target Qwen3-TTS engine without changing callers.

## Requirements

### Requirement: Pluggable TTS engine via environment

The TTS engine SHALL be selectable via the `TTS_ENGINE` environment variable so
the interim and target engines can be swapped without code changes.

#### Scenario: Engine selected at load time

- **WHEN** the TTS subsystem loads
- **THEN** it selects the engine named by `TTS_ENGINE`, falling back to a lower
  tier (interim engine, then a beep/silence fallback) if the requested engine is
  unavailable

### Requirement: Target engine is Qwen3-TTS CustomVoice

The target TTS engine SHALL be `Qwen3-TTS-12Hz-1.7B`, the **CustomVoice**
variant (which provides preset speaker voices). The Base variant is
voice-clone-only and is NOT suitable. It runs via the `qwen-tts` pip package
(which pins `transformers==4.57.3` and `accelerate==1.12.0`), in bf16, with
optional flash-attn, ~4.5 GB, producing 24000 Hz output and accepting a
`language=` argument.

#### Scenario: Qwen3-TTS synthesis

- **WHEN** the Qwen3-TTS engine is active and a layer's text + language are
  submitted
- **THEN** audio is generated at 24000 Hz using the language argument and a
  preset speaker voice

### Requirement: Interim engine is Kokoro-82M

The current/interim engine SHALL be Kokoro-82M via `kokoro-onnx` (Apache-2.0,
torch-free). Kokoro covers only 7 of the 10 languages; German, Russian, and
Korean currently use a fallback clip until Qwen3-TTS is integrated.

#### Scenario: Supported-language synthesis

- **WHEN** Kokoro is active and the requested language has a Kokoro voice
- **THEN** audio is synthesized with that voice

#### Scenario: Unsupported-language fallback

- **WHEN** Kokoro is active and the requested language has no Kokoro voice
  (German, Russian, Korean)
- **THEN** a fallback clip is produced instead of failing

### Requirement: Content-addressed audio cache

Synthesized audio SHALL be written to the audio cache and addressed by a content
hash (of engine, language, and text) so repeated requests are served instantly.

#### Scenario: Cache hit

- **WHEN** the same text + language is requested again
- **THEN** the cached audio file is returned without re-synthesizing
