# Ferry — Overview

## What Ferry is — and isn't

**Ferry is:**

- A set of GitHub Actions workflows you copy into your repo — no server, no daemon, no infra to own
- An autonomous loop that goes from Jira ticket to reviewed draft PR without you writing a line of code
- Designed for teams that already use Jira + GitHub and want AI-assisted development without leaving those tools

**Ferry is not:**

- A replacement for human review — it opens draft PRs, it never merges
- A general-purpose AI coding assistant — it only acts on explicit Jira column transitions
- Limited to tool-use phases on Anthropic — the Refiner supports all three providers (`anthropic`, `openai`, `google`); the Developer, Reviewer, and Iterator require `anthropic` today (OpenAI/Google agentic-loop support is planned)

---

## Agent phases at a glance

| Phase         | Jira column    | What the agent does                                                                                        |
| ------------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| **Refiner**   | Refinement     | Reads the ticket, creates sub-tasks, awaits human approval                                                 |
| **Developer** | In Development | Reads approved sub-tasks, opens a draft PR on `ferry/<TICKET-KEY>` (e.g. `ferry/PROJ-42`)                  |
| **Reviewer**  | In Review      | Reads PR diff (green CI only), posts fingerprinted findings                                                |
| **Iterator**  | Iteration      | Applies findings, re-triggers Reviewer (max 3 rounds by default; configurable via `limits.max_iterations`) |

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
  │  Reviewer   │  → reads PR diff (green CI only) → posts fingerprinted findings
  │  Iterator   │  → applies findings → re-triggers Reviewer (max limits.max_iterations rounds, default 3)
  └─────────────┘
        ↓
  Human merges PR
```

Ferry **never merges** and **rarely moves Jira columns** autonomously. By default, three auto-transitions are enabled:

1. Developer → In Review (FR18)
2. Reviewer → Changes Requested (FR24, on review findings)
3. Iterator → In Review (FR28)

All auto-transitions are configurable via `workflow.agents` in `ferry.config.yaml` — set any to `null` to hand control back to humans, or set custom column names to match your board. See [`docs/CONFIGURATION.md`](CONFIGURATION.md#workflowagents) for details.
