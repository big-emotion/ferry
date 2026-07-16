---
name: ferry-spec
description: Spec maintainer for Ferry. Reads the Ferry Confluence space (Requirements / Decisions / Architecture) as the source of truth, helps you investigate a problem, structures the reflection, and produces drafts — Pending REQ/DEC/ARCH sections on Confluence + matching Jira tickets in FER using the project template. Append-only on Confluence, Pending only. Use when you face a bug, want to add a feature, or need to refine an idea for Ferry.
metadata:
  author: jnk
  version: '1.0.0'
---

# Ferry Spec

Maintain the Ferry spec tree on Confluence. Given a free-text problem (bug, feature, refinement idea), read Confluence (`Requirements / Decisions / Architecture`) as the canonical source of truth, structure the reflection, propose `Pending` REQ/DEC/ARCH sections plus matching Jira tickets in `FER`, then — after explicit confirmation — publish Confluence first, Jira second, and close the link loop both ways.

This skill is **append-only on Confluence** and only writes new sections at status `Pending`. Humans transition `Pending → Implemented → Approved` through the Confluence UI. The skill never touches the Status macro of an existing section, never edits the body of a non-`Pending` section, and never deletes an ID.

## Relationship to the in-repo FR registry

Ferry already carries an implementation-level registry: `docs/REQUIREMENTS.md` (FR-NNN entries with status/source/test files, gated by `npm run check:fr-drift`). The two layers are complementary, not competing:

- **Confluence REQ/DEC/ARCH** — the _spec_ layer: what Ferry should do and why, drafted before implementation, human-approved.
- **`docs/REQUIREMENTS.md` FR entries** — the _shipped-behavior_ registry: written by the implementing PR when a REQ materializes as code carrying an `FRnn` tag. The CI drift gate keeps it honest.
- A Confluence DEC that changes repo architecture should be mirrored as an ADR under `docs/adr/` by the implementing ticket.

**ferry-spec never writes in-repo docs** — it only drafts Confluence sections and Jira tickets. The FR entry and ADR are acceptance criteria of the resulting ticket, executed downstream.

## When to Activate

- User invokes `/ferry-spec <description>` (explicit command).
- User writes a natural-language prompt that signals a spec-level reflection about Ferry:
  - `bug : …` / "il y a un bug" / "the … is broken"
  - `j'aimerais ajouter …` / "we should add"
  - `feature idea …` / "what if Ferry"
  - Any free-text describing a problem, gap, or improvement that lacks a Jira ticket and that may touch a REQ/DEC/ARCH.
- Do **not** activate when:
  - The user pastes a Jira ticket URL or key — that path belongs to `ferry-ticket`.
  - The user asks to flip a Status macro on an existing section — that is a Confluence-UI-only operation; refuse and direct them there.

If the trigger is ambiguous (the description could be either a pure code question or a spec change), default to activating: the worst case is the user replies with anything other than an affirmative token at Step 6 and nothing is written.

## Inputs

A single free-text argument: a description of the change. If empty, ask for the description before doing anything else (clarification gate, not a safety blocker).

## Preconditions (safety blockers — stop and report if any fail)

1. **Config readable** — `docs/confluence-spec/config.json` must be present and parseable, with non-null values for `cloudId`, `siteUrl`, `spaceKey`, `engineeringRootPageId`, `requirementsPageId`, `decisionsPageId`, `architecturePageId`, `obsoletePageId`, `jiraProjectKey`, and `jiraIssueTypeIds.{Epic,Task}`. Any null `*PageId` means the one-time bootstrap (see appendix) was incomplete — stop.
2. **Bootstrap sentinel exists** — `docs/.confluence-bootstrap-complete` must be present. If absent, stop and point the user at the Bootstrap appendix below.
3. **Atlassian MCP reachable** — `getAccessibleAtlassianResources` returns at least one site whose ID matches `cloudId`. If not, stop.
4. **Atlassian identity resolvable** — `atlassianUserInfo` succeeds.
5. **Jira project visible** — `getVisibleJiraProjects` includes the project whose key is `jiraProjectKey` (currently `FER`). If not, the user lacks access — stop.
6. **Template available** — `docs/templates/jira-ticket-template.md` exists. If absent, stop.

On a safety blocker: **stop and report**. Do not guess, do not skip a precondition, do not write anything.

## Workflow

The full chain is **read → investigate → dedupe → choose granularity → draft → preview → confirm → write Confluence → write Jira → close link → report**. Steps 1–5 are pure reads + in-memory drafts and write nothing. Step 6 is the single hard gate. Steps 7–9 are the only writes; they happen in strict order (Confluence first, Jira second, back-link last) so any mid-chain failure leaves recoverable state.

### Step 1 — Read config

- Load `docs/confluence-spec/config.json`. Extract every field listed in precondition 1.
- Verify `docs/.confluence-bootstrap-complete` exists.
- Read `docs/templates/jira-ticket-template.md` into memory.
- Resolve `cloudId` via `getAccessibleAtlassianResources` and cross-check against the config; resolve own `accountId` via `atlassianUserInfo` (informational).

### Step 2 — Investigate

- Read the user's description. **Ask ONE clarification question if and only if** the shape of the change is genuinely ambiguous (bug vs feature). Otherwise, **state your assumptions explicitly and proceed**.
- Fetch the spec tree:
  - `getConfluencePageDescendants(cloudId, parentId=engineeringRootPageId)` → confirm the four canonical subpages (`Requirements`, `Decisions`, `Architecture`, `Obsolete`).
  - For each of `requirementsPageId`, `decisionsPageId`, `architecturePageId`: `getConfluencePage` (full body) to retrieve existing REQ/DEC/ARCH sections and their IDs.
- **Also read the in-repo ground truth** relevant to the description: `docs/REQUIREMENTS.md` (existing FRs covering the same behavior), `docs/adr/` (prior decisions), and the source files the change would touch. A REQ that contradicts a shipped FR must call that out explicitly in the draft.
- Walk the impact graph `REQ ← DEC ← ARCH`: if a candidate change touches an ARCH, list every DEC that references it; if it touches a DEC, list every REQ that depends on it. Propagation goes **upward**. Detection is text-based: a section is "referenced" if a body contains its ID (`ARCH-007`). Use `searchConfluenceUsingCql` scoped to the engineering root with `text ~ "<ID>"` if a full body scan is impractical. Surface the propagated impact in the preview.
- Note any section you would propose to `RETIRE` and record its current Status — only `Pending` sections may be edited; non-`Pending` sections can only be marked for retirement via a successor (see Safeguards).

### Step 3 — Search for duplicates

- `searchConfluenceUsingCql` against `space = "<spaceKey>" AND ancestor = <engineeringRootPageId> AND text ~ "<id>"` for each candidate ID.
- `searchJiraIssuesUsingJql` against `project = <jiraProjectKey> AND statusCategory != Done AND text ~ "<id or keywords>"` to confirm no open ticket already covers the same scope.
- If a duplicate is found, **fold the draft into the existing artifact** (point at it in the preview, do not create a parallel ID) and tell the user.
- Before allocating a new ID in Step 5, run one CQL query per type (`REQ`, `DEC`, `ARCH`) to confirm the **highest** existing suffix — the only safeguard against a stale local view between Step 2 and Step 5.
- The dedupe step is purely informational — it never mutates Confluence or Jira. The user can override at Step 6; the override is logged in the Step 10 report.

### Step 4 — Granularity decision

Decide the Jira shape from the **shape of the Confluence change**, not the code size. FER is a team-managed project with three issue types only — `Epic`, `Tâche` (Task), `Sous-tâche` (Sub-task); there is no Story or Bug type. Use this table verbatim:

| Confluence change                                                    | Jira artifact                   |
| -------------------------------------------------------------------- | ------------------------------- |
| ≥2 REQ touched OR new ARCH + ≥2 DEC                                  | Epic + child Tasks              |
| 1 REQ touched (NEW or EDIT) ± ≤1 DEC                                 | Task                            |
| Correction of a failing test against an existing REQ, no spec change | Task with label `bug`           |
| Editorial-only Jira refinement (no REQ/DEC/ARCH change)              | no ticket — comment on existing |

Rules of thumb to disambiguate:

- A bug that proves an **existing** REQ is wrong (the spec is correct, the code is wrong) → `Task` + label `bug`. Do **not** edit the REQ.
- A bug that proves an **existing** REQ is misleading (the code matches the spec but the spec is wrong) → `Task` with an `EDIT statement` on the REQ.
- A new behaviour that did not exist in any previous spec → `Task` with a `NEW` REQ.
- A new behaviour that requires a structural change in `src/` (new module, new boundary, new agent, new IO layer) → `Epic + Tasks` with a `NEW` ARCH and ≥1 `NEW` DEC explaining the choice.

When in doubt, choose the **lighter** artifact (Task over Epic) — humans can split later; the skill never auto-merges.

### Step 5 — Draft everything

For each REQ/DEC/ARCH section to write:

1. **Allocate the next monotonic ID** from the existing IDs read in Step 2 (max suffix + 1). Never reuse an ID. Never renumber a published ID.
2. Compose the section body with this canonical shape:
   - **REQ-NNN — \<statement\>**
     - `Statement:` modal verb preserved verbatim (`must` / `must not` / `should`).
     - `GWT:` one or more Given / When / Then blocks.
     - `Status: Pending` (Confluence Status macro, colour grey).
     - `Related FR:` existing `FRnn` from `docs/REQUIREMENTS.md` if the behavior overlaps one, else `(none yet — the implementing PR registers the FR)`.
     - `Links → Jira:` block (filled in Step 9).
   - **DEC-NNN — \<context\>**
     - `Context / Decision / Alternatives / Tradeoffs / Requirements satisfied`.
     - `Supersedes: <ID>` if it retires an older decision.
     - `Related ADR:` `docs/adr/NNNN-…` when one exists or should be created by the implementing ticket.
     - `Status: Pending`.
   - **ARCH-NNN — \<summary\>**
     - `Summary / Source files (expected) / Tests anchoring this contract`.
     - `Status: Pending`.

For each Jira ticket to create:

1. Apply `docs/templates/jira-ticket-template.md`, filling the conditional sections by shape (bug-labeled Tasks include Reproduction + Expected vs Actual).
2. The **Confluence impact** section is load-bearing — allowed verbs are exactly `NEW`, `EDIT`, `RETIRE`:
   ```
   • REQ-012 — EDIT statement
     Current:  "<verbatim>"
     Proposed: "<new>"
     GWT changes: …
   • DEC-005 — NEW
     Context / Decision / Alternatives / Tradeoffs / Requirements satisfied
   ```
3. Include a placeholder for the Confluence anchor URL (filled at create time in Step 8 using `<siteUrl>/wiki/spaces/<spaceKey>/pages/<pageId>#<anchor>`).
4. The ticket title is concise and business-readable; it carries the primary touched ID in parentheses (e.g. `Reviewer: make the CI pre-gate opt-out (REQ-012)`).
5. Every ticket must be self-sufficient: goal (what + why), scope/out-of-scope, GWT acceptance criteria, affected files/areas, and links. A fresh agent with only the ticket and the codebase must be able to implement it.

### Step 6 — Preview + approval gate (HARD)

Print all drafts: Confluence sections (ID, statement/summary), Jira tickets (type, title, Confluence impact, body preview), and the impact propagation list.

```
Reply `create` / `go` / `ok` / `oui` / `valide` / `yes` to publish.
Anything else aborts. Silence aborts.
```

Wait for explicit confirmation. Affirmative tokens (case-insensitive): `create`, `go`, `ok`, `oui`, `valide`, `yes`. Anything else — including silence, partial answers, "let me check first" — aborts. Implicit confirmation from a prior turn does **not** count.

### Step 7 — Confluence first

For each Pending section to publish, in deterministic order (Requirements → Decisions → Architecture, then Obsolete entries last):

1. `getConfluencePage(cloudId, pageId, …)` — capture the current `version.number`.
2. `updateConfluencePage(cloudId, pageId, version=<current+1>, body=<current body + new section appended>)` — append. Never overwrite, never reorder existing content.
3. On `409` / version-mismatch: re-fetch, **re-allocate the ID** (a competing writer may have taken it), reassemble, retry **once**. On a second mismatch, abort and surface the error verbatim.

If a section is a `RETIRE`-successor, the predecessor is **not** edited here — the Obsolete page receives a separate appended entry in the same pass. The predecessor's Status macro stays untouched; humans flip it via the UI.

### Step 8 — Then Jira

After all Confluence writes succeed:

1. If the granularity is `Epic + Tasks`, `createJiraIssue` the Epic first (`jiraIssueTypeIds.Epic`). Capture its key.
2. Create child Tasks next, each with `parent.key = <epic_key>` (team-managed projects accept `parent` directly).
3. Standalone Tasks last. Apply the `bug` label via `additional_fields` when the granularity table says so.
4. Every ticket body includes a clickable Confluence heading-anchor URL for **each** touched REQ/DEC/ARCH.

If a ticket creation fails mid-sequence, **stop and report** the partial state. Do not retry blindly. An orphan Confluence section is recoverable; an orphan Jira ticket is harder to clean up — which is why Confluence comes first.

### Step 9 — Close the loop

For each Confluence section touched in Step 7, re-`updateConfluencePage` (version+1) to append the created Jira key inside its `Links → Jira:` block (`Links → Jira: FER-12, FER-13`). Same version-mismatch retry policy (one retry max, then abort verbatim).

### Step 10 — Return

End-of-turn report: Confluence URLs (heading anchors), Jira keys with browse URLs, per-ticket recap of touched REQ/DEC/ARCH IDs, plus any assumptions made, RETIRE successors proposed, or duplicates folded.

## Safeguards

- Append-only on Confluence. `Pending` only — never touch the Status macro of an existing section.
- Never modify the body of a non-`Pending` section. Never remove or delete an ID.
- Never write outside the engineering root subtree (page ID from `config.json`).
- Confluence-first, then Jira.
- No invention: if a REQ statement is unclear, leave a `TODO: clarify with <stakeholder>` block and ask.
- ID stability: never renumber an already-published ID.
- No silent retries: surface every failure verbatim except the bounded version-mismatch retry (one attempt).
- Never create without explicit confirmation in the same session.
- If a new decision supersedes an old one: propose `RETIRE` + Obsolete entry + successor with `Supersedes: <ID>`. No silent edits.

## Required Atlassian MCP tools

Allowed (read + scoped writes): `getAccessibleAtlassianResources`, `atlassianUserInfo`, `getConfluencePage`, `getConfluencePageDescendants`, `searchConfluenceUsingCql`, `searchJiraIssuesUsingJql`, `getJiraIssue`, `getVisibleJiraProjects`, `updateConfluencePage`, `createJiraIssue`.

Forbidden: `editJiraIssue` (this skill never touches existing tickets), Confluence comments (not the spec channel), any write outside the engineering root subtree, any Status-macro flip.

## Failure Modes — Stop Without Modifying

| Condition                                                    | Action                                             |
| ------------------------------------------------------------ | -------------------------------------------------- |
| `docs/.confluence-bootstrap-complete` missing                | Stop. Point at the Bootstrap appendix.             |
| `docs/confluence-spec/config.json` missing or null `*PageId` | Stop. Report which fields are missing.             |
| `docs/templates/jira-ticket-template.md` missing             | Stop.                                              |
| Atlassian MCP unreachable / wrong `cloudId`                  | Stop. Surface the error verbatim.                  |
| Jira project `FER` not visible                               | Stop. The user lacks access.                       |
| Duplicate REQ/DEC/ARCH ID detected                           | Fold into the existing artifact; tell the user.    |
| Open Jira ticket already covers the same IDs                 | Fold into that ticket — do not create a duplicate. |
| No affirmative token at Step 6                               | Stop. Nothing is written.                          |
| Version-mismatch twice in a row                              | Stop and report verbatim.                          |
| `createJiraIssue` fails mid-sequence                         | Stop. Report which tickets/sections exist.         |
| User asks to flip a Status macro or delete an ID             | Refuse. UI-only / propose `RETIRE` + successor.    |

## Out of Scope

- Writing `docs/REQUIREMENTS.md`, `docs/adr/`, or any repo file — those belong to the implementing ticket (`ferry-ticket` or the Ferry pipeline).
- Editing existing Jira tickets.
- Implementation. Once tickets exist, the path is `/ferry-ticket <key>` (local) or the Ferry pipeline itself (move the ticket to Refinement).
- Bulk creation: one user description per invocation.
- Multi-project routing: only the project whose key is in `config.json`.

## Appendix — Bootstrap (one-time)

ferry-spec expects this scaffolding to exist. If the sentinel is missing, create it once (with explicit user confirmation, since these are external writes):

1. In the Confluence space `<spaceKey>` (currently `Ferry`, homepage = `engineeringRootPageId`), create four child pages of the homepage: **Requirements**, **Decisions**, **Architecture**, **Obsolete**. Each starts with a one-paragraph intro and no sections.
2. Write `docs/confluence-spec/config.json` with `cloudId`, `siteUrl`, `spaceKey`, `engineeringRootPageId`, the four page IDs, `jiraProjectKey`, `jiraProjectId`, and `jiraIssueTypeIds` (from `getVisibleJiraProjects` with issue types expanded).
3. Create `docs/.confluence-bootstrap-complete` (empty sentinel file).
4. Commit both files.

## Relationship to neighbouring skills

- `ferry-ticket` runs **after** this skill: given a FER key created in Step 8, it self-assigns, refines, branches, implements, opens the PR, and transitions to In Review. Spec drafting (this skill, gated) versus implementation (next skill, full-auto) are intentionally split.
- `ferry-audit` is orthogonal: it scores the repo; its prioritized action list is a natural input to ferry-spec descriptions.
- The Ferry pipeline itself (Refiner → Developer → Reviewer → Iterator → Merger) is the _cloud_ consumer of the tickets this skill creates — moving a ticket into the Refinement column hands it to Ferry.
