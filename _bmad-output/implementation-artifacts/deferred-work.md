# Deferred Work

## Deferred from: code review of 1-4-cross-workflow-concurrency-action-and-freshness-check (2026-04-27)

- W1: `emit-audit` job runs on `gate-envelope` failure due to `if: always()` — produces misleading audit records for rejected envelopes. Placeholder jobs in `.github/workflows/*.yml`; Story 1.5 implements proper audit logic with correct condition guards.

## Deferred from: code review of 1-5-error-taxonomy-audit-writer-and-labels-allowlist (2026-04-28)

- `start_ms: ${{ github.run_id }}` produces nonsensical `duration_ms` (~55 years) — known per spec Dev Notes; real epoch ms will be passed from agent entry points in Stories 3.1, 4.1, 5.1, 6.1 [.github/workflows/]
- `jiraCommentTemplate` placeholders `{role}`, `{runId}`, `{runUrl}` never substituted — caller (agent entry point) responsible for substitution in Stories 3.1+ [src/lib/error-taxonomy/index.ts]
- FerryError `context` JSON-serialised into Jira comment template without sanitisation — injection risk; caller responsibility in Stories 3.1+ [src/lib/error-taxonomy/index.ts:12]
- Reconciler `run_id: ${{ github.run_id }}` is numeric, not a ULID — fix when reconciler fully implemented in Story 8.3 [.github/workflows/reconciler.yml:37]
- `npm ci` in composite action on cold cache causes audit step failure — consider pre-bundling in a later infrastructure story [.github/actions/ferry-emit-audit/action.yml:49]
- Multi-repo `github.run_id` marker collision risk — not relevant to current single-repo deployment; revisit if Ferry deployed to multiple repos
- W2: `assertFreshOrSupersede` not wired to audit emit or `process.exit(0)` — caller integration deferred by design to agent entry-point stories (3.1, 4.1, 5.1, 6.1).

## Deferred from: code review of 1-2 + 1-3 (2026-04-27)

- W1: `validateEnvelope` uses `'state-invariant'` error code for envelope failures — Story 1.5 adds full error taxonomy with distinct codes; reclassify then.
- W2: Concurrent claim race in `checkAndClaim` — GitHub Actions `concurrency` key serializes runs per `ticket_key`, making the race window effectively impossible in practice; revisit if architecture changes.
- W3: Stale `.ferry/state.json.tmp` if `writeState` crashes mid-write (ENOSPC) — POSIX `rename` is atomic on Linux; cleanup of partial `.tmp` on `writeFileSync` throw is out of scope for current stories.
- W4: `ticket_key` regex allows single-char project keys (`A-1`) and underscores (Jira doesn't permit these) — tightening is a breaking schema change; defer until schema v2.
- W5: AJV singleton init failure (missing schema file) produces raw Node.js stack trace instead of `FerryError` — defer to Story 1.6 (I/O wrappers).
- W6: `writeState` read-back verification is belt-and-suspenders — spec-mandated atomic write pattern; not a bug but can be simplified once Story 1.6 adds I/O wrappers.

## Deferred from: code review of 1-1-project-scaffold-typescript-config-and-ci-pipeline (2026-04-27)

- W1: Concurrency sinkhole in workflow files only guards `CHAN-` ticket prefix — multi-project support is post-MVP (OQ9 in architecture)
- W2: Each CI job runs `npm ci` independently — no shared node_modules artifact; grows slower as dependencies accumulate
- W3: `reconciler.yml` has no `timeout-minutes` — relevant once placeholder is replaced with real reconciler logic in Story 8.3
- W4: `tsconfig.json` includes test files via `src/**/*` — a separate `tsconfig.test.json` would isolate test compilation from production types
- W5: Dependabot does not group LLM runtime dependencies (`@anthropic-ai/sdk`, `@google/genai`, `openai`) — individual weekly PRs per SDK could land partial upgrades between reviews
