# languages Specification

## Purpose

Define the exact set of supported languages and how requests are validated
against it. The set is constrained to the languages supported by the target TTS
model (Qwen3-TTS).

## Requirements

### Requirement: Exactly ten supported languages

The system SHALL support exactly these ten languages (the Qwen3-TTS supported
set): English, Spanish, French, Italian, Portuguese, German, Russian, Japanese,
Korean, Chinese. Hindi is NOT supported because Qwen3-TTS does not support it.

#### Scenario: Language list reported

- **WHEN** the status endpoint is queried
- **THEN** it reports exactly these ten languages as supported

#### Scenario: Hindi excluded

- **WHEN** any example or request references Hindi
- **THEN** it is not served, because Hindi is not in the supported set

### Requirement: Validate request languages

Translate requests SHALL be rejected when either the source or target language
is not in the supported set.

#### Scenario: Unsupported language rejected

- **WHEN** a translate request specifies a source or target language outside the
  supported set
- **THEN** the request is rejected with a client error

### Requirement: Curated examples filtered to supported languages

The examples API SHALL only serve curated examples whose source and target
languages are both currently supported.

#### Scenario: Examples filtered

- **WHEN** the examples list is requested
- **THEN** only examples whose source and target are both in the supported set
  are returned
