# 0005 — No Auto-Merge Invariant

**Status:** Accepted (amended by FR32)  
**Date:** 2024-01-01  
**Amended:** 2026-06-07

## Context

Ferry's Reviewer agent evaluates PRs and reaches a binary verdict: approved or changes required. When a PR is approved, the natural next question is: should Ferry merge it?

Auto-merging carries significant risk. A merge is a deployment event — it changes the target branch's history and can trigger CI/CD pipelines, package publishing, or production deployments. Human teams have varied and legitimate reasons to gate merges separately from code approval: release windows, dependent changes in other PRs, staged rollouts, compliance sign-offs, and stakeholder communication.

Ferry also runs with broad permissions inside consumer repositories (it needs to push branches, create PRs, and post comments). If the agent could merge, a bug in the Reviewer's verdict logic — or a prompt injection attack through a malicious PR description — could cause an unintended merge into the main branch.

## Decision

Ferry never merges a PR. This invariant is enforced at two independent layers:

### 1. Sandbox deny-list (runtime enforcement)

The Developer agent (the agent most likely to attempt shell commands) is guarded by a bash pattern deny-list in `src/agents/developer/sandbox.ts`. The list explicitly blocks:

```
/\bgh\s+pr\s+merge\b/
```

Any bash command matching this pattern throws immediately with a `deny-list` error before execution. This is tested in `src/agents/developer/sandbox.test.ts`.

The same deny-list also blocks `git push`, `git reset --hard`, `git rebase`, `rm -rf`, `sudo`, and outbound network tools (`curl`, `wget`) to limit the blast radius of agent errors generally.

### 2. Reviewer agent architecture (no merge code path)

The Reviewer agent's approval path (`src/agents/reviewer/review-action.ts`) deliberately stops at:

- Posting an approval comment with a `[ferry:reviewer:<sha>]` marker
- Adding the `ferry:approved` label to the PR

There is no call to `gh pr merge`, no API call to GitHub's merge endpoint, and no transition that would signal downstream automation to merge. The ticket remains in its current Jira column; stakeholders receive the `ferry:approved` label as a signal and decide when to merge.

### What enforces the invariant

| Layer         | Mechanism                                    | Location                               |
| ------------- | -------------------------------------------- | -------------------------------------- |
| Runtime       | Bash deny-list regex `/\bgh\s+pr\s+merge\b/` | `src/agents/developer/sandbox.ts`      |
| Architecture  | No merge call in Reviewer approval path      | `src/agents/reviewer/review-action.ts` |
| Documentation | Explicit statement in CLAUDE.md              | `CLAUDE.md` line 23                    |
| Tests         | Unit test asserting deny-list blocks merge   | `src/agents/developer/sandbox.test.ts` |

### Jira transition behaviour on approval

On the approval path, the Reviewer does **not** auto-transition the Jira ticket (compare FR24 which transitions on "changes required"). The ticket stays in the Review column until a human moves it to Done or Approved. This mirrors the merge decision: both require human intent.

## Consequences

**Positive:**

- Consumers retain full control over merge timing, regardless of their release process.
- A bug in Ferry's Reviewer logic cannot cause an unintended main-branch mutation.
- The `ferry:approved` label is a clean, observable signal that works with any merge strategy: manual click, GitHub auto-merge rules, or a separate merge bot.
- The sandbox deny-list provides defense-in-depth even if a future agent prompt is manipulated.

**Negative:**

- Teams that want fully automated end-to-end delivery must add their own merge automation (e.g., a GitHub Action triggered by the `ferry:approved` label, or enabling GitHub's "auto-merge" feature on the PR).
- The invariant is not enforced by GitHub branch protection alone — a consumer who grants the Ferry GitHub App `Contents: write` permission could theoretically call the merge API outside of Ferry. The deny-list only covers bash commands executed by the agent loop.

## FR32 Amendment — Merger role exception

**FR32** introduces the Merger agent, the single role in the Ferry pipeline that is explicitly permitted to run `gh pr merge`. This is a deliberate, gated exception to the invariant above.

### What changed

The Merger's claude-code path `--disallowedTools` list was updated from:

```
--disallowedTools 'Bash(gh pr merge),Bash(gh pr merge:*),Bash(gh pr close:*)'
```

to:

```
--disallowedTools 'Bash(gh pr close),Bash(gh pr close:*)'
```

`gh pr merge` is no longer on the deny-list for the Merger; `gh pr close` remains blocked for all roles including the Merger.

All four other roles (Refiner, Developer, Reviewer, Iterator) retain the original full ban.

### Gating mechanism

The Merger is triggered exclusively by a `ferry-merge` repository dispatch event. That event is emitted only by the Reviewer agent at approve time (FR24 approve path). The chain is:

```
Reviewer approve → ferry-merge dispatch → Merger → gh pr merge
```

No other Ferry agent, workflow, or external caller can trigger the Merger without explicitly dispatching `ferry-merge`.

### Branch-protection caveat

The `ferry:approved` label added by the Reviewer on the `ferry-merge` dispatch is **not** the same as a formal GitHub pull request review approval. GitHub branch protection rules that require a minimum number of PR review approvals are **not satisfied** by the `ferry:approved` label alone.

Consumers who rely on branch-protection rules requiring human PR review approvals must ensure those approvals are in place before the Merger runs, or configure branch protection to allow the Ferry GitHub App to bypass the requirement. See `docs/CONFIGURATION.md` for details on Ferry's permission requirements.

### Regression guard

`src/cli/init/templates.test.ts` contains an explicit regression test (describe block `workflowTemplates — merge authority (FR32)`) that asserts:

- `ferry-merge.yml` does **not** contain `Bash(gh pr merge)` in `--disallowedTools`
- `ferry-merge.yml` does contain `Bash(gh pr close)` in `--disallowedTools`
- All four other role templates (`ferry-refine.yml`, `ferry-dev.yml`, `ferry-review.yml`, `ferry-iterate.yml`) still contain `Bash(gh pr merge)` in `--disallowedTools`

## Alternatives Considered

**Auto-merge on Reviewer approval** — rejected. The Reviewer approves code correctness, not deployment readiness. Merging bypasses human release decisions, compliance gates, and coordinated rollout timing. The risk of an incorrect auto-merge outweighs the convenience.

**Opt-in auto-merge via configuration flag** — evaluated. A `FERRY_AUTO_MERGE=true` environment variable would let teams that trust the pipeline opt into automatic merging. Rejected because it creates a footgun with no secondary confirmation and shifts the mental model of Ferry from "approval assistant" to "deployment bot." Teams that want this are better served by GitHub's built-in auto-merge feature, which provides a PR-level opt-in with full audit trail.

**Merge via GitHub's auto-merge feature (not Ferry's code)** — acceptable and recommended for teams that want it. Consumers can enable auto-merge on the PR at creation time (Developer agent creates the PR; a separate workflow enables auto-merge based on the `ferry:approved` label). This keeps the merge decision in GitHub's audit trail and outside Ferry's code entirely.
