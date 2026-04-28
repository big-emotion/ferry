# Story 1.8: README, Examples & First-Time Setup Documentation

Status: ready-for-dev

## Story

As a new Ferry operator,
I want a complete `README.md` that walks me through installing Ferry on a target repository in under 30 minutes,
so that I can trigger the first autonomous PR without writing code or seeking external support.

## Background

Epic 1 has shipped: scaffold (1-1), state schema (1-2), event envelope (1-3), concurrency (1-4), error taxonomy + audit + labels (1-5), secret scanning + IO wrappers (1-6), gitleaks CI (1-6b), and LLM harness routing (1-7). The harness side is functionally ready.

What's missing is the **operator-facing surface**: a README that walks a new user through repository setup end-to-end, an `examples/` directory containing reference artifacts (schemas, sample audit log, prompt templates, reviewer rules and rubric), and a `scripts/ferry-grade.ts` reviewer-grading utility that emits a `reviewer_grade` audit line.

This story closes Epic 1 by making Ferry installable on a new repo without source-diving.

## Acceptance Criteria

1. **Given** `README.md` exists in the Ferry repo root
   **When** a user familiar with Jira and GitHub follows it step by step
   **Then** it covers exactly 7 setup steps:
   1. Create GitHub App with scoped permissions per NFR-S6
   2. Install App on target repo
   3. Create Atlassian API token
   4. Configure Jira Automation rule per Ferry column with `repository_dispatch`
   5. Populate 6 repository secrets
   6. Set hard spend caps on each provider console
   7. Copy `.github/workflows/*.yml` and `.github/CODEOWNERS` into the target repo

2. **Given** the README data-privacy disclosure section exists
   **When** read before first use
   **Then** it prominently states that ticket content, sub-tasks, comments, and code diffs are transmitted to third-party LLM providers (NFR-D1).

3. **Given** the `examples/` directory exists
   **When** examined
   **Then** it contains: `chancellerie-setup.md`, `state.v1.schema.json`, `event.v1.schema.json`, `ferry-audit.jsonl` (≥ 20 sample lines), `prompt-templates/` (4 role prompt starters: refiner, developer, reviewer, iterator), `reviewer-rules.yaml`, `reviewer-rubric.md`.

4. **Given** `scripts/ferry-grade.ts` exists
   **When** run as `tsx scripts/ferry-grade.ts <pr-number>`
   **Then** it prompts for 4 rubric integers (Substantive / Specific / Correct / Actionable, each 0–2),
   computes verdict (`actionable` 5–8, `weak` 3–4, `rubber_stamp` ≤ 2, capped at `weak` if Correct=0),
   and writes one `ferry-audit` line with `phase=reviewer_grade`.

## Non-Goals

- Do not invoke real Jira or LLM provider APIs.
- Do not implement column-transition wiring (that's Epic 2).
- Do not finalize 1-6c gitleaks harness runtime scanning — that story is parked.

## Tasks / Subtasks

- [ ] Expand `README.md` with the 7-step setup flow, prominent privacy disclosure, and link to examples.
- [ ] Create `examples/chancellerie-setup.md` with the concrete chancellerie pilot setup walkthrough.
- [ ] Verify `examples/state.v1.schema.json` and `examples/event.v1.schema.json` already match the latest schemas in `src/schemas/` (copy if drifted).
- [ ] Create `examples/ferry-audit.jsonl` with ≥ 20 representative audit lines covering all phases.
- [ ] Create `examples/prompt-templates/` with 4 role prompt starters (`refiner.md`, `developer.md`, `reviewer.md`, `iterator.md`).
- [ ] Create `examples/reviewer-rules.yaml` with declarative review rules.
- [ ] Create `examples/reviewer-rubric.md` with the 4-dimension rubric and verdict table.
- [ ] Implement `scripts/ferry-grade.ts` with stdin-prompt mode and verdict computation, exporting pure functions for unit testing.
- [ ] Add unit tests for the grade-computation pure function (boundary cases: 0/0/0/0, 2/2/0/2 → capped weak, 2/2/2/2, 1/1/1/0 → weak, 0/2/2/2 → weak boundary, 5/3/2 thresholds).
- [ ] Ensure all gates pass: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`.

## Dev Notes

- **Determinism:** all examples must be self-contained. No env vars, no network, no fixtures generated at install time.
- **Audit format:** `examples/ferry-audit.jsonl` lines should follow the same shape `src/lib/audit/index.ts` produces: ticket, phase, run_id, model, input/output tokens, cost_eur, outcome, started_at, finished_at.
- **Verdict thresholds (reviewer-grade):**
  - `actionable`: total ≥ 5 (range 5–8)
  - `weak`: total 3–4
  - `rubber_stamp`: total ≤ 2
  - **Override:** any verdict is capped at `weak` (downgraded from `actionable`) if Correct=0.
- **CLI tooling:** use `node:readline/promises` for interactive prompts (no extra dependency). `tsx` is already available via dev deps.
- **Tests:** keep grade-logic pure and table-driven so the test file is small and exhaustive. Do not test the readline/IO part — only the pure function. The CLI script can be a thin shell over the pure function.
- **TDD discipline:** write the boundary-case test table first, run red, implement, green, refactor.

## Files Created / Modified

**Modified:**
- `README.md` — full 7-step setup expansion + privacy disclosure
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 1-8 → done

**Created:**
- `examples/chancellerie-setup.md`
- `examples/ferry-audit.jsonl`
- `examples/prompt-templates/refiner.md`
- `examples/prompt-templates/developer.md`
- `examples/prompt-templates/reviewer.md`
- `examples/prompt-templates/iterator.md`
- `examples/reviewer-rules.yaml`
- `examples/reviewer-rubric.md`
- `scripts/ferry-grade.ts`
- `scripts/ferry-grade.test.ts`

**Already exists (verified):**
- `examples/state.v1.schema.json`
- `examples/event.v1.schema.json`

## References

- Epic 1.8 spec: `_bmad-output/planning-artifacts/epics.md` (line 477+)
- FR52 (README-driven install), NFR-D1 (privacy disclosure), NFR-M2 (30-minute setup), NFR-S6 (App scopes)
- Architecture: `_bmad-output/planning-artifacts/architecture.md`
