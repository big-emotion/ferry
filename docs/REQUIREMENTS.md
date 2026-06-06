# Ferry Requirements Registry

This file is the single source of truth for all Ferry Requirements (FRs). Every `FR\d+` tag in `src/`, `prompts/`, and `docs/` must have a corresponding entry here.

The CI drift detector (`npm run check:fr-drift`) greps for `FR\d+` across those directories and fails if any ID is missing from this file.

## Format

| Field               | Description                                                 |
| ------------------- | ----------------------------------------------------------- |
| **ID**              | Stable numeric tag (e.g. `FR18`) — never reuse a retired ID |
| **Description**     | One-line statement of the requirement                       |
| **Status**          | `shipped` · `planned` · `removed`                           |
| **Source files**    | Implementation files where the FR tag appears               |
| **Test files**      | Test files that exercise the behaviour                      |
| **Date introduced** | ISO date the FR was first committed                         |

---

## Registry

### FR1 — Phase → workflow routing table is the single source of truth

|                     |                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Status**          | shipped                                                                                                             |
| **Source files**    | `src/lib/dispatch/routing.ts`                                                                                       |
| **Test files**      | `src/lib/dispatch/routing.test.ts`, `src/lib/dispatch/workflow-binding.test.ts`, `src/lib/dispatch/dry-run.test.ts` |
| **Date introduced** | 2026-05-01                                                                                                          |

The `PHASE_TO_WORKFLOW` table in `routing.ts` is consulted by the dispatcher, binding tests, and the dry-run E2E suite. A single table prevents drift between production and test routing.

---

### FR6 — Ticket-type filter: skip issues of type `Task`

|                     |                                    |
| ------------------- | ---------------------------------- |
| **Status**          | shipped                            |
| **Source files**    | `src/lib/dispatch/routing.ts`      |
| **Test files**      | `src/lib/dispatch/routing.test.ts` |
| **Date introduced** | 2026-05-01                         |

Ferry processes Story/Bug/etc. tickets only. `Task` issues are sub-tasks created by the Refiner; re-running Ferry on them would cause a dispatch loop.

---

### FR10 — Atomic batch sub-task creation (cap 12, rollback on failure)

|                     |                                    |
| ------------------- | ---------------------------------- |
| **Status**          | shipped                            |
| **Source files**    | `src/agents/refiner/batch.ts`      |
| **Test files**      | `src/agents/refiner/batch.test.ts` |
| **Date introduced** | 2026-05-01                         |

The Refiner creates sub-tasks in a single atomic batch capped at 12. If the callback throws, a `FerryError("transient")` is raised so the caller can retry without partial state.

---

### FR12 — Refiner re-run idempotency via subtask marker deduplication

|                     |                                          |
| ------------------- | ---------------------------------------- |
| **Status**          | shipped                                  |
| **Source files**    | `src/agents/refiner/idempotency.ts`      |
| **Test files**      | `src/agents/refiner/idempotency.test.ts` |
| **Date introduced** | 2026-05-01                               |

On re-run, the Refiner reads existing Jira sub-task descriptions, extracts `[ferry:refiner-subtask:<id>]` markers, and skips any sub-tasks that already exist. Prevents duplicate ticket creation.

---

### FR15 — Standardised commit message and branch name format for Developer

|                     |                                       |
| ------------------- | ------------------------------------- |
| **Status**          | shipped                               |
| **Source files**    | `src/agents/developer/commit.ts`      |
| **Test files**      | `src/agents/developer/commit.test.ts` |
| **Date introduced** | 2026-05-01                            |

Developer commits follow `[TICKET-KEY] type: summary\n\n[ferry:developer:<run-id>]`. Branch names are `ferry/<TICKET-KEY>`. Ensures consistent audit trail and idempotent comment fingerprinting.

---

### FR16 — Pull request title format for Developer

|                     |                                   |
| ------------------- | --------------------------------- |
| **Status**          | shipped                           |
| **Source files**    | `src/agents/developer/pr.ts`      |
| **Test files**      | `src/agents/developer/pr.test.ts` |
| **Date introduced** | 2026-05-01                        |

PR title is `<TICKET-KEY> <summary>`. Consistent format makes Jira ↔ GitHub tracing straightforward without additional tooling.

---

### FR18 — Developer auto-transitions Jira ticket to "In Review" on PR creation

|                     |                                                      |
| ------------------- | ---------------------------------------------------- |
| **Status**          | shipped                                              |
| **Source files**    | `src/agents/developer/dev-action.ts`                 |
| **Test files**      | `src/install-guide.test.ts`                          |
| **Docs**            | `README.md` (Quick install), `docs/CONFIGURATION.md` |
| **Date introduced** | 2026-05-01                                           |

After the Developer opens a pull request, Ferry immediately calls the Jira transition API (`FERRY_REVIEW_TRANSITION_ID`) to move the ticket from _In Development_ to _In Review_. Enables automatic Reviewer dispatch via Jira Automation without human intervention.

---

### FR24 — Reviewer auto-transitions Jira ticket to "Changes Requested"

|                     |                                                                              |
| ------------------- | ---------------------------------------------------------------------------- |
| **Status**          | shipped                                                                      |
| **Source files**    | `src/agents/reviewer/review-loop.ts`, `src/agents/reviewer/review-action.ts` |
| **Test files**      | `src/install-guide.test.ts`                                                  |
| **Docs**            | `README.md` (Quick install), `docs/CONFIGURATION.md`                         |
| **Date introduced** | 2026-05-01                                                                   |

When the Reviewer verdict is `changes-requested`, Ferry calls the Jira transition API (`FERRY_ITER_TRANSITION_ID`) to move the ticket to _Changes Requested_. Triggers Jira Automation to dispatch the Iterator. On `merge-ready`, the ticket remains in _In Review_ and the PR receives the `ferry:approved` label.

---

### FR28 — Iterator auto-transitions Jira ticket back to "In Review"

|                     |                                                                       |
| ------------------- | --------------------------------------------------------------------- |
| **Status**          | shipped                                                               |
| **Source files**    | `src/agents/iterator/transition.ts`                                   |
| **Test files**      | `src/agents/iterator/transition.test.ts`, `src/install-guide.test.ts` |
| **Docs**            | `README.md` (Quick install), `docs/CONFIGURATION.md`                  |
| **Date introduced** | 2026-05-01                                                            |

After a successful Iterator commit, Ferry moves the ticket back to _In Review_ (`FERRY_REVIEW_TRANSITION_ID`) and increments `state.iteration`. Ferry does not self-dispatch the Reviewer — Jira Automation handles that.

---

### FR29 — Oscillation cap: halt iteration when limit exceeded with open findings

|                     |                                   |
| ------------------- | --------------------------------- |
| **Status**          | shipped                           |
| **Source files**    | `src/agents/iterator/cap.ts`      |
| **Test files**      | `src/agents/iterator/cap.test.ts` |
| **Date introduced** | 2026-05-01                        |

When `state.iteration >= limits.max_iterations` (default 3) and findings remain, the Iterator throws `FerryError("oscillation")`. Prevents infinite back-and-forth between Reviewer and Iterator when issues cannot be resolved automatically.

---

### FR32 — Reviewer best-effort dispatches ferry-merge on approve

|                     |                                                                              |
| ------------------- | ---------------------------------------------------------------------------- |
| **Status**          | shipped                                                                      |
| **Source files**    | `src/agents/reviewer/review-action.ts`, `src/cli/init/templates.ts`          |
| **Test files**      | `src/cli/init/templates.test.ts`                                             |
| **Date introduced** | 2026-06-06                                                                   |

When the Reviewer verdict is `merge-ready`, Ferry attempts a best-effort `repository_dispatch` to trigger `ferry-merge.yml`. The dispatch is wrapped in try/catch so a failure never loses the approval. The reviewer `run-agent` step requires `contents: write` to issue the dispatch event.

---

### FR45 — Daily provider spend check against configurable EUR cap

|                     |                                           |
| ------------------- | ----------------------------------------- |
| **Status**          | shipped                                   |
| **Source files**    | `src/cost-governance/daily-check.ts`      |
| **Test files**      | `src/cost-governance/daily-check.test.ts` |
| **Date introduced** | 2026-05-01                                |

Evaluates per-provider monthly and daily spend against a cap. Emits an alert payload when any provider crosses 50% of the monthly limit. Side effects (posting to `ferry-audit`, applying `ferry:spend-cap`) live in the consumer's `audit-daily.yml`.

---

### FR46 — HTTP-status classifier and ticket-scoped pause directive

|                     |                                |
| ------------------- | ------------------------------ |
| **Status**          | shipped                        |
| **Source files**    | `src/lib/io/spend-cap.ts`      |
| **Test files**      | `src/lib/io/spend-cap.test.ts` |
| **Date introduced** | 2026-05-01                     |

Classifies provider HTTP responses (`ok` / `transient` / `spend-cap`) and builds a pause directive for 429/402 responses. Pausing is ticket-scoped — Ferry never globally halts, only the affected ticket gets `ferry:paused`.

---

### FR50 — 15-minute reconciler: detect and re-dispatch stalled tickets

|                     |                                    |
| ------------------- | ---------------------------------- |
| **Status**          | shipped                            |
| **Source files**    | `src/reconciler/reconcile.ts`      |
| **Test files**      | `src/reconciler/reconcile.test.ts` |
| **Date introduced** | 2026-05-01                         |

The reconciler sweeps Ferry-managed tickets on a 15-minute schedule. When a ticket's Jira column no longer matches `state.phase` or the last audit is stale, it issues a fresh `repository_dispatch`. Consumers wire it via their own `reconciler.yml`.

---

### FR51 — Reconciler label pruning for resolved tickets

|                     |                                    |
| ------------------- | ---------------------------------- |
| **Status**          | shipped                            |
| **Source files**    | `src/reconciler/reconcile.ts`      |
| **Test files**      | `src/reconciler/reconcile.test.ts` |
| **Date introduced** | 2026-05-01                         |

The reconciler removes stale `ferry:*` labels from tickets that have moved to terminal states (`ready`, `cancelled`, `needs-human`). Keeps GitHub label state consistent with Jira column reality.

---

### FR55 — Mandated TL;DR block in pull request body

|                     |                           |
| ------------------- | ------------------------- |
| **Status**          | shipped                   |
| **Source files**    | `src/lib/io/tldr.ts`      |
| **Test files**      | `src/lib/io/tldr.test.ts` |
| **Date introduced** | 2026-05-01                |

Every Developer-opened PR must contain a six-field markdown table inside `<!-- ferry:tldr -->` markers. The Iterator refreshes it on each push; the Reviewer updates only the verdict field. Total length capped at 500 chars.

---

### FR60 — In-place Jira comment upsert (per-ticket comment count ≤ 8)

|                     |                                  |
| ------------------- | -------------------------------- |
| **Status**          | shipped                          |
| **Source files**    | `src/lib/io/jira-upsert.ts`      |
| **Test files**      | `src/lib/io/jira-upsert.test.ts` |
| **Date introduced** | 2026-05-01                       |

Rather than appending a new comment on each agent run, Ferry updates its existing comment (identified by `[ferry:<role>:<run-id>]` marker). Keeps the total Ferry comment count across a full ticket lifecycle ≤ 8.

---

## Retired FRs

_None yet. When an FR is removed, move it here and set status to `removed`._

---

## Adding a new FR

1. Pick the next available integer — check this file and the grep output of `FR\d+` across `src/`, `prompts/`, `docs/`.
2. Add the `FR<n>` tag as a comment in the implementation file.
3. Add a corresponding entry in this registry (copy any block above as a template).
4. Run `npm run check:fr-drift` locally to confirm the check passes.
5. Include `(FR<n>)` in the commit message footer when the commit type is `feat:` or `fix:`.
