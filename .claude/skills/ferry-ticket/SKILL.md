---
name: ferry-ticket
description: End-to-end local automation for a single Jira ticket on the Ferry repo. Paste a FER ticket URL (or key) and the skill self-assigns the ticket, reads it, refines it, creates the Jira sub-tasks, branches off main in an isolated git worktree, implements the work test-first (rebuilding .ferry/ bundles when src/ changes), opens the pull request, then moves the ticket to In Review and comments the PR link. Runs fully automatically with no confirmation gates. Use when the user pastes a FER ticket link, says "prends ce ticket", "implémente ce ticket Jira", "traite ce ticket", or invokes /ferry-ticket.
metadata:
  author: jnk
  version: '1.0.0'
---

# Ferry Ticket

Take a single Jira ticket from link to merge-ready PR, locally and unattended.

This is the **local, interactive, on-demand** counterpart to the Ferry pipeline itself (which runs the same lifecycle async/cloud via Jira Automation → `repository_dispatch`). It does not dispatch Ferry; it does the work directly on the developer's machine. To avoid divergence with the pipeline, **column names and branch settings are read from `ferry.config.json` at runtime when the file exists** — never hard-coded when a config value is available.

## Operating mode — FULL AUTO

The user chose **no confirmation gates**. The skill runs the entire chain — assign → read → refine → sub-tasks → branch → implement → PR → Jira transition + comment — without stopping to ask.

"Full auto" removes _confirmation_ prompts. It does **not** remove _safety blockers_: hard preconditions where proceeding would corrupt shared state or produce a broken PR. On a safety blocker the skill **stops and reports** — it does not guess or force through.

## When to Activate

- User pastes a Jira ticket URL (e.g. `https://big-emotion.atlassian.net/browse/FER-12`) or a bare issue key.
- User says: "prends ce ticket", "implémente / traite ce ticket Jira", "fais ce ticket".
- User invokes `/ferry-ticket <jira-url-or-key>`.

## Inputs

A single argument: the Jira ticket URL or issue key.

- Accept `.../browse/KEY-123`, `...selectedIssue=KEY-123`, or a bare `KEY-123`.
- Extract the issue key with the regex `[A-Z][A-Z0-9]+-\d+`. If zero or more than one distinct key is found, **stop** and ask for the exact key (ambiguous input is a safety blocker).

## Preconditions (safety blockers — stop and report if any fail)

1. **Repo root** — `package.json` `.name` is `@big-emotion/ferry`. If not, stop and tell the user to `cd` in.
2. **Atlassian MCP reachable** — `getAccessibleAtlassianResources` returns at least one site. Resolve and keep `cloudId` for every subsequent Jira call. If it fails, stop.
3. **gh authenticated** — `gh auth status` succeeds for `big-emotion/ferry`.
4. **Base branch fetchable** — `git fetch origin` succeeds and `origin/<base_branch>` exists. Implementation runs in a dedicated worktree (Step 5), so the user's main checkout need not be clean — but the worktree must be cut from a real remote base branch.

Load configuration from `ferry.config.json` **when the file exists at the repo root** (it arrives with the dogfooding install):

- `base_branch` = `.git.base_branch` (fallback when null/absent: `main`)
- `target_branch` = `.git.target_branch` (fallback: `main`)
- `review_column` = `.workflow.agents.developer.auto_transition` (fallback: `In Review`)

If the file is absent entirely, use all three fallbacks and note it in the final report. Never substitute literals when a config value is available — if `ferry.config.json` changes, the skill must follow.

## Workflow

### Step 1 — Resolve ticket and Jira identity

- `cloudId` from `getAccessibleAtlassianResources`.
- `getJiraIssue(cloudId, issueIdOrKey=FER-12)` — fetch summary, description, issue type, status, acceptance criteria, existing sub-tasks, comments.
- `atlassianUserInfo` → own `accountId` (the assignee).

### Step 2 — Self-assign

- `editJiraIssue(cloudId, FER-12, fields={ assignee: { accountId: <own> } })`.
- If the ticket is already assigned to someone else, still assign to self (the user explicitly wants to take the ticket) but note the previous assignee in the final report.

### Step 3 — Read & refine

- Summarise the ticket's intent, scope, and acceptance criteria.
- **Surface assumptions explicitly**: any ambiguous requirement gets a stated assumption rather than a silent guess.
- **Apply the Ferry repo rules (mandatory — see `CLAUDE.md`):**
  1. **Bundle rule** — if the ticket touches `src/`, a sub-task (or the closing step of the last sub-task) must run `npm run build:ferry` and commit the regenerated `.ferry/` bundles in the same PR. CI (`check:bundle`) fails on drift. Never edit `.ferry/` directly.
  2. **Agent isolation** — code under `src/agents/**` never imports `@octokit/rest` or Jira modules directly; all IO goes through `src/lib/dispatch/runner/github-actions/`, `src/lib/io/tracker/factory.ts`, `src/lib/llm/`. ESLint enforces this; plan accordingly.
  3. **CODEOWNERS caution** — `.github/**`, `src/schemas/**`, and `prompts/*.md` are protected paths. Flag in the refinement when the ticket touches them: schema changes are migrations (backward compat unless intentionally breaking), workflow changes affect all consumers, prompt changes impact production runs.
  4. **FR registry rule** — if the ticket ships behavior carrying an `FRnn` tag (new or changed), `docs/REQUIREMENTS.md` must gain/update the entry in the same PR; `npm run check:fr-drift` gates it.
  5. **Idempotency contract** — any new external write (comment, label, transition) must be fingerprinted/repeatable per the `[ferry:<role>:<run-id>]` convention.
- Write the refined breakdown back to Jira as a comment (`addCommentToJiraIssue`) so the refinement is visible — concise: intent, assumptions, sub-task list with dependency ordering (bundle rebuild last, agent-isolation and CODEOWNERS flags called out).

### Step 4 — Create sub-tasks in Jira

- For each refined item, `createJiraIssue(cloudId, fields={ project: FER, parent: { key: FER-12 }, issuetype "Sous-tâche", summary, description })`.
  - Resolve the exact sub-task issue type name via `getJiraProjectIssueTypesMetadata` (FER is team-managed; the sub-task type is `Sous-tâche`, id `10286` at the time of writing — always re-resolve).
- **Order matters**: dependency sub-tasks first; the `.ferry/` rebuild is always the final step before the PR. Each dependency sub-task's description states what cannot start until it is done.
- Collect the created sub-task keys; they drive the implementation plan and the PR checklist.

### Step 5 — Create an isolated worktree off the base branch

All implementation happens in a **dedicated git worktree**, never in the user's main checkout.

- `git fetch origin`.
- Branch name: `<prefix>/<key-lower>-<slug>` where:
  - `prefix` = `fix` if the ticket carries the `bug` label, else `feat`.
  - `key-lower` = the issue key lowercased; `slug` = kebab-cased, ASCII, ≤ 5 words from the summary.
  - **Never use the `ferry/` prefix** — that namespace belongs to the Ferry pipeline's own branches (`ferry/<TICKET>`); colliding with it would confuse the Reviewer/Iterator/Merger workflows once dogfooding is live.
- Worktree path: a sibling of the repo root — `<repo-parent>/ferry-worktrees/<key-lower>-<slug>` (outside the repo so tooling never scans it).
- Create branch + worktree in one step, cutting from the **remote** base branch:
  `git worktree add -b <branch> <worktree-path> origin/<base_branch>`
- **Every subsequent step — implement, verify, commit, push, open PR — runs with the worktree as the working directory.** Pass it as `cwd` to Bash calls and as the repo path in every sub-agent brief.

### Step 6 — Implement (parallel sub-agents)

Follow TDD and KISS (user `CLAUDE.md`): tests before code, simplest design that satisfies acceptance criteria, surgical scope.

Dependency-aware execution:

1. **Independent sub-tasks run in parallel** via the `Agent` tool (`general-purpose`, or `test-engineer` for test-heavy slices), launched in a single message so they run concurrently. Each sub-agent gets a self-contained brief: the worktree path as working directory, the sub-task summary, acceptance criteria, relevant file paths, and the repo constraints — strict TS NodeNext ESM (`.js` import specifiers on local imports, no `any`), tests colocated next to implementation, all external IO mocked in tests, TDD. All sub-agents share the one worktree (different sub-tasks of the same branch) — do not give them separate worktree isolation.
2. **Prompts discipline** — if a sub-task edits `prompts/*.md`, keep the bundled default generic; consumer-specific behavior belongs in `prompts/*.extra.md` composition, not in the default prompt.
3. **The `.ferry/` rebuild runs last, alone**, after all `src/` sub-tasks are merged into the branch: `npm run build:ferry`, then commit the `.ferry/` diff.

### Step 7 — Verify (safety blocker if it fails)

Before any PR, all of these must pass on the branch, from the worktree:

```bash
npm run typecheck && npm run lint && npm run format:check && npm test
```

Also run when relevant: `npm run check:fr-drift` (FR-tagged behavior changed) and `npm run check:bundle` (src/ changed — proves `.ferry/` matches).

If a check fails, iterate on the implementation to fix the **root cause** (do not disable checks, do not `--no-verify`). If genuinely unrecoverable, **stop and report** — never open a broken PR.

### Step 8 — Commit & push

- Commit per sub-task (or logically grouped), Conventional Commits, message references the Jira key (e.g. `feat(reviewer): make ci gate opt-out (FER-12)`).
- **Never add `Co-Authored-By` trailers** (user `CLAUDE.md`).
- Commit messages, code comments, PR body — **English** (user `CLAUDE.md`).
- `git push -u origin <branch>`.

### Step 9 — Open the pull request

```bash
gh pr create --repo big-emotion/ferry \
  --base <target_branch> --head <branch> \
  --title "<type>(<scope>): <summary> (FER-12)" \
  --body "$(cat <<'EOF'
## Summary
<1-3 bullets — what and why>

Jira: <full ticket URL>

## Sub-tasks
- [x] <sub-task FER-13 summary>
- [x] <sub-task FER-14 summary>

## Test plan
- [ ] <how to verify each acceptance criterion>

## Repo gates
- [ ] typecheck / lint / format:check / test green locally
- [ ] .ferry/ rebuilt (`npm run build:ferry`) — or "N/A, no src/ change"
- [ ] docs/REQUIREMENTS.md updated — or "N/A, no FR-tagged behavior change"

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR URL. **Never merge or close the PR. Never push to `main`.** If the ticket touches CODEOWNERS-protected paths, note in the PR body that codeowner review is required.

### Step 10 — Transition Jira to review + comment

- `getTransitionsForJiraIssue(cloudId, FER-12)` → find the transition whose **target status name** equals `review_column` (from `ferry.config.json` when present, else `In Review`). Match on the target status name, not the transition's own name.
- `transitionJiraIssue(cloudId, FER-12, transition=<id>)`.
- `addCommentToJiraIssue(cloudId, FER-12, "PR ready for review: <PR URL>")`.
- If no transition leads to `review_column`, do not invent one — leave the ticket where it is, still post the PR-link comment, and flag the missing transition in the final report.

### Step 11 — Report

End-of-turn summary (one or two sentences): the ticket key, the branch, the worktree path (kept for follow-up — remove with `git worktree remove <path>` once the PR is merged), the PR URL, the Jira status it now sits in, and any flagged anomalies (previous assignee overridden, missing transition, config fallbacks used, assumptions made during refinement).

## Failure handling

- Safety blockers (Preconditions, Step 7 verification, ambiguous issue key) → **stop and report**, leave shared state untouched.
- Recoverable implementation failures → iterate to root cause within the implementation loop.
- Never disable quality gates, never `--no-verify`, never force-push, never open a knowingly-broken PR.
- If a Jira write fails mid-chain (e.g. sub-task creation), report exactly what was created vs. not so the user can reconcile manually — do not retry blindly in a loop.

## Relationship to the Ferry pipeline

Once dogfooding is live, the same ticket could instead be handed to the cloud pipeline by moving it into the Refinement column. Use this skill when you want the work done **now, locally, under your eyes** — e.g. pipeline outages, credentials work the pipeline can't do, or changes to the pipeline itself that would be awkward to self-apply. The two paths share the ticket contract (`docs/templates/jira-ticket-template.md`) and the column names (`ferry.config.json`), so a ticket is portable between them.

## Cleanup

If any temporary files are created during verification, delete them immediately after use (user `CLAUDE.md`).
