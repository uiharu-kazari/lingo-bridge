# progressive-translation Specification

## Purpose

Decompose a single sentence into aligned phrase "units" with one structured LLM
call, then deterministically build a 7-layer progressive translation in which
the source language gradually becomes the target language. The layers and all
cross-layer links are computed in plain Python so that every visual link is
valid by construction.

## Requirements

### Requirement: Single structured decompose-and-align call

The system SHALL produce the phrase alignment with exactly **one** LLM call that
returns a single JSON object of shape
`{final: "<natural target sentence>", units: [{source, target, type, order_target}]}`,
where `type` is one of `concept | action | time | connector | other` and
`order_target` is the 0-based position of the unit in the natural target word
order.

#### Scenario: Sentence decomposed into aligned units

- **WHEN** a non-empty sentence is submitted with a source and target language
- **THEN** the LLM returns one JSON object containing a `final` natural target
  sentence and a list of `units`, each with `source`, `target`, `type`, and
  `order_target`

#### Scenario: Output is validated before use

- **WHEN** the model returns units
- **THEN** units missing source or target text are dropped, unknown `type`
  values are coerced to `other`, and `order_target` values are normalized into a
  clean 0..N-1 permutation by rank
- **AND** if no valid units remain the call is treated as a failure

#### Scenario: Mock fallback when no model is present

- **WHEN** the LLM backend is unavailable (no GGUF / load failure) or the LLM
  call fails twice
- **THEN** a deterministic mock decomposition is used so the rest of the app and
  the frontend still work

### Requirement: Seven deterministic progressive layers

The system SHALL build exactly seven layers labeled
`Original, Concept, Action / Feeling, Time / Context, Grammar Bridge,
Mostly Target, Final`. Layer 0 is fully source language and layer 6 is fully
target language.

#### Scenario: Layers built from units

- **WHEN** valid aligned units are available
- **THEN** the system produces seven layers in label order, where layer 0 shows
  every unit in its source form and the final layer uses the model's natural
  target sentence

### Requirement: Phrase flips scheduled by type

Phrases SHALL flip from source to target language by **type** on a fixed
schedule: `concept` flips at layer 1, `action` at 2, `time` at 3, `connector`
at 4, `other` at 5. Phrases of the same type flip together so each layer makes a
semantically/grammatically coherent move — never a random word replacement.

#### Scenario: Same-type phrases flip together

- **WHEN** layers are built
- **THEN** at each layer all units of the type scheduled for that layer switch
  to their target text (marked as a mixed/just-flipped state at the flip layer
  and fully target thereafter), and units of other types remain unchanged

### Requirement: Word-order migration to target order

Word order SHALL stay in source order for early layers and migrate to the target
order near the end (controlled by `REORDER_AT = 5`), so layers 0–4 keep source
order and layers 5–6 use target order. This reordering produces visible crossing
connector ribbons.

#### Scenario: Reorder near the end

- **WHEN** building a layer at index `>= REORDER_AT`
- **THEN** that layer's units are arranged in the target word order
- **AND** layers before `REORDER_AT` keep the original source order

### Requirement: Valid cross-layer links by construction

The system SHALL emit links that connect the **same unit** across adjacent
layers, classifying each link as `reorder` (position changed), `translate`
(language mix changed), or `keep` (unchanged). Because every link references the
same unit, every link is valid by construction.

#### Scenario: Adjacent-layer links emitted

- **WHEN** layers are built
- **THEN** for each pair of adjacent layers the system emits one link per shared
  unit, tagged `reorder`, `translate`, or `keep` according to what changed

#### Scenario: Result payload shape

- **WHEN** a translation completes
- **THEN** the result contains `source_lang`, `target_lang`, `source_text`,
  `final_text`, `n_units`, `layers`, and `links`
