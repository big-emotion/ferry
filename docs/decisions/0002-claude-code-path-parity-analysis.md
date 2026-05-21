# 0002 — claude-code-action Path: Full-Lifecycle Parity Analysis

> **Partially superseded** by the claude-code-path simplification: the Ferry wrapper around `claude-code-action` was removed in favour of a direct call, so the parity/contract layer this analysis describes no longer exists. This document is kept as a historical record.

**Status:** Accepted (analysis backing [ADR-0006](../adr/0006-claude-code-action-execution-path.md))
**Date:** 2026-05-19
**Relates to:** [ADR-0006](../adr/0006-claude-code-action-execution-path.md) (the decision), [ADR-0004](../adr/0004-idempotency-via-comment-markers.md), [ADR-0005](../adr/0005-no-auto-merge-invariant.md)

## Goal

Establish whether a consumer's experience of Ferry-on-Anthropic is **near-identical** whether agents
run via the bundled script or via `claude-code-action`, across the **whole lifecycle**: install →
operate (use cases + edge cases) → maintain → uninstall. Classify every Ferry element as reused,
wrapped, adapted, set aside, or new.

**Hard constraint (caller directive):** the `claude-code-action` path authenticates **exclusively
with `CLAUDE_CODE_OAUTH_TOKEN`** (Claude subscription, obtained via `claude setup-token`). It must
**never** use `ANTHROPIC_API_KEY`. This supersedes ADR-0006 point 6's "reuse ANTHROPIC_API_KEY /
zero new step" provision: the OAuth token is now a **required** install element for the path.

Legend: ✅ reused as-is · 🔁 reused but moved to a deterministic wrapper step · 🟡 adapted (different
mechanism, identical observable outcome) · ⛔ set aside (does not apply) · ➕ new (claude-code path only)

## A. Installation (`ferry-init` → consumer repo)

| Element                                                         | Class | Notes                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub App auth (`FERRY_APP_ID`, `FERRY_PRIVATE_KEY`)           | ✅    | Installation token passed to `claude-code-action` `github_token:`.                                                                                                                                                                                                                        |
| Jira secrets (`FERRY_JIRA_BASE_URL/EMAIL/API_TOKEN`)            | ✅    | Used by wrapper steps / Jira MCP.                                                                                                                                                                                                                                                         |
| Transition IDs (`FERRY_REVIEW/ITER/APPROVE_TRANSITION_ID`)      | ✅    | Read by the post-step that performs FR18/24/28.                                                                                                                                                                                                                                           |
| `FERRY_AUDIT_ISSUE` variable, `ferry.config.json`               | ✅    | Path-agnostic; read by wrapper steps.                                                                                                                                                                                                                                                     |
| 4 Jira automation rules → `repository_dispatch`                 | ✅    | Same trigger; unchanged.                                                                                                                                                                                                                                                                  |
| `gate-envelope` job (`ferry-envelope-validate` composite)       | ✅    | Runs unchanged before either path.                                                                                                                                                                                                                                                        |
| `ANTHROPIC_API_KEY`                                             | ⛔    | **Forbidden** on the claude-code path (caller directive). Still used by the script path / non-Anthropic consumers.                                                                                                                                                                        |
| `CLAUDE_CODE_OAUTH_TOKEN` secret                                | ➕    | **Required** new secret. Obtained via `claude setup-token` (needs a Claude Pro/Max subscription). New mandatory `ferry-init` step for the claude-code path.                                                                                                                               |
| Install-time path choice (wizard)                               | ➕    | `ferry-init` asks which path to install — **(a) bundled script** or **(b) claude-code-action**. The choice is recorded in `ferry.config.json` and materialized in the generated workflows. Either path is selectable at install; the Jira label still switches path per-ticket afterward. |
| Consumer workflow stubs (`ferry-refine/dev/review/iterate.yml`) | 🟡    | A path-select branch (or a sibling `run-agent-cc` job) invokes `claude-code-action` instead of `ferry-run-<role>`; `gate-envelope` job reused verbatim.                                                                                                                                   |
| gitleaks install / secret scan                                  | 🔁    | The in-loop `makeSecretScan` callback has no equivalent inside the action; becomes a **deterministic gate before push** (see §D).                                                                                                                                                         |

**Net install delta:** +1 wizard question (choose path: script vs claude-code), and **when the
claude-code path is chosen**: +1 required secret (`CLAUDE_CODE_OAUTH_TOKEN`, subscription via
`claude setup-token`) and +1 workflow path-select branch. The script path is unchanged. Everything
else is reused.

## B. Operation — the contract layer

| Element                                                                                                   | Class | Notes                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repository_dispatch` + `EventEnvelopeV1` + envelope-validate                                             | ✅    | Identical entry.                                                                                                                                                                                                                                                     |
| `resolveTicketOverrides` (dry-run/skip/read-only/no-auto-transition/base/target/thinking/rubric/max-iter) | 🔁    | Runs as a deterministic pre-step around the action instead of in-process.                                                                                                                                                                                            |
| `model` / `provider` overrides (label/config)                                                             | 🟡    | `provider` is meaningless (Anthropic-only); `model` maps to `claude_args --model` if supported, else fixed by the subscription.                                                                                                                                      |
| Idempotency markers (`byEventId` / `byPrHeadSha`, `checkIdempotencyMarker`)                               | 🔁    | Pre-step skip check + post-step marker emission.                                                                                                                                                                                                                     |
| Audit comment `[ferry:<role>:…]` (ADR-0004)                                                               | 🔁    | Deterministic post-step — **never** the LLM. Reconciler depends on it.                                                                                                                                                                                               |
| Transitions FR18 / FR24 / FR28                                                                            | 🔁    | Post-step using the transition-ID secrets.                                                                                                                                                                                                                           |
| Per-run EUR cap (`maxCostEur` in agent-loop)                                                              | ⛔    | No mid-loop EUR enforcement in the action. Replaced by `--max-turns` + job `timeout-minutes`. Under subscription billing, per-run EUR is conceptually moot — but the **`ferry:spend-cap` edge case loses parity** (see §D).                                          |
| `writeStepSummary` / `appendOutput` (cost telemetry)                                                      | 🟡    | Action emits its own usage; wrapper maps it to the step summary. EUR cost is unknown under subscription billing.                                                                                                                                                     |
| Reconciler (`src/reconciler`)                                                                             | ✅    | Operates on audit comments + Jira columns — path-agnostic, provided the wrapper emits markers (it does).                                                                                                                                                             |
| Daily cost-governance auto-pause (`ferry:paused` at 50% monthly)                                          | 🟡    | Monthly **EUR** spend is not measurable under a subscription token → this backstop is **weakened** on the claude-code path.                                                                                                                                          |
| Prompts: `buildSystem(<role>)` + `prompts/<agent>.extra.md` resolver                                      | ✅    | Reused **verbatim**, concatenated into the action `prompt:` input ahead of the initial prompt. Not via `claude_args --append-system-prompt`: that input is comment-stripped by `claude-code-action`, which deletes Markdown headings (amended for #354). No rewrite. |
| `initialPrompt` builders (ticket block, SUBTASKS, findings, repo tree)                                    | ✅    | Reused verbatim via the action `prompt:` input.                                                                                                                                                                                                                      |
| `delimitUntrusted` injection fences                                                                       | ✅    | Part of `initialPrompt`; same prompt-injection posture.                                                                                                                                                                                                              |

## C. Per-agent reasoning core

| Element                                                                                                               | Class | Notes                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refiner / Reviewer (read + structured verdict)                                                                        | 🔁    | LLM emits the same JSON contract; all Jira/PR writes, labels, FR24, audit = deterministic post-step.                                                              |
| Developer / Iterator code tools (`bash/read_file/write_file/str_replace/list_dir/search_files/move_file/delete_file`) | 🟡    | Mapped to native `Bash/Read/Write/Edit/Glob/Grep`.                                                                                                                |
| `spawn_subagent`                                                                                                      | 🟡    | Mapped to the action's sub-agent/Task facility, or set aside (single loop).                                                                                       |
| `done` / `commit_progress` / `finish_review`                                                                          | 🔁    | Replaced by a final structured-JSON artifact the LLM writes; post-step parses it and applies outcomes — same result as the script.                                |
| `outcome-guard` (`assertDev/IterOutputContract`)                                                                      | 🔁    | Post-step assertion before the terminal comment.                                                                                                                  |
| Reviewer CI gate (`gateCi`)                                                                                           | 🔁    | Pre-step; blocks a red/pending CI exactly as today.                                                                                                               |
| Reviewer rubric (`applyRubricToPrompt`)                                                                               | ✅    | Folded into the built system prompt.                                                                                                                              |
| Sandbox no-merge deny-list (ADR-0005, `developer/sandbox.ts`)                                                         | ⛔    | Does not wrap the action's loop.                                                                                                                                  |
| No-merge enforcement for the action                                                                                   | ➕    | `--allowedTools` allowlist (no `gh pr merge`, no push to protected refs) + least-privilege token (ADR-0006 §5). Weaker defense-in-depth than the regex deny-list. |
| MCP pool (`loadMcpServers` + `filterMcpServers` by capabilities)                                                      | 🟡    | Capability filtering becomes a pre-step that emits `--mcp-config`; consumer MCP servers passed through for parity.                                                |

## D. Edge-case parity matrix

| Edge case                                                | Parity?             | Mechanism                                                                                                                                                                      |
| -------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ferry:dry-run` / `FERRY_DRY_RUN`                        | ✅ 🔁               | Pre-step detects; post-step suppresses all external writes. (LLM turn still consumed.)                                                                                         |
| `ferry:read-only`                                        | ✅ 🔁               | Pre-step short-circuits — the action is never invoked.                                                                                                                         |
| `ferry:skip/<phase>`                                     | ✅ 🔁               | Pre-step no-op + standard comment.                                                                                                                                             |
| Outcome `blocked`                                        | ✅ 🔁               | Post-step reads structured outcome → `ferry:blocked` + comment + exit 1 (output-schema validation is fail-closed).                                                             |
| Outcome `already_satisfied`                              | ✅ 🔁               | Post-step writes verification note + verify PR — same as script.                                                                                                               |
| Iteration cap (`max_iterations`, `countPriorIterations`) | ✅ 🔁               | Pre-step counts prior iterations from audit comments.                                                                                                                          |
| Agent-loop iteration cap (`max_agent_iterations`)        | 🟡                  | `--max-turns` ≈ equivalent; `ferry:max-iterations/<n>` "success-of-intent" nuance differs slightly.                                                                            |
| Merge conflicts (iterator/reviewer)                      | ✅                  | Detected in a pre-step; resolved by the LLM via git, same as the script.                                                                                                       |
| No PR / no review comment / reviewer-not-visible race    | ✅ 🔁               | Pre-step guards + defer logic, path-agnostic.                                                                                                                                  |
| `LabelConflictError`                                     | ✅ 🔁               | Pre-step `resolveTicketOverrides`; same conflict comment.                                                                                                                      |
| CI red / pending (reviewer)                              | ✅ 🔁               | Pre-step `gateCi`; same comments + FR24.                                                                                                                                       |
| Resume branch / existing-PR context                      | ✅                  | Pre-step builds resume context into the prompt — same as script.                                                                                                               |
| Prompt injection (untrusted ticket content)              | ✅                  | `delimitUntrusted` fences + system instruction; same posture.                                                                                                                  |
| **`ferry:spend-cap` (mid-run EUR budget exceeded)**      | ⛔ **no parity**    | The action cannot raise a mid-loop EUR `FerryError`; the `ferry:spend-cap` label + comment will not appear. Bounded only by `--max-turns`/timeout. Accepted divergence.        |
| **Secret scan before push**                              | ➕ must re-engineer | No in-loop `secretScan` hook. Either: gate the push through a wrapper that scans first, or accept the action's own pre-push controls. Must be solved before enabling the path. |

## E. Maintenance

| Element             | Class | Notes                                                                                                                |
| ------------------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| `ferry-doctor`      | 🟡 ➕ | Existing probes reused; **add** a `CLAUDE_CODE_OAUTH_TOKEN` presence/validity probe and a path-selection diagnostic. |
| `ferry-update`      | ✅    | Version/ref bump and `MIGRATIONS.md` handling cover the new wrapper workflow unchanged.                              |
| `ferry.config.json` | 🟡    | Existing keys reused; **add** path-enable + routing-threshold (`N`) + label-name keys.                               |

## F. Destruction (`ferry-uninstall`)

| Element                                            | Class | Notes                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove `workflows/ferry-*.yml`, secrets, variables | ✅    | Mechanism reused.                                                                                                                                                                                                                                                                                                            |
| Remove `CLAUDE_CODE_OAUTH_TOKEN`                   | ➕    | Interactive-only, never under `--yes`. The bulk-removal list intentionally **excludes** this secret; it is gated behind a dedicated second confirmation prompt (see [Amendment (PR #343)](#amendment-pr-343)). Deleting the secret removes the GitHub repo value only — the underlying Anthropic OAuth token is not revoked. |

### Amendment (PR #343)

The original row above said "Add the new secret to the uninstall removal list".
This was superseded by [#337](https://github.com/big-emotion/ferry/issues/337) /
[PR #343](https://github.com/big-emotion/ferry/pull/343) to the following
contract:

- **Interactive-only, never under `--yes`.** `ferry-uninstall --yes` never
  deletes `CLAUDE_CODE_OAUTH_TOKEN`, even if the secret is present. In
  interactive mode, the user must explicitly confirm a dedicated second prompt
  (the main "Proceed with removal?" prompt is not sufficient).
- **Tradeoff: orphaned token possible.** If a consumer runs the uninstall
  non-interactively (CI / `--yes`), the secret stays. This is preferred to the
  reverse failure mode (silently losing a credential the consumer may still
  intend to use elsewhere).
- **Manual cleanup path.** After uninstall, the consumer can:
  - Re-issue: `claude setup-token` → `gh secret set CLAUDE_CODE_OAUTH_TOKEN`
  - Or remove it themselves: `gh secret delete CLAUDE_CODE_OAUTH_TOKEN --repo <owner>/<repo>`
  - And, to fully revoke the underlying OAuth token (not just the GitHub repo
    secret value), follow up at <https://console.anthropic.com>.

## G. Existing consumers (migration via `ferry-update`)

`ferry-update` re-renders `.github/workflows/ferry-*.yml` from templates, adds missing workflow
files, bumps pinned `@vX` refs, and prints the relevant `MIGRATIONS.md` section as
"Manual follow-ups required". Crucially, it **never re-prompts for credentials**.

**Design rule: a version-delta manifest decides whether `ferry-update` prompts for credentials.**
`ferry-update` stays **credential-silent for code-only updates** — the pre-update credentials keep
working, so it must not re-prompt. It becomes credential-aware **only when the version transition
being crossed declares a newly-required secret**, and then prompts **only for the ones missing**.

The manifest is the existing `MIGRATIONS.md`: each `## <from> → <to>` section gains an optional
declarative line — parallel to the existing `forge:` line — e.g.:

```
## v0.X.x → v0.Y.0
requires-secrets: CLAUDE_CODE_OAUTH_TOKEN
```

`ferry-update` already parses these sections and already has `listExistingSecrets()` (from
`ferry-init`'s secret step). The added logic is small:

1. For the crossed range, collect `requires-secrets:` (empty for code-only releases → **silent**, property preserved).
2. Diff declared-required against `gh secret list` → compute the **missing** set.
3. If non-empty: interactive → run the targeted secret step **only for the missing secrets** (e.g. guide `claude setup-token` → `gh secret set CLAUDE_CODE_OAUTH_TOKEN`); non-interactive/CI → do not flip, keep the script path (zero breakage), print a mandatory "re-run `ferry-init`" / re-run interactively follow-up.
4. Apply `execution_path: claude-code` (conditional default) only once the required secrets are present.

Resulting migration matrix for an Anthropic-only existing consumer:

| Situation on `ferry-update`                          | Outcome                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| Crossed range has no `requires-secrets:` (code-only) | **Silent** — no prompt, credentials untouched (property preserved) |
| Declares `CLAUDE_CODE_OAUTH_TOKEN`, already set      | Auto-adopts claude-code path (conditional default applied)         |
| Declares it, missing, interactive                    | Prompts **only for the missing** secret → then adopts              |
| Declares it, missing, non-interactive                | Stays on script + mandatory follow-up                              |
| `execution_path: script` explicitly set              | Respected — never overridden                                       |

The path-select branch ships **inert** in re-rendered workflows until `execution_path` resolves to
claude-code, so the upgrade is a no-op until the manifest-declared secrets are satisfied.

**No trade-off:** the "never re-prompts for credentials" property is **preserved for ordinary code
updates** and merely **narrowed** — `ferry-update` prompts only when the version-delta manifest
declares a new required secret, and only for the missing ones. This is a general mechanism, not a
one-off for the claude-code path; any future release that introduces a required secret uses the same
`requires-secrets:` line.

**Rollback** is symmetric and safe: set `execution_path` back to `script` (or remove the key),
re-run `ferry-update`. The script path needs no new secret, so reverting cannot break a consumer.

## Accepted divergences (the "set aside" list)

Near-parity holds for the **entire observable contract** (Jira/PR/audit/transitions/idempotency and
every operational edge case) **except** these, which are accepted as non-parity and documented:

1. **Per-run EUR cap + `ferry:spend-cap` edge case** — no mid-loop EUR enforcement; the label/comment
   path does not fire. Conceptually moot under subscription billing, but observably different.
2. **Daily cost-governance auto-pause** — monthly EUR spend is not measurable on a subscription
   token; this safety backstop is weakened on the claude-code path.
3. **No-auto-merge runtime enforcement (ADR-0005)** — the regex deny-list is set aside; replaced by
   an `--allowedTools` allowlist + token scoping (weaker defense-in-depth).
4. **Secret-scan-before-push** — must be re-engineered as a deterministic gate; not free.

## Recommendation

Adopt the path with the classification above. The reuse ratio is high: prompts, envelope, trigger,
reconciler, transitions, idempotency, and **every edge case except `spend-cap`** are reused as-is or
wrapped without behavioral change. The four accepted divergences are all **cost/safety-budget**
concerns — coherent with the deliberate decision (ADR-0006) that the claude-code path trades the
per-run EUR ceiling for the subscription-billing + free-agent-loop profile. The `CLAUDE_CODE_OAUTH_TOKEN`
requirement makes this a non-zero-friction install (one extra required secret + wizard step), which
ADR-0006 must reflect (point 6 superseded).
