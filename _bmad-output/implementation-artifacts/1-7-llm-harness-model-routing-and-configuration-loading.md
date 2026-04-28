# Story 1.7: LLM Harness Model Routing and Configuration Loading

Status: review

## Story

As a Ferry LLM harness,
I want model routing and configuration to be loaded deterministically from repo config,
so that agents can choose the right provider/model per task without hardcoding.

## Background

Epic 1 stories have established core scaffolding, schema validation, audit writing, and secret scanning CI gates.

This story introduces the first slice of the LLM harness: loading a config file and selecting a model/provider based on inputs (e.g., “critical” tasks).



## Acceptance Criteria

1. **Given** a repo config file exists for LLM routing (e.g., `ferry.config.json` or `ferry.config.yaml`)
   **When** the harness loads config
   **Then** it validates the config shape (zod or existing schema approach) and returns a typed object — verified by unit tests.

2. **Given** a request is marked as “critical” (either via argument or a `critical` boolean option)
   **When** the harness selects a model
   **Then** it returns the configured “critical” model route (provider + model id) — verified by unit tests.

3. **Given** a request is not marked as “critical”
   **When** the harness selects a model
   **Then** it returns the configured default route — verified by unit tests.

4. **Given** the config is missing or invalid
   **When** config load is attempted
   **Then** the harness throws a typed Ferry error with an appropriate taxonomy code (reusing the project’s error taxonomy) — verified by unit tests.

## Non-Goals

- Do not implement any real provider API calls (OpenAI/Anthropic/etc.) in this story.
- Do not add new secrets handling or runtime scanning (covered by 1-6c, currently blocked).

## Tasks / Subtasks

- [x] Identify/confirm where repo-level configuration should live (prefer existing patterns; likely under `src/config/` or root config file).
- [x] Implement `loadFerryConfig()` (or equivalent) that reads and validates config.
- [x] Implement `selectLlmRoute({ critical?: boolean })` (or equivalent) that returns provider + model id from config.
- [x] Add unit tests for config load and route selection.
- [x] Ensure errors use the existing error taxonomy and do not leak config contents unnecessarily.

## Dev Notes

- Prefer deterministic file reads (no network) and avoid environment-variable-only configuration.
- Reuse existing schema validation patterns from earlier stories.
- Keep tests stable: use inline fixtures or small test config files checked into repo.
