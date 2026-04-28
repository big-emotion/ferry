---
title: Sprint Change Proposal — Ferry Integration Layer Gap
date: 2026-04-28
project: ferry
status: approved
trigger: post-Epic-9 retrospective discovery
mode: batch
---

# Sprint Change Proposal — Ferry Integration Layer Gap

## 1. Issue Summary

### Problem statement

The Ferry retrospective (`_bmad-output/implementation-artifacts/epic-9-retro-2026-04-28.md`) and the implementation-readiness report (`implementation-readiness-report-2026-04-27.md`) declared all 9 epics complete and 60/60 functional requirements covered. **At the runtime level this is not true.** The 41 stories shipped library modules with unit tests, but the integration layer that turns those modules into a running pipeline was never built.

### Discovery context

Discovered during attempt to scope a "pre-pilot hardening sprint" on 2026-04-28. While verifying retrospective punch-list items (R1–R5 in the retro), inspection of the source tree revealed the gap.

### Concrete evidence

1. All four agent workflows have a placeholder step:
   - `.github/workflows/refine.yml:50` — `run: echo "Refiner placeholder"`
   - `.github/workflows/dev.yml:34` — `run: echo "Developer placeholder"`
   - `.github/workflows/review.yml:34` — `run: echo "Reviewer placeholder"`
   - `.github/workflows/iterate.yml:34` — `run: echo "Iterator placeholder"`
2. Agent entry-points are empty stubs:
   - `src/agents/refiner/index.ts`, `developer/index.ts`, `reviewer/index.ts`, `iterator/index.ts` are all `export {}`.
3. No real Jira HTTP client exists. `src/lib/io/jira.ts:36-37`:
   ```typescript
   // TODO(1-6b): integrate secret scanning before any outbound write.
   // TODO(1-?): replace with real Jira API call.
   ```
4. No real GitHub HTTP client exists. `src/lib/io/github.ts:39-40` has the same scaffold pattern.
5. No real LLM HTTP client exists. `src/lib/llm/{config,route}.ts` resolves *which* model to use; nothing implements the `LlmCall` interface that agent sub-modules accept as a callback.
6. `mapError` (`src/lib/error-taxonomy/index.ts`) has zero callers in `src/agents/` or `src/lib/audit/` — error handling is unwired.
7. `start_ms: ${{ github.run_id }}` in 5 workflow files passes a numeric run ID rather than epoch ms (corrupts every audit row's `duration_ms`).
8. `reconciler.yml:37` passes `run_id: ${{ github.run_id }}` instead of a ULID, breaking the dedupe/ordering invariant for reconciler-emitted events.

### Behavioural consequence

If a Jira ticket were moved into a Ferry column today, the workflow would dispatch, validate the envelope, dedupe, run `echo`, emit a synthetic "success" audit row with a 55-year `duration_ms`, and exit. **No sub-tasks would be created. No branch. No PR. No review.** The pilot cannot run.

### Issue category

**Misunderstanding of original requirements** — specifically a definition-of-done mismatch. The Epic 1–9 story files marked themselves `done` when the corresponding library module shipped with passing unit tests. This was internally consistent but did not include the integration step (entry-point + workflow wiring + real HTTP clients), which was nobody's explicit story.

---

## 2. Impact Analysis

### Epic impact

| Epic | Status (claimed) | Status (actual) | Change required |
| --- | --- | --- | --- |
| 1 — Foundation | done | partial — schema/state/preflight/audit lib done; HTTP clients are scaffolds | No epic change. Foundational work was correctly scoped at lib level. |
| 2 — Event Routing | done | partial — envelope validation + dedupe + dispatch routing done; agent step is `echo` | No epic change. Routing works; only the destination is empty. |
| 3 — Refiner | done | partial — refine/batch/empty logic done; orchestration + Jira REST not wired | No epic change. Stories defined logic; integration becomes new epic. |
| 4 — Developer | done | partial — context/diff/pr/commit formatters done; orchestration + Git/GitHub REST not wired | Same. |
| 5 — Reviewer | done | partial — ci-gate/schema/verdict/transition done; orchestration + GitHub Checks not wired | Same. |
| 6 — Iterator | done | partial — prompt/cap/transition done; orchestration not wired | Same. |
| 7 — Human Control | done | partial — preflight halt-labels + policy guards done; effective only when agents run | Becomes effective once Epic 10 lands. No epic change. |
| 8 — Observability | done | partial — audit emission + spend cap + reconciler cron logic done; will produce real data only when agents run | Same. |
| 9 — Human-Reader | done | partial — TL;DR / verdict / escalation block formatters done; PR-body writer not wired | Same. |

**Net**: no Epic 1–9 needs to be re-opened or rolled back. The library-level work is sound. **One new epic is needed: Epic 10 — Agent Integration Layer.**

### Story impact

- No existing stories require modification or rollback.
- 11 new stories needed under Epic 10 (detailed in Section 4).

### Artifact conflicts

| Artifact | Conflict? | Action |
| --- | --- | --- |
| PRD (`docs/prd.md`) | No | No FR changes; coverage is still correct in principle. |
| Architecture (`_bmad-output/planning-artifacts/architecture.md`) | No structural conflict | Add section noting that decisions D2 (envelope), D4 (LLM harness), D5 (audit) are realised at the *library* level by Epics 1–9 and at the *runtime* level by Epic 10. |
| Implementation-readiness report (`implementation-readiness-report-2026-04-27.md`) | **Yes — false positive** | Add an addendum: the report counted FR coverage at the spec/library level; it did not verify that workflow YAML invokes agent code. Future readiness checks must include a runtime-coverage gate. |
| Epics (`epics.md`) | No conflict, requires extension | Append Epic 10 section. |
| UX Design | N/A | No UX impact (operator UX unchanged). |
| Sprint status (`sprint-status.yaml`) | Requires update | Add `epic-10` block with 11 stories at `backlog`. |
| Retrospective (`epic-9-retro-2026-04-28.md`) | **Yes — overstates completion** | Add a follow-up note acknowledging the integration-layer gap and pointing to this proposal. Do not rewrite the original; preserve the historical record. |

### Technical impact

- Adds: `src/lib/io/jira-rest.ts`, `src/lib/llm/call.ts`, `src/lib/error-taxonomy/format.ts`, four agent `index.ts` orchestrators, `dist/audit-emit.cjs` bundle, `scripts/{build-audit-bundle,check-workflow-shape,print-ulid}.ts`, `docs/{e2e-smoke,operations}.md`.
- Replaces scaffold bodies in: `src/lib/io/jira.ts`, `src/lib/io/github.ts`, and the `unknown`-case context substitution in `src/lib/error-taxonomy/index.ts:11`.
- Modifies: 5 workflow YAML files, 1 composite action.
- New runtime secrets: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`. Existing: `GITHUB_TOKEN`, LLM provider keys.
- No data-model migration. No deployment-topology change. State artifact location, dispatch contract, audit storage all unchanged.

---

## 3. Path Forward Evaluation

### Option 1 — Direct Adjustment

Add Epic 10 to address the integration gap. Keep all Epic 1–9 work intact. Sequence Epic 10 stories in pipeline order (foundational clients → agent entry-points → workflow rewrites → smoke test).

- **Effort:** Medium (11 stories, 3 of which are real HTTP clients with their own scope risk).
- **Risk:** Medium. Largest unknowns are Jira REST edge cases (custom fields, transition ID lookup, ADF comment format) and provider-specific LLM error mapping.
- **Verdict:** ✅ Viable.

### Option 2 — Potential Rollback

Roll back stories 4-1..4-4, 5-1..5-4, 6-1..6-5, 9-1..9-2 (Developer, Reviewer, Iterator, Human-Reader) and re-do them as integration stories that include orchestration.

- **Effort:** High (re-doing 15 stories already merged).
- **Risk:** High. Throws away tested library code. Loses unit-test coverage of pure logic. Doesn't change the work needed; just reorganises blame.
- **Verdict:** ❌ Not viable.

### Option 3 — PRD MVP Review

Reduce MVP scope. Remove agents (e.g. ship only Refiner; defer Developer/Reviewer/Iterator). Or remove agent dispatch entirely and keep only the dispatch-and-audit skeleton.

- **Effort:** Low to write the PRD change; high to communicate to stakeholders that the pilot is descoped.
- **Risk:** High to the product. Ferry's value proposition is the closed Dev↔Review loop; without it, the system is a glorified Jira-to-GHA dispatcher.
- **Verdict:** ❌ Not viable. The original MVP is the right one; it just isn't yet implemented.

### Recommended path: Option 1 — Direct Adjustment

**Justification:**
- All Epic 1–9 work is reusable; nothing to throw away.
- Integration is a discrete, finite scope: 11 stories with clear boundaries.
- No PRD change required; original product vision intact.
- Existing TDD discipline transfers cleanly to integration stories.
- Resequencing existing epics buys nothing because the gap is orthogonal to their content.

---

## 4. Detailed Change Proposals

### 4.1 Epic addition — `_bmad-output/planning-artifacts/epics.md`

Append a new section after Epic 9:

```markdown
## Epic 10: Agent Integration Layer

The operator can move a Jira ticket through Ferry phases and observe real
agent behaviour: sub-tasks created, branches and PRs opened, findings posted,
iterations applied. Closes the runtime gap between the library modules
delivered in Epics 1–9 and a deployable pilot.

**FRs covered:** Realises (does not add) FR1–FR60 at the runtime level.
Specifically wires FR8–FR12 (Refiner), FR14–FR18 (Developer),
FR19–FR24, FR57–FR58 (Reviewer), FR25–FR29, FR59 (Iterator),
FR41 (audit duration_ms correctness), FR47 (Jira write secret scan),
FR50–FR51 (reconciler ULID).

**Stories:**
10-1  Real Jira REST client                                — `src/lib/io/jira-rest.ts`
10-2  Real LLM HTTP client                                 — `src/lib/llm/call.ts`
10-3  Real GitHub REST extension                            — `src/lib/io/github.ts` (replace scaffold)
10-4  Error-taxonomy formatter & sanitiser                  — `src/lib/error-taxonomy/format.ts`
10-5  Refiner entry-point orchestration                     — `src/agents/refiner/index.ts`
10-6  Developer entry-point orchestration                   — `src/agents/developer/index.ts`
10-7  Reviewer entry-point orchestration                    — `src/agents/reviewer/index.ts`
10-8  Iterator entry-point orchestration                    — `src/agents/iterator/index.ts`
10-9  Workflow YAML wiring + start_ms + reconciler ULID     — `.github/workflows/*.yml`
10-10 Pre-bundled audit composite action                    — `dist/audit-emit.cjs`
10-11 End-to-end smoke runbook + audit-Issue invariant doc — `docs/{e2e-smoke,operations}.md`
```

**Rationale:** The 11 stories collectively assemble the library modules from Epics 1–9 into runnable agents. Story scope and ordering already validated by the technical plan at `~/.claude/plans/generate-the-plan-hazy-wind.md`.

### 4.2 Architecture addendum — `_bmad-output/planning-artifacts/architecture.md`

Append a new subsection after `## Architecture Validation Results`:

```markdown
## Implementation Reality Note (2026-04-28)

Decisions D2 (event envelope), D4 (LLM harness), D5 (audit storage)
were realised at the **library** level in Epics 1–9. Their **runtime**
realisation — the wiring that turns library modules into running
agents — is delivered by Epic 10. Specifically:
  - D4 LLM harness: `src/lib/llm/{config,route}.ts` resolves model
    selection (Epic 1, Story 1.7); the actual `callLlm` HTTP
    implementation is `src/lib/llm/call.ts` (Epic 10, Story 10-2).
  - D5 audit writer: `src/lib/audit/index.ts::emitAudit` formats
    rows (Epic 1, Story 1.5); the workflow integration that supplies
    real `start_ms` and ULID `run_id` is Story 10-9.
  - Jira REST and GitHub REST clients: scaffold-only in Epic 1
    (`io/jira.ts`, `io/github.ts`); real implementations in Epic 10
    (Stories 10-1, 10-3).

This split was unintentional and is reflected in the
sprint-change-proposal-2026-04-28.md.
```

**Rationale:** Preserves architectural intent while honestly recording the library/runtime split.

### 4.3 Implementation-readiness report addendum — `implementation-readiness-report-2026-04-27.md`

Append a new section at the end:

```markdown
## Addendum 2026-04-28: Library/Runtime Coverage Gap

This report's "FR coverage" matrix counts a requirement as covered
when a story file references it and when the corresponding library
module exists with passing unit tests. It does **not** verify that
the runtime entry points (`src/agents/*/index.ts`) and workflow
steps (`.github/workflows/*.yml`) actually invoke that library code.

After 9 epics declared `done`, runtime inspection found:
  - All four agent workflows still run `echo "<role> placeholder"`
  - All four `src/agents/*/index.ts` are empty `export {}`
  - `src/lib/io/{jira,github}.ts` are scaffolds with `TODO: replace
    with real API call`
  - No `callLlm` implementation exists

**Recommendation for future readiness checks:** add a runtime-coverage
gate that, for each FR claiming coverage, traces from the workflow
YAML through the agent entry-point down to the relevant library
function and asserts the path is unbroken.

This gap is addressed by Epic 10 (see
sprint-change-proposal-2026-04-28.md).
```

### 4.4 Retrospective follow-up note — `epic-9-retro-2026-04-28.md`

Append a new section at the end of the retro document:

```markdown
## Follow-up note (2026-04-28, post-retro)

After this retrospective, deeper inspection revealed that Epics 1–9
were complete at the library level but not at the runtime level. See
`sprint-change-proposal-2026-04-28.md` and Epic 10. The retro's
"all 60 FRs covered" statement was true at the spec level only; this
note preserves the original record while flagging the limitation.
```

### 4.5 Sprint-status update — `_bmad-output/implementation-artifacts/sprint-status.yaml`

Add after the Epic 9 block:

```yaml
  # ─────────────────────────────────────────────────────────────
  # Epic 10: Agent Integration Layer
  # ─────────────────────────────────────────────────────────────
  epic-10: backlog
  10-1-real-jira-rest-client: backlog
  10-2-real-llm-http-client: backlog
  10-3-real-github-rest-client: backlog
  10-4-error-taxonomy-formatter-and-sanitiser: backlog
  10-5-refiner-entry-point-orchestration: backlog
  10-6-developer-entry-point-orchestration: backlog
  10-7-reviewer-entry-point-orchestration: backlog
  10-8-iterator-entry-point-orchestration: backlog
  10-9-workflow-yaml-wiring-and-reconciler-ulid: backlog
  10-10-pre-bundled-audit-composite-action: backlog
  10-11-e2e-smoke-runbook-and-audit-invariant-doc: backlog
  epic-10-retrospective: optional
```

Update `last_updated` field to `"2026-04-28T00:00:00Z"` with comment `Epic 10 added — agent integration layer`.

### 4.6 PRD changes

**None.** The PRD is correct. No FR additions, modifications, or removals.

### 4.7 UX changes

**None.** Operator UX (Jira columns, GitHub PRs, audit Issue) unchanged.

---

## 5. Implementation Handoff

### Scope classification

**MODERATE.**

- Not Minor: 11 stories, three of which are real HTTP clients with their own scope risk. Requires backlog ordering and per-story specs.
- Not Major: no PRD change, no architectural redesign, no team-structure or product-vision shift. The work is well-scoped; it's just been mis-counted as done.

### Handoff plan

| Step | Owner | Skill / artifact |
| --- | --- | --- |
| 1. Apply edit proposals (Sections 4.1–4.5) | User (Jnk) | Manual edits or `bmad-edit-prd`-style flow per artifact |
| 2. Generate per-story specs in `_bmad-output/implementation-artifacts/10-N-*.md` | Developer agent | `bmad-create-epics-and-stories` to extend, then `bmad-create-story` per story |
| 3. Re-run readiness check on extended plan | Developer agent | `bmad-check-implementation-readiness` — verify the new runtime-coverage gate from Section 4.3 catches future regressions |
| 4. Sprint planning | Developer agent | `bmad-sprint-planning` to sequence stories per the dependency graph in `~/.claude/plans/generate-the-plan-hazy-wind.md` |
| 5. Per-story execution (TDD) | Developer agent | `bmad-create-story` → `bmad-dev-story` → `bmad-code-review` per Story 10-1..10-11 |
| 6. End-to-end smoke run | User + Developer agent | Story 10-11's `docs/e2e-smoke.md` runbook |
| 7. Epic 10 retro | Developer agent | `bmad-retrospective` after smoke passes |

### Success criteria

1. All 11 Epic 10 stories pass their unit tests.
2. `actionlint` and `scripts/check-workflow-shape.ts` pass — every workflow audit step receives a ULID `run_id` and an epoch-ms `start_ms`.
3. `git diff --exit-code dist/` is clean in CI (audit bundle is in sync).
4. End-to-end smoke run produces ≥4 real audit rows in the `ferry-audit` Issue, monotonic ULIDs, all `duration_ms < 24h`, all `outcome` values from the typed taxonomy.
5. A real PR opened by the Developer agent contains a valid TL;DR block on first push.
6. Re-running `bmad-check-implementation-readiness` reports zero gaps — including the new runtime-coverage gate.

### Dependencies and sequencing

```
10-1 (Jira REST)   ┐
10-2 (LLM call)    │  parallel (no inter-deps)
10-3 (GitHub REST) │
10-4 (taxonomy)    ┘
10-10 (audit bundle, parallel with everything)
       ↓
10-5 refiner   →   10-6 developer   →   10-7 reviewer   →   10-8 iterator
       ↓                  ↓                    ↓                  ↓
       10-9 workflow rewrites (per-agent block lands alongside its agent)
                                                                 ↓
                                                          10-11 e2e smoke (last)
```

### Risks

- **R-A (HIGH):** Real Jira REST integration may surface tenant-specific edge cases (custom field IDs, transition workflow IDs, ADF comment payload format). Mitigation: write 10-1 against a sandbox tenant first, capture observed payloads as fixtures.
- **R-B (MEDIUM):** Some library modules may have latent TODOs that block their callers (e.g. preflight). Mitigation: Story 10-5 starts with a "wire-test" that imports each lib function used and asserts a non-throwing happy path; surface latent gaps as supplementary stories.
- **R-C (MEDIUM):** Implementation-readiness check needs a new runtime-coverage gate (§4.3 recommendation). Without it, the same class of gap could recur.
- **R-D (LOW):** Bundle-freshness CI check (Story 10-10) adds friction. Worth it; alternative is silent audit-row loss.

---

## 6. Approval

**This proposal requires explicit user approval before edits land in `_bmad-output/planning-artifacts/`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, the retrospective, or the readiness report.**

Approval also authorises the handoff sequence in Section 5: extending epics.md, generating story files, and starting sprint planning for Epic 10.

---

## Appendix — Checklist execution log

| ID | Item | Status |
| --- | --- | --- |
| 1.1 | Triggering story | [N/A] No single story; gap discovered post-Epic-9 retro |
| 1.2 | Core problem defined | [x] Done — §1, "Misunderstanding of original requirements (definition-of-done mismatch)" |
| 1.3 | Evidence gathered | [x] Done — §1, 8 concrete code-level citations |
| 2.1 | Current epic completable | [x] Done — Epic 9 was; all 9 are at library level |
| 2.2 | Epic-level changes | [x] Done — add Epic 10; no changes to 1–9 |
| 2.3 | Future epics impacted | [N/A] None planned beyond 9 |
| 2.4 | Future epics invalidated | [N/A] |
| 2.5 | Epic priority changes | [N/A] |
| 3.1 | PRD conflicts | [x] Done — none |
| 3.2 | Architecture conflicts | [x] Done — addendum needed (§4.2) |
| 3.3 | UI/UX conflicts | [x] Done — none |
| 3.4 | Other artifacts | [x] Done — readiness report addendum (§4.3), retro follow-up (§4.4), sprint-status update (§4.5) |
| 4.1 | Direct Adjustment viable | [x] Viable — recommended |
| 4.2 | Rollback viable | [x] Not viable |
| 4.3 | MVP Review viable | [x] Not viable |
| 4.4 | Path selected | [x] Done — Option 1 |
| 5.1 | Issue summary | [x] Done — §1 |
| 5.2 | Epic + artifact impact | [x] Done — §2 |
| 5.3 | Recommended path + rationale | [x] Done — §3 |
| 5.4 | MVP impact + action plan | [x] Done — MVP unchanged; §4 + §5 are the action plan |
| 5.5 | Agent handoff | [x] Done — §5 |
| 6.1 | Checklist completion | [x] Done — this table |
| 6.2 | Proposal accuracy | [x] Done |
| 6.3 | User approval | [x] Approved 2026-04-28 |
| 6.4 | Sprint-status update | [x] Done — epic-10 block added to sprint-status.yaml |
| 6.5 | Next steps confirmed | [x] Done — handoff plan §5 confirmed |
