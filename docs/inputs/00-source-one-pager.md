---
subject: symphony-hitl
date: 2026-04-23
---

# Symphony with Humans in the Loop

## Problem Statement

**How might we turn a Jira board into a semi-autonomous delivery pipeline, where humans only decide *what must be done* and *what is acceptable*, and AI agents handle everything in between — at a sustainable cost and without depending on a local machine?**

Target user: a small team (2–5 people) shipping projects where the specs already exist (BMad output, Jira tickets) and execution is the bottleneck. Pilot project: `~/Documents/Dev/chancellerie` — Next.js greenfield, planning artifacts complete, ~40 stories to ship.

## Recommended Direction

**GitHub Actions as the runtime + PR as the state machine + API-only hybrid model strategy.**

Jira column transitions fire webhooks through a Cloudflare Worker proxy (signature check + payload normalization) into a GitHub App, which triggers `repository_dispatch` events. Four workflow files — `refine.yml`, `dev.yml`, `review.yml`, `iterate.yml` — each spin up an ephemeral Ubuntu runner, pull the relevant context from Jira and the repo, call the appropriate LLM via API, then write back to Jira (comments, sub-tasks) and GitHub (branch, PR body, labels).

No VPS, no daemon, no database. State lives entirely in the PR (body block as structured YAML, labels for phase, comments for audit trail) and in Jira (columns + custom fields). One branch per ticket, one PR per ticket, max 3 dev↔review iterations before escalation to `Needs Human`.

Model routing is per role, not per ticket: **Refiner = Gemini 2.5 Flash** (cheap, simple decomposition), **Developer & Iterator = Gemini 2.5 Pro** (large context, good quality at ~12× lower cost than Codex API), **Reviewer = Claude Sonnet 4.6** (quality gate at the step that matters most). Opus reserved for tickets labeled `critical`. Total estimated cost for chancellerie: **~45–60€ for all 40 stories**.

Triggers are hybrid: **column transitions drive the default path**, but a human can override by assigning `agent:refiner` / `agent:dev` / `agent:reviewer` to any ticket to re-run a phase, or by `@agent-name` in a Jira comment to relaunch with extra instructions.

This direction is chosen because it aligns with the hardest constraint (code quality > cost > everything else) by putting the best model on the role that determines quality (Reviewer), while zero runtime infrastructure keeps the system alive without a laptop and eliminates ops burden.

## Key Assumptions to Validate

- [ ] **Claude Code / Gemini can execute a BMad story end-to-end without supervision.** User already validated this manually — no further stress-test needed.
- [ ] **The dev↔review loop converges in ≤3 iterations for ≥80% of stories, without oscillation.** Test by running 5 real stories end-to-end and measuring iteration count. Add anti-oscillation by passing the full review history into each iterator prompt.
- [ ] **The Reviewer (Claude Sonnet 4.6) produces actionable, non-trivial reviews — not just LGTM or nits.** Sample 10 reviews manually in week 1 and grade them. If weak, upgrade Reviewer to Opus.
- [ ] **Jira Automation on the current plan can send authenticated web requests to `api.github.com/dispatches`.** Check plan tier (Free vs Standard vs Premium) — some automations are gated.
- [ ] **The per-story cost stays under ~1,50$ worst case, ~1€ average.** Instrument token consumption per run from day 1; set hard spend caps of 100€/mo on each provider (Anthropic, Google AI, OpenAI) as a safety net.
- [ ] **Concurrent workflows on the same ticket don't corrupt state.** Use GitHub's `concurrency:` group keyed on ticket ID to serialize runs per ticket.

## MVP Scope

**In scope (v0.1, ~1 week):**
- One workflow: `refine.yml` triggered by Jira column transition to `Refinement`
- Gemini 2.5 Flash as Refiner, reading a ticket via Jira REST API
- Creates sub-tasks in Jira, posts a summary comment
- Cloudflare Worker proxy with Jira signature verification
- GitHub App with minimal permissions (`contents:read`, `issues:write` equivalent via Jira side)
- Spend caps configured on all provider consoles
- Documented in a `README.md` so setup is reproducible

**Out of scope until v0.1 ships:**
- Developer / Reviewer / Iterator workflows
- Dev↔review loop logic
- Anti-oscillation mechanism
- Observability dashboard
- Multi-project support

Rationale: the Refiner is the lowest-risk, highest-learning slice. It validates the Jira↔GH↔Jira round-trip, secret handling, and cost instrumentation. If this works, the other phases are straightforward extensions.

## Not Doing (and Why)

- **No VPS, no always-on service** — GitHub Actions at this load is $0; a VPS adds ops burden without unlocking anything we need at MVP scale.
- **No LangGraph / ADK / orchestration framework** — PR-as-state machine is simpler and visible in the GitHub UI for free. Framework complexity is only justified when we hit a limitation we can name.
- **No subscription CLIs (Claude Code Max, Codex via ChatGPT Pro)** — these cannot run headlessly in CI; only API keys work. This is a technical constraint, not a preference.
- **No automated hard quality gate after the dev↔review loop** — user decided this is manual, triggered by label. Keeps the pipeline's failure modes legible.
- **No database, no external state store** — Jira is the source of truth for ticket state, PR is the source of truth for implementation state, GitHub Actions logs are the source of truth for history.
- **No human validation of sub-tasks** — user chose to trust the Refiner; any correction happens by re-running the phase or editing sub-tasks manually in Jira.
- **No Codex API as Developer** — Gemini 2.5 Pro offers comparable quality at ~12× lower token cost for this use case; Codex API pricing disqualifies it at volume.
- **No parallel specialist reviewers (security/perf/style)** — user specified a single Reviewer for coherence. Keep simple until single-reviewer weakness is proven.
- **No multi-project support in v0** — chancellerie is the pilot; generalizing to other projects is v1 work once the pattern is proven once.

## Open Questions

- Which Jira plan is active on `big-emotion.atlassian.net`? Free blocks some automation features; Standard/Premium open them up.
- Does the CHAN project already have a custom field for `ai.iteration` and `ai.phase`, or do we create them?
- What naming conventions are already in place on the CHAN board for branches and PR titles? (The pipeline should match existing team habits.)
- What's the acceptable merge latency — i.e., when a PR gets `reviewer-approved`, how long before a human will see it and merge? This sets the rhythm of the pipeline.
- Will other projects beyond chancellerie use this system later? If yes, the workflow files should live in a reusable template repo from day 1; if no, inline them in chancellerie.

## Next Steps

1. Validate Jira plan + automation capability (5 min, user).
2. Create GitHub App + install on chancellerie repo (15 min, user).
3. Write `refine.yml` workflow + Cloudflare Worker proxy (1–2 days, pair with agent).
4. Run on 3 real tickets, measure: latency, token cost, sub-task quality.
5. Review results, decide whether to extend to Developer phase or adjust the Refiner first.
