# Ferry — Install Guide

## Requirements

### Common

- Jira Cloud Standard or Premium (outbound web requests required)
- Anthropic account (required for all phases); OpenAI or Google AI accounts if you configure those providers for the Refiner
- **Story** issue type (and Task, Bug, Spike if your project uses them) must be enabled in the Jira project
- Node ≥ 20

### GitHub Actions

- GitHub repository (target repo where Ferry runs)
- **GitHub App** installed on the target repo with `contents: write`, `pull-requests: write`, and `issues: write`. The wizard's first step prompts for the App ID and the private-key PEM file — have both ready before running `ferry-init`. (The App is used by `ferry-doctor` to validate the install; the agent workflows themselves run on `${{ github.token }}`.)
- `gh` CLI authenticated against the target repo (`gh auth status`)

### GitLab CI (experimental)

- GitLab project
- GitLab project access token with `api` scope (`FERRY_GITLAB_TOKEN`)
- GitLab pipeline trigger token (`FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN`)
- Optional self-managed GitLab API base (`FERRY_GITLAB_API_BASE`) if you do not use `https://gitlab.com/api/v4`

---

## Quick install

> **Forge:** Ferry runs natively on **GitHub Actions** (production-ready) and on **GitLab CI** (experimental — see [#210](https://github.com/big-emotion/ferry/issues/210)). Pick the install path that matches your forge.

```bash
npx -p @big-emotion/ferry ferry-init
```

The wizard collects your Jira URL, credentials, column status names (prompts with defaults: **Refinement** / **In Development** / **In Review** / **Changes Requested** / **Ready to Merge**), and LLM provider selection per phase. Ferry supports **Anthropic** (default), **OpenAI**, and **Google AI** — see the [provider × phase matrix](CONFIGURATION.md#provider--phase-matrix) for a full breakdown and caveats. Custom status names work — enter them when prompted.

After the wizard finishes, complete the manual setup for your forge.

## GitHub Actions install

After the wizard finishes, complete four manual steps:

### Step 1 — Create the audit issue

Ferry appends a one-line journal entry to a dedicated GitHub Issue after every agent run:

```bash
gh issue create \
  --repo YOUR_ORG/YOUR_REPO \
  --title "Ferry Audit Log (#1)" \
  --body "Do not close. Ferry writes audit comments here." \
  --label ferry \
  --label "ferry:audit-log:active"
```

Note the returned issue number, then set the variable:

```bash
gh variable set FERRY_AUDIT_ISSUE --body "<issue-number>"
```

### Step 2 — Verify secrets

> **If you ran `ferry-init`**, the wizard already set these six secrets via `gh secret set` (with masked input):
> `FERRY_APP_ID`, `FERRY_PRIVATE_KEY`, `FERRY_JIRA_BASE_URL`, `FERRY_JIRA_EMAIL`, `FERRY_JIRA_API_TOKEN`, `ANTHROPIC_API_KEY`
>
> Verify: `gh secret list --repo YOUR_ORG/YOUR_REPO | grep FERRY` must show all 6 secrets.

**If you skipped the wizard or need to re-set any value**, run the relevant commands manually:

```bash
gh secret set FERRY_APP_ID                --body "<github-app-numeric-id>"
gh secret set FERRY_PRIVATE_KEY           --body "$(cat ferry-app.private-key.pem)"
gh secret set FERRY_JIRA_BASE_URL         --body "https://YOUR-ORG.atlassian.net"
gh secret set FERRY_JIRA_EMAIL            --body "you@example.com"
gh secret set FERRY_JIRA_API_TOKEN        --body "<atlassian-api-token>"
gh secret set ANTHROPIC_API_KEY           --body "<sk-ant-...>"

# Optional — explicit transition-id overrides. Ferry auto-resolves transition ids
# at runtime from the status names in ferry.config (workflow.agents.*), so these
# are only needed to pin an id the status-name match cannot handle:
gh secret set FERRY_REVIEW_TRANSITION_ID  --body "<jira-transition-id-to-in-review>"
gh secret set FERRY_ITER_TRANSITION_ID    --body "<jira-transition-id-to-changes-requested>"
```

### Step 3 — Enable workflow permissions

```bash
gh api -X PUT /repos/YOUR_ORG/YOUR_REPO/actions/permissions/workflow \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=true
```

Or via the UI: **Settings → Actions → General → Workflow permissions → Read and write**.

### Step 4 — Connect Jira → GitHub

Pick the wiring model that matches your execution path:

- **Router model** — ONE `ferry-router.yml` workflow + ONE any-column Jira Automation rule. Recommended for `execution_path: claude-code`; see [Router model (recommended for claude-code)](#router-model-recommended-for-claude-code) below.
- **Legacy per-agent model** — five per-agent workflows + 4 per-column Jira Automation rules. Still the model for the `script` and `codex-cli` execution paths.

#### Legacy per-agent model (script / codex-cli paths)

Create 4 Jira automation rules manually — one per Ferry column. For each rule:

1. **Project Settings → Automation → Create rule** (top-right button)
2. **Trigger:** "Issue transitioned" → set **To status** to the target column (e.g. `Refinement`)
3. **Action:** "Send web request"
   - **URL:** `https://api.github.com/repos/YOUR_ORG/YOUR_REPO/dispatches`
   - **HTTP method:** `POST`
   - **Web request body:** Custom data
   - **Headers** — add all four; toggle the lock icon on `Authorization` to mark it secret:

   | Name                   | Value                         | Secret? |
   | ---------------------- | ----------------------------- | ------- |
   | `Accept`               | `application/vnd.github+json` | No      |
   | `Authorization`        | `Bearer YOUR_GITHUB_PAT`      | **Yes** |
   | `X-GitHub-Api-Version` | `2022-11-28`                  | No      |
   | `Content-Type`         | `application/json`            | No      |

4. **Custom body** (example for the Refiner column):

```json
{
  "event_type": "ferry-refine",
  "client_payload": {
    "version": "v1",
    "event_id": "{{issue.key}}-{{issue.id}}",
    "ticket_key": "{{issue.key}}",
    "phase": "refine",
    "source": "jira-column",
    "ts": "{{now.jiraDate}}",
    "issue_type": "{{issue.issuetype.name}}"
  }
}
```

Set `event_type` and `phase` to `ferry-dev` / `ferry-review` / `ferry-iterate` for the other three columns. Save and **enable** each rule.

> **PAT:** Use a GitHub fine-grained PAT with **Contents: write** on `YOUR_ORG/YOUR_REPO`. Marking `Authorization` as secret keeps the token out of Jira's audit log.

> **Generated reference files:** `ferry-init` writes `ferry-jira-automation-setup.md` (per-rule UI walkthrough) and `ferry-jira-automation-rules.beta.json` into your repo root. The Markdown file mirrors the steps above. The JSON can be loaded via **Automation → ⋮ → Import rules**, but that feature is beta and breaks across Jira Cloud releases — treat it as a reference only.

---

## Router model (recommended for claude-code)

On the `claude-code` execution path Ferry can run behind a single thin router instead of the five per-agent workflows:

- **One workflow** — `.github/workflows/ferry-router.yml` listens for every Ferry `repository_dispatch` type (`ferry-transition`, the legacy per-agent events, and `ferry-merge`), maps the event to an agent via `ferry.config` (`workflow.agents.*.trigger_column`), and runs it through the shared `big-emotion/ferry/.github/actions/ferry-run-claude-agent` composite. The router only supports `execution_path: claude-code` — on the `script` / `codex-cli` paths it fails with guidance to generate the per-agent workflows instead.
- **One Jira Automation rule** — fires on **any** status change and sends the target status in the payload. The router ignores statuses Ferry does not own, so renaming or adding Jira columns never requires touching Jira again.

> **Availability:** the router model ships in Ferry **v0.18.0** — pin `@v0.18.0` or later in `ferry-router.yml`; earlier tags do not contain the `ferry-run-claude-agent` composite.

`ferry-init` installs both automatically when `execution_path: claude-code`: it writes `ferry-router.yml` and generates the single-rule walkthrough in `ferry-jira-automation-setup.md`. To wire it by hand instead:

1. Copy [`examples/consumer-setup/workflows/ferry-router.yml`](../examples/consumer-setup/workflows/ferry-router.yml) to `.github/workflows/ferry-router.yml`.
2. Create **one** Jira Automation rule:
   - **Trigger:** "Issue transitioned" — leave **From status** and **To status** **empty** (no filter: every transition fires; the router no-ops on unmapped statuses)
   - **Action:** "Send web request" — same URL, method, and headers as the legacy rules above
   - **Custom body:**

```json
{
  "event_type": "ferry-transition",
  "client_payload": {
    "version": "v1",
    "event_id": "{{issue.key}}-{{issue.id}}",
    "ticket_key": "{{issue.key}}",
    "phase": "transition",
    "source": "jira-column",
    "ts": "{{now.jiraDate}}",
    "issue_type": "{{issue.issuetype.name}}",
    "to_status": "{{issue.status.name}}"
  }
}
```

3. Save and **enable** the rule.

**Transition-ID secrets are not needed on this path.** Agents auto-resolve Jira transition ids at runtime from the status names in `ferry.config` (`workflow.agents.*.auto_transition*`). `FERRY_REVIEW_TRANSITION_ID`, `FERRY_ITER_TRANSITION_ID`, and `FERRY_APPROVE_TRANSITION_ID` remain supported as optional overrides. The merger is the exception: on the claude-code path it resolves its post-merge transition by status **name** (any transition named "Done" or "Closed", skipped silently otherwise) — `workflow.agents.merger.auto_transition_done` and the `FERRY_MERGE_DONE_TRANSITION_ID` override apply to the script path only.

> **Merger note (ADR-0005):** moving a ticket into a "merge" column does nothing by design. The Merger is only triggered by the `ferry-merge` dispatch the Reviewer emits on approval — the any-column rule cannot reach it.

**Migrating an existing install:** after enabling the router, delete the five legacy per-agent workflows (`ferry-refine.yml`, `ferry-dev.yml`, `ferry-review.yml`, `ferry-iterate.yml`, `ferry-merge.yml`) and the 4 per-column Jira rules. `ferry-router.yml` also listens for the legacy per-agent events, so keeping both means both workflows fire on every legacy dispatch.

---

## GitLab CI install (experimental)

GitLab support is **experimental**: the adapter and CLI paths ship in Ferry, but the full Jira → MR production loop has not yet completed the promotion checklist in [#210](https://github.com/big-emotion/ferry/issues/210). Expect the install flow to work, but treat minor-version upgrades with more caution than the GitHub path.

### Step 1 — Scaffold the GitLab templates

Run the GitLab branch of the installer:

```bash
npx -p @big-emotion/ferry ferry-init --forge gitlab
```

The wizard detects the GitLab project from `origin` when possible and writes six templates under `ci/ferry/`:

- `ci/ferry/refine.gitlab-ci.yml`
- `ci/ferry/dev.gitlab-ci.yml`
- `ci/ferry/review.gitlab-ci.yml`
- `ci/ferry/iterate.gitlab-ci.yml`
- `ci/ferry/reconcile.gitlab-ci.yml`
- `ci/ferry/cost-daily.gitlab-ci.yml`

Include them from the project root `.gitlab-ci.yml`:

```yaml
variables:
  FERRY_FORGE: gitlab
  FERRY_GITLAB_API_BASE: '$CI_API_V4_URL'
  FERRY_GITLAB_TRIGGER_REF: '$CI_DEFAULT_BRANCH'
  GITHUB_REPO: '$CI_PROJECT_PATH'
  GITHUB_TOKEN: '$FERRY_GITLAB_TOKEN'

include:
  - local: ci/ferry/refine.gitlab-ci.yml
  - local: ci/ferry/dev.gitlab-ci.yml
  - local: ci/ferry/review.gitlab-ci.yml
  - local: ci/ferry/iterate.gitlab-ci.yml
  # Optional scheduled jobs:
  # - local: ci/ferry/reconcile.gitlab-ci.yml
  # - local: ci/ferry/cost-daily.gitlab-ci.yml
```

### Step 2 — Set GitLab CI/CD variables

Under **Settings → CI/CD → Variables**, create:

- `FERRY_VERSION` — pinned Ferry version, e.g. `v0.19.0`
- `FERRY_JIRA_BASE_URL`, `FERRY_JIRA_EMAIL`, `FERRY_JIRA_API_TOKEN`
- `FERRY_GITLAB_TOKEN`, `FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN`
- `FERRY_REVIEW_TRANSITION_ID`, `FERRY_ITER_TRANSITION_ID`, `FERRY_APPROVE_TRANSITION_ID`
- `FERRY_AUDIT_ISSUE`
- At least one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`

Mark every token-bearing variable as **Masked** and **Protected**.

### Step 3 — Connect Jira → GitLab

Create one Jira Automation rule per Ferry column. Each rule should POST to the GitLab pipeline trigger endpoint:

```http
POST https://gitlab.example/api/v4/projects/<encoded-path>/trigger/pipeline
Content-Type: application/x-www-form-urlencoded

token=<FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN>&
ref=main&
variables[FERRY_DISPATCH_TYPE]=ferry-refine&
variables[FERRY_ENVELOPE_PAYLOAD]={"version":"v1","event_id":"{{issue.key}}-{{issue.id}}","ticket_key":"{{issue.key}}","phase":"refine","source":"jira-column","ts":"{{now.jiraDate}}"}
```

Required form fields:

- `token` — the GitLab pipeline trigger token
- `ref` — usually the default branch
- `variables[FERRY_DISPATCH_TYPE]` — one of `ferry-refine`, `ferry-dev`, `ferry-review`, `ferry-iterate`
- `variables[FERRY_ENVELOPE_PAYLOAD]` — the JSON envelope Ferry consumes

### Step 4 — Add scheduled jobs (recommended)

To enable the reconciler and cost-governance jobs, include `ci/ferry/reconcile.gitlab-ci.yml` and `ci/ferry/cost-daily.gitlab-ci.yml`, then create GitLab schedules:

- Reconciler: every 10 minutes with CI variable `schedule_reconcile=true`
- Cost governance: daily with CI variable `schedule_cost_daily=true`

### Step 5 — Smoke test and validate

Create a Jira **Story**, move it to **Refinement**, and verify that a GitLab pipeline starts with `FERRY_DISPATCH_TYPE=ferry-refine`. After the first successful trigger, validate the install with:

```bash
npx -p @big-emotion/ferry ferry-doctor --forge gitlab \
  --project owner/repo \
  --token "$FERRY_GITLAB_TOKEN" \
  --trigger-token "$FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN"
```

`ferry-doctor --forge gitlab` checks project access, token scope visibility, trigger registration, CI/CD variables, and a manual Jira-webhook confirmation step.

### Step 6 — Update and uninstall

Upgrade the GitLab templates in place:

```bash
npx -p @big-emotion/ferry@<new-version> ferry-update --forge gitlab
```

Plan or remove the install locally:

```bash
# Plan only
npx -p @big-emotion/ferry ferry-uninstall --forge gitlab

# Apply cleanup
npx -p @big-emotion/ferry ferry-uninstall --forge gitlab --apply
```

### GitLab install checklist

```
[ ] ferry-init --forge gitlab run successfully
[ ] ci/ferry/*.gitlab-ci.yml files written and included from .gitlab-ci.yml
[ ] GitLab CI/CD variables created and token-bearing ones marked Masked + Protected
[ ] Jira Automation rules POST to /projects/<id>/trigger/pipeline
[ ] variables[FERRY_DISPATCH_TYPE] and variables[FERRY_ENVELOPE_PAYLOAD] set in each rule
[ ] Smoke test passed (pipeline starts from Jira transition)
[ ] ferry-doctor --forge gitlab reports no FAIL lines
[ ] reconcile / cost-daily schedules added if you want maintenance automation
```

---

## SHA pinning (recommended)

Pin the installed stubs to an exact commit SHA rather than the floating tag:

```bash
LATEST_SHA=$(gh api repos/big-emotion/ferry/git/refs/tags/v0.19.0 --jq '.object.sha')
sed -i.bak "s|@v0.19.0|@${LATEST_SHA}|g" .github/workflows/ferry-*.yml && rm .github/workflows/ferry-*.yml.bak
git add .github/workflows/ && git commit -m "chore(ferry): pin to SHA ${LATEST_SHA}"
```

Refresh pinned SHAs every 1–2 months, or configure [Dependabot for GitHub Actions](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/keeping-your-actions-up-to-date-with-dependabot).

---

## Smoke test

Create a **Story** ticket in Jira and move it to **Refinement**. Within ~5 seconds the `Ferry — Refine` workflow should appear in GitHub Actions. Approve the sub-tasks, move the ticket to **In Development**, and watch the loop: Developer opens a draft PR and auto-transitions the ticket to _In Review_ (FR18); Reviewer runs when CI is green and either marks the PR ready and adds the `ferry:approved` label (FR24) or transitions to _Changes Requested_ (FR24); Iterator applies findings and transitions back to _In Review_ (FR28). On approval the Reviewer also dispatches `ferry-merge`, and the **Merger** squash-merges the PR — optionally moving the ticket to Done when `workflow.agents.merger.auto_transition_done` is configured in `ferry.config` (or the `FERRY_MERGE_DONE_TRANSITION_ID` override secret is set) (FR32).

**Merging is gated, not unconditional** — the Merger squash-merges only on Reviewer approval and only if your branch protection lets the Ferry app merge (the `ferry:approved` label is not a formal PR review approval). Otherwise the approved PR waits for you to merge it yourself.

---

## Operations setup (required)

Add two scheduled maintenance workflows after your smoke test passes:

```bash
# Stale-ticket reconciler — required, runs every 30 min
curl -fsSL "https://raw.githubusercontent.com/big-emotion/ferry/v0.19.0/examples/consumer-setup/workflows/ferry-reconcile.yml" \
  -o ".github/workflows/ferry-reconcile.yml"

# Daily cost check — required, runs at 06:00 UTC
curl -fsSL "https://raw.githubusercontent.com/big-emotion/ferry/v0.19.0/examples/consumer-setup/workflows/ferry-cost-daily.yml" \
  -o ".github/workflows/ferry-cost-daily.yml"

git add .github/workflows/ferry-reconcile.yml .github/workflows/ferry-cost-daily.yml
git commit -m "chore(ferry): add reconciler and cost-daily workflows (required)"
git push
```

---

## Install checklist

```
[ ] Audit issue created + FERRY_AUDIT_ISSUE variable set
[ ] 6 secrets set by ferry-init (verify with: gh secret list | grep FERRY)
    FERRY_APP_ID, FERRY_PRIVATE_KEY, FERRY_JIRA_BASE_URL, FERRY_JIRA_EMAIL,
    FERRY_JIRA_API_TOKEN, ANTHROPIC_API_KEY
[ ] Transition-ID secrets: optional overrides — auto-resolved from ferry.config
    status names (router and script paths); set only to pin an explicit id
    FERRY_REVIEW_TRANSITION_ID  — override for the transition into "In Review"
    FERRY_ITER_TRANSITION_ID    — override for the transition into "Changes Requested"
[ ] Workflow permissions = read+write
[ ] Jira automation wiring created in the Jira UI and enabled
    Router model: 1 any-column ferry-transition rule (claude-code path)
    Legacy model: 4 per-column rules (script / codex-cli paths)
[ ] Smoke test passed (ferry-refine green, draft PR opened)
[ ] ferry-reconcile.yml added (required)
[ ] ferry-cost-daily.yml added (required)
[ ] ferry-doctor reports green (npx -p @big-emotion/ferry ferry-doctor)
```

---

For on-call playbooks (stalled ticket, cost spike, agent-loop runaway, rollback), see [`docs/RUNBOOK.md`](RUNBOOK.md).

For on-demand spend breakdowns, see [`docs/COST.md`](COST.md).
