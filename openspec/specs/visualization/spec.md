# visualization Specification

## Purpose

Present the 7-layer progressive translation as an interactive, toy-like
experience: a custom WebGL 3D card stack and a 2D parallel-sets view, served by
FastAPI (not Gradio, for the "Off-Brand" bonus), with per-layer audio playback.

> Ownership note: the frontend implementation under `static/*` is owned by a
> separate coding agent and MUST NOT be edited by others. This spec captures the
> intended behavior, not implementation details to change here.

## Requirements

### Requirement: Custom FastAPI-served frontend

The visualization SHALL be a fully custom HTML/CSS/JS frontend served directly
by FastAPI (no default Gradio UI), to satisfy the "Off-Brand" bonus.

#### Scenario: Frontend served from root

- **WHEN** a user opens the app root URL
- **THEN** the custom frontend is served and static assets are available under
  `/static`

### Requirement: 3D card stack and 2D parallel-sets views

The frontend SHALL provide a WebGL (Three.js, vendored locally) 3D card-stack
view and a 2D parallel-sets view of the same seven layers.

#### Scenario: Both views available

- **WHEN** a translation result is rendered
- **THEN** the user can view it as a 3D card stack (original at back, final at
  front) and as a 2D parallel-sets diagram

### Requirement: Source-to-target gradient colorization

Phrase blocks SHALL be colorized along a purple (source) to cyan (target)
gradient, and adjacent-layer phrase blocks SHALL be connected by broad elevated
translucent ribbons.

#### Scenario: Gradient and ribbons

- **WHEN** layers and links are rendered
- **THEN** blocks are colored from purple (source) to cyan (target) and adjacent
  layers are joined by translucent ribbons, with reordering shown as crossings

### Requirement: Interactive tracing and playback

The frontend SHALL let the user hover to trace a single phrase across all
layers, play per-layer audio, play all layers in sequence, and request a random
example via a "Surprise me" button.

#### Scenario: Hover trace

- **WHEN** the user hovers over a phrase block
- **THEN** that phrase's path is highlighted across every layer

#### Scenario: Audio playback

- **WHEN** the user triggers playback on a layer or "play all"
- **THEN** the corresponding layer audio is played (one layer, or all in
  sequence)

#### Scenario: Surprise me

- **WHEN** the user clicks "Surprise me"
- **THEN** a random curated example is loaded and translated
