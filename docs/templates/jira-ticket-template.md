---
type: Task
project: FER
parent_epic: ''
assignee: ''
labels: []
---

# Title

<!-- Concise, business-readable. One short sentence that names the outcome, not the implementation.
     Example: "Make the Reviewer's CI pre-gate opt-out via config". Avoid jargon and ticket IDs here.
     FER is a team-managed project with three issue types only: Epic, Task ("Tâche"), Sub-task
     ("Sous-tâche"). Bugs are Tasks carrying the `bug` label. -->

## Goal

<!-- What + why in one short paragraph. Tie it back to a measurable outcome whenever possible
     (consumer install success, agent run reliability, cost, supply-chain posture, DX). -->

## Scope

### In

<!-- Bullet list of what IS included in this ticket. -->

### Out

<!-- Bullet list of what is explicitly NOT included (deferred, separate ticket, etc.). -->

## Reproduction steps

<!-- if: label == "bug" -->

1. <step one>
2. <step two>
3. <step three>
   <!-- /if -->

## Expected vs Actual behavior

<!-- if: label == "bug" -->

### Expected

<expected behavior>

### Actual

<actual behavior>
<!-- /if -->

## Acceptance criteria (Given-When-Then)

<!-- Required always — this is the contract with the Ferry pipeline (Refiner sub-tasks and the
     Reviewer verdict both anchor on it). One GWT block per REQ touched, or per observable behavior
     for spec-less tickets. -->

```
Given <context>
When <action>
Then <observable outcome>
```

## Affected files / areas

<!-- Mandatory. The paths (or areas: prompts/, src/agents/reviewer/, examples/consumer-setup/…)
     the implementer is expected to touch. Note CODEOWNERS-protected paths explicitly
     (.github/**, src/schemas/**, prompts/*.md) — changes there need human review.
     If src/ changes, remind: `npm run build:ferry` must rebuild .ferry/ in the same PR. -->

## Confluence impact (load-bearing)

<!-- MANDATORY when the ticket originates from ferry-spec. List every REQ / DEC / ARCH touched
     with one of the three allowed verbs: NEW, EDIT, RETIRE. For tickets with no spec impact,
     write exactly: "None — no REQ/DEC/ARCH touched."

     The bullet character is `•`. Indentation under each bullet is two spaces. -->

• REQ-012 — EDIT statement
Current: "<verbatim current statement>"
Proposed: "<new statement>"
GWT changes: <which GWT blocks change, and how>

• DEC-005 — NEW
Context: <why this decision is being recorded now>
Decision: <the decision itself, one sentence>
Alternatives: <options considered, briefly>
Tradeoffs: <what we accept by choosing this option>
Requirements satisfied: <REQ-xxx, REQ-yyy>

## FR registry impact

<!-- Does this ticket ship behavior that must be registered in docs/REQUIREMENTS.md?
     If yes: name the FR to add/update (the implementing PR owns the edit — check:fr-drift gates it).
     If no: write "None". -->

## Dependencies

<!-- Optional. Other tickets, PRs, Confluence pages, or external blockers. Keep it brief. -->

## Assumptions / open questions

<!-- Optional. Anything you assumed while writing the ticket, or questions that need a
     maintainer decision before implementation can start. -->
