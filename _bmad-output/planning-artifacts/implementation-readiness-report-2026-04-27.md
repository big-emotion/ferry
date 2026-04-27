---
stepsCompleted: ['step-01-document-discovery', 'step-02-prd-analysis', 'step-03-epic-coverage-validation', 'step-04-ux-alignment', 'step-05-epic-quality-review', 'step-06-final-assessment']
status: complete
documentsUsed:
  prd: docs/prd.md
  architecture: _bmad-output/planning-artifacts/architecture.md
  epics: _bmad-output/planning-artifacts/epics.md
  ux: null
---

# Implementation Readiness Assessment Report

**Date:** 2026-04-27
**Project:** Ferry

## Document Inventory

### PRD
- `docs/prd.md` (79 KB, 2026-04-23)

### Architecture
- `_bmad-output/planning-artifacts/architecture.md` (87 KB, 2026-04-23)

### Epics & Stories
- `_bmad-output/planning-artifacts/epics.md` (80 KB, 2026-04-27)

### UX Design
- None found (not applicable — CLI/CI tool, no UI)

---

## PRD Analysis

### Functional Requirements

**Ticket Ingestion & Triggering (FR1–FR7)**
- FR1: Receive Jira column-transition event → dispatch to matching workflow (Refine/Dev/Review/Iterate)
- FR2: Receive `agent:<role>` label-added event → dispatch manual re-trigger of named phase, no column advance
- FR3: Parse Jira `@agent-<role>` comment + instructions → dispatch re-run with injected instructions
- FR4: Assign ULID `event_id` to every dispatch; record in audit before run begins
- FR5: Detect duplicate `event_id`s on ingestion and refuse to start a second run
- FR6: Skip dispatch for Jira tickets of type `Task` (not `Story`)
- FR7: Refuse dispatch when per-ticket daily trigger cap exceeded; post Jira comment with reason

**Refiner Agent (FR8–FR13)**
- FR8: Read Jira ticket (title, description, comments, labels) → produce sub-task plan
- FR9: Post audit comment summarizing plan before creating sub-tasks
- FR10: Create Jira sub-tasks as single atomic batch, capped at 12 per parent ticket
- FR11: Detect empty/unactionable ticket → escalate with `needs-human` instead of creating sub-tasks
- FR12: Detect pre-existing sub-tasks on re-run → skip recreation (idempotent)
- FR13: ~~Auto-transition parent ticket to `Ready for Dev` on successful completion~~ **REMOVED — manual operator checkpoint; Refiner applies `ferry:ready` label only**

**Developer Agent (FR14–FR18)**
- FR14: Read refined Jira ticket (parent + sub-tasks) and target repo current state
- FR15: Create branch named `ferry/<ticket-key>` from configured default branch
- FR16: Commit code changes to branch and open draft PR whose body references Jira ticket
- FR17: Use different models per role; auto-switch to `critical` model on `critical` label
- FR18: Auto-transition ticket to `In Review` on PR creation

**Reviewer Agent (FR19–FR24)**
- FR19: Wait for CI status to be green before spending model tokens on code review
- FR20: Treat red CI as synthetic finding, transition to `Changes Requested`, exit without LLM call
- FR21: Read green-CI PR diff, linked Jira ticket, prior review history → post findings as PR comments
- FR22: Fingerprint each finding by `(file, line-range, rule-id)` and record in persistent audit
- FR23: Post structured summary (findings count, actionability, recommended next state) on PR
- FR24: Auto-transition to `Changes Requested` when findings exist, or `Ready to Merge` when clean

**Iterator Agent (FR25–FR29)**
- FR25: Read full review history (all prior rounds) + latest Reviewer findings
- FR26: Apply code changes to existing branch to address findings, preserving PR identity
- FR27: Detect resurgent findings (same fingerprint across iterations) → escalate to `needs-human` immediately
- FR28: Auto-transition ticket to `In Review` on commit, re-triggering Reviewer
- FR29: Enforce max-iteration cap of 3 per ticket → escalate to `needs-human` on third unresolved round

**State Management (FR30–FR33)**
- FR30: Persist per-ticket pipeline state in schema-validated artifact (bot-owned PR comment or `.ferry/state.json`)
- FR31: Validate state against JSON Schema on every read and write; refuse writes on schema violation
- FR32: Run preflight invariants before every agent run (PR open, head SHA, branch, Jira column); abort with `status:stale` on mismatch
- FR33: Enforce cross-workflow concurrency group `ferry-${ticket.key}` with cancel-in-progress semantics

**Human Control & Override (FR34–FR40)**
- FR34: Human operator can cancel any in-progress run via standard GitHub Actions interface
- FR35: Human operator can re-trigger any phase by applying `agent:<role>` label on Jira ticket
- FR36: Human operator can re-trigger any phase with extra context via `@agent-<role>` Jira comment
- FR37: Human operator can pause all Ferry processing via `ferry:paused` label
- FR38: Human operator can manually escalate to `Needs Human` via `needs-human` label
- FR39: Final merge is exclusively performed by a human; Ferry never merges
- FR40: Jira column transitions are exclusively performed by a human; Ferry writes only to labels and comments

**Observability & Audit (FR41–FR44)**
- FR41: Write one JSON line per run to `ferry-audit` GitHub Issue containing `{ticket, phase, run_id, model, input_tokens, output_tokens, cost_eur, outcome, duration_ms, timestamp}`
- FR42: Write or update (in-place) a human-readable Jira comment per phase with outcome summary, cost, GHA run link; on re-run, edit existing comment rather than duplicate (see FR60)
- FR43: Expose raw per-run logs via standard GitHub Actions log retention (90 days)
- FR44: Label each PR and Jira ticket with current phase label (`ferry:refining`, `ferry:developing`, `ferry:reviewing`, `ferry:iterating`, `ferry:paused`, `ferry:ready`, `ferry:cancelled`, `needs-human`)

**Cost & Safety Governance (FR45–FR49)**
- FR45: Query provider usage APIs daily; post warning to `ferry-audit` at 50% of kill-switch budget per provider
- FR46: Detect provider HTTP 429/402 → apply `ferry:paused` on affected tickets + post Jira comment with resume date
- FR47: Scan every agent-generated commit, PR body, and Jira comment for secrets before write; hits abort write + apply `ferry:paused` with `secret-scan-hit`
- FR48: Refuse any agent PR modifying `.github/**` via CODEOWNERS and path-filter enforcement
- FR49: Enforce tool denylist on every agent run (no arbitrary shell, no arbitrary network, only configured MCP servers)

**Webhook Resilience & Reconciliation (FR50–FR51)**
- FR50: Run scheduled reconciler every 15 minutes; scan Ferry-managed Jira columns; detect state divergence; re-dispatch with fresh ULID
- FR51: Reconciler deduplicates against already-processed `event_id`s before re-firing

**Setup & Configuration (FR52–FR54)**
- FR52: New user can install Ferry via documented sequence in `README.md` using only Jira UI, GitHub UI, and provider consoles — no local CLI, no scripts
- FR53: Read configuration from GitHub repository secrets/variables + optional `.ferry/config.yml` in consumer repo
- FR54: Pin model IDs per role; document rollback models inline in workflow files

**Human-Reader Surface (FR55–FR60)**
- FR55: Every agent-opened PR body renders a fixed `TL;DR for the human merger` block (6 fields: Ships, Touches, Risk, Tests, Rollback, Reviewer verdict) within delimited bot-owned markers; total block ≤ 500 chars
- FR56: CI check fails on agent-authored PR missing the FR55 block, wrong field order, or exceeding length/style caps; runs on every push to `ferry/*` branches
- FR57: Reviewer emits every finding with a `rule_id` from `examples/reviewer-rules.yaml`; unknown rule IDs rejected by post-review validator; Reviewer re-runs once with taxonomy re-injected before escalating
- FR58: Reviewer produces `Reviewer verdict` summary (≤120 words, 3 fields: `decision`, `top-risk`, `reading-time-estimate`) written into the FR55 PR-body slot
- FR59: On any `needs-human` transition (FR11/FR27/FR29/FR38), render pinned PR-body block `🚨 Escalation Summary` with 5 mandatory sections; auto-removed when `needs-human` cleared
- FR60: Enforce per-ticket comment-volume ceiling by editing existing idempotency-marked comments in place; caps: 1 Refiner, 1 Developer, 1 Reviewer per iteration, 1 Iterator per iteration, 1 escalation per ticket

**Total FRs: 60 (FR13 removed → 59 active)**

---

### Non-Functional Requirements

**Performance (NFR-P1–P5)**
- NFR-P1: Jira column transition → Refiner first Jira comment: p95 ≤ 120 seconds
- NFR-P2: Jira column transition → draft PR opened (Developer): p95 ≤ 15 minutes
- NFR-P3: PR green-CI → Reviewer findings posted: p95 ≤ 10 minutes
- NFR-P4: Reconciler cron completion: ≤ 2 minutes for ≤ 100 open tickets
- NFR-P5: At most one agent run per ticket at any time; up to 10 tickets in parallel

**Security (NFR-S1–S8)**
- NFR-S1: All LLM calls use delimiter-based separation of untrusted content from system prompt
- NFR-S2: Every agent-generated output scanned for secrets before write; zero leakage is a hard release gate
- NFR-S3: Agent PRs modifying `.github/**` refused by CODEOWNERS on 100% of runs (verified by test)
- NFR-S4: Every agent run executes with tool denylist (no arbitrary shell, no arbitrary network, no out-of-workspace filesystem)
- NFR-S5: Secrets live only in GitHub repository secrets; never logged, printed, or written to artifacts
- NFR-S6: GitHub App permissions minimal: `contents:write`, `pull-requests:write`, `issues:write`, `metadata:read` only
- NFR-S7: All GitHub Action deps pinned by commit SHA; Dependabot enabled with SHA-pinning preserved
- NFR-S8: Zero prompt-injection incidents during pilot — Business Success gate

**Reliability (NFR-R1–R6)**
- NFR-R1: Any missed Jira webhook recovered within ≤ 15 minutes via reconciler
- NFR-R2: Re-running any phase produces no duplicates (sub-tasks, comments, PR blocks, labels)
- NFR-R3: Zero state corruption under concurrent Jira events across pilot
- NFR-R4: HTTP 429/402 from provider triggers `ferry:paused` within 1 run; no cascade to other tickets/providers
- NFR-R5: Cancelling an in-progress run leaves ticket state consistent — no partial state
- NFR-R6: ≥ 80% of pilot stories merge within 3 dev↔review iterations

**Integration (NFR-I1–I5)**
- NFR-I1: Jira Cloud REST API v3 is sole Jira integration; rate-limit headers respected
- NFR-I2: GitHub REST/GraphQL v4 + `repository_dispatch` are sole GitHub surfaces; abuse-rate-limit respected
- NFR-I3: LLM provider calls respect vendor SDK contracts; model IDs pinned in workflow files
- NFR-I4: Event envelope schema (`event.schema.json`) versioned; breaking changes require `v{N+1}` bump
- NFR-I5: Jira Standard/Premium tier required (Free-tier unsupported, documented)

**Cost & Budget (NFR-C1–C4)**
- NFR-C1: Per-provider monthly kill switch: 200€ hard cap on each provider console
- NFR-C2: Total pilot spend: 120–180€ across all providers for 40 stories
- NFR-C3: Per-story cost: average ≤ 1.50€, p95 ≤ 4€
- NFR-C4: Daily spend check scheduled workflow; warns at 50% of kill-switch threshold

**Observability (NFR-O1–O4)**
- NFR-O1: Every agent run writes exactly one JSON line to `ferry-audit` within 30 seconds of completion
- NFR-O2: Every agent run produces a Jira comment within 30 seconds with direct GHA log URL
- NFR-O3: Raw GHA logs retained ≥ 90 days (platform guarantee)
- NFR-O4: 3am debuggability: root cause reachable via exactly two bookmarks (`ferry-audit` issue + Jira ticket)

**Privacy & Data Handling (NFR-D1–D3)**
- NFR-D1: README must prominently disclose that ticket content and code diffs are sent to third-party LLM providers
- NFR-D2: No ticket content, code, or secrets persisted beyond what GitHub and Jira already persist; no Ferry-owned storage
- NFR-D3: Provider data-retention policy is consumer's responsibility; configuration hook to disable providers

**Maintainability & Operability (NFR-M1–M5)**
- NFR-M1: Zero long-running process; Ferry consists entirely of GitHub Actions workflows
- NFR-M2: First-time installation completable within 30 minutes via `README.md`
- NFR-M3: Rolling back a model choice is a single-PR change to a workflow file
- NFR-M4: Root cause of any failed run identifiable via `ferry-audit` JSON line + raw GHA log
- NFR-M5: Upgrade path: re-copy workflow files from pinned commit SHA; no migration scripts

**UX & Human Factors (NFR-UX1–UX4)**
- NFR-UX1: Time-to-decision on clean PR: ≤ 2 min median, ≤ 5 min p95
- NFR-UX2: Time-to-hypothesis on `needs-human` PR: ≤ 3 min on ≥ 4 of 5 usability drill tickets
- NFR-UX3: Reading-quality caps: FR55 TL;DR ≤ 200 words, FR58 verdict ≤ 120 words, FR59 escalation ≤ 600 words; Flesch Reading Ease ≥ 50 enforced by FR56 CI check
- NFR-UX4: Per-ticket comment-volume ceiling: ≤ 8 Ferry-authored Jira comments across full lifecycle

**Total NFRs: 44 (9 categories)**

---

### Additional Requirements

**Architecture Decisions (D1–D12):**
- D1: State artifact = `.ferry/state.json` in-branch (not bot-owned issue comment)
- D2: Event deduplication via `ferry-processed-events` GitHub Issue (not in-branch)
- D3: Per-phase cancel-in-progress policy: `refine.yml` and `reconciler.yml` = true; `dev.yml`, `review.yml`, `iterate.yml` = false
- D4: Finding fingerprint = SHA-256 of `{file, line_start, line_end, rule_id}`
- D5: 5 error classes: `transient`, `spend-cap`, `state-invariant`, `oscillation`, `unknown`
- D6: ULID event IDs; deduplication window = 24 hours
- D7: Secret scanning = gitleaks pre-write gate in agent harness
- D8: CODEOWNERS protects `.github/**`, `src/schemas/**`, `prompt.*.md`
- D9: Language policy: preserve source language in Jira-visible outputs; English for internal logs
- D10: Attachment handling: note in audit comment, proceed without processing
- D11: Touch paths: Refiner emits `touch_paths[]` (max 20 files, 200 KB) authorizing Developer/Iterator scope
- D12: Implementation sequence: scaffold → shared libs → LLM harness → Refiner → Developer → Reviewer → Iterator → Reconciler → cost governance

**Pilot Constraints:**
- Target repo: `chancellerie` (Next.js greenfield, ~40 stories)
- Budget: 120–180€ hard-capped at 200€ per provider
- Timeline: 2–4 focused implementation weeks

**Open Questions Still Active:**
- OQ1: Confirm Jira plan tier supports outbound web requests (blocks setup)
- OQ3: Negotiate branch/PR naming with pilot repo conventions (pilot-phase decision)
- OQ7: Monitor GitHub Actions concurrency cap usage (instrument and revisit)
- OQ11: Decide whether FR56 CI check lives in Ferry repo or per consumer repo (decide during first story)

---

### PRD Completeness Assessment

The PRD is comprehensive and well-structured. All 60 FRs are numbered and grouped into 12 capability areas. All 44 NFRs span 9 categories covering performance, security, reliability, integration, cost, observability, privacy, maintainability, and UX. Key product decisions are documented. Open questions are tracked with explicit status.

**Note on FR13:** FR13 was formally removed during epics review — the Refiner does not auto-transition to `Ready for Dev`; that is a manual operator checkpoint. The FR text remains in the PRD as a strikethrough but is not implemented.

**Note on NFR count:** PRD header references earlier count of 36 NFRs (pre-round-2 patch). Round-2 added NFR-UX1–UX4, bringing the actual total to 44 NFRs across 9 categories.

---

## Epic Coverage Validation

### Coverage Matrix

| FR | PRD Requirement (summary) | Epic Coverage | Status |
|---|---|---|---|
| FR1 | Column-transition → workflow dispatch | Epic 2 | ✓ Covered |
| FR2 | `agent:<role>` label → manual re-trigger | Epic 2 | ✓ Covered |
| FR3 | `@agent-<role>` comment → re-run with injected instructions | Epic 2 | ✓ Covered |
| FR4 | ULID event_id assigned + recorded before run | Epic 1 | ✓ Covered |
| FR5 | Duplicate event_id rejection | Epic 1 | ✓ Covered |
| FR6 | Task-type ticket filter | Epic 2 | ✓ Covered |
| FR7 | Daily trigger cap + Jira comment | Epic 2 | ✓ Covered |
| FR8 | Refiner reads ticket → sub-task plan | Epic 3 | ✓ Covered |
| FR9 | Refiner audit comment before sub-tasks | Epic 3 | ✓ Covered |
| FR10 | Atomic batch sub-task creation, cap 12 | Epic 3 | ✓ Covered |
| FR11 | Empty ticket → needs-human escalation | Epic 3 | ✓ Covered |
| FR12 | Idempotent re-run (skip existing sub-tasks) | Epic 3 | ✓ Covered |
| FR13 | ~~Auto-transition to Ready for Dev~~ | ~~Epic 3~~ | ⛔ REMOVED — manual checkpoint |
| FR14 | Developer reads ticket + repo state | Epic 4 | ✓ Covered |
| FR15 | Branch creation `ferry/<key>` | Epic 4 | ✓ Covered |
| FR16 | Commit + draft PR open | Epic 4 | ✓ Covered |
| FR17 | Critical-model routing | Epic 4 | ✓ Covered |
| FR18 | Auto-transition to In Review on PR open | Epic 4 | ✓ Covered |
| FR19 | Reviewer waits for green CI | Epic 5 | ✓ Covered |
| FR20 | Red CI = synthetic finding, no LLM call | Epic 5 | ✓ Covered |
| FR21 | Reviewer reads diff + history → post findings | Epic 5 | ✓ Covered |
| FR22 | Finding fingerprinting + persist in audit | Epic 5 | ✓ Covered |
| FR23 | Structured summary (findings count, actionability) | Epic 5 | ✓ Covered |
| FR24 | Auto-transition Changes Requested / Ready to Merge | Epic 5 | ✓ Covered |
| FR25 | Iterator reads full review history | Epic 6 | ✓ Covered |
| FR26 | Iterator applies findings to branch, preserves PR | Epic 6 | ✓ Covered |
| FR27 | Resurgent fingerprint → needs-human immediately | Epic 6 | ✓ Covered |
| FR28 | Auto-transition to In Review after Iterator commit | Epic 6 | ✓ Covered |
| FR29 | 3-iteration cap → needs-human | Epic 6 | ✓ Covered |
| FR30 | Per-ticket state persisted in schema-validated artifact | Epic 1 | ✓ Covered |
| FR31 | JSON Schema validation on every state read/write | Epic 1 | ✓ Covered |
| FR32 | Preflight invariants + status:stale on mismatch | Epic 1 | ✓ Covered |
| FR33 | Cross-workflow concurrency group cancel-in-progress | Epic 1 | ✓ Covered |
| FR34 | Human cancel via GitHub Actions UI | Epic 7 | ✓ Covered |
| FR35 | `agent:<role>` label re-trigger | Epic 7 | ✓ Covered |
| FR36 | `@agent-<role>` comment re-trigger with context | Epic 7 | ✓ Covered |
| FR37 | `ferry:paused` label halts processing | Epic 7 | ✓ Covered |
| FR38 | `needs-human` label manual escalation | Epic 7 | ✓ Covered |
| FR39 | Human-only merge invariant | Epic 7 | ✓ Covered |
| FR40 | Human-only column transition invariant | Epic 7 | ✓ Covered |
| FR41 | ferry-audit JSON line per run | Epic 2 | ✓ Covered |
| FR42 | Jira phase comment per run (in-place edit) | Epic 2 | ✓ Covered |
| FR43 | GHA log retention 90 days | Epic 1 | ✓ Covered |
| FR44 | Phase label application on PR + ticket | Epic 2 | ✓ Covered |
| FR45 | Daily 50% spend soft alert | Epic 8 | ✓ Covered |
| FR46 | 429/402 auto-pause | Epic 8 | ✓ Covered |
| FR47 | Pre-write secret scan (gitleaks) | Epic 1 | ✓ Covered |
| FR48 | CODEOWNERS + path-filter enforcement | Epic 1 | ✓ Covered |
| FR49 | Tool denylist per agent run | Epic 1 | ✓ Covered |
| FR50 | 15-minute reconciler cron | Epic 8 | ✓ Covered |
| FR51 | Reconciler ULID dedupe | Epic 8 | ✓ Covered |
| FR52 | README-driven install (no CLI) | Epic 1 | ✓ Covered |
| FR53 | Config from secrets + variables + `.ferry/config.yml` | Epic 1 | ✓ Covered |
| FR54 | Model ID pinning + inline rollback | Epic 1 | ✓ Covered |
| FR55 | TL;DR block in PR body (6 fields) | Epic 9 | ✓ Covered |
| FR56 | CI check enforces TL;DR format | Epic 9 | ✓ Covered |
| FR57 | Reviewer rule_id taxonomy enforcement | Epic 5 | ✓ Covered |
| FR58 | Reviewer verdict in TL;DR slot | Epic 5 | ✓ Covered |
| FR59 | Escalation Summary block on needs-human | Epic 6 | ✓ Covered |
| FR60 | Comment-volume ceiling (in-place edits) | Epic 8 | ✓ Covered |

### Missing Requirements

**None.** All 59 active FRs are covered by an epic.

FR13 is intentionally removed (manual operator checkpoint, not an implementation gap).

### Coverage Statistics

- Total PRD FRs: 60
- FR13 removed (product decision): 1
- Active FRs requiring implementation: 59
- FRs covered in epics: 59
- **Coverage: 100%**

**Coverage by Epic:**
| Epic | FRs Covered | Count |
|------|-------------|-------|
| Epic 1: Foundation | FR4, FR5, FR30, FR31, FR32, FR33, FR43, FR47, FR48, FR49, FR52, FR53, FR54 | 13 |
| Epic 2: Event Routing | FR1, FR2, FR3, FR6, FR7, FR41, FR42, FR44 | 8 |
| Epic 3: Refiner Agent | FR8, FR9, FR10, FR11, FR12 | 5 |
| Epic 4: Developer Agent | FR14, FR15, FR16, FR17, FR18 | 5 |
| Epic 5: Reviewer Agent | FR19, FR20, FR21, FR22, FR23, FR24, FR57, FR58 | 8 |
| Epic 6: Iterator Agent | FR25, FR26, FR27, FR28, FR29, FR59 | 6 |
| Epic 7: Human Control | FR34, FR35, FR36, FR37, FR38, FR39, FR40 | 7 |
| Epic 8: Observability & Governance | FR45, FR46, FR50, FR51, FR60 | 5 |
| Epic 9: Human-Reader Experience | FR55, FR56 | 2 |
| **Total** | | **59** |

---

## UX Alignment Assessment

### UX Document Status

Not found — by design. Ferry has no graphical UI surface.

### Assessment

Ferry's "UX" is entirely mediated through Jira and GitHub native interfaces. The PRD explicitly documents this architectural choice (see "Explicitly Skipped: Visual design / UI / UX") and states that the product's visual identity lives entirely in those two third-party UIs.

Human-experience requirements ARE captured — but as FR55–FR60 (Human-Reader Surface) and NFR-UX1–NFR-UX4 (UX & Human Factors), and they are fully covered in Epic 5, Epic 6, and Epic 9. Specifically:
- **NFR-UX1** (≤2 min to merge decision) → enforced by FR55 TL;DR block (Epic 9)
- **NFR-UX2** (≤3 min to hypothesis on needs-human) → enforced by FR59 Escalation Summary (Epic 6)
- **NFR-UX3** (reading quality / word caps / Flesch ≥50) → enforced by FR56 CI check (Epic 9)
- **NFR-UX4** (≤8 Ferry comments per ticket) → enforced by FR60 in-place editing (Epic 8)

### Warnings

None. The absence of a UX document is intentional and explicitly documented in the PRD. All human-consumption quality requirements are captured as FRs and NFRs with measurable, implementable acceptance criteria.

---

## Epic Quality Review

### Epic Structure Validation

**User Value Focus Check:**

| Epic | Title | User-Centric? | Assessment |
|------|-------|---------------|------------|
| 1 | Foundation — Scaffold, Core Infrastructure & Setup | ⚠️ Borderline | Technical but justified for a developer tool. Exit criterion is operator-observable: "clone, run CI, configure." Approved during party-mode review. |
| 2 | Event Routing — Ticket Ingestion & Dispatch | ✓ | Operator can trigger Ferry via Jira controls |
| 3 | Refiner Agent — Automated Planning | ✓ | Operator sees sub-tasks in Jira |
| 4 | Developer Agent — Automated Implementation | ✓ | Operator sees branch + draft PR |
| 5 | Reviewer Agent — Quality Gate | ✓ | Operator sees actionable findings |
| 6 | Iterator Agent — Closed-Loop Delivery | ✓ | Operator gets convergent delivery or clear escalation |
| 7 | Human Control & Override | ✓ | Operator has full cancel/re-trigger/pause control |
| 8 | Observability, Cost Governance & Webhook Resilience | ✓ | Operator gets budget safety + webhook recovery |
| 9 | Human-Reader Experience | ✓ | Operator can decide to merge in ≤2 minutes |

**Epic Independence Check:**

| Epic | Dependencies | Verdict |
|------|-------------|---------|
| Epic 1 | None | ✓ Standalone |
| Epic 2 | Epic 1 (envelope/validation libs) | ✓ Correct dependency direction |
| Epic 3 | Epic 1 (LLM harness, IO, audit) | ✓ Correct |
| Epic 4 | Epic 1 + Epic 3 (`state.touch_paths` from Refiner) | ✓ Graceful fallback: missing `touch_paths` → `status:stale`, no crash |
| Epic 5 | Epic 1 + Epic 4 (PRs to review) | ✓ Linear pipeline flow |
| Epic 6 | Epic 1 + Epic 5 (fingerprints from review) | ✓ Linear pipeline flow |
| Epic 7 | Epic 1 (preflight/labels baked in foundation) | ✓ Schema pre-reserves override slots (Story 1.2 AC) |
| Epic 8 | Epic 1 (audit writer, cron runner) | ✓ Correct |
| Epic 9 | Epic 4 (TL;DR in PR body) + Epic 5 (Reviewer verdict) | ✓ Design-time coupling, logical for sequential pipeline |

### Story Quality Assessment

All 34 stories reviewed. All use proper Given/When/Then BDD format. All ACs are specific and testable. Error conditions are covered. NFR and FR references are woven into ACs.

**Story sizing:** No stories are oversized (none require more than one agent phase) or undersized (none are "just a config file").

**Greenfield check:** Story 1.1 is correctly the project scaffold story — `npm init`, TypeScript config, CI pipeline. ✓

### Dependency Analysis

**Within-epic dependencies are correctly forward-sequential.** E.g.:
- Story 1.1 (scaffold) → Story 1.2 (state schema) → Story 1.3 (envelope) → Story 1.4 (concurrency) — each builds on the prior.
- Story 4.1 (read ticket) → Story 4.2 (generate diff) → Story 4.4 (open PR) — linear within epic.

**No backward within-epic dependency found.**

**Cross-epic reference in Story 9.1:** "Given the Developer opens a draft PR (Story 4.4)" — This is a backward reference (Epic 4 precedes Epic 9), not a forward dependency. ✓

### Best Practices Compliance

- [x] All epics deliver user (operator) value
- [x] Epics can function independently (with acceptable linear pipeline dependencies)
- [x] Stories are appropriately sized
- [x] No forward dependencies within epics
- [x] State/schema initialized when first needed (Story 1.2), not as a monolithic upfront dump
- [x] ACs use Given/When/Then with measurable outcomes
- [x] FR traceability maintained in ACs
- [x] Error conditions covered in ACs
- [x] NFR targets embedded in story ACs (latency, cost, idempotency)

---

### 🔴 Critical Violations

**None.**

---

### 🟠 Major Issues

**1 issue found:**

**Story 7.4 references removed FR13**

Story 7.4 AC states:
> "Ferry calls the Jira transition API only for the transitions explicitly listed in **FR13**, FR18, FR24, FR28"

FR13 was removed (auto-transition to `Ready for Dev` is a manual operator checkpoint). Story 7.4 should reference only **FR18, FR24, FR28**. Additionally, the README statement in Story 7.4 ("Ferry never moves Jira columns except for the four listed auto-transitions") should say "three" auto-transitions.

**Recommended fix:** Edit Story 7.4 to remove the FR13 reference. The AC text should read:
> "Ferry calls the Jira transition API only for the transitions explicitly listed in FR18, FR24, FR28"

And the README statement:
> "Ferry never merges. Ferry never moves Jira columns except for the three auto-transitions: Developer→In Review (FR18), Reviewer→Ready to Merge or Changes Requested (FR24), Iterator→In Review (FR28)."

---

### 🟡 Minor Concerns

**1 concern found:**

**Epic 9 has implicit split implementation with Epic 5**

FR58 (Reviewer verdict written into the TL;DR slot) is assigned to Epic 5 and implemented in Story 5.3. Story 9.1 also references updating the `Reviewer verdict` field in the TL;DR block. This split is intentional and architecturally sound (Epic 5 writes the verdict, Epic 9 defines the slot structure), but the implementation dependency means the TL;DR `Reviewer verdict` field will initially show "pending — awaiting review" until Epic 5 is shipped. This is the correct behavior and is documented in Story 9.1.

**Recommendation:** Confirm this is intentional (it is) and ensure the Developer (Epic 4/Story 4.4) initializes the `Reviewer verdict` field as `pending — awaiting review` placeholder. This is already specified in Story 9.1 AC.

---

### Quality Summary

- **34 stories** reviewed across **9 epics**
- **0 critical violations**
- **1 major issue** (Story 7.4 FR13 stale reference — fix before implementing Story 7.4)
- **1 minor concern** (Epic 5/9 split implementation — by design, acceptable)
- **Overall quality: HIGH** — epics and stories are implementation-ready with one targeted fix needed

---

## Summary and Recommendations

### Overall Readiness Status

## ✅ READY — with one targeted fix before implementing Story 7.4

All planning artifacts are complete, aligned, and implementation-ready. The single required fix (Story 7.4 stale FR13 reference) is a 2-line edit that should be made now, before Sprint Planning or implementation begins.

---

### Critical Issues Requiring Immediate Action

**None.** No critical blockers exist.

---

### Required Fix Before Sprint Planning

**Story 7.4 — Stale FR13 Reference**

In `epics.md`, Story 7.4 (Human-Only Merge & Column-Transition Invariants) contains:
> "Ferry calls the Jira transition API only for the transitions explicitly listed in **FR13**, FR18, FR24, FR28"

FR13 was removed. Fix: replace with **FR18, FR24, FR28** (3 transitions, not 4).

Also update the README statement in that AC from "four listed auto-transitions" to "three auto-transitions."

---

### Recommended Next Steps

1. **Fix Story 7.4** — Remove FR13 reference (2-line edit in `epics.md` Story 7.4 AC)
2. **Resolve OQ1** — Confirm Jira plan tier supports outbound web requests (required prerequisite for first run; do this before Sprint Planning so the environment is ready)
3. **Resolve OQ11** — Decide whether the FR56 TL;DR CI check lives in the Ferry repo or per-consumer repo (decide during first story scaffolding — this affects Story 9.2's implementation)
4. **Proceed to Sprint Planning** (`bmad-sprint-planning`) — Order stories into implementation sprints following the architecture's implementation sequence: Epic 1 → Epic 2 → Epic 3 → Epic 4 → Epic 5 → Epic 6 → Epic 7 → Epic 8 → Epic 9

---

### Assessment Summary

| Category | Result |
|----------|--------|
| Documents found | ✓ PRD, Architecture, Epics — all present |
| FR coverage | ✓ 59/59 active FRs covered (100%) |
| NFR coverage | ✓ 44 NFRs across 9 categories, all in epics scope |
| UX alignment | ✓ No UX doc needed; UX reqs captured as FRs/NFRs |
| Epic quality | ✓ 9 epics, all user-value focused |
| Story quality | ✓ 34 stories, all BDD format, error paths covered |
| Critical violations | 0 |
| Major issues | 1 (Story 7.4 FR13 stale reference) |
| Minor concerns | 1 (Epic 5/9 split — by design) |

**Assessor:** Implementation Readiness Check — bmad-check-implementation-readiness v6.3.0
**Date:** 2026-04-27
**Report file:** `_bmad-output/planning-artifacts/implementation-readiness-report-2026-04-27.md`
