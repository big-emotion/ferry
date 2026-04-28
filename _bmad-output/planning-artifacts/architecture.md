---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: complete
completedAt: '2026-04-23'
inputDocuments:
  - /Users/jnk/Documents/Dev/ferry/docs/prd.md
  - /Users/jnk/Documents/Dev/ferry/docs/inputs/00-source-one-pager.md
  - /Users/jnk/Documents/Dev/ferry/docs/inputs/01-review-adversarial.md
  - /Users/jnk/Documents/Dev/ferry/docs/inputs/02-review-edge-cases.md
  - /Users/jnk/Documents/Dev/ferry/docs/inputs/03-decisions-synthesis.md
workflowType: 'architecture'
project_name: 'Ferry'
user_name: 'Jnk'
date: '2026-04-23'
classification:
  projectType: developer_tool
  domain: general
  complexity: high
  projectContext: greenfield
pilot: chancellerie
---

# Architecture Decision Document — Ferry

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements (54 FRs across 10 capability areas):**

- Ticket Ingestion & Triggering (FR1–FR7): Jira column / label / @mention dispatch; ULID event IDs; per-ticket daily cap; `Task` filter
- Refiner Agent (FR8–FR13): plan → audit → batch sub-task creation; 12-cap; empty→`needs-human`; idempotent re-run
- Developer Agent (FR14–FR18): branch `ferry/<key>`, draft PR, critical-model swap on label
- Reviewer Agent (FR19–FR24): green-CI gate, red-CI = synthetic finding, fingerprinted findings, state-recommending summary
- Iterator Agent (FR25–FR29): review-history injection, resurgent-fingerprint escalation, 3-iteration cap
- State Management (FR30–FR33): schema-validated artifact, preflight invariants, cross-workflow concurrency
- Human Control & Override (FR34–FR40): manual cancel, label/@mention re-trigger, pause/escalate labels, human-only merge and column moves
- Observability & Audit (FR41–FR44): `ferry-audit` JSON stream, Jira-comment-per-run, 90-day GHA logs, phase labels
- Cost & Safety Governance (FR45–FR49): 50% soft alert, 429/402 auto-pause, pre-write secret scan, CODEOWNERS, tool denylist
- Webhook Resilience (FR50–FR51): 15-min reconciler cron with ULID dedupe
- Setup & Configuration (FR52–FR54): README-driven install, secrets + variables + optional `.ferry/config.yml`, pinned model IDs with inline rollback

**Non-Functional Requirements (architectural drivers):**

- **Performance:** p95 120s Jira→Refiner comment; p95 15min Jira→draft PR; p95 10min Reviewer findings after green CI; reconciler ≤2min for 100 tickets; 10 parallel tickets max per project
- **Security:** delimited untrusted content; gitleaks pre-write on every output; CODEOWNERS 100% coverage verified by test; tool denylist (no arbitrary shell/network/FS); minimal GitHub App scopes (no workflow-write, no admin); SHA-pinned Actions with Dependabot; zero prompt-injection incidents as release gate
- **Reliability:** ≤15min webhook loss recovery; idempotency verified by ≥3 re-runs; zero state corruption under concurrent events; 429/402 single-run isolation; cancellation leaves no partial state; ≥80% convergence in ≤3 iterations
- **Integration:** Jira Cloud REST v3 only; GitHub REST + GraphQL + `repository_dispatch`; versioned event envelope; Jira Standard/Premium tier required
- **Cost:** 200€/provider hard cap (console); 120–180€ pilot budget; ≤1.50€ avg / ≤4€ p95 per story; daily usage-API polling at 50%
- **Observability:** one JSON line per run ≤30s post-completion; two-bookmark 3am debuggability
- **Privacy:** third-party LLM transmission disclosed; no Ferry-owned persistence; per-provider disable hook
- **Maintainability:** zero long-running processes; 30min first-time setup; single-PR model rollback; re-copy workflow files for upgrade

**Scale & Complexity:**

- Primary domain: CI/CD automation / developer tooling (GitHub Actions-native)
- Complexity level: high — multi-LLM routing, cross-workflow concurrency, PR-as-state-machine, anti-oscillation, first-class cost governance
- Estimated architectural components: ~12 (5 workflows, 1 composite concurrency action, 1 shared agent-harness library, state schema, event envelope schema, audit emitter, reconciler, secret-scan wrapper)

### Technical Constraints & Dependencies

**Hard platform constraints (non-negotiable):**

- Runtime: GitHub Actions `ubuntu-latest` ephemeral runners only — no self-hosted, no VPS, no daemon
- SCM: GitHub only (v0.0.1)
- Tracker: Jira Cloud Standard or Premium only (outbound web requests required)
- LLM providers: Anthropic (Sonnet 4.6), Google (Gemini 2.5 Flash/Pro), OpenAI (GPT-5.4) — directly wired, no abstraction layer
- State store: none owned by Ferry — bot-comment or in-branch JSON are the only options (OQ5)
- Dispatch path: Jira Automation → GitHub `repository_dispatch` direct (Cloudflare Worker proxy explicitly rejected per C8)

**Product decisions frozen pre-architecture:**

- All 4 agents ship in MVP (no phased agents)
- One reviewer model only (no multi-model debate)
- Human-only: final merge, column transitions
- Agent language: English-only; source-language preservation policy unresolved (OQ10)
- Jira `Task` issue type filtered out; only `Story` processed

**Open architectural decisions inherited from PRD:**

- **OQ5** — state artifact: bot-owned PR comment vs `.ferry/state.json` (this workflow must close)
- OQ2 — Jira custom field provisioning for `ai.iteration` / `ai.phase`
- OQ8 — attachment handling (currently: ignore silently per I11)
- OQ10 — Refiner language policy for French tickets

### Cross-Cutting Concerns Identified

1. **Concurrency & idempotency** — every workflow, every external write; shared composite action `.github/actions/ferry-concurrency`; ULID event IDs; idempotency markers `[ferry:<role>:<run-id>]` on all writes
2. **State artifact integrity** — JSON Schema validation on every read/write; preflight invariants before any write; `status:stale` on mismatch
3. **Secret scanning** — pre-write gate on every commit, PR body, Jira comment, sub-task field; abort + `ferry:paused` + `secret-scan-hit` reason
4. **Model routing** — per-role pinning + per-label override (`critical` → GPT-5.4); rollback IDs inline in workflow files; versioned prompts
5. **Cost telemetry & governance** — per-run JSON line; daily usage polling; 429/402 → auto-pause; 50% soft alert
6. **Audit logging** — single `ferry-audit` Issue as canonical telemetry surface; Jira comment per run with GHA log URL
7. **Error taxonomy** — `transient` / `spend-cap` / `state-invariant` / `oscillation` / `unknown` → deterministic label + escalation mapping
8. **Security perimeter** — CODEOWNERS on `.github/**`, path-filter on agent PRs, tool denylist per run, SHA-pinned Actions, minimal App scopes
9. **Webhook resilience** — 15-min reconciler cron with dedupe across ULID event IDs
10. **Finding fingerprinting & anti-oscillation** — `(file, line-range, rule-id)` tuples persisted in audit storage; resurgent = immediate `needs-human`

## Starter Template Evaluation

### Primary Technology Domain

Ferry is a **GitHub Actions–native developer tool**, not a framework-backed application. It has no web surface, no API server, no CLI binary, no SDK, no mobile app. Its "platform" is the combination of GitHub Actions + Jira Cloud + four LLM provider APIs. The PRD explicitly rules out any runtime binary or distributable package (Developer-Tool Specific Requirements § Installation & Distribution).

### Starter Options Considered

| Option | Fit | Why |
|--------|-----|-----|
| Next.js / Vite / Remix / SvelteKit starters | ❌ | No web app surface |
| NestJS / Express / Fastify starters | ❌ | No backend service; Ferry is workflows, not a server |
| Expo / React Native | ❌ | Not a mobile product |
| oclif / commander CLI starters | ❌ | No CLI in v0.0.1 (explicitly out of scope) |
| T3 / RedwoodJS full-stack | ❌ | Not a full-stack app |
| `actions/typescript-action` template | ⚠️ Partial | Template for a *single* JavaScript Action; Ferry has 5+ workflows and shared logic. Useful only as a pattern reference for individual composite actions. |
| Python-on-GHA scaffold | ⚠️ Viable | SDKs available; ecosystem less aligned with GHA-TS idioms |
| **Hand-scaffolded TypeScript + Node on GHA** | ✅ Selected | Matches Ferry's "workflows are the product" thesis; no framework assumptions; aligns with official Anthropic/Google/OpenAI TS SDKs (NFR-I3) |

### Selected Starter: None (manual scaffold)

**Rationale:**

1. **No framework-backed starter fits the problem shape.** Ferry is workflows + small TypeScript helpers inside composite actions, not an application.
2. **Every off-the-shelf starter imports assumptions Ferry actively rejects** (web server, routing, client bundle, SSR, ORM).
3. **The scaffold is small enough that conventions beat tooling.** `package.json`, `tsconfig.json`, `src/` layout, and a composite-action pattern are the full foundation — all documented as architectural decisions in the next steps.

**Initialization (to be codified as the first implementation story):**

```bash
git init ferry
cd ferry
npm init -y
npm install --save-dev typescript @types/node vitest tsx
npm install @anthropic-ai/sdk @google/genai openai @octokit/rest ulid ajv
npx tsc --init --rootDir src --outDir dist --module nodenext --target es2023 --strict
```

**Architectural Decisions Provided by (Manual) Scaffold:**

**Language & Runtime:**

- TypeScript strict mode, target ES2023, module `nodenext`.
- Node.js runtime pinned to GitHub Actions default at release time (`actions/setup-node` with exact minor version).

**Styling Solution:** N/A (no UI).

**Build Tooling:**

- `tsc` for type-checking, `tsx` for local execution, `vitest` for tests.
- No bundler — workflows import compiled JS directly via `actions/setup-node` + `npm ci`.

**Testing Framework:**

- `vitest` for unit tests on helpers (state schema, envelope schema, fingerprint hashing, idempotency marker parsing).
- GitHub Actions workflow runs `npm test` on every PR.
- Contract tests for Jira/GitHub/LLM SDKs use recorded fixtures (no live API hits in CI).

**Code Organization:**

- `src/agents/{refiner,developer,reviewer,iterator}/` — one folder per role.
- `src/lib/{state,envelope,audit,secret-scan,concurrency,routing}/` — cross-cutting concerns.
- `src/schemas/{state,event}.schema.json` — source of truth for JSON Schema validation.
- `.github/workflows/{refine,dev,review,iterate,reconciler}.yml` — one file per phase.
- `.github/actions/ferry-concurrency/action.yml` — shared composite action.
- `.github/CODEOWNERS` — protects `.github/**` (C2).
- `examples/` — `chancellerie-setup.md`, `event.schema.json`, `state.schema.json`, `ferry-audit.jsonl`, `prompt-templates/`.

**Development Experience:**

- `npm ci` only (I10); Dependabot enabled on this repo (NFR-S7).
- All GitHub Actions dependencies SHA-pinned (NFR-S7).
- Linting: ESLint with `@typescript-eslint`; Prettier for formatting.
- Secret-scan pre-commit hook (gitleaks) + GitHub push protection (I9).

**Note:** Scaffolding this structure is the first implementation story. No `npx create-*` command applies.

## Core Architectural Decisions

The PRD heavily constrains Ferry's stack (GHA-only, TS, specific providers, no DB, no service). This section records decisions in Ferry's actual decision space — not the generic template categories, which mostly don't apply — and closes the PRD open questions OQ5, OQ8, OQ10. OQ2 is deferred to Growth.

### Decision Priority Analysis

**Critical (block implementation):**

- D1 State artifact location (resolves OQ5)
- D2 Event envelope & dispatch contract
- D3 Concurrency primitive
- D4 Agent harness & LLM SDK integration shape
- D5 Audit storage writer semantics
- D6 Secret scanning tool + placement

**Important (shape architecture):**

- D7 Prompt storage, versioning, and stale-prompt handling
- D8 Testing strategy (unit + contract + dry-run)
- D9 Language policy for agent-generated Jira content (resolves OQ10)
- D10 Attachment handling (resolves OQ8)
- D11 Error taxonomy & label mapping
- D12 Finding fingerprinting scheme

**Deferred (post-MVP):**

- Jira custom field provisioning `ai.iteration` / `ai.phase` (OQ2 → Growth; state artifact carries these at MVP)
- Second-project onboarding / reusable template repo (OQ9 → Growth)
- Provider-agnostic LLM abstraction (PRD defers to v0.1)
- GitHub Actions concurrency cap instrumentation (OQ7 → Growth, instrument only)
- Reviewer-upgrade trigger procedure (OQ6 → week-1 audit, not architecture)

---

### D1 — State artifact location (closes OQ5)

**Options considered:**

| Option | Pros | Cons |
|--------|------|------|
| (a) Bot-owned PR issue comment `<!-- ferry:state v1 -->` | No branch mutation; visible; zero commit noise | Concurrent comment-edit races; weaker history; humans can edit and corrupt |
| (b) `.ferry/state.json` in-branch (JSON Schema–validated) | Git history = audit; trivial validation; concurrency serialized by commit ordering; single source of truth | Adds one commit per agent run; conflicts possible with iterator diffs (resolvable by agent as last-writer-wins on this file) |
| (c) Jira custom fields `ai.iteration` / `ai.phase` | Authoritative in Jira | Requires Jira admin setup (OQ2); limited to primitives; can't carry fingerprints or full history |

**Decision: (b) `.ferry/state.json` in-branch, JSON Schema–validated.**

**Rationale:**

1. Git history provides a free, durable audit trail per ticket, co-located with the PR.
2. JSON Schema validation is trivial and deterministic (Ajv).
3. The cross-workflow concurrency group already serializes writes — no concurrent-comment race.
4. One small file in `.ferry/` does not meaningfully pollute diffs; CODEOWNERS on `.github/**` does not extend to `.ferry/` so agents may write it.
5. Recoverability (NFR-R5): a cancelled run leaves either the old state file or a half-updated one; preflight invariants (FR32) detect schema violations and label `status:stale`.

**Schema (authoritative location `src/schemas/state.v1.schema.json`, mirrored in `examples/state.v1.schema.json`):**

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ferry.dev/schemas/state.v1.json",
  "type": "object",
  "required": ["version", "ticket_key", "phase", "run_id", "prompt_version", "iteration", "iteration_history", "updated_at"],
  "properties": {
    "version": { "const": "v1" },
    "ticket_key": { "type": "string", "pattern": "^[A-Z][A-Z0-9_]+-\\d+$" },
    "phase": { "enum": ["refining", "developing", "reviewing", "iterating", "ready", "paused", "cancelled", "needs-human"] },
    "run_id": { "type": "string", "pattern": "^[0-9A-HJKMNP-TV-Z]{26}$" },
    "prompt_version": { "type": "string" },
    "iteration": { "type": "integer", "minimum": 0, "maximum": 3 },
    "findings_fingerprints": { "$ref": "#/$defs/fingerprintArray" },
    "iteration_history": {
      "type": "array",
      "maxItems": 4,
      "items": {
        "type": "object",
        "required": ["iteration", "run_id", "completed_at", "pr_sha", "fingerprints"],
        "properties": {
          "iteration": { "type": "integer", "minimum": 0, "maximum": 3 },
          "run_id": { "type": "string", "pattern": "^[0-9A-HJKMNP-TV-Z]{26}$" },
          "completed_at": { "type": "string", "format": "date-time" },
          "pr_sha": { "type": "string", "pattern": "^[a-f0-9]{40}$" },
          "fingerprints": { "$ref": "#/$defs/fingerprintArray" },
          "review_verdict": { "enum": ["clean", "findings", "escalate"] }
        }
      }
    },
    "updated_at": { "type": "string", "format": "date-time" },
    "updated_by_run": { "type": "string" }
  },
  "$defs": {
    "fingerprintArray": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["file", "line_start", "line_end", "rule_id", "hash"],
        "properties": {
          "file": { "type": "string" },
          "line_start": { "type": "integer" },
          "line_end": { "type": "integer" },
          "rule_id": { "type": "string" },
          "hash": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
        }
      }
    }
  },
  "additionalProperties": false
}
```

**Why `iteration_history[]` is mandatory (patch from round-2 gap hunt):** FR27 resurgent-finding detection requires comparing fingerprints at iteration N against iteration N−1. The original schema had only `findings_fingerprints` (current) + `last_review_history` (unspecified shape), forcing runtime code to walk git history for prior fingerprints. Explicit history eliminates that implicit contract: Reviewer reads `state.iteration_history.at(-1).fingerprints` directly. `pr_sha` anchors each iteration's fingerprints to the exact code state they were computed against — essential when Iterator commits between rounds change line numbers.

**Resurgence algorithm (`src/lib/fingerprint/resurgence.ts`):**

```
const prev = state.iteration_history.at(-1)?.fingerprints ?? [];
const resurgent = newFingerprints.filter(fp =>
  prev.some(p => p.hash === fp.hash)
);
if (resurgent.length > 0 && state.iteration >= 1) {
  throw new FerryError("oscillation", { fingerprints: resurgent });
}
```

**State-cleanup on merge:** `.ferry/state.json` is deleted in the final Iterator commit before PR merge when `review_verdict === "clean"`. Squash-merge then retains only the clean code; `main` never accumulates stale state files. If the consumer repo uses merge-commit or rebase-merge, an Iterator cleanup commit still removes the file. Preflight asserts absence on `main` via a CI check `no-ferry-state-on-main.test.ts`.

**Affects:** FR22, FR27, FR30, FR31, FR32, NFR-R3, NFR-R5, all four agents.

---

### D2 — Event envelope & dispatch contract

**Decision:** Jira Automation → GitHub `repository_dispatch` direct (per C8, no proxy). Envelope versioned `v1`. Authoritative schema at `src/schemas/event.schema.json`.

**Schema fields (required unless noted):**

```jsonc
{
  "version": "v1",
  "event_id": "<ULID>",               // FR4, dedupe key
  "ticket_key": "CHAN-27",
  "phase": "refine" | "dev" | "review" | "iterate" | "reconcile",
  "source": "jira-column" | "jira-label" | "jira-mention" | "reconciler",
  "instructions": "string (optional, from @mention)",
  "ts": "ISO-8601"
}
```

**Enforcement:**

- Every workflow has a **`gate-envelope` job** as its first job (all other jobs `needs: [gate-envelope]`). It runs the composite action `.github/actions/ferry-envelope-validate/` which performs full Ajv schema validation against `event.v1.schema.json`, including the strict `ticket_key` pattern `^[A-Z][A-Z0-9_]+-[0-9]+$`. On failure, the workflow exits non-zero before any side-effect job runs. No payload content is logged.
- **Dedupe happens at ingress in the gate-envelope job** against a bot-owned GitHub Issue, not an in-branch file (see below).

**Dedupe — bot-owned `ferry-processed-events` Issue (patch from round-2 gap hunt):**

The original design stored recent event IDs in `.ferry/processed_events.json` on each ticket branch. That surface cannot serialize cross-ticket dedupe: a `repository_dispatch` may target a ticket whose branch doesn't yet exist; two tickets firing simultaneously write to two different branches' files; the reconciler re-dispatching a previously-seen event has no global surface to consult. Last-writer-wins silently drops `event_id`s and FR5 ("refuse to start a second run for the same ID") is violated.

**Replacement:** A dedicated bot-owned GitHub Issue titled `ferry-processed-events` (created at install time) holds one issue comment per accepted `event_id`, marker `[ferry:dedupe] <event_id> <ticket_key> <run_id>`. The dedupe helper `src/lib/envelope/dedupe.ts` exposes `checkAndClaim(event_id) → {alreadyProcessed: boolean}`. Implementation: read the last N comments (paginated ULID-sorted), return early if `event_id` is present; otherwise post the claiming comment. GitHub issue comment creation is strongly consistent, providing a global serialization point without a database.

**Why this surface and not the existing `ferry-audit` issue:** Keeping dedupe on a separate issue avoids contention with audit-line writes (which race under concurrent runs across tickets) and keeps the two write patterns independent — dedupe uses comment *creation* only (append-only, no edits); audit uses comment creation *and* in-place edits per D5/FR60. Conflating them on one issue couples two different consistency requirements.

**Pruning:** The reconciler's daily job (`audit-daily.yml`) deletes `ferry-processed-events` comments older than 24 hours. The dedupe window is therefore 24 hours — longer than any realistic re-dispatch or webhook retry scenario, shorter than unbounded growth would allow.

**Cross-ticket correctness:** The 15-minute reconciler (FR50–FR51) can re-dispatch a webhook that was previously processed on a different ticket branch; the single `ferry-processed-events` issue is the only surface that can detect this.

**Legacy note:** `.ferry/processed_events.json` is removed from the design. The file is not created, not read, not referenced. Any prior mention elsewhere in this document is superseded by this patch.

**Affects:** FR1, FR2, FR3, FR4, FR5, FR51, NFR-R1.

---

### D3 — Concurrency primitive

**Decision:** GitHub Actions workflow-level `concurrency` with a **hardened group-key expression** and a **per-phase cancel policy**.

**Hardened group-key expression (patch from round-2 gap hunt):**

GitHub Actions evaluates the `concurrency:` block before any step runs — so runtime payload validation (composite action) cannot prevent a malformed `ticket_key` from becoming the group key. A payload with an empty, missing, or adversarial `ticket_key` would either coalesce all garbage traffic into one global group or fragment into thousands of ephemeral groups (exhausting the 500-group GHA cap under sustained bad input).

Every workflow uses this exact block at the top of the file:

```yaml
concurrency:
  group: ferry-${{ startsWith(github.event.client_payload.ticket_key, 'CHAN-') && github.event.client_payload.ticket_key || 'ferry-invalid-payload-sinkhole' }}
  cancel-in-progress: <policy-per-phase-below>
```

- The `startsWith` guard uses GitHub-expression-only functions (no shell, no composite — evaluated at the same stage as the group itself).
- The **sinkhole group** `ferry-invalid-payload-sinkhole` intentionally collapses all malformed payloads into one group so they queue and die serially. This prevents both global-collision chaos and 500-group-cap exhaustion under sustained bad input.
- The prefix allowlist (`CHAN-`, and any other Jira project keys the consumer adds) is structurally encoded in the YAML. Adding a new Jira project means editing the five workflow files — acceptable given how rarely this happens.
- The `gate-envelope` job (per D2) is the real enforcement: when the `ticket_key` is malformed, the workflow enters the sinkhole group *and* fails fast in the first job without any side effects.

Key derivation remains in the shared composite action `.github/actions/ferry-concurrency/action.yml` for documentation and version-pinning, but the `concurrency:` block itself must live in each workflow (GitHub Actions does not allow composites to set workflow-level concurrency).

**Per-phase cancel policy (patch from round-2 gap hunt):**

Uniform `cancel-in-progress: true` creates a state-loss race: a cancellation mid-flight between `writeState` and `git push`, or between the `.ferry/state.json` commit and the external Jira/GitHub writes, leaves state and branch diverged. Uniform `cancel-in-progress: false` starves tickets where a human is legitimately updating inputs in quick succession. The correct policy is **split by phase**:

| Workflow | `cancel-in-progress` | Rationale |
|----------|----------------------|-----------|
| `refine.yml` | `true` | Pure read of ticket + single audit comment + sub-task creation; the latest human ticket edit should win; no branch state to corrupt |
| `dev.yml` | **`false`** | Writes `.ferry/state.json`, branch, and PR; cancellation mid-commit = state/branch divergence |
| `review.yml` | **`false`** | Writes fingerprints to `state.iteration_history[]` + PR review body; must complete atomically |
| `iterate.yml` | **`false`** | Same as dev |
| `reconciler.yml` | `true` | Idempotent sweep; a newer sweep supersedes an older one safely |

**Freshness check (`src/lib/preflight/freshness.ts`) — mitigates queue starvation on `cancel-in-progress: false` write phases:**

With write-phase queueing, rapid successive events for the same ticket stack up. Each queued run, upon starting, calls `assertFreshOrSupersede(envelope)`:

1. Re-fetch the Jira ticket's `updated` timestamp.
2. Re-check `ferry-processed-events` for any newer `event_id` for this `ticket_key`.
3. If a newer human event or a newer queued Ferry event exists → exit 0 early with `outcome: "superseded"` in `ferry-audit`. No LLM call, no external writes.
4. Otherwise proceed.

This collapses N queued runs to 1 effective run without dropping human input. The freshness check is the first action after `preflight()` in every write-phase entry point.

A vitest lint asserts no write-phase workflow sets `cancel-in-progress: true` (parses YAML, fails CI on violation).

**Affects:** FR33, NFR-R3, C4. Single most load-bearing invariant per PRD.

---

### D4 — Agent harness & LLM SDK integration

**Decision:** Custom minimal TypeScript harness per role. No agent framework (LangChain, LangGraph, claude-agent-sdk, etc.).

**Shape:**

```
src/agents/<role>/
  index.ts            # entry point, called from workflow
  prompt.v0_0_1.md    # versioned prompt, markdown with {{placeholders}}
  schema.ts           # expected output structure validated with Ajv
src/lib/llm/
  anthropic.ts        # thin wrapper around @anthropic-ai/sdk
  google.ts           # thin wrapper around @google/genai
  openai.ts           # thin wrapper around openai
  index.ts            # route(role, ticketLabels) → {provider, modelId}
```

Each provider wrapper exposes `invoke({systemPrompt, userContent, maxTokens}) → {text, usage: {inputTokens, outputTokens, costEur}}`. Cost is computed locally from pinned per-1M-token rates in `src/lib/llm/pricing.ts`.

**Rationale:**

1. **KISS.** Each role is <500 LOC; a framework would be net-negative.
2. **Tool denylist enforcement (NFR-S4).** Agent frameworks ship broad toolsets that have to be explicitly disabled; a custom harness starts with zero tools and adds only what's needed.
3. **Cost determinism.** Direct SDK calls make token counting straightforward; frameworks add hidden prompt overhead.
4. **SDK churn isolation.** Swapping `@google/genai` versions touches one file, not a framework abstraction.

**Code-application strategy (Developer/Iterator) — patched from round-2 gap hunt:**

The LLM cannot produce a correct diff without reading the files it's modifying. The original "no tool interface" claim for FR49 was true in the narrow sense (no tool-use protocol) but silently required the harness to include source code in the prompt — the question was how, bounded by what, and how the output scope is enforced.

**Selective file inclusion driven by Refiner `touch_paths`:**

1. **Refiner output schema extension.** The Refiner (`src/agents/refiner/schema.ts`) emits, alongside sub-tasks, an explicit `touch_paths: string[]` listing the files the Developer is authorized to modify. Glob-free — exact paths, relative to repo root. Hard cap: **20 files, 200 KB total content**. Overflow → `FerryError("spec-too-broad")` → `needs-human`.
2. **Context builder (`src/agents/developer/context.ts`).** Pre-reads each path from the checked-out workspace and embeds contents as delimited `<file path="...">...</file>` blocks in the Developer prompt. The delimiter convention lives in `src/lib/prompt/delimit.ts` (same primitive used for untrusted ticket content, NFR-S1).
3. **Model output.** Unified diff in a delimited `<diff>...</diff>` block + a short summary.
4. **Scope-enforced diff application (`src/lib/diff/apply.ts`).** Before `git apply`:
   - Parse the diff with `git apply --check` to fail fast on malformed patches.
   - For each touched path in the diff, assert `touch_path ∈ (Refiner.touch_paths ∪ {".ferry/state.json"})`. Any out-of-scope hunk → `FerryError("scope-violation")` → `needs-human`. No partial application attempted.
   - Any path matching `.github/**` is hard-rejected regardless of `touch_paths` (defense-in-depth alongside CODEOWNERS).
   - Apply with `git apply --index`. On failure → `git reset --hard` the workspace, then re-generate the diff against fresh HEAD (not a backoff-retry: patch rejection usually means the Iterator has a stale view of HEAD, retrying the same diff is pointless). Max 3 regenerate cycles before escalating to `needs-human`.
5. **Diff size cap (Growth → MVP).** `>50 files` in the diff → `FerryError("spec-too-broad")` → `needs-human`. This was deferred to Growth in the PRD but the `touch_paths` mechanism makes it cheap: the 20-file `touch_paths` cap subsumes it.

**What this delivers for FR49:** the "tool denylist" is enforced at **output scope** (diff-path guard) rather than at tool-use level (since there is no tool-use interface). A model attempting to exfiltrate data by writing to `~/.aws/credentials` cannot — the diff can only modify paths the Refiner explicitly authorized. Prompt injection attempting to write to `.github/workflows/*.yml` is blocked twice: once by `touch_paths` (Refiner won't authorize it for a feature ticket), and again by the hard-reject on `.github/**`.

**Iterator shape:** Iterator receives the current iteration's Reviewer findings + the prior `iteration_history[]` + the same Refiner-authorized `touch_paths`. It emits a diff scoped to those paths. The `pr_sha` field in the iteration history ensures the Iterator knows the exact HEAD its diff will apply against.

**Reviewer shape note (from round-2 gap hunt):** the agent-entry-point skeleton (per Implementation Patterns §) does not literally fit the Reviewer, because the Reviewer must branch on CI status before any LLM call (FR19, FR20). The Reviewer's `index.ts` implements a documented skeleton variant:

```typescript
// src/agents/reviewer/index.ts
try {
  await preflight(envelope);
  await assertFreshOrSupersede(envelope);
  const state = await loadState(envelope);
  const ci = await github.getCiStatus(state.pr_number);
  if (ci === "pending") { /* requeue via exit 75 or auto-re-dispatch */ return; }
  if (ci === "red") {
    // Synthetic finding path per FR20 — no LLM call
    await writeState({ ...state, /* record synthetic finding */ });
    await jira.transition(envelope.ticket_key, "Changes Requested");
    await emitAudit({ outcome: "success", usage: { inputTokens: 0, outputTokens: 0, costEur: 0 }, runId, start });
    return;
  }
  // Green CI: real review path
  const { text, usage } = await invoke(routeModel("reviewer", ticket.labels), { ... });
  // ... fingerprint, persist to iteration_history, post findings ...
}
```

The CI-status branch is documented as the only permitted variant from the base skeleton. Tests assert both branches emit audit lines under `if: always()`.

**Affects:** FR14–FR29, FR49, NFR-S1, NFR-S4, NFR-I3.

---

### D5 — Audit storage writer semantics

**Decision:** Single GitHub Issue titled `ferry-audit` in the consumer repo. One **issue comment per run** (not issue-body append — which would race under concurrent runs across tickets).

**Write semantics:**

- Each agent run, on exit, posts exactly one comment containing one compact JSON object (FR41 fields: `ticket`, `phase`, `run_id`, `model`, `input_tokens`, `output_tokens`, `cost_eur`, `outcome`, `duration_ms`, `timestamp`).
- Idempotency marker `[ferry:audit:<run_id>]` in the comment; writer checks last 50 comments for the marker and skips if present (FR5 dedupe on retry).
- Comment creation is the last step of every workflow (via `if: always()`), so cancellations still emit an `outcome: "cancelled"` line.

**Alternatives rejected:**

- Appending to issue body: concurrent writes conflict, last-write-wins loses audit entries.
- Separate `ferry-audit/YYYY-MM.jsonl` file in-repo: branch-bound, not suitable for reconciler or cross-ticket aggregation.
- A dedicated dashboard: out of scope (NFR-O4 mandates zero tooling).

**Affects:** FR41, FR42, FR43, FR45, NFR-O1, NFR-O4.

---

### D6 — Secret scanning tool + placement

**Decision:** `gitleaks` (open-source, maintained, broad ruleset) invoked **inside the agent harness** before every external write (commit, PR body, Jira comment, Jira sub-task body).

**Placement:**

1. **Pre-write hook in harness.** `src/lib/secret-scan/index.ts` runs gitleaks against every outbound string; a hit aborts the write, labels `ferry:paused` with reason `secret-scan-hit`, and posts a minimal Jira comment (no leaked content).
2. **Pre-commit safety net.** GitHub push protection enabled on the consumer repo as defense-in-depth.
3. **Dependabot + SHA-pinned Actions.** (NFR-S7) — separate concern, covered in D8 testing/CI.

**Alternatives considered:** `trufflehog` (heavier, more false positives in testing), `detect-secrets` (Python, extra runtime). Gitleaks wins on speed, TS compatibility (via binary invocation in the runner), and GHA ecosystem fit.

**Affects:** FR47, NFR-S2, C1, I9.

---

### D7 — Prompt storage & versioning

**Decision:** Prompts live at `src/agents/<role>/prompt.v<semver>.md`. State artifact records `prompt_version` used for the current run. Mismatched version on re-run triggers `status:stale` and requires a human re-dispatch (FR32).

**Versioning rules:**

- **Patch bump** (v0.0.1 → v0.0.2): wording clarifications, safe to use mid-pilot.
- **Minor bump** (v0.0.1 → v0.1.0): output schema or capability change — breaks iterator history compatibility; labels ongoing tickets `status:stale`.
- **Major bump** (v1.0.0): reserved.

**Affects:** FR54, NFR-I4, NFR-M3.

---

### D8 — Testing strategy

**Decision:** Three layers, all enforced in CI on Ferry's own PRs.

1. **Unit (vitest):** helpers — state schema validation, envelope schema, ULID generation, idempotency marker parsing, fingerprint hashing, cost calculation, diff application, secret-scan integration.
2. **Contract tests:** recorded fixtures for Jira REST v3 + GitHub REST/GraphQL + each LLM SDK. Fixtures stored at `src/__fixtures__/`. No live API calls in CI.
3. **Dry-run E2E:** env var `FERRY_DRY_RUN=1` short-circuits every external write (logs would-be payloads to GHA output). A dedicated workflow runs the full refine→dev→review→iterate sequence against a canned ticket fixture on every PR to Ferry.

**Quality gates (CI required checks):**

- Typecheck (`tsc --noEmit`)
- Lint (ESLint + Prettier check)
- `npm test` (vitest)
- `npm run test:contract`
- `npm run test:e2e:dry`
- Gitleaks on diff
- CODEOWNERS test (asserts `.github/**` protected — NFR-S3 "verified by test")

**Affects:** NFR-R2, NFR-R5, NFR-S2, NFR-S3.

---

### D9 — Language policy (closes OQ10)

**Decision:** Agents preserve the parent ticket's source language in Jira-visible outputs (sub-task titles/descriptions, audit comments), while `ferry-audit` JSON and GHA logs remain English.

**Mechanism:**

- Detection: simple heuristic in the harness — if parent ticket description contains > 3% of French stopwords (`le, la, de, un, et, pour, que, est, avec, ...`) the output locale is `fr`; otherwise `en`. Recorded in state artifact as `output_locale`.
- Prompt: each role's prompt includes `Output language: {{output_locale}}. Do not translate code, filenames, identifiers, or error messages.`
- No LLM-based translation — the model generates directly in target language.

**Tradeoff accepted:** heuristic misclassifies mixed-language tickets ~5% of the time. MVP cost. Human can override per-run via `@agent-<role> output=en|fr <instructions>` (not yet documented; deferred to Growth).

**Affects:** FR8–FR13 (Refiner), FR21–FR24 (Reviewer), NFR-D1.

---

### D10 — Attachment handling (closes OQ8)

**Decision:** Refiner detects attachments on the parent ticket and lists them (filename + type) in its audit comment, then ignores their content. Attachments are not fetched, not base64-encoded, not passed to the model.

**Rationale:** multi-modal processing adds cost, latency, security surface (image-based prompt injection), and schema complexity. MVP defers. Users who need attachment content inject it via `@agent-refiner <instructions including quoted text>`.

**Audit comment template:**

```
[ferry:refiner:<run-id>] 6 sub-tasks created, cost 0.03€. See run #<n>.
Attachments detected but not processed: 2 (ferry-ui-mockup.png, adr-007.pdf).
```

**Affects:** FR8, I11.

---

### D11 — Error taxonomy & label mapping

**Decision:** Five-class error taxonomy (per PRD), with deterministic label and escalation mapping.

| Class | Label | Action | Retry |
|-------|-------|--------|-------|
| `transient` | none | exponential backoff in-run | max 3, ULID-deduped |
| `spend-cap` | `ferry:paused` + `ferry:spend-cap` | abort run, Jira comment with resume date | human unpauses |
| `state-invariant` | `status:stale` | abort run, no writes | human re-dispatches |
| `oscillation` | `needs-human` | abort after resurgent-fingerprint detection | human intervention |
| `unknown` | `needs-human` + link to GHA log | abort | human triages |

Implemented as `src/lib/error-taxonomy/index.ts` with typed `FerryError` subclasses. Every run's top-level try/catch maps thrown `FerryError` to the correct label application + Jira comment + audit JSON `outcome` field.

**Affects:** FR37, FR38, FR44, FR46, FR47, NFR-R4, NFR-M4.

---

### D12 — Finding fingerprinting scheme

**Decision:** Fingerprint = SHA-256 of JSON `{file, line_start, line_end, rule_id}` normalized (file path relative to repo root, POSIX separators). Persisted in state artifact `findings_fingerprints` array per iteration.

**Resurgent detection:** on Iterator completion, Reviewer computes new fingerprints; if any fingerprint in iteration N+1 also appears in iteration N → immediately escalate `needs-human` (FR27), no further Iterator run.

**Rule-id convention:** Reviewer prompt instructs the model to emit `rule_id` per finding from a fixed taxonomy (e.g., `missing-test`, `unhandled-error`, `type-mismatch`, `security-secret`, `logic-bug`, `nit-style`). Free-text findings get `rule_id: "other"` and are excluded from fingerprinting (they cannot be reliably deduped).

**Affects:** FR22, FR27, I3.

---

### Decision Impact Analysis

**Implementation sequence (informs epic ordering in the next BMad step):**

1. Project scaffold + CI (D8) → enables all subsequent work.
2. Shared libs: state schema (D1), event envelope (D2), concurrency action (D3), error taxonomy (D11), audit writer (D5), secret-scan wrapper (D6).
3. LLM harness + routing (D4) + prompt storage (D7).
4. Refiner end-to-end (FR8–FR13, D10 attachment listing, D9 language).
5. Developer end-to-end (FR14–FR18).
6. Reviewer + fingerprinting (FR19–FR24, D12).
7. Iterator + resurgent escalation (FR25–FR29).
8. Reconciler cron (FR50–FR51).
9. Cost governance daily cron (FR45–FR46).

**Cross-component dependencies:**

- D1 state artifact is read/written by D4 harness, D11 error mapper, D12 fingerprinter — change in schema ripples to all four agents.
- D3 concurrency key derives from D2 envelope — malformed envelope = malformed group key; D2 schema validation is the upstream guard.
- D5 audit writer runs `if: always()` after every workflow — depends on the harness exposing a structured `RunSummary` object regardless of error class.
- D7 prompt versioning interacts with D1 state: a `prompt_version` mismatch is a `state-invariant` error (D11).

## Implementation Patterns & Consistency Rules

Ferry has no database, no public API, no frontend — so classic DB/API/UI naming conflict points don't apply. The real conflict surface for agents working on Ferry is: **workflow file shape, TS module layout, LLM harness signatures, JSON schemas, idempotency markers, log/comment formats, and error handling.** Patterns below enforce consistency across those axes.

### Naming Patterns

**TypeScript code:**

- Files: `kebab-case.ts` (e.g., `secret-scan.ts`, `state-schema.ts`). Exception: role entry points are `src/agents/<role>/index.ts`.
- Exported symbols: `camelCase` for functions/variables, `PascalCase` for types/classes, `SCREAMING_SNAKE_CASE` for runtime constants.
- Test files: co-located `*.test.ts` beside the source (`secret-scan.test.ts` next to `secret-scan.ts`). Fixtures under `src/__fixtures__/`.
- No `default` exports; named exports only (keeps grep trivial).

**JSON field naming (state artifact, event envelope, audit lines):** `snake_case`. Rationale: matches existing PRD prose (`event_id`, `run_id`, `ticket_key`, `cost_eur`, `input_tokens`). Never mix cases across schemas.

**Workflow files and job names:**

- Workflow files: `.github/workflows/<phase>.yml` where `<phase>` ∈ {`refine`, `dev`, `review`, `iterate`, `reconciler`, `audit-daily`, `ferry-ci`}.
- Workflow `name:` field: `Ferry — <Phase>` (e.g., `Ferry — Refine`). Prefix makes all Ferry runs visible in the Actions tab at a glance.
- Job IDs: `kebab-case` (e.g., `validate-envelope`, `run-agent`, `emit-audit`).
- Step `name:` fields: imperative sentence case (e.g., `Validate event envelope`).

**Branches (created by Developer agent):** `ferry/<TICKET-KEY>` exactly (e.g., `ferry/CHAN-27`). One branch per ticket. Iterator commits to the same branch.

**Commit messages (by agents):** conventional-commit-ish, prefixed with ticket key:

```
[CHAN-27] feat: add dark-mode toggle to settings

Fixes findings: missing-test, localstorage-persistence

[ferry:developer:01HGQ...]
```

The trailer idempotency marker is load-bearing (FR5 dedupe).

**Labels (closed set; agents may never introduce new labels):**

- Agent re-triggers: `agent:refiner`, `agent:dev`, `agent:reviewer`, `agent:iterator`.
- Ferry phase status: `ferry:refining`, `ferry:developing`, `ferry:reviewing`, `ferry:iterating`, `ferry:ready`, `ferry:paused`, `ferry:cancelled`, `ferry:spend-cap`.
- Escalation: `needs-human`, `status:stale`.
- Routing: `critical` (user-applied; routes Dev/Iterator to GPT-5.4 per FR17).

CI test `labels-allowlist.test.ts` asserts every agent-applied label belongs to the allowlist.

**Idempotency marker format (mandatory on every external write):**

```
[ferry:<role>:<run_id>]
```

- `<role>` ∈ {`refiner`, `developer`, `reviewer`, `iterator`, `reconciler`, `audit`}.
- `<run_id>` is the ULID from the event envelope.
- Appears in: commit trailers, PR body footer, every Jira comment last line, every sub-task description footer, every `ferry-audit` issue comment.

---

### Structure Patterns

See D4 for `src/` layout. Additional rules:

- **One concern per directory.** `src/lib/<concern>/` holds all code for one cross-cutting concern (e.g., `src/lib/secret-scan/` owns gitleaks invocation, pre-write gating, and the `ferry:paused` labelling helper — nothing else).
- **No `utils.ts` grab-bags.** If a helper doesn't belong to an existing concern, create a new `src/lib/<name>/` directory.
- **Schemas are authoritative under `src/schemas/`.** The `examples/` copies are duplicated at build time — never edited directly.
- **Prompts live with their role.** `src/agents/<role>/prompt.v*.md` — not in a central `prompts/` directory.
- **Config is read once at startup.** `src/lib/config/index.ts` exports `loadConfig()` called in every agent entry point's first line. No ambient `process.env` reads elsewhere.

---

### Format Patterns

**Error output to Jira (human-readable):**

```
[ferry:<role>:<run_id>] <phase> failed — <error_class>

<one-sentence summary>

Details: <GHA run URL>
```

Never dump stack traces into Jira. Stack traces go to GHA logs only.

**Audit JSON line (one comment = one run):**

```json
{
  "ticket": "CHAN-27",
  "phase": "refine",
  "run_id": "01HGQ...",
  "model": "gemini-2.5-flash",
  "input_tokens": 1243,
  "output_tokens": 521,
  "cost_eur": 0.003,
  "outcome": "success",
  "duration_ms": 18432,
  "timestamp": "2026-04-23T19:12:05.123Z",
  "prompt_version": "v0.0.1"
}
```

Keys are fixed, ordered, never omitted. Additional debugging fields go into an optional `meta` object, never at the top level. `outcome` ∈ {`success`, `cancelled`, `spend-cap`, `state-invariant`, `oscillation`, `unknown`}.

**Date/time format:** ISO-8601 with milliseconds and `Z` suffix everywhere (`2026-04-23T19:12:05.123Z`). Never Unix timestamps. Never locale-dependent strings.

**Cost format:** euros as decimal number in `cost_eur`, rounded to 4 decimal places. Source of truth is the pricing table in `src/lib/llm/pricing.ts`.

---

### Communication Patterns

**Event envelope structure (D2):** fixed schema `v1`, validated on every ingress. No new top-level fields without a `v2` bump.

**Between workflows:** workflows do **not** call each other via `workflow_call`. Cross-phase transitions happen via Jira auto-transitions (human-owned Jira Automation rules per FR40) that re-emit a `repository_dispatch`. This keeps every run independently resumable and concurrency-grouped.

**Between TS modules inside a workflow:** pure functions by default. Side effects (network calls, file writes) live in `src/lib/io/*` and are the last thing called in the agent flow. Keeps dry-run trivial (D8).

**Logging levels:**

- `log.debug`: verbose, disabled in production runs; enabled only under `FERRY_DEBUG=1`.
- `log.info`: one line per phase boundary (envelope validated, prompt assembled, LLM call start/end, write start/end).
- `log.warn`: recoverable anomalies (retryable failures, missing optional fields).
- `log.error`: terminal failures — always accompanied by a `FerryError` subclass and taxonomy class.

No `console.log` in any committed code (ESLint rule enforces).

---

### Process Patterns

**Every agent entry point follows the same skeleton:**

```typescript
// src/agents/<role>/index.ts
import { loadConfig } from "../../lib/config";
import { validateEnvelope } from "../../lib/envelope";
import { loadState, writeState } from "../../lib/state";
import { preflight } from "../../lib/preflight";
import { emitAudit } from "../../lib/audit";
import { mapError } from "../../lib/error-taxonomy";
import { scanForSecrets } from "../../lib/secret-scan";
import { routeModel, invoke } from "../../lib/llm";

export async function main(): Promise<void> {
  const cfg = loadConfig();
  const envelope = validateEnvelope(process.env.FERRY_EVENT!);
  const runId = envelope.event_id;
  const start = Date.now();

  try {
    await preflight(envelope);                 // FR32
    const state = await loadState(envelope);   // D1
    // ... role-specific work, returns usage + output ...
    await scanForSecrets(output);              // D6
    await writeState({ ...state, /* updated */ });
    // ... external writes via src/lib/io/* ...
    await emitAudit({ outcome: "success", usage, runId, start });
  } catch (e) {
    const mapped = mapError(e);                // D11
    await mapped.applyLabels(envelope);
    await emitAudit({ outcome: mapped.outcome, runId, start, error: mapped.toLog() });
    process.exit(1);
  }
}
```

**All external writes pass through `src/lib/io/*` wrappers that:**

1. Check idempotency (scan last N items for marker `[ferry:<role>:<run_id>]`; skip if present).
2. Pre-scan output for secrets (D6).
3. Append idempotency marker to the outgoing payload.
4. Retry on `transient` errors with exponential backoff (max 3, jittered).

**Retry policy:** max 3 attempts, base delay 2s, jitter ±50%, exponential factor 2. Cumulative wait ≤ 14s. After 3 failures, escalate to `unknown` error class.

**LLM call budget enforcement:**

- Before calling: compute estimated input-token cost; if adding it to the running session cost would exceed `FERRY_MAX_COST_EUR_PER_RUN` (default 10€), abort with `spend-cap` class.
- After calling: add actual usage to session cost; if running total exceeds the cap mid-run, no further calls are made.
- Per-ticket daily cap (FR7): separate check in `src/lib/budget/daily.ts` via `ferry-audit` aggregation.

---

### Enforcement Guidelines

**All AI agents (including the 4 Ferry agents AND any coding assistant building Ferry itself) MUST:**

1. Use the agent-entry-point skeleton above verbatim. Tests assert structural invariants (envelope validated before any IO; audit emitted under all outcomes).
2. Route every external write through `src/lib/io/*`. Direct calls to `@octokit/rest` or Jira fetch outside of `src/lib/io/` fail CI via ESLint rule `no-restricted-imports`.
3. Write an idempotency marker on every external write. Tests assert presence.
4. Validate every JSON artifact (state, envelope, audit line) against its schema. No ad-hoc `JSON.parse` outside of schema-validating helpers.
5. Never introduce a new label outside the allowlist. CI `labels-allowlist.test.ts` asserts.
6. Never add a `default` export, a `console.log`, or a `utils.ts`. ESLint rules enforce.
7. Add a `v{N}` schema bump when changing any schema; never edit `v1` in place once shipped.
8. Preserve commit trailer idempotency marker in every commit message (Developer/Iterator; verified by a pre-commit CI step).

**Pattern enforcement surfaces:**

- ESLint config: `no-default-export`, `no-console`, `no-restricted-imports`, custom rule `ferry/require-idempotency-marker` on string templates in `src/lib/io/*`.
- Vitest: structural tests on entry-point skeleton, schema validation smoke tests, labels allowlist.
- CI: `tsc`, ESLint, vitest, gitleaks, CODEOWNERS test, dry-run E2E (per D8).
- Code review checklist in `.github/pull_request_template.md` for human-authored PRs to Ferry.

**Updating patterns:** a pattern change is an ADR in `docs/adr/NNNN-*.md` with PR + review. No ad-hoc drift.

---

### Anti-Patterns (reject in review)

- Agent fetches a file from outside the workspace ("let me check ~/.aws/credentials" — prompt injection exfiltration).
- Agent proposes a workflow-file edit (rejected by CODEOWNERS; must never reach review).
- Direct `fetch()` or `@octokit/rest` call in `src/agents/*/` — must route through `src/lib/io/`.
- String concatenation of ticket content into system prompt — must use delimiter helpers in `src/lib/prompt/delimit.ts`.
- `as any` casts in schema-validated code paths (ESLint rule `@typescript-eslint/no-explicit-any` error).
- Silent try/catch that drops errors without emitting an audit line (`no-empty-catch` rule).
- Adding a new provider wrapper without updating `pricing.ts` (unit test fails).
- Committing with `--no-verify` to bypass gitleaks or CODEOWNERS (repo branch protection enforces).

## Project Structure & Boundaries

### Complete Project Directory Structure

```
ferry/
├── README.md                              # FR52 — canonical setup guide
├── LICENSE                                # open-source license (TBD MIT/Apache-2.0)
├── package.json
├── package-lock.json
├── tsconfig.json                          # strict, ES2023, nodenext
├── .eslintrc.cjs                          # no-default-export, no-console, ferry/* rules
├── .prettierrc
├── .gitignore
├── .nvmrc                                 # pinned Node version
├── .gitleaks.toml                         # secret-scan rules + allowlist
├── .editorconfig
│
├── .github/
│   ├── CODEOWNERS                         # C2 — protects .github/**, src/schemas/**, prompt.*.md
│   ├── pull_request_template.md           # human PR checklist (Ferry's own repo)
│   ├── dependabot.yml                     # NFR-S7 — Dependabot with SHA-pinning preserved
│   ├── actions/
│   │   ├── ferry-concurrency/             # D3 — shared concurrency key derivation
│   │   │   └── action.yml
│   │   ├── ferry-envelope-validate/       # D2 — reject malformed envelopes before run
│   │   │   └── action.yml
│   │   └── ferry-emit-audit/              # D5 — post one JSON line to ferry-audit on exit
│   │       └── action.yml
│   └── workflows/
│       ├── refine.yml                     # FR8–FR13 + FR1
│       ├── dev.yml                        # FR14–FR18
│       ├── review.yml                     # FR19–FR24 + green-CI gate (FR19)
│       ├── iterate.yml                    # FR25–FR29
│       ├── reconciler.yml                 # FR50–FR51, schedule: '*/15 * * * *'
│       ├── audit-daily.yml                # FR45 — provider usage poll, schedule: daily
│       └── ferry-ci.yml                   # typecheck / lint / vitest / gitleaks / codeowners-test / dry-run E2E
│
├── src/
│   ├── agents/
│   │   ├── refiner/
│   │   │   ├── index.ts                   # entry point (uses skeleton from patterns)
│   │   │   ├── refine.ts                  # plan → audit → batch sub-task creation (FR9, FR10)
│   │   │   ├── prompt.v0_0_1.md           # D7
│   │   │   ├── schema.ts                  # output shape validated with Ajv
│   │   │   └── refine.test.ts
│   │   ├── developer/
│   │   │   ├── index.ts
│   │   │   ├── develop.ts                 # branch + patch + draft PR (FR15, FR16)
│   │   │   ├── context.ts                 # D4 — selective file inclusion from Refiner touch_paths
│   │   │   ├── prompt.v0_0_1.md
│   │   │   ├── schema.ts                  # expects unified diff + summary
│   │   │   ├── develop.test.ts
│   │   │   └── context.test.ts
│   │   ├── reviewer/
│   │   │   ├── index.ts
│   │   │   ├── review.ts                  # CI check + findings + fingerprints (FR19–FR24)
│   │   │   ├── prompt.v0_0_1.md
│   │   │   ├── schema.ts                  # findings[] with rule_id from taxonomy
│   │   │   └── review.test.ts
│   │   └── iterator/
│   │       ├── index.ts
│   │       ├── iterate.ts                 # apply findings, detect resurgent (FR25–FR29)
│   │       ├── prompt.v0_0_1.md
│   │       ├── schema.ts
│   │       └── iterate.test.ts
│   │
│   ├── reconciler/
│   │   ├── index.ts                       # cron entry point
│   │   ├── reconcile.ts                   # column scan + ULID dedupe + re-dispatch (FR50, FR51)
│   │   └── reconcile.test.ts
│   │
│   ├── cost-governance/
│   │   ├── daily-check.ts                 # FR45 — 50% soft alert cron
│   │   └── daily-check.test.ts
│   │
│   ├── lib/
│   │   ├── config/
│   │   │   ├── index.ts                   # loadConfig() — reads env + .ferry/config.yml
│   │   │   └── config.test.ts
│   │   ├── envelope/
│   │   │   ├── index.ts                   # D2 — validate + parse
│   │   │   ├── dedupe.ts                  # D2 — checkAndClaim via ferry-processed-events issue
│   │   │   ├── envelope.test.ts
│   │   │   └── dedupe.test.ts
│   │   ├── state/
│   │   │   ├── index.ts                   # D1 — loadState, writeState (.ferry/state.json)
│   │   │   └── state.test.ts
│   │   ├── preflight/
│   │   │   ├── index.ts                   # FR32 — PR open, SHA match, column match
│   │   │   ├── freshness.ts               # D3 — assertFreshOrSupersede, anti-starvation
│   │   │   ├── preflight.test.ts
│   │   │   └── freshness.test.ts
│   │   ├── concurrency/
│   │   │   └── key.ts                     # D3 — group key derivation
│   │   ├── llm/
│   │   │   ├── index.ts                   # route(role, labels), invoke(provider, prompt)
│   │   │   ├── anthropic.ts               # @anthropic-ai/sdk wrapper
│   │   │   ├── google.ts                  # @google/genai wrapper
│   │   │   ├── openai.ts                  # openai wrapper
│   │   │   ├── pricing.ts                 # per-1M-token rates → cost_eur
│   │   │   ├── budget.ts                  # per-run + per-ticket-daily caps (FR7)
│   │   │   └── llm.test.ts
│   │   ├── prompt/
│   │   │   ├── delimit.ts                 # NFR-S1 — untrusted content delimiters
│   │   │   ├── render.ts                  # {{placeholder}} interpolation
│   │   │   └── prompt.test.ts
│   │   ├── secret-scan/
│   │   │   ├── index.ts                   # D6 — gitleaks invocation, pre-write gate
│   │   │   └── secret-scan.test.ts
│   │   ├── fingerprint/
│   │   │   ├── index.ts                   # D12 — SHA-256 of normalized finding
│   │   │   ├── resurgence.ts              # D1 — detect resurgent fingerprints vs iteration_history
│   │   │   ├── fingerprint.test.ts
│   │   │   └── resurgence.test.ts
│   │   ├── error-taxonomy/
│   │   │   ├── index.ts                   # D11 — FerryError classes + label mapping
│   │   │   └── error-taxonomy.test.ts
│   │   ├── audit/
│   │   │   ├── index.ts                   # D5 — emit one comment to ferry-audit issue
│   │   │   └── audit.test.ts
│   │   ├── locale/
│   │   │   ├── detect.ts                  # D9 — fr/en heuristic
│   │   │   └── locale.test.ts
│   │   ├── diff/
│   │   │   ├── apply.ts                   # git apply --index + retry
│   │   │   └── apply.test.ts
│   │   ├── io/
│   │   │   ├── jira.ts                    # Jira REST v3 wrappers (comment, sub-task, label, transition)
│   │   │   ├── github.ts                  # @octokit/rest wrappers (PR body, comment, label, check)
│   │   │   ├── idempotency.ts             # marker scan + append
│   │   │   ├── retry.ts                   # exponential backoff + jitter
│   │   │   └── io.test.ts
│   │   └── ulid/
│   │       └── index.ts                   # thin re-export; seeded for tests
│   │
│   ├── schemas/
│   │   ├── state.v1.schema.json           # D1 — authoritative
│   │   ├── event.v1.schema.json           # D2 — authoritative
│   │   ├── audit.v1.schema.json           # D5 — authoritative
│   │   └── schemas.test.ts                # schema-file self-validation
│   │
│   ├── labels/
│   │   ├── allowlist.ts                   # closed set (patterns)
│   │   └── labels-allowlist.test.ts       # CI gate
│   │
│   └── __fixtures__/
│       ├── jira/                          # recorded Jira API responses
│       ├── github/                        # recorded GitHub API responses
│       └── llm/                           # recorded LLM outputs for contract tests
│
├── tests/
│   └── e2e/
│       ├── refine-happy.e2e.test.ts       # dry-run E2E (FERRY_DRY_RUN=1)
│       ├── dev-happy.e2e.test.ts
│       ├── review-happy.e2e.test.ts
│       ├── iterate-happy.e2e.test.ts
│       ├── resurgent-escalation.e2e.test.ts
│       ├── secret-scan-hit.e2e.test.ts
│       ├── codeowners-protection.e2e.test.ts   # NFR-S3 verified-by-test
│       └── labels-allowlist.e2e.test.ts
│
├── scripts/
│   ├── copy-schemas-to-examples.ts        # pre-commit: mirror src/schemas → examples/
│   └── validate-workflow-pins.ts          # assert all Actions dep SHAs are pinned (NFR-S7)
│
├── examples/
│   ├── chancellerie-setup.md              # PRD — full pilot walkthrough
│   ├── state.v1.schema.json               # mirror of src/schemas/state.v1.schema.json
│   ├── event.v1.schema.json               # mirror
│   ├── audit.v1.schema.json               # mirror
│   ├── ferry-audit.jsonl                  # ~20 anonymized sample audit lines
│   └── prompt-templates/
│       ├── refiner.v0_0_1.md
│       ├── developer.v0_0_1.md
│       ├── reviewer.v0_0_1.md
│       └── iterator.v0_0_1.md
│
├── docs/
│   ├── adr/
│   │   ├── 0001-state-artifact-in-branch-json.md        # mirrors D1
│   │   ├── 0002-single-issue-audit-stream.md             # mirrors D5
│   │   ├── 0003-custom-minimal-agent-harness.md          # mirrors D4
│   │   ├── 0004-fingerprint-scheme.md                    # mirrors D12
│   │   └── 0005-language-policy-source-mirror.md         # mirrors D9
│   ├── prd.md                             # existing — moved here? or kept root per current layout
│   └── inputs/                            # pre-PRD inputs (existing)
│
├── dist/                                  # tsc output; .gitignored but shipped via release
└── .ferry/                                # consumer-repo artifact (NOT in Ferry's own repo)
    ├── state.json                         # D1 — per-ticket state artifact (created by agents)
    └── config.yml                         # optional overrides (FR53)
# Note: .ferry/processed_events.json removed from the design (round-2 patch).
# Event dedupe now lives in the bot-owned `ferry-processed-events` issue — see D2.
```

---

### Architectural Boundaries

**External boundaries (trust surfaces):**

1. **Jira Cloud** — authoritative for ticket state; Ferry reads via REST v3; writes only labels, comments, sub-tasks. Never writes column transitions (FR40). Untrusted content: title, description, comments, sub-task fields, attachments metadata.
2. **GitHub** — SCM + runtime + audit surface. Trust boundary is the GitHub App's OAuth scope (NFR-S6: contents:write, pull-requests:write, issues:write, metadata:read). No `workflow:write`, no `admin`, no `actions:write`.
3. **LLM providers** (Anthropic, Google, OpenAI) — stateless request/response. Trust: API keys in GitHub secrets only. Rate + cost boundaries enforced in `src/lib/llm/budget.ts`.
4. **`.ferry/` directory in the consumer repo** — internal state persistence boundary. Agents own this directory; humans should not edit it (documented in README).

**Internal module boundaries (enforced by ESLint `no-restricted-imports`):**

| From | May import | May NOT import |
|------|-----------|----------------|
| `src/agents/*` | `src/lib/*` | other `src/agents/*` (keep phases independent); `@octokit/rest` or `fetch` directly |
| `src/reconciler/*` | `src/lib/*` | `src/agents/*` (reconciler never runs agent logic inline) |
| `src/lib/llm/*` | `src/lib/{config,prompt,error-taxonomy}` | `src/agents/*`, `src/lib/io/*` (LLM layer is pure compute) |
| `src/lib/io/*` | `src/lib/{idempotency,secret-scan,retry,error-taxonomy,config}` | `src/agents/*`, `src/lib/llm/*` |
| `src/schemas/*` | — (JSON only) | — |
| `src/labels/*` | — | — |

**Phase boundaries (runtime):**

- Each phase runs in a fresh `ubuntu-latest` runner (NFR-S4, PRD § CI/CD Pipeline Integrity "Runner isolation").
- Cross-phase data travels only via: (a) state artifact in-branch, (b) event envelope at next dispatch, (c) Jira ticket fields, (d) PR comments/body.
- No in-memory, filesystem (other than `.ferry/`), or side-channel transfer between phases.

**Concurrency boundary:** `ferry-${ticket_key}` group at workflow level. One run per ticket at any time across ALL Ferry workflows for that ticket (D3).

---

### Requirements → Structure Mapping

**Agent-phase mapping:**

| Capability area | Files |
|-----------------|-------|
| FR1–FR7 Ingestion & Triggering | `src/lib/envelope/*`, `.github/actions/ferry-envelope-validate/`, `.github/workflows/*` `on: repository_dispatch`, `src/reconciler/*` |
| FR8–FR13 Refiner | `src/agents/refiner/*`, `.github/workflows/refine.yml` |
| FR14–FR18 Developer | `src/agents/developer/*`, `src/lib/diff/apply.ts`, `.github/workflows/dev.yml` |
| FR19–FR24 Reviewer | `src/agents/reviewer/*`, `src/lib/fingerprint/*`, `.github/workflows/review.yml` |
| FR25–FR29 Iterator | `src/agents/iterator/*`, `src/lib/fingerprint/*`, `.github/workflows/iterate.yml` |
| FR30–FR33 State | `src/lib/state/*`, `src/schemas/state.v1.schema.json`, `src/lib/preflight/*`, `.github/actions/ferry-concurrency/` |
| FR34–FR40 Human Control | label dispatch in `src/lib/envelope/*`, label allowlist in `src/labels/*`, manual cancel via GHA UI (no code) |
| FR41–FR44 Observability | `src/lib/audit/*`, `src/schemas/audit.v1.schema.json`, `.github/actions/ferry-emit-audit/` |
| FR45–FR49 Cost & Safety | `src/cost-governance/*`, `src/lib/llm/budget.ts`, `src/lib/secret-scan/*`, `.github/CODEOWNERS`, `.github/workflows/audit-daily.yml` |
| FR50–FR51 Reconciler | `src/reconciler/*`, `.github/workflows/reconciler.yml` |
| FR52–FR54 Setup & Config | `README.md`, `examples/chancellerie-setup.md`, `src/lib/config/*` |

**Cross-cutting concerns → location:**

| Concern | Location |
|---------|----------|
| Concurrency & idempotency | `.github/actions/ferry-concurrency/`, `src/lib/io/idempotency.ts` |
| State integrity | `src/lib/state/`, `src/lib/preflight/`, `src/schemas/state.v1.schema.json` |
| Secret scanning | `src/lib/secret-scan/`, `.gitleaks.toml`, `.github/workflows/ferry-ci.yml` |
| Model routing | `src/lib/llm/index.ts` (route), workflow files pin model IDs |
| Cost telemetry | `src/lib/llm/{pricing,budget}.ts`, `src/lib/audit/`, `src/cost-governance/` |
| Audit logging | `src/lib/audit/`, `.github/actions/ferry-emit-audit/` |
| Error taxonomy | `src/lib/error-taxonomy/` |
| Security perimeter | `.github/CODEOWNERS`, `.gitleaks.toml`, `scripts/validate-workflow-pins.ts`, `tests/e2e/codeowners-protection.e2e.test.ts` |
| Webhook resilience | `src/reconciler/`, `.github/workflows/reconciler.yml` |
| Finding fingerprinting | `src/lib/fingerprint/` |

---

### Integration Points

**Inbound events:**

1. Jira Automation → GitHub `repository_dispatch` (per Jira column / label / comment pattern). One Jira Automation rule per trigger pattern, documented in `examples/chancellerie-setup.md`.
2. Scheduled cron → `.github/workflows/{reconciler,audit-daily}.yml`.
3. Human-triggered: `workflow_dispatch` inputs on any workflow (for manual smoke tests; not exposed in ops docs).

**Outbound writes:**

| Target | Wrapper | Idempotency? | Secret-scanned? |
|--------|---------|--------------|-----------------|
| Jira comment | `src/lib/io/jira.ts:postComment` | ✅ | ✅ |
| Jira sub-task | `src/lib/io/jira.ts:createSubtask` | ✅ | ✅ |
| Jira label | `src/lib/io/jira.ts:addLabel` | ✅ (no-op if already applied) | — |
| GitHub PR body | `src/lib/io/github.ts:updatePRBody` | ✅ | ✅ |
| GitHub PR comment | `src/lib/io/github.ts:postPRComment` | ✅ | ✅ |
| GitHub branch commit | `src/lib/io/github.ts:commitAndPush` | ✅ (marker in trailer) | ✅ (pre-commit) |
| GitHub label | `src/lib/io/github.ts:addLabel` | ✅ | — |
| `ferry-audit` issue comment | `src/lib/audit/index.ts:emit` | ✅ | ✅ |

All wrappers also: log start/end at `log.info`, retry on `transient` class up to 3×, raise taxonomized `FerryError` on terminal failure.

**Data flow (happy path, refine phase):**

```
Jira column move → Jira Automation rule → POST /repos/<o>/<r>/dispatches
  → refine.yml on: repository_dispatch
  → validate-envelope (action) → concurrency key set → setup-node + npm ci
  → src/agents/refiner/index.ts main()
    → loadConfig() → validateEnvelope() → preflight() → loadState()
    → detectLocale(ticket) → render(prompt, ticket) → delimit(ticket content)
    → llm.invoke(gemini-2.5-flash, prompt) → parse → Ajv validate
    → scanForSecrets(output)
    → writeState({iteration:0, phase:"refining", ...}) → git commit .ferry/state.json
    → jira.postComment(auditComment) → jira.createSubtasks(batch) → jira.addLabel("ferry:ready")
    → emitAudit({outcome:"success", usage, cost_eur})
  → exit 0
```

---

### File Organization Patterns

**Configuration files:** root-level only (`package.json`, `tsconfig.json`, `.eslintrc.cjs`, `.prettierrc`, `.gitleaks.toml`). No nested config scattered across subdirectories.

**Source organization:** strict `agents / lib / schemas / labels / __fixtures__` split. `agents/` = role-specific orchestration; `lib/` = reusable primitives; `schemas/` = authoritative JSON Schemas; `labels/` = closed set of label names.

**Test organization:** unit tests co-located (`*.test.ts`); E2E tests under `tests/e2e/` with `.e2e.test.ts` suffix (excluded from unit runs via vitest config).

**Asset organization:** no static assets. Prompt templates and schemas are the only "assets" — both versioned and under `src/`.

---

### Development Workflow Integration

**Development server:** N/A (no server). Local iteration uses `FERRY_DRY_RUN=1 tsx src/agents/<role>/index.ts` with a ticket fixture file. No hot reload; no localhost.

**Build process:**

- `npm run build` = `tsc -p .` → `dist/`.
- Workflow files use `actions/setup-node@<sha>` + `npm ci` + `npm run build` on every run. No pre-built artifacts checked in.
- `scripts/copy-schemas-to-examples.ts` runs as pre-commit hook to keep `examples/*.schema.json` in sync with `src/schemas/*.schema.json`.

**Deployment:** there is no deployment. "Release" = tag a commit SHA. Consumers copy workflow files from that SHA. The Ferry repo itself ships no binary artifact.

**CI (`.github/workflows/ferry-ci.yml` on Ferry's own PRs):**

1. `actions/checkout@<sha>`
2. `actions/setup-node@<sha>` (with `.nvmrc`)
3. `npm ci`
4. `npm run typecheck` (tsc --noEmit)
5. `npm run lint` (ESLint + Prettier check)
6. `npm test` (vitest unit)
7. `npm run test:contract` (vitest fixtures)
8. `npm run test:e2e:dry` (FERRY_DRY_RUN=1)
9. `gitleaks detect --source . --verbose`
10. `tsx scripts/validate-workflow-pins.ts` (all Actions SHAs pinned)
11. CODEOWNERS + labels-allowlist E2E assertions

## Architecture Validation Results

### Coherence Validation ✅

**Decision compatibility.** The twelve decisions (D1–D12) are mutually consistent and layered: D2 (envelope) feeds D3 (concurrency key); D1 (state) is read/written by D4 (harness), D11 (error mapper), D12 (fingerprints); D5 (audit) runs under `if: always()` regardless of D11 outcome; D6 (secret-scan) gates every write wrapped by `src/lib/io/*`. No decision contradicts another.

**Pattern consistency.** Naming patterns (kebab-case files, snake_case JSON, closed-set labels), structure patterns (one concern per directory, no `utils.ts`), and process patterns (agent-entry-point skeleton, all writes through `src/lib/io/*`) reinforce the enforcement surfaces (ESLint rules, vitest structural tests, CODEOWNERS). The anti-patterns are directly rejectable in review.

**Structure alignment.** The directory tree allocates every cross-cutting concern to exactly one location; every FR maps to named files in the "Requirements → Structure Mapping" table; module import boundaries are encodable as `no-restricted-imports` rules.

---

### Requirements Coverage Validation ✅

**Functional Requirements (54 FRs):** all 54 FRs map to specific files/modules in the mapping table above. Spot-checks:

- FR4 (ULID event_id) → `src/lib/ulid/` + D2 envelope.
- FR5 (dedupe) → `src/lib/envelope/dedupe.ts` + bot-owned `ferry-processed-events` issue (see D2 round-2 patch) + idempotency markers on writes.
- FR17 (critical-model routing) → `src/lib/llm/index.ts:routeModel()` reads ticket labels.
- FR22 (fingerprinting) → `src/lib/fingerprint/` + D12 SHA-256 scheme.
- FR27 (resurgent escalation) → Reviewer compares new fingerprints against state artifact's prior iteration; D11 `oscillation` class.
- FR33 (cross-workflow concurrency) → D3 shared composite action + top-of-file `concurrency:` block on every workflow.
- FR47 (pre-write secret scan) → D6 + `src/lib/io/*` wrappers invoke `scanForSecrets` before every write.
- FR48 (CODEOWNERS on `.github/**`) → `.github/CODEOWNERS` + E2E test `codeowners-protection.e2e.test.ts`.
- **FR49 (tool denylist):** satisfied by construction — the D4 custom harness operates the LLM in completion mode with structured JSON output only. It exposes no tool-use interface to the model. There is nothing to deny because nothing is offered. For Developer/Iterator specifically: the model returns a unified diff in a delimited block, applied by `src/lib/diff/apply.ts` — the model never invokes shell, file-system, or network tools directly. Documented explicitly as a note in D4.
- FR50–FR51 (reconciler + dedupe) → `src/reconciler/` + `.github/workflows/reconciler.yml`.
- FR54 (model ID pinning + inline rollback) → D7 + workflow-file comment convention.

**Non-Functional Requirements:**

| Category | Coverage |
|----------|----------|
| **Performance** (NFR-P1 to P5) | ✅ Structurally supported: GHA ephemeral runners + minimal harness + pinned Node give deterministic latency; concurrency bounds match NFR-P5; reconciler is a single scheduled workflow with bounded Jira queries |
| **Security** (NFR-S1 to S8) | ✅ S1 via `src/lib/prompt/delimit.ts`; S2 via D6 + `src/lib/io/*`; S3 via CODEOWNERS + E2E test; S4 via D4 (no tool interface); S5 via GitHub secrets only; S6 via GitHub App minimal scopes documented in README; S7 via `scripts/validate-workflow-pins.ts` + Dependabot; S8 via pilot monitoring (not architectural) |
| **Reliability** (NFR-R1 to R6) | ✅ R1 via reconciler; R2 via idempotency markers + tests; R3 via D3 concurrency; R4 via D11 `spend-cap` class + per-provider scope; R5 via preflight invariants; R6 via iteration cap + D12 fingerprints |
| **Integration** (NFR-I1 to I5) | ✅ Sole API surfaces via `src/lib/io/{jira,github}.ts`; envelope versioning in D2; Jira tier requirement in README |
| **Cost** (NFR-C1 to C4) | ✅ C1 external (documented pre-req); C2/C3 measured in audit; C4 via `.github/workflows/audit-daily.yml` + `src/cost-governance/` |
| **Observability** (NFR-O1 to O4) | ✅ D5 emits within workflow exit step; Jira-comment-per-run via D11 error mapping; NFR-O4 two-bookmark debuggability = `ferry-audit` issue + Jira ticket |
| **Privacy** (NFR-D1 to D3) | ⚠️ D1 disclosed in README (architectural pre-req, not implementation); D2 satisfied by no Ferry-owned store; **D3 provider-disable hook** — mechanism added below as architectural note |
| **Maintainability** (NFR-M1 to M5) | ✅ M1 no long-running processes; M2 first-setup scripted; M3 single-PR model rollback via inline comments in workflow files; M4 audit-issue surface; M5 re-copy upgrade path |

**Architectural note on NFR-D3 (provider-disable hook):** `src/lib/llm/index.ts:routeModel()` returns a `{provider, modelId}` tuple. If the required provider secret (`FERRY_ANTHROPIC_KEY`, `FERRY_GOOGLE_AI_KEY`, `FERRY_OPENAI_KEY`) is empty, `loadConfig()` omits that provider; `routeModel()` then falls through to a role-specific fallback documented in the workflow file comments, or — if no fallback is configured — fails fast with a `state-invariant` class, labels `ferry:paused`, and posts a Jira comment. Consumers disable a provider by deleting its secret; no code change required. Fallback chains per role should be documented in `README.md` (operational concern, not code).

---

### Implementation Readiness Validation ✅

**Decision completeness.** All 12 decisions have rationale, options-considered, and affected-FR lists. No TBDs remain on the critical path. OQ5/OQ8/OQ10 are closed; OQ2/OQ6/OQ7/OQ9 are explicitly deferred with documented fallbacks.

**Structure completeness.** Every directory and file is named with its responsibility; the module import boundary table eliminates common layering mistakes; the data-flow diagram (refine happy path) is concrete enough for a junior engineer to follow.

**Pattern completeness.** Eight MUST rules + ESLint/vitest/CI enforcement surfaces + anti-pattern list cover the realistic conflict surface. The agent-entry-point skeleton makes any role implementation a fill-in-the-blank exercise rather than a design exercise.

---

### Gap Analysis

**Critical gaps (block implementation):** **none identified.**

**Important gaps (address during implementation, not blocking):**

1. **Provider fallback chain documentation.** NFR-D3 hook described above, but the per-role fallback policy (e.g., "if Gemini Pro unavailable, Developer falls back to Sonnet? to Flash? to pause?") is an operator decision belonging in README § Configuration Surface. Architecture provides the mechanism; operator provides the policy.
2. **Jira-column → workflow mapping.** FR1 requires column-to-phase mapping but the actual column names on the `CHAN` project are an operator concern. Document in `examples/chancellerie-setup.md` as part of the first implementation story.
3. **Reviewer-output rubric and prompt craft.** D7 pins prompt versioning but the content of Reviewer's prompt (fingerprint-producing structure, taxonomy enforcement) is implementation-phase work. The rule_id taxonomy is fixed here (`missing-test`, `unhandled-error`, `type-mismatch`, `security-secret`, `logic-bug`, `nit-style`, `other`) but prompt wording iterates during week-1 audit (OQ6).
4. **Dedupe issue pruning.** Resolved in round-2 patch — dedupe now lives in the `ferry-processed-events` issue (D2). Daily reconciler deletes comments >24h old. `src/lib/envelope/dedupe.ts` owns the read/write/prune logic with tests.

**Nice-to-have gaps (post-MVP):**

- A first-class diagram of the state machine (phase transitions) in docs/adr/0001.
- A runnable local harness simulator without GHA (`scripts/run-local.sh`, already scoped to Growth per PRD).
- Prometheus/OTel export from `ferry-audit` (Vision tier).
- Multi-model Reviewer (Vision tier).

---

### Validation Issues Addressed

- **FR49 tool denylist** was at risk of being under-specified. Resolved by documenting D4's by-construction satisfaction: no tool interface offered to the model, so no denylist enforcement code path needed. This is a stronger guarantee than a runtime denylist would be.
- **NFR-D3 provider-disable** was implicit. Resolved by specifying the `loadConfig()` + `routeModel()` mechanism above.
- **OQ5 state artifact** resolved in D1 (`.ferry/state.json`).
- **OQ8 attachment handling** resolved in D10 (detect + list, do not process).
- **OQ10 language policy** resolved in D9 (preserve source language in Jira outputs; English internals).

---

### Architecture Completeness Checklist

**✅ Requirements Analysis**

- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed (high, 54 FRs, ~12 components)
- [x] Technical constraints identified (GHA-only, no DB, three LLM providers)
- [x] Cross-cutting concerns mapped (10 concerns → specific modules)

**✅ Architectural Decisions**

- [x] 12 critical/important decisions documented with rationale
- [x] Technology stack fully specified (TS strict + Node LTS + specific SDKs)
- [x] Integration patterns defined (workflow → Jira/GitHub/LLM via `src/lib/io/*`)
- [x] Performance considerations addressed (ephemeral runners + budgeted per-run cost)

**✅ Implementation Patterns**

- [x] Naming conventions established (files, symbols, JSON, workflows, branches, labels, commits)
- [x] Structure patterns defined (one concern per dir, no grab-bags, schemas authoritative)
- [x] Communication patterns specified (no workflow-to-workflow calls; envelope + Jira only)
- [x] Process patterns documented (entry-point skeleton, retry policy, budget enforcement, error taxonomy)

**✅ Project Structure**

- [x] Complete directory tree defined with all files and responsibilities
- [x] Internal module boundaries encoded as import rules
- [x] Integration points mapped (inbound events + outbound writes + data flow)
- [x] FR → file mapping complete for all 54 FRs

---

### Architecture Readiness Assessment

**Overall Status:** ✅ READY FOR IMPLEMENTATION

**Confidence Level:** **High.** The architecture closes all PRD-critical open questions, maps every FR to specific code locations, and encodes the non-negotiable invariants (concurrency, idempotency, secret scan, CODEOWNERS, state schema) into enforcement surfaces (ESLint, vitest, CI, branch protection). The scope is sized appropriately for v0.0.1: a minimal custom TS harness over GitHub Actions, no frameworks, no infrastructure.

**Key strengths:**

- **Correctness invariants are enforced by tests**, not by convention — CODEOWNERS protection, labels allowlist, idempotency markers, and envelope schema all have dedicated tests.
- **No framework churn risk** — minimal custom harness keeps SDK upgrades scoped.
- **Cost governance is first-class**, not retrofitted — budget module and audit surface are architectural components.
- **State artifact is schema-validated and diffable** (D1) — debuggable via git history.
- **Every cross-cutting concern has exactly one owner directory** — no ambiguity on where logic belongs.

**Areas for future enhancement (Growth / Vision):**

- Provider-agnostic LLM abstraction (PRD explicitly v0.1).
- Reusable template repo for second-project onboarding (Growth).
- Rich dashboards built on top of `ferry-audit` JSON stream (Vision).
- Multi-project / multi-tenant / pluggable-provider matrix (Vision).

---

### Implementation Handoff

**AI-agent guidelines for implementers (both Ferry's own agents once operational, and any coding assistant building Ferry now):**

- Follow all 12 decisions (D1–D12) exactly as documented. Any deviation requires an ADR PR.
- Use the agent-entry-point skeleton verbatim; structural tests enforce it.
- Every external write routes through `src/lib/io/*`. ESLint rule blocks direct SDK imports in `src/agents/*`.
- Validate every JSON artifact against its schema; never `JSON.parse` without Ajv.
- Respect the module import boundary table.
- Bump `v{N}` on any schema change; never edit `v1` in place post-ship.
- The first implementation story is the scaffold (per D4 initialization command + this directory tree).

**First implementation priority (first story in the next BMad step — epics & stories):**

```
Story: Scaffold Ferry repository
- Initialize package.json, tsconfig.json, ESLint, Prettier, vitest
- Commit directory skeleton (empty index.ts + placeholder tests per module)
- Author .github/workflows/ferry-ci.yml with all quality gates
- Author .github/CODEOWNERS protecting .github/**, src/schemas/**, prompt.*.md
- Enable Dependabot with SHA-pin preservation
- Author README.md prerequisites section (NFR-I5 Jira tier, NFR-C1 provider caps)
Acceptance: ferry-ci.yml passes on first PR; no lint errors; CODEOWNERS test asserts
protection; labels-allowlist test passes with the documented closed set.
```

---

## Round-2 Patches Applied (2026-04-23, party-mode gap hunt)

This section records the blocking-severity design changes that landed after an adversarial multi-agent review of the v1 architecture. The patches are integrated into D1, D2, D3, and D4 above — this is the changelog, not a separate decision record.

| Patch | Area | What changed | Driven by |
|-------|------|--------------|-----------|
| **P1** | D1 state schema | Added mandatory `iteration_history[]` (max 4 entries) with `pr_sha`, `fingerprints`, `review_verdict`. Factored fingerprints through `$defs/fingerprintArray`. Added SHA-256 `hash` field per fingerprint. Added state-file cleanup rule on merge. | Amelia B3: FR27 resurgent detection had nowhere to compare against. |
| **P2** | D2 dedupe surface | Removed `.ferry/processed_events.json`. Added bot-owned `ferry-processed-events` issue as the single cross-ticket dedupe surface. Added `src/lib/envelope/dedupe.ts`. 24-hour retention window via daily reconciler. | Winston B2 + Amelia B2: per-branch JSON cannot serialize cross-ticket dedupe. |
| **P3** | D2 ingress | Made `gate-envelope` a dedicated first job (all other jobs `needs:` it). Strict `ticket_key` regex `^[A-Z][A-Z0-9_]+-[0-9]+$` enforced before any side effect. | Winston B1 + Amelia B1: composite validation inside a step runs too late to protect the `concurrency:` group key. |
| **P4** | D3 group key | Hardened `concurrency.group` expression to `startsWith(...) && ticket_key || 'ferry-invalid-payload-sinkhole'`. Sinkhole group collapses all malformed payloads to prevent 500-group-cap exhaustion. | Amelia B1: untrusted payload lands in group expression; Winston's sinkhole insight prevents exhaustion. |
| **P5** | D3 cancel policy | Split `cancel-in-progress` per phase: `true` on Refiner + Reconciler, `false` on Dev / Reviewer / Iterator. | Winston B1: uniform `true` creates state/branch divergence on mid-commit cancellation. |
| **P6** | D3 starvation guard | Added `src/lib/preflight/freshness.ts` with `assertFreshOrSupersede()` called first in every write-phase entry point. Queued stale runs early-exit with `outcome: "superseded"`. | Amelia refinement: split cancel alone creates queue starvation under rapid human input. |
| **P7** | D4 tool-denylist | Replaced "no tool interface = denylist satisfied by construction" with **output-scope enforcement**: Refiner emits `touch_paths[]`; Developer context builder embeds authorized files; `src/lib/diff/apply.ts` rejects out-of-scope hunks. Hard-reject on `.github/**`. `touch_paths` cap: 20 files / 200 KB. | Amelia B4: FR49 claim was false — the model needs file content to produce diffs, but the mechanism and scope enforcement were unspecified. |
| **P8** | D4 diff-apply semantics | Replaced "retry 3× on fail" with regenerate-against-fresh-HEAD (max 3 cycles). `git apply --check` before apply. `git reset --hard` on any failure path. | Winston minor + Amelia I3: patch rejection isn't a transient failure. |
| **P9** | D4 Reviewer variant | Documented the Reviewer's skeleton variant (CI-status branch before LLM call). Both branches must emit audit lines under `if: always()`. | Amelia I4: base skeleton doesn't fit Reviewer; variant needs to be explicit to be enforceable by tests. |

**Non-blocking findings accepted as Growth / implementation-phase work** (tracked for epic ordering, not architectural changes):

- Jira rate-limit `Retry-After` handling in `src/lib/io/retry.ts` (Amelia I8).
- Log sanitizer for NFR-S5 secret redaction (Amelia I7).
- Language-detection heuristic refinement — use `ticket.fields.reporter.locale` before stopword heuristic (Winston #7).
- `schema-validation` error class with bounded reprompt before `needs-human` (Amelia I2).
- Reviewer CI-check allowlist in `.ferry/config.yml` rather than "all checks green" (Winston #9).
- State-file cleanup on merge verified by `no-ferry-state-on-main.test.ts` (Winston #10 — resolved in P1).
- `src/schemas/config.v1.schema.json` for `.ferry/config.yml` (Amelia M2).
- Jira-column → workflow mapping in `.ferry/config.yml.columns` so preflight can assert (Amelia M3).

**Open Questions status:**

- **OQ5** — closed in D1 (in-branch JSON).
- **OQ8** — closed in D10 (detect + list, do not process).
- **OQ10** — closed in D9 (preserve source language in Jira outputs).
- **OQ1** — Jira plan tier: still requires operator verification before first run (Mary G3). Blocks setup, not architecture.
- **OQ2** — Jira custom fields: deferred to Growth.
- **OQ6** — Reviewer rubric: closed in PRD round-2 patch (Paige's rubric).
- **OQ7** — GHA concurrency cost: instrument in audit, revisit before v0.1.
- **OQ9** — second-project onboarding: deferred to Growth.
- **OQ11 (NEW)** — Does FR56's PR-body structure CI check live in the Ferry repo (enforced on consumer PRs by the Ferry GitHub App) or copied into the consumer repo? Consistent with the distribution model → copy-paste. Confirm during first-story scaffolding.

---

## Implementation Reality Note (2026-04-28)

Decisions D2 (event envelope), D4 (LLM harness), and D5 (audit storage) were realised at the **library** level in Epics 1–9. Their **runtime** realisation — the wiring that turns library modules into running agents — is delivered by Epic 10 (see `sprint-change-proposal-2026-04-28.md`). Specifically:

- **D4 LLM harness:** `src/lib/llm/{config,route}.ts` resolves model selection (Epic 1, Story 1.7); the actual `callLlm` HTTP implementation is `src/lib/llm/call.ts` (Epic 10, Story 10-2).
- **D5 audit writer:** `src/lib/audit/index.ts::emitAudit` formats rows (Epic 1, Story 1.5); the workflow integration that supplies real epoch-ms `start_ms` and ULID `run_id` is Story 10-9.
- **Jira REST and GitHub REST clients:** scaffold-only in Epic 1 (`src/lib/io/jira.ts`, `src/lib/io/github.ts`); real implementations in Epic 10 (Stories 10-1, 10-3).
- **Agent orchestration:** `src/agents/*/index.ts` files were empty `export {}` stubs after Epic 9; Epic 10 Stories 10-5..10-8 fill them.

This split was unintentional and is reflected in `sprint-change-proposal-2026-04-28.md` (Section 1, evidence 1–8). The architectural decisions themselves remain valid — only their runtime realisation was deferred unrecorded.
