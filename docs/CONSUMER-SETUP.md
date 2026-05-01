# Installing Ferry — From Zero to First Merged PR

**Estimated time: 20–25 min** (first install; ~5 min on repeat installs).

> **Acceptance contract:** This guide is the release definition-of-done for Ferry. Every step must execute on a clean machine without improvisation, undocumented edits, or Slack assistance. The release does not ship until a volunteer who has never seen Ferry can follow this guide top-to-bottom and reach Phase 6 with all checkmarks green in ≤ 25 minutes.

---

## Prerequisites

- [ ] GitHub account with a target repo (avoid a protected `main` for the first test)
- [ ] Atlassian / Jira Cloud account with project admin rights
- [ ] [GitHub CLI](https://cli.github.com/) installed and authenticated (`gh auth login`)
- [ ] Anthropic API credit (~$5 is enough to start)
- [ ] Node.js ≥ 20 locally (only for optional local debugging — not required to run Ferry)

---

## What Ferry Does

```
Jira column move → GitHub repository_dispatch → Agent runs → Jira auto-transitions
```

Four agents chain automatically:

1. **Refiner** — reads the ticket, proposes a sub-task breakdown (you approve)
2. **Developer** — writes code, opens a draft PR on `ferry/<TICKET-KEY>` (FR18: auto-transitions ticket to _In Review_)
3. **Reviewer** — reviews the PR. On `merge-ready`, adds the `ferry:approved` label to the PR (the Jira ticket stays in _In Review_ — you move it manually). On `changes-requested`, auto-transitions ticket to _Changes Requested_ (FR24).
4. **Iterator** — applies reviewer feedback, pushes commits, auto-transitions ticket back to _In Review_ (FR28); up to 3 rounds

**Ferry never merges.** You merge the PR when it's ready.

---

## Phase 1 — Prepare Jira (5 min)

### 1.1 — Generate a Jira API token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. **Create API token** → label `ferry-<your-repo>` → copy the token
3. Keep it open in a tab — you will need it in Phase 2

### 1.2 — Verify Jira columns

Ferry expects the Jira board to use these exact column names for each phase:

| Column name (exact)   | Phase triggered                          |
| --------------------- | ---------------------------------------- |
| **Refinement**        | Refiner agent                            |
| **In Development**    | Developer agent                          |
| **In Review**         | Reviewer agent (auto-set by FR18 / FR28) |
| **Changes Requested** | Iterator agent (auto-set by FR24)        |
| **Ready to Merge**    | Human review + merge                     |

✅ **Verification:** Open your board → confirm these 5 columns exist. If not, add them via **Project Settings → Board → Columns**. Column names are case-sensitive — use the exact names above.

---

## Phase 2 — Prepare GitHub (5 min)

### 2.1 — Create the audit issue

Ferry writes a per-run journal in a dedicated GitHub Issue. Create it once:

```bash
gh issue create \
  --repo YOUR_ORG/YOUR_REPO \
  --title "Ferry — Audit log" \
  --body "Do not close. Ferry writes audit comments here." \
  --label ferry
```

Note the returned issue number (e.g., `#42`). You will use it in step 2.3.

### 2.2 — Enable "Read and write permissions"

```bash
gh api -X PUT /repos/YOUR_ORG/YOUR_REPO/actions/permissions/workflow \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=true
```

Or via the UI: **Settings → Actions → General → Workflow permissions → Read and write**.

Ferry's workflows declare explicit minimal permissions, but GitHub enforces that those permissions cannot exceed the repo-level ceiling.

### 2.3 — Set the secrets and variable

Replace the values and run:

```bash
# Jira credentials
gh secret set FERRY_JIRA_BASE_URL    --body "https://YOUR-ORG.atlassian.net"
gh secret set FERRY_JIRA_EMAIL       --body "you@example.com"
gh secret set FERRY_JIRA_API_TOKEN   --body "<token from step 1.1>"

# LLM provider
gh secret set ANTHROPIC_API_KEY      --body "<sk-ant-...>"

# Jira transition IDs (numeric IDs from your Jira project — see note below)
gh secret set FERRY_REVIEW_TRANSITION_ID   --body "<id for the → In Review transition>"
gh secret set FERRY_ITER_TRANSITION_ID     --body "<id for the → Changes Requested transition>"

# Audit log issue number (from step 2.1)
gh variable set FERRY_AUDIT_ISSUE    --body "42"
```

> **Finding Jira transition IDs:** Run `curl -u you@example.com:<token> https://YOUR-ORG.atlassian.net/rest/api/3/issue/PROJ-1/transitions` on any ticket in your project. Find the `id` values for the transitions to "In Review" and "Changes Requested". These are project-specific numeric strings like `"31"` or `"151"`.

✅ **Verification:**

```bash
gh secret list --repo YOUR_ORG/YOUR_REPO | grep FERRY
gh variable list --repo YOUR_ORG/YOUR_REPO | grep FERRY_AUDIT
```

You must see **6 secrets** and **1 variable**.

---

## Phase 3 — Install Ferry workflows (3 min)

### 3.1 — Copy the 4 core workflow stubs

```bash
mkdir -p .github/workflows
for w in refine dev review iterate; do
  curl -fsSL "https://raw.githubusercontent.com/big-emotion/ferry/main/examples/consumer-setup/workflows/ferry-${w}.yml" \
    -o ".github/workflows/ferry-${w}.yml"
done
```

These stubs call Ferry's reusable workflows at `@v1`. Each stub uses `secrets: inherit` so all secrets flow through automatically.

### 3.2 — Pin the version (recommended)

By default the stubs reference `@v1`. For immutable pinning, replace with the exact commit SHA:

```bash
# Get the SHA the v1 tag points to
LATEST_SHA=$(gh api repos/big-emotion/ferry/git/refs/tags/v1 --jq '.object.sha')
echo "Pinning to $LATEST_SHA"

# Substitute in the 4 core stubs
sed -i.bak "s|@v1|@${LATEST_SHA}|g" .github/workflows/ferry-*.yml
rm .github/workflows/ferry-*.yml.bak
```

### 3.3 — Commit and push

```bash
git add .github/workflows/
git commit -m "chore(ferry): install consumer workflows pinned to ${LATEST_SHA:-v1}"
git push
```

✅ **Verification:** Go to **Actions** on GitHub → you must see 4 workflows listed. No run yet.

---

## Phase 4 — Connect Jira → GitHub (5 min)

This is the only step that requires browser interaction — Jira Automation has no programmatic import on most tiers.

### 4.1 — Create a GitHub PAT for Jira

Jira needs a token to call the GitHub API. Create a **Fine-grained personal access token**:

1. Go to https://github.com/settings/tokens → **Fine-grained token**
2. Target repo: **YOUR_ORG/YOUR_REPO**
3. Permissions: **Actions: Read and write** (to trigger `repository_dispatch`)
4. Copy the token — you will paste it into Jira in the next step

### 4.2 — Create 4 Jira Automation rules (one per phase)

For each phase, create a separate rule at `https://YOUR-ORG.atlassian.net/jira/settings/automation`:

**Rule 1 — Refiner trigger (when ticket moves to Refinement):**

- **Trigger:** Issue transitioned → Status changed to **Refinement**
- **Action:** Send web request
  - URL: `https://api.github.com/repos/YOUR_ORG/YOUR_REPO/dispatches`
  - Method: `POST`
  - Headers: `Authorization: Bearer <PAT from 4.1>`, `Accept: application/vnd.github+json`
  - Body type: **Custom data**
  ```json
  {
    "event_type": "ferry-refine",
    "client_payload": {
      "version": "v1",
      "event_id": "{{now.toMillis}}-{{issue.key}}-{{issue.id}}",
      "ticket_key": "{{issue.key}}",
      "phase": "refine",
      "source": "jira-column",
      "ts": "{{now.jiraDate}}",
      "issue_type": "{{issue.issuetype.name}}"
    }
  }
  ```
- **Turn rule on**

**Rule 2 — Developer trigger** (same structure, Status changed to **In Development**, `event_type: ferry-dev`, `phase: dev`)

**Rule 3 — Reviewer trigger** (Status changed to **In Review**, `event_type: ferry-review`, `phase: review`)

**Rule 4 — Iterator trigger** (Status changed to **Changes Requested**, `event_type: ferry-iterate`, `phase: iterate`)

> **`event_id` format:** `{{now.toMillis}}-{{issue.key}}-{{issue.id}}` produces e.g. `1746047810000-CHAN-27-10042`. The envelope schema validates this pattern — do not substitute a plain timestamp or random string.

✅ **Verification:** From the Jira UI, **Run rule** on a test ticket for each rule → each execution must show `200 OK` in the rule's **Audit log** tab.

---

## Phase 5 — First end-to-end smoke test (5 min)

### 5.1 — Create a simple ticket

In Jira, create a **Story** with:

- **Title:** `Ferry smoke test — add a hello-world README badge`
- **Description:** `Add a "Powered by Ferry" badge to the project README. Single-line change in README.md.`
- **Acceptance criteria:** `README displays a Ferry badge near the top.`

### 5.2 — Trigger the Refiner

Move the ticket to the **Refinement** column.

✅ **In GitHub Actions** within 5 seconds:

- Run `Ferry — Refine` appears
- 3 sequential jobs: `gate-envelope` → `run-agent` → `emit-audit`
- All green in ~30–60 sec

✅ **In Jira:** A comment appears on the ticket with the proposed sub-task breakdown.

### 5.3 — Approve and trigger the Developer

Read the proposed sub-tasks. If OK, move the ticket to **In Development**.

✅ Run `Ferry — Dev` appears (~1–3 min):

- A **draft PR** is created on branch `ferry/<TICKET-KEY>`
- The ticket **automatically transitions to In Review** (FR18)

### 5.4 — Reviewer chains in

Because the ticket is now in **In Review**, the Jira automation fires → `Ferry — Review` starts.

> **CI prerequisite:** The Reviewer blocks on the PR's CI status (`ci-gate`). If your repository has **no CI workflow that runs on `pull_request`**, the Reviewer will time out waiting for a check that never runs. Add at least one CI workflow (lint, typecheck, unit tests) before relying on Ferry end-to-end.

✅ Reviewer waits for the PR's CI to pass, then posts a structured verdict comment on the PR (FR24):

- Verdict `merge-ready` → adds the `ferry:approved` label to the PR. **The Jira ticket stays in _In Review_** — Ferry does not move it. You manually transition it to _Ready to Merge_ when you're ready.
- Verdict `changes-requested` → ticket **automatically transitions to Changes Requested** → triggers `Ferry — Iterate`.

### 5.5 — (If needed) Iterator

If the Reviewer requested changes:

- Iterator pushes commits on the same `ferry/<TICKET-KEY>` branch
- Ticket **automatically transitions back to In Review** (FR28) → Reviewer runs again
- Maximum 3 rounds (then Ferry halts and adds `ferry:needs-human` label)

### 5.6 — You merge

When Reviewer verdict is `ready` AND you have reviewed the PR yourself:

1. Mark the PR as **Ready for review** (exit draft mode)
2. **Merge**
3. Manually move the Jira ticket to Done (Ferry never closes tickets by design)

---

## Phase 6 — Final "all green" verification

After the smoke test, confirm all of the following:

✅ GitHub **Actions** tab: at least 3 green workflow runs for the test ticket (`Ferry — Refine`, `Ferry — Dev`, `Ferry — Review`)
✅ Branch `ferry/<TICKET-KEY>` was created by Ferry and merged into `main` by you (Phase 5.6) — Ferry never merges
✅ Audit issue `#FERRY_AUDIT_ISSUE` has accumulated lines — one per phase run (refine, dev, review, and iterate if it ran)
✅ Jira transitions happened automatically: Refinement → In Development → In Review (FR18). Then either: ticket auto-transitioned to Changes Requested (FR24, when verdict was `changes-requested`), or the PR received the `ferry:approved` label and the ticket stayed in In Review (when verdict was `merge-ready`)
✅ Anthropic console cost: < $0.50 for the smoke test

If **all** of these check, the install is complete.

---

## Phase 7 — Post-install hardening (recommended)

1. **Anthropic cost cap:** https://console.anthropic.com/settings/limits → set a monthly cap (e.g., $50) as a hard ceiling independent of Ferry's internal governance.
2. **CODEOWNERS:** Add `.github/workflows/ferry-* @your-handle` to prevent unauthorized edits to the stubs.
3. **Branch protection on `main`:** Require PR review + green CI before merge. Ferry opens drafts — you remain the last barrier.
4. **SHA renewal:** Every 1–2 months, redo step 3.2 to bump the pinned SHA. Or configure Dependabot via `package-ecosystem: github-actions`.

### 7.5 — Stale-ticket reconciler (every 30 min)

The reconciler sweeps all Ferry-managed tickets and re-triggers any that have stalled — for example, a `repository_dispatch` that was dropped or a ticket whose Jira column drifted out of sync with its state file.

**Install:**

```bash
curl -fsSL "https://raw.githubusercontent.com/big-emotion/ferry/main/examples/consumer-setup/workflows/ferry-reconcile.yml" \
  -o ".github/workflows/ferry-reconcile.yml"
git add .github/workflows/ferry-reconcile.yml
git commit -m "chore(ferry): add reconciler scheduled workflow"
git push
```

**Required variables (already set in Phase 2.3):** `FERRY_AUDIT_ISSUE`

**Optional variables:**

```bash
# Set to your Jira project key (e.g. "CHAN") to sweep ALL tickets in active
# Ferry columns — not just tickets with local state files. Without this,
# the reconciler only re-checks tickets it can find via .ferry/ state files.
gh variable set FERRY_JIRA_PROJECT --body "CHAN"
```

**Required secrets (only if FERRY_JIRA_PROJECT is set):** `FERRY_JIRA_BASE_URL`, `FERRY_JIRA_EMAIL`, `FERRY_JIRA_API_TOKEN` — already set in Phase 2.3.

**Schedule:** every 30 minutes (configurable — edit the `cron` expression in `ferry-reconcile.yml`).

**Opt-out:** delete `ferry-reconcile.yml` from `.github/workflows/`. Consumers who prefer to re-trigger stalled tickets manually do not need this workflow.

**Permissions required (added automatically by the stub):** `contents: read`, `issues: write`, `actions: write`.

### 7.6 — Daily cost check (06:00 UTC)

The daily cost check reads accumulated `cost_eur` values from the Ferry audit issue, groups them by LLM provider, and fires a `ferry:paused` alert when any provider crosses 50% of the configured monthly cap.

**Install:**

```bash
curl -fsSL "https://raw.githubusercontent.com/big-emotion/ferry/main/examples/consumer-setup/workflows/ferry-cost-daily.yml" \
  -o ".github/workflows/ferry-cost-daily.yml"
git add .github/workflows/ferry-cost-daily.yml
git commit -m "chore(ferry): add daily cost-check scheduled workflow"
git push
```

**Required variables:**

```bash
# Monthly spend cap in EUR. Alerts fire at 50% of this value.
# Default if not set: 200 EUR.
gh variable set FERRY_SPEND_CAP_EUR --body "200"
```

**What happens when the 50% threshold is crossed:**

1. A `[ferry:cost-check:daily]` comment is posted on the audit issue listing each provider over the threshold.
2. If Jira credentials are configured, the `ferry:paused` label is added to all active Jira tickets — agents will not advance them further until the label is removed.
3. Removing the `ferry:paused` label and manually re-triggering a ticket resumes normal operation.

**Schedule:** daily at 06:00 UTC (configurable — edit the `cron` expression in `ferry-cost-daily.yml`).

**Opt-out:** delete `ferry-cost-daily.yml`. Without this workflow, the only hard cost ceiling is the manual cap set in the Anthropic console (Phase 7, item 1).

**Permissions required:** `contents: read`, `issues: write`.

---

## Known limitations and open issues

| Issue                                           | Status                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `@v1` tag must exist before install guide works | Required for release — tag must be cut before distributing this guide                               |
| Stale-ticket reconciler sweep                   | Implemented — see Phase 7.5. Wired via `ferry-reconcile.yml` (issue #79).                           |
| `.ferry/` agent scripts in consumer workspace   | Tracked in #71 — workflows currently read agent scripts from Ferry repo checkout                    |
| Anthropic Agent SDK support                     | Planned — current LLM call site uses the Anthropic Messages API; Agent SDK is the next roadmap item |

---

## Quick checklist

```
Phase 1 — Jira              [ ] API token generated
                            [ ] 5 board columns present (exact names required)
Phase 2 — GitHub            [ ] Audit issue created + number noted
                            [ ] Workflow permissions = read+write
                            [ ] 6 secrets + 1 variable set
Phase 3 — Workflows         [ ] 4 core stubs copied to .github/workflows/
                            [ ] SHA pinned (not @v1) — recommended
                            [ ] Pushed to main
Phase 4 — Jira ↔ GitHub     [ ] GitHub PAT created
                            [ ] 4 Jira Automation rules created + enabled
                            [ ] "Run rule" test → 200 OK for each rule
Phase 5 — Smoke test        [ ] Ticket created
                            [ ] Refine green + sub-tasks posted
                            [ ] Dev green + draft PR opened
                            [ ] Review green + verdict commented
                            [ ] FR18 auto-transition observed (Dev → In Review)
                            [ ] FR24 outcome observed (either auto-transition to Changes Requested, or ferry:approved label on the PR with the ticket left in In Review)
                            [ ] PR manually merged
Phase 6 — Final verification[ ] Lines in audit issue (one per phase run)
                            [ ] Automatic Jira transitions observed
                            [ ] Anthropic cost < $0.50
```

---

## Troubleshooting

| Problem                                         | Check                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflows don't trigger                         | Verify Jira automation rule is enabled; check rule's Audit log for errors                                                                   |
| "workflow not found" error                      | `@v1` tag must exist on the Ferry repo; contact Ferry maintainers                                                                           |
| "Missing secret" error                          | All 6 secrets must be added — run `gh secret list` to verify                                                                                |
| `event_id` validation error                     | Use `{{now.toMillis}}-{{issue.key}}-{{issue.id}}` — do not omit the key/id suffix                                                           |
| FR18 / FR24 / FR28 never fires                  | `FERRY_REVIEW_TRANSITION_ID` and `FERRY_ITER_TRANSITION_ID` must be set with correct numeric Jira IDs                                       |
| "Action not found: `./.github/actions/ferry-*`" | You copied Ferry's internal workflows. Use the consumer stubs from `examples/consumer-setup/workflows/`                                     |
| "Resource not accessible by integration"        | Repo workflow permissions ceiling too low — enable **Read and write permissions** under Settings → Actions → General                        |
| Review workflow hangs (never starts jobs)       | Remove any `concurrency:` block in your consumer `ferry-review.yml` — it causes a deadlock; concurrency is managed by the reusable workflow |
| Preflight fails: "Jira column mismatch"         | Your board column names don't match exactly — see Phase 1.2 for the required names                                                          |

---

## Customization

See **[docs/CONFIGURATION.md](CONFIGURATION.md)** for all configurable parameters: models, token limits, Jira label capabilities, and the complete config-file schema.

In brief: create `ferry.config.json` (or `ferry.config.yaml` / `ferry.config.yml`) at your repo root to set the Anthropic model per agent, plus run-cost and iteration limits. Set `FERRY_REVIEW_MODEL` or `FERRY_ITER_MODEL` as GitHub repository variables for per-repo model overrides without editing the config file. Use Jira `ferry:*` labels to grant agents extra MCP capabilities on a per-ticket basis.

---

## Customizing agent prompts

Ferry ships a default system prompt for each of the four agents (Refiner, Developer, Reviewer, Iterator). You can adapt them to your project in three ways, from safest to most invasive.

### 1. Per-agent extension (recommended) — `prompts/<agent>.extra.md`

Drop a file at `prompts/<agent>.extra.md` in your repo root. Its contents are appended to Ferry's bundled prompt under the heading `## Project-specific guidance for <agent>`. The bundled prompt — including tool contracts, output format, comment fingerprints (`[ferry:<role>:<run-id>]`), and Jira transition rules (FR18, FR24, FR28) — stays intact.

| Filename                   | Augments  |
| -------------------------- | --------- |
| `prompts/refiner.extra.md` | Refiner   |
| `prompts/dev.extra.md`     | Developer |
| `prompts/review.extra.md`  | Reviewer  |
| `prompts/iterate.extra.md` | Iterator  |

Each file is capped at **4096 bytes** (truncated with a warning if exceeded). Use these to inject project-specific guidance: review checklists, security rules, naming conventions, tone, domain glossary, etc.

**Example — `prompts/review.extra.md`:**

```markdown
# Project-specific review guidance

In addition to checking the ticket ACs, evaluate every change across these
five dimensions. Surface findings inside the existing "Issues requiring
changes" section — do not invent new sections.

## 1. Correctness

- Edge cases handled (null, empty, boundaries, error paths)?
- Do tests verify behaviour, not just call the function?

## 2. Readability

- Names descriptive and consistent with project conventions?
- Control flow straightforward (no deeply nested logic)?

## 3. Architecture

- Follows existing patterns, or introduces a new one (and is it justified)?
- Module boundaries respected? No circular dependencies?

## 4. Security

- User input validated/sanitised at boundaries?
- Secrets out of code, logs, VCS?
- Queries parameterised, output encoded?

## 5. Performance

- N+1 queries? Unbounded loops? Missing pagination on list endpoints?

## Severity hint

Prefix each issue's **Why** with `[critical]`, `[important]`, or `[suggestion]`.
Block the PR (`approved: false`) only on `[critical]` findings.
```

### 2. Global project snippet — `prompts/_project.md`

A single file appended to **all** agent prompts under `## Project conventions`. Capped at 2048 bytes. Use this for repo-wide conventions that apply to every agent (build commands, monorepo layout, branch naming).

### 3. Full override — `prompts/<agent>.md` (advanced, not recommended)

Drops a file at `prompts/<agent>.md` (without `.extra`) and Ferry replaces the bundled prompt entirely. **This breaks the Ferry contract** — you become responsible for tool calls, output schema, comment fingerprints, and FR transitions. `ferry-doctor` will warn when it detects a full override and suggest the `.extra.md` form instead.

### Composition order

When all three layers are present, the final system prompt is composed as:

```
<bundled prompt for the agent>
## Project-specific guidance for <agent>
<contents of prompts/<agent>.extra.md>
## Project conventions
<contents of prompts/_project.md>
```

The bundled contract comes first so it carries the most weight; your customisations refine it without overriding it.

### Pointing Ferry at a different prompts directory

Set `FERRY_PROMPTS_DIR` (env var or workflow input) to use a directory other than `prompts/` — useful for monorepos or for sharing prompts across multiple repos via a submodule.

---

## Support

- **Ferry repo:** https://github.com/big-emotion/ferry
- **Issues:** GitHub Issues on the Ferry repo
