# Ferry — Install Guide

## Requirements

- GitHub repository (target repo where Ferry runs)
- **GitHub App** installed on the target repo with `contents: write`, `pull-requests: write`, and `issues: write`. The wizard's first step prompts for the App ID and the private-key PEM file — have both ready before running `ferry-init`. (The App is used by `ferry-doctor` to validate the install; the agent workflows themselves run on `${{ github.token }}`.)
- Jira Cloud Standard or Premium (outbound web requests required)
- Anthropic account (required for all phases); OpenAI or Google AI accounts if you configure those providers for the Refiner
- **Story** issue type (and Task, Bug, Spike if your project uses them) must be enabled in the Jira project
- Local tooling: `gh` CLI authenticated against the target repo (`gh auth status`), Node ≥ 20

---

## Quick install

> **Forge:** Ferry runs natively on **GitHub Actions** (production-ready) and on **GitLab CI** (experimental — see [#210](https://github.com/big-emotion/ferry/issues/210)). The wizard targets GitHub; GitLab consumers should copy the templates from [`examples/consumer-setup-gitlab/`](../examples/consumer-setup-gitlab) and follow the [GitLab section in `docs/CONFIGURATION.md`](CONFIGURATION.md#gitlab-experimental).

```bash
npx -p @big-emotion/ferry ferry-init
```

The wizard collects your Jira URL, credentials, column status names (prompts with defaults: **Refinement** / **In Development** / **In Review** / **Changes Requested** / **Ready to Merge**), and LLM provider selection per phase. Ferry supports **Anthropic** (default), **OpenAI**, and **Google AI** — see the [provider × phase matrix](CONFIGURATION.md#provider--phase-matrix) for a full breakdown and caveats. Custom status names work — enter them when prompted.

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

## SHA pinning (recommended)

Pin the installed stubs to an exact commit SHA rather than the floating tag:

```bash
LATEST_SHA=$(gh api repos/big-emotion/ferry/git/refs/tags/v0.13.1 --jq '.object.sha')
sed -i.bak "s|@v0.13.1|@${LATEST_SHA}|g" .github/workflows/ferry-*.yml && rm .github/workflows/ferry-*.yml.bak
git add .github/workflows/ && git commit -m "chore(ferry): pin to SHA ${LATEST_SHA}"
```

Refresh pinned SHAs every 1–2 months, or configure [Dependabot for GitHub Actions](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/keeping-your-actions-up-to-date-with-dependabot).

---

## Smoke test

Create a **Story** ticket in Jira and move it to **Refinement**. Within ~5 seconds the `Ferry — Refine` workflow should appear in GitHub Actions. Approve the sub-tasks, move the ticket to **In Development**, and watch the loop: Developer opens a draft PR and auto-transitions the ticket to _In Review_ (FR18); Reviewer runs when CI is green and either marks the PR ready (FR24 — `ferry:approved` label) or transitions to _Changes Requested_ (FR24); Iterator applies findings and transitions back to _In Review_ (FR28).

**Ferry never merges** — you merge the PR yourself when satisfied.

---

## Operations setup (required)

Add two scheduled maintenance workflows after your smoke test passes:

```bash
# Stale-ticket reconciler — required, runs every 30 min
curl -fsSL "https://raw.githubusercontent.com/big-emotion/ferry/v0.13.1/examples/consumer-setup/workflows/ferry-reconcile.yml" \
  -o ".github/workflows/ferry-reconcile.yml"

# Daily cost check — required, runs at 06:00 UTC
curl -fsSL "https://raw.githubusercontent.com/big-emotion/ferry/v0.13.1/examples/consumer-setup/workflows/ferry-cost-daily.yml" \
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
[ ] 2 transition-ID secrets set manually (the wizard does NOT set these)
    FERRY_REVIEW_TRANSITION_ID  — Jira transition ID into "In Review"
    FERRY_ITER_TRANSITION_ID    — Jira transition ID into "Changes Requested"
[ ] Workflow permissions = read+write
[ ] 4 Jira automation rules created manually in Jira UI and enabled
[ ] Smoke test passed (ferry-refine green, draft PR opened)
[ ] ferry-reconcile.yml added (required)
[ ] ferry-cost-daily.yml added (required)
[ ] ferry-doctor reports green (npx -p @big-emotion/ferry ferry-doctor)
```

---

For on-call playbooks (stalled ticket, cost spike, agent-loop runaway, rollback), see [`docs/RUNBOOK.md`](RUNBOOK.md).

For on-demand spend breakdowns, see [`docs/COST.md`](COST.md).
