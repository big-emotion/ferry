# Deferred Work

## Deferred from: code review of 1-5-error-taxonomy-audit-writer-and-labels-allowlist (2026-04-28)

- W1: `audit_issue` is sourced from `${{ vars.FERRY_AUDIT_ISSUE }}` (GitHub repo-level variable). The first-time setup docs in Story 1.8 must document this variable plus `FERRY_OWNER`/`FERRY_REPO` defaults so operators can configure the audit issue before any dispatch workflow runs.
- W2: `start_ms` workflow input uses `${{ github.run_id }}` as a placeholder — produces nonsensical `duration_ms` values until Stories 3.1, 4.1, 5.1, 6.1 pass real agent-entry epoch ms via job outputs.
- W3: Reconciler workflow does not yet emit audit lines. Story 8.3 must wire per-ticket `emit-audit` invocations inside the reconciler sweep (cron runs are per-sweep, but each reconciled ticket should produce its own audit line keyed by the original `event_id`).
- W4: **CI on `main` is failing.** `ferry-ci.yml` and the new `ferry-emit-audit` composite action both call `npm ci`, but `package-lock.json` is gitignored. The two most recent CI runs on `main` (commits `cfc5228`, `087ce3e`) failed at the install step. Resolution: either commit the lockfile (remove the `.gitignore` entry) or switch CI/composite-action installs to `npm install --no-audit --no-fund`. Recommend lockfile route for reproducibility. Should be tackled in Story 1-6 (I/O wrappers) or as a hotfix before any Story 1-5 dispatch workflow runs in production.

## Deferred from: code review of 1-4-cross-workflow-concurrency-action-and-freshness-check (2026-04-27)

- W1: `emit-audit` job runs on `gate-envelope` failure due to `if: always()` — produces misleading audit records for rejected envelopes. Placeholder jobs in `.github/workflows/*.yml`; Story 1.5 implements proper audit logic with correct condition guards.
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
