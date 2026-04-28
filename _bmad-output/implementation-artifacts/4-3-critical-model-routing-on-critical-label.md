# Story 4.3: Critical-Model Routing on `critical` Label

Status: review

## Story

As a Ferry operator,
I want tickets labeled `critical` to automatically use the higher-capability model for implementation,
So that complex or high-stakes tickets get the stronger SWE model without manual intervention.

## Acceptance Criteria

1. **Given** an envelope's labels list contains `critical`
   **When** `routeModel({ agent: 'developer', labels })` runs
   **Then** it returns the `critical` LLM route from config (FR17).

2. **Given** an envelope without `critical`
   **When** `routeModel(...)` runs
   **Then** it returns the `default` LLM route.

3. **Given** the agent is not 'developer'
   **When** `routeModel({ agent: 'refiner', labels })` runs
   **Then** it always returns the `default` route — only the developer respects `critical` per FR17 ACs.

## Tasks / Subtasks

- [x] `src/lib/llm/route.ts`: `routeModel`.
- [x] `src/lib/llm/route.test.ts`: covers all branches with an injected config.
- [x] All four CI gates pass locally.

## Dev Notes

- KISS: the helper takes the config as a parameter so tests don't need env-var manipulation.
