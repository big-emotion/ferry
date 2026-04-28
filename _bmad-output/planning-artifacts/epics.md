---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
status: complete
inputDocuments:
  - /Users/jnk/Documents/Dev/ferry/docs/prd.md
  - /Users/jnk/Documents/Dev/ferry/_bmad-output/planning-artifacts/architecture.md
---

# Ferry - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Ferry, decomposing the requirements from the PRD and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: The system can receive a Jira column-transition event and dispatch it to the matching workflow (Refine / Dev / Review / Iterate) based on the target column name.
FR2: The system can receive a `agent:<role>` label-added event on a Jira ticket and dispatch it as a manual re-trigger of the named phase, without advancing the Jira column.
FR3: The system can parse a Jira comment containing `@agent-<role>` mentions plus free-text instructions and dispatch a re-run of the named phase with the instructions injected into the agent prompt.
FR4: The system can assign a unique ULID `event_id` to every dispatch and record it in persistent audit storage before the run begins.
FR5: The system can detect duplicate `event_id`s on ingestion and refuse to start a second run for the same ID.
FR6: The system can skip dispatch for Jira tickets whose type is `Task` (not `Story`), per configured filter.
FR7: The system can refuse dispatch when the per-ticket daily trigger cap is exceeded and post a Jira comment indicating the reason.
FR8: The Refiner can read a Jira ticket (title, description, comments, labels) and produce a plan of sub-tasks.
FR9: The Refiner can post an audit comment summarizing its plan before creating sub-tasks.
FR10: The Refiner can create Jira sub-tasks as a single atomic batch, capped at 12 per parent ticket.
FR11: The Refiner can detect an empty or unactionable ticket and escalate with label `needs-human` instead of creating sub-tasks.
FR12: The Refiner can respect pre-existing sub-tasks on re-run, skipping recreation for any sub-task already present (idempotent).
FR13: ~~The Refiner can auto-transition the parent ticket to `Ready for Dev` on successful completion.~~ **REMOVED** — `Ready for Dev` transition is a manual operator checkpoint. The Refiner signals completion via Jira comment and label only; the operator moves the ticket manually.
FR14: The Developer can read a refined Jira ticket (parent + sub-tasks) and the target repository's current state.
FR15: The Developer can create a branch named `ferry/<ticket-key>` from the configured default branch.
FR16: The Developer can commit code changes to that branch and open a draft pull request whose body references the Jira ticket.
FR17: The Developer can use different models per role and auto-switch to the `critical` model when the ticket carries the `critical` label.
FR18: The Developer can auto-transition the ticket to `In Review` on PR creation.
FR19: The Reviewer can wait for CI status to become green before spending model tokens on code review.
FR20: The Reviewer can treat red CI as a synthetic finding, transition the ticket to `Changes Requested`, and exit without calling the review model.
FR21: The Reviewer can read a green-CI PR diff, its linked Jira ticket, and prior review history, then post findings as PR comments.
FR22: The Reviewer can fingerprint each finding by `(file, line-range, rule-id)` and record fingerprints in persistent audit storage.
FR23: The Reviewer can post a structured summary (findings count, actionability assessment, recommended next state) on the PR.
FR24: The Reviewer can auto-transition the ticket to `Changes Requested` when findings exist, or `Ready to Merge` when clean.
FR25: The Iterator can read the full review history (all prior rounds) and the latest Reviewer findings.
FR26: The Iterator can apply code changes to the existing branch to address the findings, preserving PR identity.
FR27: The Iterator can detect resurgent findings (same fingerprint across iterations) and escalate to `needs-human` immediately rather than looping.
FR28: The Iterator can auto-transition the ticket to `In Review` on commit, re-triggering the Reviewer.
FR29: The Iterator can enforce a max-iteration cap of 3 per ticket, escalating to `needs-human` on the third unresolved round.
FR30: The system can persist per-ticket pipeline state in a schema-validated artifact (bot-owned PR issue comment or `.ferry/state.json`) that every agent reads before writing.
FR31: The system can validate state against a JSON Schema on every read and write, refusing writes on schema violation.
FR32: The system can run preflight invariants before every agent run (PR open, head SHA matches, branch exists, Jira column matches phase) and abort with label `status:stale` on mismatch.
FR33: The system can enforce a cross-workflow concurrency group `ferry-${ticket.key}` with cancel-in-progress semantics.
FR34: A human operator can manually cancel any in-progress run through the standard GitHub Actions interface at any time.
FR35: A human operator can re-trigger any phase by applying the corresponding `agent:<role>` label on the Jira ticket.
FR36: A human operator can re-trigger any phase with extra context by posting a `@agent-<role>` comment on the Jira ticket.
FR37: A human operator can pause all Ferry processing for a ticket by applying the `ferry:paused` label.
FR38: A human operator can escalate a ticket manually to `Needs Human` by applying the `needs-human` label, halting downstream agents.
FR39: The final merge of any PR is performed exclusively by a human; Ferry never merges.
FR40: Ticket column transitions between named Jira columns are performed exclusively by a human; Ferry only writes to ticket labels and comments for status signalling.
FR41: The system can write one JSON line per run to a dedicated GitHub Issue `ferry-audit`, containing `{ticket, phase, run_id, model, input_tokens, output_tokens, cost_eur, outcome, duration_ms, timestamp}`.
FR42: The system can write or update a human-readable Jira comment per phase (not per run) containing the phase name, short outcome summary, cost, and a direct link to the raw GitHub Actions run. On phase re-run, the existing idempotency-marked comment is edited in place rather than duplicated.
FR43: The system can expose raw per-run logs via the standard GitHub Actions log retention (90 days) without additional configuration.
FR44: The system can label each PR and Jira ticket with the current phase (`ferry:refining`, `ferry:developing`, `ferry:reviewing`, `ferry:iterating`, `ferry:paused`, `ferry:ready`, `ferry:cancelled`, `needs-human`).
FR45: The system can query provider usage APIs daily and post a warning to `ferry-audit` when total spend on any provider reaches 50% of the configured kill-switch budget.
FR46: The system can detect provider HTTP 429/402 responses and respond by applying `ferry:paused` on affected tickets plus posting a Jira comment with expected resume date.
FR47: The system can scan every agent-generated commit, PR body, and Jira comment for secrets before writing; hits abort the write and apply `ferry:paused` with reason `secret-scan-hit`.
FR48: The system can refuse any agent PR that modifies files under `.github/**` via CODEOWNERS and path-filter enforcement.
FR49: The system can enforce a tool denylist on every agent run (no arbitrary shell, no arbitrary network, only configured MCP servers).
FR50: The system can run a scheduled reconciler every 15 minutes that scans Ferry-managed Jira columns, detects tickets whose state diverges from the latest GitHub state, and re-dispatches the missing event with a fresh ULID.
FR51: The reconciler can deduplicate against already-processed `event_id`s before re-firing to avoid double execution.
FR52: A new user can install Ferry on a target repository by following a documented sequence in `README.md` using only Jira UI, GitHub UI, and provider consoles — no local CLI, no script execution, no custom tooling required.
FR53: The system can read configuration from GitHub repository secrets and variables plus an optional `.ferry/config.yml` in the consumer repo.
FR54: The system can pin model IDs per role and document rollback models inline in workflow files so that a human can revert a model choice via a single PR.
FR55: Every agent-opened pull request body can render a fixed `TL;DR for the human merger` block at the top, populated by the Developer on PR open and refreshed by the Iterator on each revision commit. The block contains exactly six fields — `Ships`, `Touches`, `Risk` (low / medium / high), `Tests`, `Rollback`, `Reviewer verdict` — rendered as a markdown table within delimited bot-owned markers.
FR56: The system can fail a CI check on any agent-authored pull request whose body is missing the FR55 TL;DR block, has the six required fields out of order, or exceeds the declared length / style caps.
FR57: The Reviewer can emit every finding with a `rule_id` drawn from a published, versioned taxonomy file (`examples/reviewer-rules.yaml`). Findings with an unknown `rule_id` are rejected by the post-review validator.
FR58: The Reviewer can produce a `Reviewer verdict` summary (≤ 120 words) with exactly three fields — `decision`, `top-risk`, `reading-time-estimate` — and write it into the FR55 PR-body slot.
FR59: On any transition to `needs-human`, the system can render a single pinned PR-body block titled `🚨 Escalation Summary — human attention needed` containing five mandatory sections with specific content and format requirements.
FR60: The system can enforce a per-ticket comment-volume ceiling by editing existing idempotency-marked Jira and GitHub comments in place on phase re-runs, rather than appending new ones.

### NonFunctional Requirements

NFR-P1: End-to-end latency from Jira column transition to Refiner first Jira comment: p95 ≤ 120 seconds.
NFR-P2: End-to-end latency from Jira column transition to draft PR opened (Developer phase): p95 ≤ 15 minutes.
NFR-P3: Reviewer latency from PR green-CI to findings posted: p95 ≤ 10 minutes.
NFR-P4: Reconciler cron completion time: ≤ 2 minutes for up to 100 open Ferry-managed tickets across the project.
NFR-P5: Concurrency bound: at most one agent run executing per ticket at any time. Up to 10 different tickets may run in parallel across the project.
NFR-S1: All LLM calls pass untrusted user content through a delimiter-based separation scheme before reaching the system prompt.
NFR-S2: Every agent-generated commit, PR body, Jira comment, and Jira sub-task field is scanned for secrets before any write. Zero secret-leakage incidents is a hard release gate.
NFR-S3: Agent PRs modifying files under `.github/**` are refused by CODEOWNERS enforcement on 100% of runs (verified by test).
NFR-S4: Every agent run executes with a tool denylist: no arbitrary shell, no arbitrary network egress beyond configured endpoints, no filesystem access outside the workspace.
NFR-S5: Secrets live only in GitHub repository secrets and are never logged, printed, or written to any artifact.
NFR-S6: GitHub App permissions are minimal: `contents:write`, `pull-requests:write`, `issues:write`, `metadata:read`. No `administration`, no `workflow` write, no `actions:write`.
NFR-S7: Supply chain: all GitHub Action dependencies pinned by commit SHA. Dependabot enabled on the Ferry repository with SHA-pinning preserved on updates.
NFR-S8: Zero prompt-injection incidents during the chancellerie pilot is a Business Success gate.
NFR-R1: Webhook loss tolerance: any missed Jira webhook must be recovered within ≤ 15 minutes via the reconciler cron.
NFR-R2: Idempotency: re-running any phase on the same ticket produces no duplicate sub-tasks, comments, PR body blocks, or labels.
NFR-R3: State integrity: zero state corruption under concurrent Jira events across the pilot.
NFR-R4: Graceful degradation on provider outage: HTTP 429/402 from any provider triggers `ferry:paused` within 1 run and does not cascade.
NFR-R5: Recoverability: cancelling an in-progress run must leave ticket state consistent — no partial sub-task creation, no dangling branches, no half-updated PR bodies.
NFR-R6: Iteration convergence: ≥ 80% of pilot stories merge within 3 dev↔review iterations.
NFR-I1: Jira Cloud REST API v3 is the sole Jira integration surface. Ferry tolerates API rate-limit headers.
NFR-I2: GitHub REST / GraphQL API v4 and `repository_dispatch` are the sole GitHub integration surfaces.
NFR-I3: LLM provider calls respect each vendor's current SDK contract; model IDs are pinned in workflow files.
NFR-I4: Event envelope schema is versioned. Breaking changes require a version bump.
NFR-I5: Ferry supports the Jira plan tier that exposes outbound authenticated web requests (Standard, Premium).
NFR-C1: Per-provider monthly kill switch: hard-capped at 200€ each on Anthropic, Google AI, OpenAI consoles.
NFR-C2: Total pilot spend stays within 120–180€ across all providers for 40 stories.
NFR-C3: Per-story cost: average ≤ 1.50€, p95 ≤ 4€.
NFR-C4: Daily spend check: a scheduled workflow queries provider usage APIs and warns at 50% of kill-switch threshold.
NFR-O1: Every agent run writes exactly one JSON line to the `ferry-audit` GitHub Issue within 30 seconds of run completion.
NFR-O2: Every agent run produces a Jira comment within 30 seconds of completion, with a direct URL to the GitHub Actions raw log.
NFR-O3: Raw GitHub Actions logs are retained for ≥ 90 days by default.
NFR-O4: A user woken at 3am can reach sufficient context to diagnose any Ferry failure via exactly two bookmarks — the `ferry-audit` issue and the failing run's Jira ticket.
NFR-D1: Ticket content, sub-tasks, comments, and code diffs are transmitted to third-party LLM providers. The `README.md` MUST disclose this prominently before first use.
NFR-D2: No ticket content, code, or secrets are persisted by Ferry beyond what GitHub and Jira already persist natively.
NFR-D3: Provider data-retention policy is the consumer's responsibility; Ferry provides a configuration hook to disable providers.
NFR-M1: Zero long-running process: Ferry consists entirely of GitHub Actions workflows. No daemon, no service, no always-on infrastructure.
NFR-M2: Setup completion time: a user familiar with Jira and GitHub can complete first-time installation within 30 minutes.
NFR-M3: Rollback a model choice: replacing a role's model across the pipeline is a single-PR change to a workflow file.
NFR-M4: Troubleshooting surface: the operator can identify root cause of any failed run via the `ferry-audit` JSON line plus the raw GHA log, without reading Ferry source code.
NFR-M5: Upgrade path: upgrading Ferry in a consumer repo consists of re-copying workflow files from the pinned Ferry commit SHA; no migration scripts.
NFR-UX1: Time-to-decision on a clean PR: a merger reaches a merge-or-not decision in ≤ 2 minutes (median) and ≤ 5 minutes (p95).
NFR-UX2: Time-to-hypothesis on a `needs-human` PR: a merger can state a plausible root-cause hypothesis within 3 minutes of opening the PR. Target: ≤ 3 minutes on ≥ 4 of 5 drills each week.
NFR-UX3: PR-body reading quality: TL;DR block ≤ 200 words; Reviewer verdict ≤ 120 words; Escalation Summary ≤ 600 words. Flesch Reading Ease ≥ 50.
NFR-UX4: Notification volume discipline: no Ferry-managed Jira ticket accumulates more than 8 Ferry-authored Jira comments across its full lifecycle.

### Additional Requirements

Architecture requirements that impact implementation:

- **No starter template / framework**: Ferry is a hand-scaffolded TypeScript + Node.js on GitHub Actions. No web framework, no backend service. First implementation story = project scaffold.
- **Manual scaffold commands**: `npm init -y`, install `typescript @types/node vitest tsx`, install `@anthropic-ai/sdk @google/genai openai @octokit/rest ulid ajv`, `npx tsc --init --strict --module nodenext --target es2023`.
- **State artifact**: `.ferry/state.json` in-branch (Decision D1), JSON Schema–validated with Ajv. Schema at `src/schemas/state.v1.schema.json`. Deleted in final Iterator commit before PR merge.
- **Event envelope**: Jira Automation → GitHub `repository_dispatch` direct (no proxy). Versioned `v1` schema at `src/schemas/event.v1.schema.json`. Every workflow has a `gate-envelope` job as its first job.
- **Dedupe surface**: A bot-owned GitHub Issue `ferry-processed-events` (not in-branch), with one comment per accepted `event_id`. Pruned daily via `audit-daily.yml`.
- **Concurrency**: Per-phase `cancel-in-progress` policy — `refine.yml` and `reconciler.yml` use `true`; `dev.yml`, `review.yml`, `iterate.yml` use `false`. Hardened group-key expression with sinkhole fallback.
- **Freshness check**: `assertFreshOrSupersede()` runs at start of every write-phase to collapse stale queued runs.
- **LLM harness**: Custom minimal TypeScript harness per role — no agent framework. `src/lib/llm/` with thin SDK wrappers per provider. Cost computed locally from `pricing.ts`.
- **Code-application strategy**: Refiner emits `touch_paths: string[]` (max 20 files, 200 KB). Developer/Iterator use scope-enforced diff application via `src/lib/diff/apply.ts` with `git apply --check` + `git apply --index`.
- **Secret scanning**: `gitleaks` invoked inside agent harness before every external write (`src/lib/secret-scan/`). Plus GitHub push protection as defense-in-depth.
- **Prompt versioning**: Prompts at `src/agents/<role>/prompt.v<semver>.md`. Mismatched `prompt_version` triggers `status:stale`.
- **Testing layers**: Unit (vitest), contract tests with recorded fixtures (no live API in CI), dry-run E2E with `FERRY_DRY_RUN=1`.
- **Language policy**: Agent outputs preserve source language in Jira-visible fields; English for `ferry-audit` and GHA logs. Locale detected via French stopword heuristic.
- **Attachment handling**: Refiner lists attachments in audit comment but does not process them.
- **Error taxonomy**: 5 classes (`transient`, `spend-cap`, `state-invariant`, `oscillation`, `unknown`) mapped to deterministic labels + escalation.
- **Finding fingerprinting**: SHA-256 of `{file, line_start, line_end, rule_id}` normalized. Persisted per-iteration in `state.iteration_history[]`. Resurgent = immediate `needs-human`.
- **CODEOWNERS**: `.github/**` + `src/schemas/**` + `prompt.*.md` protected. Path-filter pre-check on every agent PR.
- **Labels allowlist**: Closed set enforced by `labels-allowlist.test.ts` CI gate.
- **Workflow naming**: `Ferry — <Phase>` prefix in `name:` field. All workflow files: `refine.yml`, `dev.yml`, `review.yml`, `iterate.yml`, `reconciler.yml`, `audit-daily.yml`, `ferry-ci.yml`.
- **`ferry grade` CLI**: `tsx scripts/ferry-grade.ts <pr>` prompts for rubric integers, writes `ferry-audit` phase=`reviewer_grade` line. Not a binary — invoked from cloned Ferry repo.
- **Implementation sequence** (informs epic ordering): (1) scaffold + CI, (2) shared libs, (3) LLM harness, (4) Refiner, (5) Developer, (6) Reviewer + fingerprinting, (7) Iterator, (8) Reconciler, (9) cost governance cron.

### UX Design Requirements

N/A — Ferry has no graphical UI surface. All human interaction is via Jira and GitHub native UIs. UX requirements are captured as FR55–FR60 and NFR-UX1–NFR-UX4 in the sections above.

### FR Coverage Map

| FR | Epic | Summary |
|---|---|---|
| FR1 | Epic 2 | Column-transition dispatch |
| FR2 | Epic 2 | Label re-trigger dispatch |
| FR3 | Epic 2 | @mention dispatch with instructions |
| FR4 | Epic 1 | ULID event_id assignment |
| FR5 | Epic 1 | Duplicate event_id rejection |
| FR6 | Epic 2 | Task-type filter |
| FR7 | Epic 2 | Daily trigger cap |
| FR8 | Epic 3 | Refiner reads ticket |
| FR9 | Epic 3 | Refiner audit comment before sub-tasks |
| FR10 | Epic 3 | Atomic batch sub-task creation (cap 12) |
| FR11 | Epic 3 | Empty ticket → needs-human |
| FR12 | Epic 3 | Idempotent re-run (skip existing sub-tasks) |
| FR13 | ~~Epic 3~~ | ~~Auto-transition to Ready for Dev~~ — REMOVED, manual operator checkpoint |
| FR14 | Epic 4 | Developer reads ticket + repo state |
| FR15 | Epic 4 | Branch creation ferry/<key> |
| FR16 | Epic 4 | Commit + draft PR open |
| FR17 | Epic 4 | Critical-model routing |
| FR18 | Epic 4 | Auto-transition to In Review |
| FR19 | Epic 5 | Reviewer waits for green CI |
| FR20 | Epic 5 | Red CI = synthetic finding |
| FR21 | Epic 5 | Reviewer reads diff + history, posts findings |
| FR22 | Epic 5 | Finding fingerprinting |
| FR23 | Epic 5 | Structured summary on PR |
| FR24 | Epic 5 | Auto-transition Changes Requested / Ready to Merge |
| FR25 | Epic 6 | Iterator reads full review history |
| FR26 | Epic 6 | Iterator applies findings to branch |
| FR27 | Epic 6 | Resurgent-fingerprint → needs-human |
| FR28 | Epic 6 | Auto-transition to In Review after commit |
| FR29 | Epic 6 | 3-iteration cap → needs-human |
| FR30 | Epic 1 | Per-ticket state persistence |
| FR31 | Epic 1 | JSON Schema validation on state |
| FR32 | Epic 1 | Preflight invariants + status:stale |
| FR33 | Epic 1 | Cross-workflow concurrency group |
| FR34 | Epic 7 | Human manual cancel via GHA UI |
| FR35 | Epic 7 | agent:role label re-trigger |
| FR36 | Epic 7 | @agent-role comment re-trigger |
| FR37 | Epic 7 | ferry:paused label handling |
| FR38 | Epic 7 | needs-human label, halt downstream |
| FR39 | Epic 7 | Human-only merge invariant |
| FR40 | Epic 7 | Human-only column transition invariant |
| FR41 | Epic 2 | ferry-audit JSON line per run |
| FR42 | Epic 2 | Jira phase comment per run |
| FR43 | Epic 1 | GHA log retention |
| FR44 | Epic 2 | Phase label application |
| FR45 | Epic 8 | Daily 50% spend soft alert |
| FR46 | Epic 8 | 429/402 auto-pause |
| FR47 | Epic 1 | Pre-write secret scan (gitleaks) |
| FR48 | Epic 1 | CODEOWNERS + path-filter enforcement |
| FR49 | Epic 1 | Tool denylist |
| FR50 | Epic 8 | 15-minute reconciler cron |
| FR51 | Epic 8 | Reconciler ULID dedupe |
| FR52 | Epic 1 | README-driven install |
| FR53 | Epic 1 | Config from secrets + variables + .ferry/config.yml |
| FR54 | Epic 1 | Model ID pinning + inline rollback |
| FR55 | Epic 9 | TL;DR block in PR body |
| FR56 | Epic 9 | CI check for TL;DR format |
| FR57 | Epic 5 | Reviewer rule_id taxonomy |
| FR58 | Epic 5 | Reviewer verdict in TL;DR slot |
| FR59 | Epic 6 | Escalation Summary block |
| FR60 | Epic 8 | Comment-volume ceiling (in-place edits) |

## Epic List

### Epic 1: Foundation — Scaffold, Core Infrastructure & Setup
The operator can clone Ferry, run its full CI suite, configure it against a target repo, and have a validated foundation ready to host agents. State schema, event envelope, concurrency, error taxonomy, audit, secret-scan, LLM harness, and all shared libs are shipped with full unit tests. Epic 1's state schema pre-reserves interrupt/override transition slots so Epic 7 is an addition, not a retrofit.

**FRs covered:** FR4, FR5, FR30, FR31, FR32, FR33, FR43, FR47, FR48, FR49, FR52, FR53, FR54

---

### Epic 2: Event Routing — Ticket Ingestion & Dispatch
The operator can move a Jira ticket to a Ferry column, apply an `agent:*` label, or post an `@agent-*` comment — and have Ferry correctly receive, validate, deduplicate, and route the event to the right workflow, with phase labels applied and audit lines emitted.

**FRs covered:** FR1, FR2, FR3, FR6, FR7, FR41, FR42, FR44

---

### Epic 3: Refiner Agent — Automated Planning
The operator can move a ticket to `Refinement` and see sub-tasks atomically created in Jira with an audit comment. The operator then manually moves the ticket to `Ready for Dev` after reviewing the plan. Unactionable tickets escalate cleanly to `needs-human`.

**FRs covered:** FR8, FR9, FR10, FR11, FR12

---

### Epic 4: Developer Agent — Automated Implementation
The operator sees a branch `ferry/<ticket>` and a draft PR opened in GitHub with the ticket's changes implemented — within 15 minutes of entering `In Development`.

**FRs covered:** FR14, FR15, FR16, FR17, FR18

---

### Epic 5: Reviewer Agent — Quality Gate
The operator sees actionable, fingerprinted findings posted on the PR, gated on green CI. Red CI produces a synthetic finding automatically. The Reviewer verdict is summarized in 120 words with clear decision, top risk, and reading-time estimate.

**FRs covered:** FR19, FR20, FR21, FR22, FR23, FR24, FR57, FR58

---

### Epic 6: Iterator Agent — Closed-Loop Delivery
The operator can have review findings automatically addressed across up to 3 iterations. Resurgent findings escalate immediately to `needs-human` with a structured escalation block, instead of looping indefinitely.

**FRs covered:** FR25, FR26, FR27, FR28, FR29, FR59

---

### Epic 7: Human Control & Override
The operator can cancel, re-trigger, pause, or escalate any Ferry phase at any time using only Jira labels and comments — giving full control without a dashboard or CLI.

**FRs covered:** FR34, FR35, FR36, FR37, FR38, FR39, FR40

---

### Epic 8: Observability, Cost Governance & Webhook Resilience
The operator can monitor Ferry's costs, receive early warnings before budget overruns, trust that missed Jira webhooks are recovered within 15 minutes, and stay within the 8-comment-per-ticket notification budget.

**FRs covered:** FR45, FR46, FR50, FR51, FR60

---

### Epic 9: Human-Reader Experience
The operator can merge a clean PR in under 2 minutes and diagnose a `needs-human` PR within 3 minutes — using the mandated TL;DR block and CI check that enforce reading quality at every push.

**FRs covered:** FR55, FR56

---

## Epic 1: Foundation — Scaffold, Core Infrastructure & Setup

The operator can clone Ferry, run its full CI suite, configure it against a target repo, and have a validated foundation ready to host agents. State schema, event envelope, concurrency, error taxonomy, audit, secret-scan, LLM harness, and all shared libs are shipped with full unit tests. Epic 1's state schema pre-reserves interrupt/override transition slots so Epic 7 is an addition, not a retrofit.

### Story 1.1: Project Scaffold, TypeScript Config & CI Pipeline

As a Ferry operator,
I want a well-structured Ferry repository with a passing CI pipeline,
So that I have a validated, contributor-ready foundation before any agent code is written.

**Acceptance Criteria:**

**Given** a freshly cloned `ferry` repo
**When** `npm ci && npm test` is run locally
**Then** TypeScript compiles without errors (`tsc --noEmit`), ESLint reports zero violations, Prettier reports zero formatting issues, and all vitest tests pass

**Given** a PR is opened against `main`
**When** `ferry-ci.yml` runs
**Then** it executes all quality gates in order: typecheck → lint → vitest → gitleaks → CODEOWNERS test — and fails the PR if any gate fails

**Given** `.github/CODEOWNERS` is present
**When** a PR touches any file under `.github/**`, `src/schemas/**`, or `prompt.*.md`
**Then** CI asserts that the CODEOWNERS rule matches and the PR requires the named human reviewer — verified by `codeowners.test.ts` that parses and asserts coverage

**Given** `dependabot.yml` is configured
**When** a GitHub Action dependency is referenced in any workflow file
**Then** it is pinned by commit SHA (not tag) and Dependabot is enabled to update it with SHA-pinning preserved

**And** the project structure matches the architecture: `src/agents/`, `src/lib/`, `src/schemas/`, `.github/workflows/`, `.github/actions/`, `examples/`, with `tsconfig.json` set to strict, ES2023, nodenext

---

### Story 1.2: State Schema, JSON Validation & Preflight Invariants

As a Ferry agent,
I want to read and write per-ticket pipeline state from a schema-validated `.ferry/state.json` file,
So that every agent phase starts from a known-good state and corrupt state is detected before any write.

**Acceptance Criteria:**

**Given** `src/schemas/state.v1.schema.json` exists with all required fields (version, ticket_key, phase, run_id, prompt_version, iteration, iteration_history, updated_at)
**When** `loadState(envelope)` is called on a branch that has `.ferry/state.json`
**Then** it reads and validates the file against the schema using Ajv, returning a typed state object — or throws `FerryError("state-invariant")` on schema violation

**Given** `writeState(state)` is called with a valid state object
**When** the write completes
**Then** the resulting `.ferry/state.json` validates against the v1 schema, and the previous valid state is preserved if the new state fails schema validation (no silent corruption)

**Given** `preflight(envelope)` is called at the start of an agent run
**When** any invariant fails: PR not open, head SHA mismatch, branch absent, or Jira column mismatches expected phase
**Then** it throws `FerryError("state-invariant")` with the specific mismatch logged — no external writes occur

**And** `src/schemas/schemas.test.ts` validates the schema file itself is valid JSON Schema, and the state schema `phase` enum pre-reserves all values including `paused`, `cancelled`, `needs-human` so Epic 7 override transitions require no schema change

---

### Story 1.3: Event Envelope Schema, ULID Generation & Deduplication

As a Ferry workflow,
I want every inbound `repository_dispatch` event validated against a versioned schema and deduplicated before any agent code runs,
So that malformed payloads are rejected early and duplicate dispatches never trigger duplicate runs.

**Acceptance Criteria:**

**Given** `.github/actions/ferry-envelope-validate/action.yml` is the first job in every workflow
**When** a `repository_dispatch` arrives with a payload that fails Ajv validation against `event.v1.schema.json` (missing required fields, invalid ticket_key pattern, unknown phase)
**Then** the workflow exits non-zero before any side-effect job runs — no payload content is logged

**Given** a valid envelope with a fresh `event_id` (ULID)
**When** `checkAndClaim(event_id)` is called in `src/lib/envelope/dedupe.ts`
**Then** it posts a claiming comment `[ferry:dedupe] <event_id> <ticket_key> <run_id>` to the `ferry-processed-events` GitHub Issue and returns `{ alreadyProcessed: false }`

**Given** the same `event_id` is dispatched a second time within 24 hours
**When** `checkAndClaim(event_id)` is called
**Then** it finds the existing comment and returns `{ alreadyProcessed: true }` — no run starts, no writes occur (FR5)

**Given** `src/lib/ulid/index.ts` exposes `generateULID()`
**When** called in tests
**Then** it accepts a seeded clock for deterministic output, and generated ULIDs match the pattern `^[0-9A-HJKMNP-TV-Z]{26}$`

---

### Story 1.4: Cross-Workflow Concurrency Action & Freshness Check

As a Ferry pipeline,
I want exactly one agent run executing per ticket at any time, with stale queued runs self-terminating,
So that concurrent Jira events never corrupt `.ferry/state.json` or produce duplicate outputs.

**Acceptance Criteria:**

**Given** a workflow includes the concurrency block with the `startsWith(ticket_key, 'CHAN-')` guard
**When** a malformed `ticket_key` (missing, empty, or without the expected prefix) arrives
**Then** it collapses into the `ferry-invalid-payload-sinkhole` group — verified by a vitest test that parses the workflow YAML and asserts the expression

**Given** `cancel-in-progress.test.ts` parses all workflow files
**When** it checks write-phase workflows (`dev.yml`, `review.yml`, `iterate.yml`)
**Then** `cancel-in-progress` is `false` for all three — the test fails CI if any write-phase workflow sets it to `true`

**Given** `refine.yml` and `reconciler.yml` exist
**When** parsed by the same test
**Then** `cancel-in-progress` is `true` for both

**Given** `assertFreshOrSupersede(envelope)` runs at the start of a write-phase agent
**When** a newer `event_id` for the same `ticket_key` exists in `ferry-processed-events`
**Then** the current run exits 0 with `outcome: "superseded"` emitted to `ferry-audit` — no LLM call, no external writes

---

### Story 1.5: Error Taxonomy, Audit Writer & Labels Allowlist

As a Ferry agent,
I want every failure mapped to a deterministic label + Jira comment + audit outcome, and every run to emit exactly one JSON audit line,
So that operators can diagnose any failure from the `ferry-audit` issue alone without reading source code.

**Acceptance Criteria:**

**Given** `src/lib/error-taxonomy/index.ts` exports typed `FerryError` subclasses for all 5 classes: `transient`, `spend-cap`, `state-invariant`, `oscillation`, `unknown`
**When** a `FerryError` is thrown and caught by the top-level try/catch
**Then** `mapError(e)` returns the correct label(s), Jira comment template, and `outcome` string — verified by a unit test covering all 5 classes

**Given** `src/lib/audit/index.ts` exposes `emitAudit({ outcome, usage, runId, start })`
**When** called at workflow exit (including under `if: always()` after a failure)
**Then** it posts exactly one comment to the `ferry-audit` GitHub Issue with a valid JSON object containing all required fields (`ticket`, `phase`, `run_id`, `model`, `input_tokens`, `output_tokens`, `cost_eur`, `outcome`, `duration_ms`, `timestamp`) and idempotency marker `[ferry:audit:<run_id>]`

**Given** `src/labels/allowlist.ts` defines the closed label set
**When** `labels-allowlist.test.ts` runs in CI
**Then** it asserts every label string used anywhere in `src/lib/` and `src/agents/` belongs to the allowlist — failing CI if a new label was introduced outside the closed set

**And** `.github/actions/ferry-emit-audit/action.yml` wraps `emitAudit` as the final step in every workflow

---

### Story 1.6: Secret Scanning, CODEOWNERS Path-Filter & IO Wrappers

As a Ferry agent,
I want every outbound string scanned for secrets before any write, and all Jira/GitHub calls routed through shared IO wrappers with idempotency and retry,
So that secret leakage is prevented at the harness level and all external writes are safe to re-run.

**Acceptance Criteria:**

**Given** `src/lib/secret-scan/index.ts` wraps `gitleaks` binary invocation
**When** `scanForSecrets(text)` is called with a string containing a credential pattern
**Then** it returns a non-empty findings array — verified by a unit test using a synthetic secret string against the `.gitleaks.toml` ruleset

**Given** an agent harness calls `src/lib/io/jira.ts` or `src/lib/io/github.ts`
**When** the outbound payload contains a secret pattern
**Then** `scanForSecrets` aborts the write, applies `ferry:paused` + reason `secret-scan-hit`, and posts a Jira comment without including the leaked content — no write reaches the external API

**Given** `src/lib/io/idempotency.ts` exposes `checkIdempotencyMarker(marker, items)` and `appendMarker(payload, marker)`
**When** an external write is attempted with marker `[ferry:<role>:<run_id>]` already present in recent items
**Then** the write is skipped and the function returns `{ skipped: true }`

**Given** `src/lib/io/retry.ts` wraps any IO function with exponential backoff
**When** the wrapped function throws a `transient` error up to 3 times
**Then** it retries with base 2s delay, ±50% jitter, factor 2 — and escalates to `FerryError("unknown")` after 3 failures

**And** ESLint rule `no-restricted-imports` fails CI if `@octokit/rest` or Jira fetch is imported directly anywhere in `src/agents/`

---

### Story 1.7: LLM Harness, Model Routing & Configuration Loading

As a Ferry agent,
I want to invoke any configured LLM provider through a unified interface with cost tracking, prompt-content delimiting, and per-run budget enforcement,
So that agents are cost-predictable and prompt injection from untrusted ticket content is structurally prevented.

**Acceptance Criteria:**

**Given** `src/lib/llm/index.ts` exposes `routeModel(role, labels)` and `invoke(provider, {systemPrompt, userContent, maxTokens})`
**When** `routeModel("developer", ["critical"])` is called
**Then** it returns the `FERRY_CRITICAL_MODEL` config value; when called without `critical` it returns `FERRY_DEVELOPER_MODEL`

**Given** `src/lib/llm/pricing.ts` contains per-1M-token rates for all configured models
**When** `computeCost(model, inputTokens, outputTokens)` is called
**Then** it returns a `cost_eur` value rounded to 4 decimal places — verified by unit tests with known token counts

**Given** `src/lib/llm/budget.ts` enforces `FERRY_MAX_COST_EUR_PER_RUN` (default 10€)
**When** the running session cost would exceed the cap before a new LLM call
**Then** it throws `FerryError("spend-cap")` before the call is made — no tokens are spent

**Given** `src/lib/prompt/delimit.ts` exposes `delimitUntrusted(text)`
**When** ticket description or comments are included in a prompt
**Then** they are always wrapped with `delimitUntrusted()` — ESLint rule enforces this on any string passed to `invoke()`

**Given** `src/lib/config/index.ts` exposes `loadConfig()`
**When** called at agent startup
**Then** it reads all required env vars, merges `.ferry/config.yml` overrides if present, and throws a descriptive error for any missing required key — `process.env` reads occur only in this module

---

### Story 1.8: README, Examples & First-Time Setup Documentation

As a new Ferry operator,
I want a complete `README.md` that walks me through installing Ferry on a target repository in under 30 minutes,
So that I can trigger the first autonomous PR without writing code or seeking external support.

**Acceptance Criteria:**

**Given** `README.md` exists in the Ferry repo root
**When** a user familiar with Jira and GitHub follows it step by step
**Then** it covers exactly 7 steps: (1) create GitHub App with scoped permissions per NFR-S6, (2) install App on target repo, (3) create Atlassian API token, (4) configure Jira Automation rule per Ferry column with `repository_dispatch`, (5) populate 6 repository secrets, (6) set hard spend caps on each provider console, (7) copy `.github/workflows/*.yml` and `.github/CODEOWNERS` into the target repo

**Given** the README data-privacy disclosure section exists
**When** read before first use
**Then** it prominently states that ticket content, sub-tasks, comments, and code diffs are transmitted to third-party LLM providers (NFR-D1)

**Given** `examples/` directory exists
**When** examined
**Then** it contains: `chancellerie-setup.md`, `state.v1.schema.json`, `event.v1.schema.json`, `ferry-audit.jsonl` (≥ 20 sample lines), `prompt-templates/` (4 role prompt starters), `reviewer-rules.yaml`, `reviewer-rubric.md`

**Given** `scripts/ferry-grade.ts` exists
**When** run as `tsx scripts/ferry-grade.ts <pr-number>`
**Then** it prompts for 4 rubric integers (Substantive / Specific / Correct / Actionable, 0–2 each), computes verdict (`actionable` 5–8, `weak` 3–4, `rubber_stamp` ≤2, capped at `weak` if Correct=0), and writes one `ferry-audit` phase=`reviewer_grade` comment line

---

## Epic 2: Event Routing — Ticket Ingestion & Dispatch

The operator can move a Jira ticket to a Ferry column, apply an `agent:*` label, or post an `@agent-*` comment — and have Ferry correctly receive, validate, deduplicate, and route the event to the right workflow, with phase labels applied and audit lines emitted.

### Story 2.1: Column-Transition Dispatch & Workflow Routing

As a Ferry operator,
I want moving a Jira ticket to a Ferry column to automatically trigger the correct GitHub Actions workflow on the target repo,
So that Ferry starts working the moment I drag a ticket on the board — no manual intervention needed.

**Acceptance Criteria:**

**Given** a Jira Automation rule is configured to send a `repository_dispatch` with payload `{ phase: "refine", ticket_key: "CHAN-27", ... }` when a ticket moves to `Refinement`
**When** the dispatch is received by the target repo
**Then** `refine.yml` triggers (and only `refine.yml`) — verified in dry-run E2E with `FERRY_DRY_RUN=1`

**Given** `phase` maps to a workflow: `refine` → `refine.yml`, `dev` → `dev.yml`, `review` → `review.yml`, `iterate` → `iterate.yml`
**When** an unknown `phase` value is dispatched
**Then** the `gate-envelope` job rejects it before any side-effect runs

**Given** a ticket of type `Task` (not `Story`) triggers a dispatch
**When** the workflow starts
**Then** it posts a Jira comment `[ferry:refiner:<run_id>] Skipped — ticket type Task is not processed by Ferry` and exits 0 without creating sub-tasks or writing state (FR6)

**And** all four phase-to-workflow mappings are covered by dry-run E2E fixture tests

---

### Story 2.2: Label-Based & @Mention Re-Trigger Dispatch

As a Ferry operator,
I want to re-trigger any Ferry phase by adding a label or posting a comment on a Jira ticket,
So that I can restart a specific phase with or without extra instructions — without moving the ticket column.

**Acceptance Criteria:**

**Given** the label `agent:refiner` is applied to a Jira ticket in any column
**When** the Jira Automation rule fires a `repository_dispatch` with `source: "jira-label"` and `phase: "refine"`
**Then** `refine.yml` triggers with the same envelope structure as a column dispatch — the workflow routes identically regardless of source (FR2)

**Given** a Jira comment `@agent-developer please focus only on the auth module` is posted
**When** the Jira Automation rule fires a `repository_dispatch` with `source: "jira-mention"`, `phase: "dev"`, and `instructions: "please focus only on the auth module"`
**Then** `dev.yml` triggers and the `instructions` field is available in the event envelope for injection into the agent prompt (FR3)

**Given** the `instructions` field is present in the envelope
**When** `validateEnvelope(payload)` parses it
**Then** it is trimmed, max 2000 characters, and passed through to the agent harness as `envelope.instructions` — oversized instructions are truncated with a warning logged, not rejected

**And** all four `agent:<role>` labels trigger the correct phase — covered by unit tests on the routing function

---

### Story 2.3: Per-Ticket Daily Trigger Cap

As a Ferry operator,
I want Ferry to refuse processing a ticket that has already been triggered too many times today,
So that a misconfigured Jira Automation rule or a runaway reconciler cannot exhaust my API budget on a single ticket.

**Acceptance Criteria:**

**Given** a ticket has already been dispatched ≥ N times today (N configurable via `.ferry/config.yml`, default 10)
**When** a new dispatch arrives for that ticket
**Then** the workflow posts a Jira comment `[ferry:<role>:<run_id>] Paused — daily trigger cap (10) reached for CHAN-27. Resets at midnight UTC.` and exits 0 without starting agent work (FR7)

**Given** the cap is not yet reached
**When** `checkDailyTicketCap(ticketKey)` is called
**Then** it returns `{ allowed: true }` and the run proceeds normally

**And** the daily cap check runs after envelope validation and dedupe but before any LLM call or external write

---

### Story 2.4: Phase Labels, Jira Phase Comments & ferry-audit Emission

As a Ferry operator,
I want each workflow run to update the ticket's phase label, post a Jira status comment, and emit an audit line,
So that I can see exactly what Ferry is doing on any ticket at a glance — in Jira and in the `ferry-audit` issue.

**Acceptance Criteria:**

**Given** a Ferry workflow starts for a ticket
**When** the `run-agent` job begins
**Then** it applies the matching phase label (`ferry:refining`, `ferry:developing`, `ferry:reviewing`, `ferry:iterating`) on both the GitHub PR and the Jira ticket, replacing the previous Ferry phase label (FR44)

**Given** a Ferry workflow completes (success or failure)
**When** the final step runs under `if: always()`
**Then** it writes or updates exactly one Jira comment for this phase using the idempotency marker `[ferry:<role>:<run_id>]`, containing: phase name, short outcome summary, cost in EUR, and a direct URL to the raw GHA run — on re-run the existing comment is edited in place, not duplicated (FR42)

**Given** `emitAudit()` is called from `ferry-emit-audit` composite action
**When** the audit comment is posted to `ferry-audit`
**Then** it is posted within 30 seconds of run completion and contains all required fields per FR41 (NFR-O1)

**And** a dry-run E2E test asserts that a full refine→audit sequence produces exactly one Jira comment and one ferry-audit line for the ticket

---

## Epic 3: Refiner Agent — Automated Planning

The operator can move a ticket to `Refinement` and see sub-tasks atomically created in Jira with an audit comment. The operator then manually moves the ticket to `Ready for Dev` after reviewing the plan. Unactionable tickets escalate cleanly to `needs-human`.

### Story 3.1: Refiner Reads Ticket & Produces Sub-Task Plan

As a Ferry operator,
I want the Refiner to read a Jira ticket and produce an ordered plan of sub-tasks before creating anything,
So that I can see what Ferry intends to do — and catch hallucinations — before any sub-tasks are written to Jira.

**Acceptance Criteria:**

**Given** `refine.yml` triggers with a valid envelope for ticket `CHAN-27`
**When** `src/agents/refiner/index.ts` runs following the entry-point skeleton
**Then** it reads the ticket title, description, comments, and labels via `src/lib/io/jira.ts` and passes them through `delimitUntrusted()` before including in the Gemini 2.5 Flash prompt (NFR-S1)

**Given** the LLM call completes successfully
**When** the Refiner parses the response against `src/agents/refiner/schema.ts`
**Then** the output is a valid `RefinerOutput` with fields: `subtasks[]` (title + description each), `touch_paths: string[]` (≤ 20 files), `output_locale` (`en` | `fr`), and `audit_summary` — or `FerryError("spec-too-broad")` if `touch_paths` exceeds 20 files or 200 KB total

**Given** the plan is ready
**When** the Refiner posts the audit comment (FR9)
**Then** a Jira comment is posted with idempotency marker `[ferry:refiner:<run_id>]` containing: number of planned sub-tasks, estimated cost, run link — and any attachments detected are listed by name but not processed

**And** the full flow from dispatch to first Jira comment completes in p95 ≤ 120 seconds on a canned fixture (NFR-P1)

---

### Story 3.2: Atomic Batch Sub-Task Creation with Cap

As a Ferry operator,
I want sub-tasks created as a single atomic batch capped at 12,
So that either all sub-tasks appear or none do — no partial states where some sub-tasks exist and others were dropped.

**Acceptance Criteria:**

**Given** the Refiner plan contains ≤ 12 sub-tasks
**When** `src/agents/refiner/refine.ts` calls the Jira batch-create endpoint
**Then** all sub-tasks are created in a single API call with idempotency markers in their description footers — if the API call fails, no sub-tasks are created and the error is classified as `transient` for retry (FR10)

**Given** the Refiner plan contains > 12 sub-tasks
**When** the cap check runs before the batch create
**Then** the plan is truncated to the top 12 sub-tasks by the LLM's own priority ordering, a warning is noted in the audit comment, and the batch proceeds with 12

**Given** `output_locale` is `fr` (French stopwords detected in parent ticket)
**When** sub-task titles and descriptions are written to Jira
**Then** they are written in French — code identifiers, filenames, and error messages remain in English (D9)

**And** the batch create is covered by a contract test using a recorded Jira REST v3 fixture — no live API call in CI

---

### Story 3.3: Idempotent Re-Run & Empty-Ticket Escalation

As a Ferry operator,
I want re-triggering the Refiner to be safe on a ticket that already has sub-tasks, and unactionable tickets to escalate clearly,
So that I can correct a hallucinated sub-task manually and re-run without doubling up, and empty tickets never silently waste tokens.

**Acceptance Criteria:**

**Given** a ticket already has sub-tasks with Ferry idempotency markers
**When** the Refiner re-runs (via `agent:refiner` label or reconciler)
**Then** it detects existing sub-tasks by scanning for `[ferry:refiner:` markers, skips recreation for any already-present sub-task, and posts an updated audit comment acknowledging the human edits — no duplicate sub-tasks are created (FR12)

**Given** a ticket has an empty description or a description the LLM classifies as unactionable
**When** the Refiner processes it
**Then** it applies label `needs-human` on the Jira ticket, posts a comment `[ferry:refiner:<run_id>] Cannot plan — ticket description is empty or unactionable. Please add requirements and re-trigger.`, and exits 0 without creating sub-tasks (FR11)

**And** on successful completion, the Refiner applies label `ferry:ready` on the Jira ticket (signal only — the operator manually moves the column to `Ready for Dev`)

**And** idempotency is verified by a unit test that runs the refiner mock twice on the same ticket fixture and asserts sub-task count = original count (not doubled)

**And** a dry-run E2E test asserts the full Refiner flow: read ticket → plan → audit comment → batch create, in sequence

> **Note:** Story 3.4 (Auto-Transition to Ready for Dev) removed. FR13 removed. `Ready for Dev` is a manual operator checkpoint.

---

## Epic 4: Developer Agent — Automated Implementation

The operator sees a branch `ferry/<ticket>` and a draft PR opened in GitHub with the ticket's changes implemented — within 15 minutes of entering `In Development`.

### Story 4.1: Developer Reads Ticket & Builds File Context

As a Ferry Developer agent,
I want to read the refined Jira ticket and load only the files the Refiner authorized me to touch,
So that my prompt is grounded in the actual codebase and I cannot modify files outside the authorized scope.

**Acceptance Criteria:**

**Given** `dev.yml` triggers with a valid envelope for a ticket in `In Development`
**When** `src/agents/developer/index.ts` runs preflight and loads state
**Then** it reads the parent ticket + sub-tasks from Jira via `src/lib/io/jira.ts`, and reads `state.touch_paths[]` from `.ferry/state.json` (populated by the Refiner in Epic 3)

**Given** `state.touch_paths` contains ≤ 20 file paths with ≤ 200 KB total content
**When** `src/agents/developer/context.ts` builds the prompt context
**Then** each file is read from the checked-out workspace and embedded as a delimited `<file path="...">...</file>` block — ticket content is wrapped with `delimitUntrusted()` (NFR-S1)

**Given** `state.touch_paths` is missing or empty (Refiner did not populate it)
**When** the Developer starts
**Then** it throws `FerryError("state-invariant")` and labels the ticket `status:stale` — no branch is created, no LLM tokens are spent

**And** context builder is covered by unit tests asserting correct delimiter wrapping and file-size enforcement

---

### Story 4.2: Branch Creation, Code Generation & Scope-Enforced Diff Application

As a Ferry Developer agent,
I want to generate a unified diff and apply it only to authorized file paths,
So that the code change is scoped exactly to what the Refiner planned and cannot touch `.github/**` or other out-of-scope paths.

**Acceptance Criteria:**

**Given** the Developer prompt is assembled with file context and sub-task instructions
**When** the LLM (Gemini 2.5 Pro) returns a response validated against `src/agents/developer/schema.ts`
**Then** the response contains a `<diff>...</diff>` block with a valid unified diff and a short summary — invalid schema triggers `FerryError("unknown")`

**Given** the diff is parsed by `src/lib/diff/apply.ts`
**When** `git apply --check` runs on the diff
**Then** any hunk touching a path not in `touch_paths ∪ {".ferry/state.json"}` throws `FerryError("scope-violation")` → `needs-human` — no partial application is attempted

**Given** a diff hunk targets any path matching `.github/**`
**When** the scope check runs
**Then** it is hard-rejected regardless of `touch_paths` content — defense-in-depth on top of CODEOWNERS

**Given** `git apply --index` succeeds
**When** the branch `ferry/CHAN-27` is created from the default branch and the diff is committed
**Then** the commit message follows the format `[CHAN-27] feat: <summary>\n\n[ferry:developer:<run_id>]` with idempotency marker in the trailer (FR15, FR16)

**Given** `git apply --index` fails (stale HEAD)
**When** the diff-regeneration retry runs
**Then** the Developer re-fetches HEAD, rebuilds context, and regenerates the diff — max 3 regeneration cycles before escalating to `needs-human`

---

### Story 4.3: Critical-Model Routing on `critical` Label

As a Ferry operator,
I want tickets labeled `critical` to automatically use the higher-capability model for implementation,
So that complex or high-stakes tickets get GPT-5.4's stronger SWE performance without manual intervention.

**Acceptance Criteria:**

**Given** a ticket carries the label `critical` in the Jira event envelope
**When** `routeModel("developer", envelope.labels)` is called
**Then** it returns `FERRY_CRITICAL_MODEL` (default `gpt-5-4`) instead of `FERRY_DEVELOPER_MODEL` (default `gemini-2.5-pro`) — the OpenAI SDK wrapper is used for the LLM call (FR17)

**Given** a ticket does not carry the `critical` label
**When** `routeModel("developer", [])` is called
**Then** it returns `FERRY_DEVELOPER_MODEL` — no GPT-5.4 call is made

**And** a unit test covers both routing branches, asserting the correct provider wrapper is selected in each case

---

### Story 4.4: Draft PR Open & Auto-Transition to In Review

As a Ferry operator,
I want a draft PR opened automatically once code is committed, with the ticket linked in the PR body,
So that the PR appears in GitHub and the ticket advances to `In Review` without me lifting a finger.

**Acceptance Criteria:**

**Given** the code commit is pushed to branch `ferry/CHAN-27`
**When** `src/lib/io/github.ts` opens the draft PR
**Then** the PR title is `[CHAN-27] <summary from LLM>`, the body references the Jira ticket URL, and it is opened as a **draft** PR (FR16)

**Given** the draft PR is successfully opened
**When** the Developer writes the updated state to `.ferry/state.json`
**Then** `state.phase` is set to `"reviewing"`, `state.pr_number` is recorded, and the state file is committed on the branch

**Given** state is written and the PR is open
**When** the final step of `dev.yml` runs
**Then** it applies `ferry:ready` on the Jira ticket, transitions the ticket to `In Review` via the Jira API, and emits the `ferry-audit` line with the PR number and cost (FR18)

**And** the full Developer flow is covered by a dry-run E2E test: read ticket → build context → LLM call (mocked) → apply diff → commit → open PR → transition — completing in p95 ≤ 15 minutes on the fixture (NFR-P2)

---

## Epic 5: Reviewer Agent — Quality Gate

The operator sees actionable, fingerprinted findings posted on the PR, gated on green CI. Red CI produces a synthetic finding automatically. The Reviewer verdict is summarized in 120 words with clear decision, top risk, and reading-time estimate.

### Story 5.1: CI-Status Gate — Green Proceeds, Red Produces Synthetic Finding

As a Ferry Reviewer agent,
I want to check CI status before spending any model tokens, and treat a red CI as a finding in itself,
So that LLM review costs are only incurred on code that already passes automated checks.

**Acceptance Criteria:**

**Given** `review.yml` triggers for a PR
**When** `src/agents/reviewer/index.ts` calls `github.getCiStatus(state.pr_number)`
**Then** if CI is `pending`, the workflow exits 0 with `outcome: "pending-ci"` in the audit line — no LLM call is made and no findings are posted (FR19)

**Given** CI status is `red` (any required check failed)
**When** the red-CI branch executes
**Then** it posts a PR comment with the CI failure summary as a synthetic finding (rule_id: `ci-failure`), transitions the ticket to `Changes Requested`, emits a `ferry-audit` line with `input_tokens: 0, output_tokens: 0, cost_eur: 0`, and exits without calling the review model (FR20)

**Given** CI status is `green`
**When** the Reviewer proceeds
**Then** the real review path executes — LLM is invoked, findings are generated, and the full review flow runs

**And** both branches (red-CI synthetic and green-CI real) are asserted to emit audit lines in the dry-run E2E test — `if: always()` coverage verified

---

### Story 5.2: Code Review with Fingerprinted Findings & Rule Taxonomy

As a Ferry Reviewer agent,
I want to post findings with structured rule IDs and store fingerprints so oscillation can be detected,
So that each finding is traceable, dedupable across iterations, and the Iterator knows exactly which issues persist.

**Acceptance Criteria:**

**Given** CI is green and the Reviewer reads the PR diff, linked Jira ticket, and `state.iteration_history[]`
**When** the LLM (Claude Sonnet 4.6) returns findings validated against `src/agents/reviewer/schema.ts`
**Then** every finding has a `rule_id` drawn from `examples/reviewer-rules.yaml` — findings with an unknown `rule_id` are rejected and the Reviewer re-runs once with the taxonomy re-injected into the prompt before escalating to `needs-human` (FR57)

**Given** findings are validated
**When** `src/lib/fingerprint/index.ts` computes fingerprints
**Then** each fingerprint is SHA-256 of `{file, line_start, line_end, rule_id}` (POSIX paths, normalized) — stored in `state.iteration_history[N].fingerprints` with the current `pr_sha` (FR22)

**Given** findings and fingerprints are ready
**When** they are posted to the PR as review comments via `src/lib/io/github.ts`
**Then** each comment contains the finding text, `rule_id`, file path, and line range — posted with idempotency marker `[ferry:reviewer:<run_id>]`

**And** a contract test using recorded GitHub API fixtures asserts that findings are posted correctly without live API calls in CI

---

### Story 5.3: Structured Reviewer Summary & Verdict

As a Ferry operator,
I want a structured summary posted on the PR telling me the decision, top risk, and how long to read the diff,
So that I can triage the PR in under 2 minutes without reading every finding comment.

**Acceptance Criteria:**

**Given** findings (or a clean result) are ready
**When** the Reviewer generates the verdict via `src/agents/reviewer/schema.ts`
**Then** the verdict contains exactly three fields: `decision` (`merge-ready` | `changes-requested` | `needs-human`), `top-risk` (one sentence or `none`), `reading-time-estimate` (integer minutes) — and is ≤ 120 words total (FR58, NFR-UX3)

**Given** the verdict is generated
**When** it is written to the PR body's Reviewer verdict slot
**Then** it is written into a delimited bot-owned marker `<!-- ferry:reviewer-verdict -->…<!-- /ferry:reviewer-verdict -->` in the PR body — idempotent on re-write

**Given** the Reviewer posts the structured summary to the PR (FR23)
**When** the summary comment is created via `src/lib/io/github.ts`
**Then** it contains: findings count, actionability assessment, recommended next state, and a link to `examples/reviewer-rubric.md` for grading context

**And** a unit test asserts that a verdict exceeding 120 words is truncated at the schema validation layer before posting

---

### Story 5.4: Auto-Transition Based on Review Outcome

As a Ferry operator,
I want the ticket to automatically move to the correct next state based on the Reviewer's decision,
So that clean PRs reach `Ready to Merge` and PRs with findings go to `Changes Requested` without manual column moves.

**Acceptance Criteria:**

**Given** the Reviewer verdict is `merge-ready` (zero findings)
**When** the final step of `review.yml` runs
**Then** it transitions the Jira ticket to `Ready to Merge`, applies label `ferry:ready`, removes `ferry:reviewing`, and updates `state.phase` to `"ready"` (FR24)

**Given** the Reviewer verdict is `changes-requested` (findings present)
**When** the final step of `review.yml` runs
**Then** it transitions the Jira ticket to `Changes Requested` and updates `state.phase` to `"iterating"` (FR24)

**Given** the transition to `Changes Requested` succeeds
**When** Jira Automation fires on that column
**Then** a `repository_dispatch` with `phase: "iterate"` is emitted — Ferry does not self-trigger the Iterator (FR40)

**And** the full Reviewer flow is covered by a dry-run E2E test: CI-status check → LLM call (mocked) → findings → fingerprints → verdict → transition — completing in p95 ≤ 10 minutes on the fixture (NFR-P3)

---

## Epic 6: Iterator Agent — Closed-Loop Delivery

The operator can have review findings automatically addressed across up to 3 iterations. Resurgent findings escalate immediately to `needs-human` with a structured escalation block, instead of looping indefinitely.

### Story 6.1: Iterator Reads Review History & Applies Findings

As a Ferry Iterator agent,
I want to read all prior review rounds and apply the latest findings to the existing branch,
So that each iteration builds on full context and the PR identity is preserved across multiple fix rounds.

**Acceptance Criteria:**

**Given** `iterate.yml` triggers with a valid envelope for a ticket in `Changes Requested`
**When** `src/agents/iterator/index.ts` runs preflight and loads state
**Then** it reads `state.iteration_history[]` (all prior iterations with fingerprints and `pr_sha`), the latest Reviewer findings from PR comments, and the current branch HEAD — full review history is injected into the Iterator prompt (FR25)

**Given** the Iterator prompt is assembled with findings, history, and Refiner-authorized `touch_paths`
**When** the LLM (Gemini 2.5 Pro) returns a diff validated against `src/agents/iterator/schema.ts`
**Then** the diff is scope-enforced via `src/lib/diff/apply.ts` using the same path-guard as the Developer (touch_paths ∪ {".ferry/state.json"}, hard-reject `.github/**`) and applied to the existing branch with `git apply --index` (FR26)

**Given** the diff is applied successfully
**When** the commit is created
**Then** the commit message follows `[CHAN-27] fix: <summary>\n\nFixes findings: <rule_ids>\n\n[ferry:iterator:<run_id>]`

**And** a unit test asserts that `iteration_history` with 0, 1, and 2 prior rounds all produce valid prompts with correct history injection

---

### Story 6.2: Resurgent-Finding Detection & Immediate Escalation

As a Ferry Iterator agent,
I want to detect when the same finding reappears after I've already tried to fix it,
So that I escalate immediately instead of wasting tokens on a loop I cannot break.

**Acceptance Criteria:**

**Given** the Reviewer runs after an Iterator commit and computes new fingerprints
**When** `src/lib/fingerprint/resurgence.ts` compares new fingerprints against `state.iteration_history.at(-1).fingerprints`
**Then** any fingerprint present in both sets (same SHA-256 hash) is classified as resurgent — if `state.iteration >= 1` and resurgent findings exist, `FerryError("oscillation")` is thrown immediately (FR27)

**Given** `FerryError("oscillation")` is thrown
**When** `mapError(e)` handles it
**Then** the ticket is labeled `needs-human`, `state.phase` is set to `"needs-human"`, a Jira comment is posted listing the resurgent fingerprints by `rule_id` and file path, and the Iterator exits without further LLM calls

**And** a unit test covering the resurgence algorithm: 0 resurgent → proceed; 1+ resurgent at iteration ≥ 1 → oscillation error; resurgent at iteration 0 → proceed (first occurrence is not oscillation)

---

### Story 6.3: 3-Iteration Cap with needs-human Escalation

As a Ferry operator,
I want iteration to stop after 3 rounds if findings are not resolved,
So that a ticket that genuinely needs human attention does not silently burn through API budget.

**Acceptance Criteria:**

**Given** `state.iteration` reaches 3 and findings still exist
**When** the Iterator checks the cap at the start of its run
**Then** it throws `FerryError("oscillation")`, transitions the ticket to `Needs Human`, and posts a Jira comment `[ferry:iterator:<run_id>] 3-iteration cap reached. Unresolved findings: <fingerprints>. See PR #<n>.` (FR29)

**Given** `state.iteration` is 0, 1, or 2
**When** the cap check runs
**Then** it returns `{ proceed: true }` and the Iterator continues normally

**And** a unit test asserts cap enforcement at exactly iteration = 3, not before

---

### Story 6.4: Escalation Summary Block on PR Body

As a Ferry operator,
I want a clear, structured summary pinned to the PR body whenever a ticket is escalated to `needs-human`,
So that I can understand what was tried, what blocked it, and what to do next — in under 3 minutes, without reading the full review thread.

**Acceptance Criteria:**

**Given** any transition to `needs-human` occurs (via FR11, FR27, FR29, or manual FR38)
**When** `src/lib/io/github.ts` writes the escalation block to the PR body
**Then** the block is titled `🚨 Escalation Summary — human attention needed` and contains exactly five sections: `What I tried` (2–5 bullets ≤ 120 chars each), `What blocked me` (≥ 1 fingerprinted finding verbatim), `My best hypothesis` (≤ 400 chars, must hedge, must name missing-context artifacts), `Suggested next action for you` (imperative, must reference a concrete Ferry primitive), and optional `Context` (FR59)

**Given** the escalation block is written
**When** it is placed in the PR body
**Then** it is wrapped in `<!-- ferry:escalation -->…<!-- /ferry:escalation -->` markers — no other agent writes above this block until escalation is resolved

**Given** the `needs-human` label is subsequently cleared (human re-triggers an agent)
**When** the agent run succeeds and `state.phase` exits `"needs-human"`
**Then** the escalation block is removed from the PR body by overwriting the marker region with an empty string

**And** a unit test asserts: block present after escalation, block absent after successful re-run

---

### Story 6.5: Auto-Transition to In Review After Iterator Commit

As a Ferry operator,
I want the ticket to automatically return to `In Review` after the Iterator commits a fix,
So that the Reviewer is re-triggered without me manually moving the ticket.

**Acceptance Criteria:**

**Given** the Iterator successfully applies the diff and commits to the branch
**When** the final step of `iterate.yml` runs
**Then** it transitions the Jira ticket to `In Review`, applies `ferry:reviewing`, updates `state.phase` to `"reviewing"` and increments `state.iteration` by 1, and emits the `ferry-audit` line with cost and iteration number (FR28)

**Given** the transition succeeds
**When** Jira Automation fires on the `In Review` column
**Then** a `repository_dispatch` with `phase: "review"` is emitted — Ferry does not self-trigger the Reviewer

**And** a dry-run E2E test asserts the full Iterator flow: load history → LLM call (mocked) → apply diff → commit → transition → audit — with `state.iteration` correctly incremented

---

## Epic 7: Human Control & Override

The operator can cancel, re-trigger, pause, or escalate any Ferry phase at any time using only Jira labels and comments — giving full control without a dashboard or CLI.

### Story 7.1: Manual Cancel via GitHub Actions UI

As a Ferry operator,
I want to cancel any in-progress Ferry run from the GitHub Actions UI and have the ticket left in a consistent, recoverable state,
So that I can abort a runaway agent without leaving dangling branches, partial sub-tasks, or corrupted state.

**Acceptance Criteria:**

**Given** a Ferry workflow is running (any phase)
**When** the operator clicks "Cancel run" in the GitHub Actions UI
**Then** GitHub sends a cancellation signal, the workflow exits, and the `ferry-emit-audit` composite action runs under `if: always()` emitting `outcome: "cancelled"` to `ferry-audit` (FR34)

**Given** cancellation occurs during a write-phase workflow after `writeState` but before external writes complete
**When** the next agent run starts for the same ticket
**Then** `preflight()` detects the inconsistent state (head SHA mismatch or schema violation), labels the ticket `status:stale`, and exits without writes — a human must re-dispatch to resume

**Given** cancellation occurs in `refine.yml` mid-sub-task batch before the batch API call
**When** the ticket state is inspected
**Then** no orphan sub-tasks exist and no partial state file was written

**And** NFR-R5 is verified by a dry-run test that simulates cancellation at each phase boundary and asserts ticket state consistency

---

### Story 7.2: Label Re-Trigger & @Mention Re-Trigger with Context

As a Ferry operator,
I want to re-run any specific phase by applying a label or posting a comment — and have extra instructions I provide injected into the agent prompt,
So that I can correct a bad plan, add context to a failing implementation, or force a re-review without moving the ticket column.

**Acceptance Criteria:**

**Given** the operator applies label `agent:developer` to a ticket currently in any column
**When** Jira Automation fires the `repository_dispatch` with `source: "jira-label"`, `phase: "dev"`
**Then** `dev.yml` triggers as if the ticket had just entered `In Development` — the existing branch is reused if present, or a new one is created (FR35)

**Given** the operator posts `@agent-iterator the session refresh race is intentional per ADR-007 — focus only on the CSRF finding`
**When** Jira Automation fires with `source: "jira-mention"`, `phase: "iterate"`, and `instructions` populated
**Then** `iterate.yml` triggers and `envelope.instructions` is appended to the Iterator prompt after the standard context — wrapped with `delimitUntrusted()` (FR36, NFR-S1)

**Given** a re-trigger is dispatched for a phase already processed
**When** `checkAndClaim(event_id)` runs
**Then** the new dispatch has a fresh ULID and proceeds — the prior run's `event_id` does not block re-triggers

**And** a unit test asserts that `instructions` from an @mention is correctly appended in the prompt and does not overwrite system instructions

---

### Story 7.3: Pause & Needs-Human Label Handling

As a Ferry operator,
I want to halt all Ferry processing on a ticket by applying `ferry:paused`, and manually escalate to `needs-human` when I know the agent cannot resolve something,
So that I can intervene at any point in the pipeline without the agent continuing to fire.

**Acceptance Criteria:**

**Given** the operator applies `ferry:paused` to a Jira ticket
**When** any Ferry workflow triggers for that ticket
**Then** `preflight()` detects the `ferry:paused` label, exits 0 immediately with `outcome: "paused"` in the audit line — no LLM call, no state write, no sub-task creation (FR37)

**Given** the operator removes `ferry:paused` and re-triggers via a label or @mention
**When** the new dispatch arrives
**Then** `preflight()` does not see `ferry:paused` and the run proceeds normally — the pause is not sticky beyond the label being present

**Given** the operator applies `needs-human` manually to a Jira ticket
**When** any downstream Ferry workflow would trigger
**Then** `preflight()` detects `needs-human`, exits 0 with `outcome: "needs-human-halt"`, and does not overwrite any escalation block already on the PR (FR38)

**And** a unit test covers: paused label present → exit 0; paused label absent → proceed; needs-human present → exit 0

---

### Story 7.4: Human-Only Merge & Column-Transition Invariants

As a Ferry operator,
I want Ferry to never merge a PR or move a Jira column autonomously,
So that I retain full control over what ships and when — the agent delivers, I decide.

**Acceptance Criteria:**

**Given** a PR reaches `ferry:ready` (Reviewer verdict: `merge-ready`)
**When** the `review.yml` final step runs
**Then** it does NOT call the GitHub merge API — the PR remains open for human review (FR39)

**Given** Ferry needs to signal a column change
**When** the transition is needed
**Then** Ferry calls the Jira transition API only for the three auto-transitions explicitly listed in FR18, FR24, FR28 — all other column moves are performed by human-owned Jira Automation rules or the operator directly (FR40)

**Given** `src/lib/io/github.ts` is reviewed
**When** a grep for merge calls is run on the codebase
**Then** no `octokit.pulls.merge` call exists anywhere — enforced by an ESLint rule `no-auto-merge` that fails CI on any call to the merge endpoint

**And** `README.md` explicitly states: "Ferry never merges. Ferry never moves Jira columns except for the three auto-transitions: Developer→In Review (FR18), Reviewer→Ready to Merge or Changes Requested (FR24), Iterator→In Review (FR28)."

---

## Epic 8: Observability, Cost Governance & Webhook Resilience

The operator can monitor Ferry's costs, receive early warnings before budget overruns, trust that missed Jira webhooks are recovered within 15 minutes, and stay within the 8-comment-per-ticket notification budget.

### Story 8.1: Daily Provider Spend Check & 50% Soft Alert

As a Ferry operator,
I want a daily automated check that warns me when I'm approaching the provider spend cap,
So that I have time to act before the hard kill switch cuts off all API access mid-pilot.

**Acceptance Criteria:**

**Given** `audit-daily.yml` runs on a daily schedule (`cron: '0 9 * * *'`)
**When** `src/cost-governance/daily-check.ts` queries each provider's usage API (Anthropic, Google AI, OpenAI)
**Then** it computes total spend for the current month per provider and compares against `FERRY_MAX_SPEND_EUR` (default 200€)

**Given** any provider's spend reaches ≥ 50% of the cap
**When** the check completes
**Then** it posts a warning comment to the `ferry-audit` issue: `[ferry:audit:<run_id>] ⚠️ Spend alert: Anthropic at 52% of 200€ cap (103.40€). Daily cost: 8.20€.` and applies `ferry:spend-cap` label to any open Ferry-managed tickets (FR45, NFR-C4)

**Given** all providers are below 50%
**When** the check completes
**Then** no alert is posted — the run emits a single audit line with `outcome: "ok"` and the spend summary

**And** `audit-daily.yml` also prunes `ferry-processed-events` comments older than 24 hours as its second job

---

### Story 8.2: HTTP 429/402 Auto-Pause on Provider Rate Limits

As a Ferry operator,
I want Ferry to automatically pause when a provider rejects calls due to rate limits or budget exhaustion,
So that a single provider outage does not cascade to other tickets or burn retries against a quota wall.

**Acceptance Criteria:**

**Given** an LLM provider returns HTTP 429 (rate limited) or 402 (payment required) during an agent run
**When** `src/lib/io/retry.ts` catches the response
**Then** it classifies it as `spend-cap` error class, does NOT retry, applies `ferry:paused` + `ferry:spend-cap` on the affected ticket, posts a Jira comment `[ferry:<role>:<run_id>] Paused — provider rate limit hit. Resume manually when resolved.`, and emits `outcome: "spend-cap"` to `ferry-audit` (FR46)

**Given** the 429/402 occurs on one provider for one ticket
**When** the pause is applied
**Then** other tickets on other providers continue unaffected — the pause is ticket-scoped, not global (NFR-R4)

**Given** the operator removes `ferry:paused` and `ferry:spend-cap` from the ticket after the provider issue resolves
**When** they re-trigger via `agent:<role>` label
**Then** the run proceeds normally — no special resume procedure required

**And** a unit test covers: 429 response → spend-cap class → no retry; 500 response → transient class → retry

---

### Story 8.3: 15-Minute Reconciler Cron with ULID Dedupe

As a Ferry operator,
I want a scheduled reconciler to detect and recover tickets stuck due to missed Jira webhooks,
So that no ticket remains in a stale Ferry column longer than 15 minutes without being retried.

**Acceptance Criteria:**

**Given** `reconciler.yml` runs on schedule `*/15 * * * *`
**When** `src/reconciler/reconcile.ts` scans all Ferry-managed Jira columns
**Then** for each ticket whose Jira column does not match `state.phase` (or has no state file and no recent `ferry-audit` line within the last 20 minutes), it generates a fresh ULID and dispatches a `repository_dispatch` with `source: "reconciler"` (FR50)

**Given** the same ticket was already dispatched by the reconciler in a prior cycle and the original run completed
**When** the reconciler scans again
**Then** it finds `state.phase` matches the Jira column and does NOT re-dispatch — no duplicate runs (FR51)

**Given** the reconciler cron completes
**When** it finishes scanning up to 100 open tickets
**Then** the run completes in ≤ 2 minutes (NFR-P4) and emits one `ferry-audit` line with outcome and ticket count

**And** a unit test asserts: stale ticket (column/phase mismatch) → dispatch; fresh ticket (column/phase match) → no dispatch

---

### Story 8.4: Comment-Volume Ceiling via In-Place Editing

As a Ferry operator,
I want Ferry to edit its existing Jira comments in place on re-runs rather than posting new ones,
So that a ticket never accumulates more than 8 Ferry-authored Jira comments across its full lifecycle.

**Acceptance Criteria:**

**Given** a Jira comment with marker `[ferry:refiner:<run_id>]` already exists on a ticket
**When** the Refiner re-runs on that ticket
**Then** `src/lib/io/jira.ts` finds the existing comment by scanning for `[ferry:refiner:` prefix, updates it in place with the new content, and does NOT post a new comment (FR60)

**Given** each phase has at most one active comment per ticket
**When** a ticket goes through a full lifecycle: refine → dev → review → iterate × 3 → merge
**Then** the total Ferry-authored Jira comment count never exceeds 8 (NFR-UX4)

**Given** a phase runs for the first time on a ticket (no existing marker comment)
**When** `src/lib/io/jira.ts` scans for an existing comment
**Then** it finds none and creates a new comment — the create path is only taken when no prior marker exists

**And** a unit test asserts: existing marker → update in place; no marker → create new; two phases → two separate comments (not merged)

---

## Epic 9: Human-Reader Experience

The operator can merge a clean PR in under 2 minutes and diagnose a `needs-human` PR within 3 minutes — using the mandated TL;DR block and CI check that enforce reading quality at every push.

### Story 9.1: Mandated TL;DR Block in PR Body

As a Ferry operator,
I want every agent-opened PR to have a structured TL;DR block at the top of the body — written by the Developer and refreshed by the Iterator on every revision,
So that I can make a merge-or-not decision in under 2 minutes without reading the full diff.

**Acceptance Criteria:**

**Given** the Developer opens a draft PR (Story 4.4)
**When** `src/lib/io/github.ts` writes the initial PR body
**Then** the body begins with a `TL;DR for the human merger` block wrapped in `<!-- ferry:tldr -->…<!-- /ferry:tldr -->` markers, containing exactly six fields as a markdown table: `Ships` (imperative mood), `Touches` (file count + line delta), `Risk` (one token: low/medium/high + ≤ 80-char justification), `Tests` (test coverage summary), `Rollback` (concrete shell command or "no-op safe"), `Reviewer verdict` (initially `pending — awaiting review`) (FR55)

**Given** the TL;DR block is written
**When** the total character count of the block is computed
**Then** it is ≤ 500 characters — the LLM output for the block is truncated at the schema layer if it exceeds this limit

**Given** the Iterator commits a fix and updates the PR body
**When** `src/lib/io/github.ts` refreshes the TL;DR block
**Then** it overwrites only the `<!-- ferry:tldr -->…<!-- /ferry:tldr -->` region — all content outside the markers is preserved unchanged

**Given** the Reviewer verdict is written (Story 5.3)
**When** the `Reviewer verdict` field is updated in the TL;DR table
**Then** it reflects the Reviewer's `decision` + `top-risk` in ≤ 40 characters — so mergers do not need to scroll to the review thread to know the outcome (FR58)

**And** a unit test asserts: TL;DR block present after Developer PR open; block refreshed (not duplicated) after Iterator commit; Reviewer verdict field updated after review

---

### Story 9.2: CI Check for TL;DR Format & Length

As a Ferry operator,
I want a CI check to fail any agent PR whose TL;DR block is missing, malformed, or too long,
So that the human-reader contract is enforced automatically — no agent can ship a PR that bypasses the reading-quality standard.

**Acceptance Criteria:**

**Given** `ferry-ci.yml` includes a `validate-tldr` job that runs on every push to `ferry/*` branches
**When** the job runs on a PR with a well-formed TL;DR block (all 6 fields present, correct order, ≤ 500 chars)
**Then** the check passes (exit 0)

**Given** the PR body is missing the `<!-- ferry:tldr -->` marker entirely
**When** the `validate-tldr` job runs
**Then** it fails with message: `TL;DR block missing. Developer must include the ferry:tldr section.` (FR56)

**Given** the PR body has the TL;DR block but fields are in the wrong order
**When** the `validate-tldr` job runs
**Then** it fails with message: `TL;DR fields out of order. Expected: Ships, Touches, Risk, Tests, Rollback, Reviewer verdict.`

**Given** the TL;DR block content exceeds 500 characters
**When** the `validate-tldr` job runs
**Then** it fails with message: `TL;DR block too long. Maximum is 500 characters.`

**Given** the PR is opened by a human (not `ferry-bot`)
**When** the `validate-tldr` job runs
**Then** it skips the check (exit 0) — detected by checking the PR author login against `FERRY_BOT_LOGIN`

**And** `validateTldrBlock(prBody, authorLogin)` in `src/lib/io/github.ts` is covered by unit tests for all four failure modes and the human-author skip
