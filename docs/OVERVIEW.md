# Ferry — Overview

## What Ferry is — and isn't

**Ferry is:**

- A set of GitHub Actions workflows you copy into your repo — no server, no daemon, no infra to own
- An autonomous loop that goes from Jira ticket to a reviewed PR — and, with the gated Merger enabled, all the way to a merged PR — without you writing a line of code
- Designed for teams that already use Jira + GitHub and want AI-assisted development without leaving those tools

**Ferry is not:**

- A replacement for human review — the Reviewer's verdict is advisory; merging is confined to a separate, gated Merger agent (FR32) that runs only on approval, and you still own branch protection and merge policy
- A general-purpose AI coding assistant — it only acts on explicit Jira column transitions
- Limited to tool-use phases on Anthropic — the Refiner supports all three providers (`anthropic`, `openai`, `google`); the Developer, Reviewer, and Iterator require `anthropic` today (OpenAI/Google agentic-loop support is planned)

---

## Agent phases at a glance

| Phase         | Jira column         | What the agent does                                                                                                                                    |
| ------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Refiner**   | Refinement          | Reads the ticket, creates sub-tasks, awaits human approval                                                                                             |
| **Developer** | In Development      | Reads approved sub-tasks, opens a draft PR on `ferry/<TICKET-KEY>` (e.g. `ferry/PROJ-42`)                                                              |
| **Reviewer**  | In Review           | Reads PR diff (green CI only), posts fingerprinted findings                                                                                            |
| **Iterator**  | Iteration           | Applies findings, re-triggers Reviewer (max 3 rounds by default; configurable via `limits.max_iterations`)                                             |
| **Merger**    | In Review → approve | Squash-merges the approved PR via `gh pr merge` (triggered by the Reviewer's `ferry-merge` dispatch), optionally transitions the ticket to Done (FR32) |

---

## How it works

```
Jira column move / label / @mention
        ↓
  repository_dispatch
        ↓
  gate-envelope (validate)
        ↓
  ┌─────────────┐
  │   Refiner   │  → reads ticket → creates sub-tasks → awaits human approval
  │  Developer  │  → reads sub-tasks → opens draft PR on ferry/<TICKET-KEY> branch
  │  Reviewer   │  → reads PR diff (green CI only) → posts findings → on approve, dispatches ferry-merge
  │  Iterator   │  → applies findings → re-triggers Reviewer (max limits.max_iterations rounds, default 3)
  │   Merger    │  → squash-merges the approved PR → optionally transitions the ticket to Done
  └─────────────┘
        ↓
  PR merged by the Merger (FR32) — or merge it yourself if the Merger is disabled
```

Four of Ferry's five agents **never merge**; the **Merger** (FR32) is the single gated exception — it runs `gh pr merge` only on a `ferry-merge` dispatch emitted by the Reviewer on approve, and only if your branch protection lets the Ferry app merge. Ferry otherwise **rarely moves Jira columns** autonomously. By default, these auto-transitions are enabled:

1. Developer → In Review (FR18)
2. Reviewer → Changes Requested (FR24, on review findings)
3. Iterator → In Review (FR28)
4. Merger → Done (FR32, only when `FERRY_MERGE_DONE_TRANSITION_ID` is set)

All auto-transitions are configurable via `workflow.agents` in `ferry.config.yaml` — set any to `null` to hand control back to humans, or set custom column names to match your board. See [`docs/CONFIGURATION.md`](CONFIGURATION.md#workflowagents) for details.

For operator-local execution without a GitHub Actions runner, see [`docs/LOCAL-RUNNER.md`](LOCAL-RUNNER.md).
