<p align="center">
  <img src="logos/ferry-lockup-stacked.svg" alt="Ferry" width="240">
</p>

# Ferry

> **GitHub Actions–native agent pipeline for Jira-driven automated development.**

[![CI](https://github.com/big-emotion/ferry/actions/workflows/ferry-ci.yml/badge.svg)](https://github.com/big-emotion/ferry/actions/workflows/ferry-ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

```
Jira board  ──▶  repository_dispatch  ──▶  GitHub Actions  ──▶  draft PR
   (you)              (automatic)           (autonomous)        (you merge)
```

Ferry connects your Jira board to a fully autonomous dev loop — Refiner, Developer, Reviewer, and Iterator agents run as GitHub Actions workflows, triggered by column transitions and labels on your Jira tickets.

---

## What Ferry is — and isn't

**Ferry is:**

- A set of GitHub Actions workflows you copy into your repo — no server, no daemon, no infra to own
- An autonomous loop that goes from Jira ticket to reviewed draft PR without you writing a line of code
- Designed for teams that already use Jira + GitHub and want AI-assisted development without leaving those tools

**Ferry is not:**

- A replacement for human review — it opens draft PRs, it never merges
- A general-purpose AI coding assistant — it only acts on explicit Jira column transitions
- Vendor-locked — the LLM provider per phase (Anthropic / Google AI / OpenAI) is configurable

---

## Agent phases at a glance

| Phase         | Jira column    | What the agent does                                            |
| ------------- | -------------- | -------------------------------------------------------------- |
| **Refiner**   | Refinement     | Reads the ticket, creates sub-tasks, awaits human approval     |
| **Developer** | In Development | Reads approved sub-tasks, opens a draft PR on `ferry/<ticket>` |
| **Reviewer**  | In Review      | Reads PR diff (green CI only), posts fingerprinted findings    |
| **Iterator**  | Iteration      | Applies findings, re-triggers Reviewer (max 3 rounds)          |

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
  │  Developer  │  → reads sub-tasks → opens draft PR on ferry/<ticket> branch
  │  Reviewer   │  → reads PR diff (green CI only) → posts fingerprinted findings
  │  Iterator   │  → applies findings → re-triggers Reviewer (max 3 rounds)
  └─────────────┘
        ↓
  Human merges PR
```

Ferry **never merges** and **never moves Jira columns** autonomously except for three explicit transitions:

1. Developer → In Review (FR18)
2. Reviewer → Ready to Merge or Changes Requested (FR24)
3. Iterator → In Review (FR28)

---

> ⚠️ **Privacy notice — read before first use.** Ferry transmits the following data to third-party LLM providers (Anthropic, Google AI, OpenAI):
>
> - Jira ticket titles, descriptions, comments, and sub-tasks
> - File contents and diffs from the target GitHub repository
> - Code review feedback and re-prompts
>
> No customer data is stored by Ferry itself, but each provider's data-retention policy applies. Review provider terms and obtain organisational approval before pointing Ferry at any repo containing confidential code or PII.

---

## Requirements

- GitHub repository (target repo where Ferry runs)
- Jira Cloud Standard or Premium (outbound web requests required)
- LLM provider accounts: Anthropic, Google AI, OpenAI
- **Story** issue type (and Task, Bug, Spike if your project uses them) must be enabled in the Jira project

---

## Quick install

```bash
npx -p @big-emotion/ferry ferry-init
```

The wizard collects your Jira URL, credentials, and column status names (prompts with defaults: **Refinement** / **In Development** / **In Review** / **Changes Requested** / **Ready to Merge**), generates the Jira Automation rules, and copies the 4 consumer workflow stubs into `.github/workflows/`. Custom status names work — enter them when prompted.

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

### Step 2 — Set the 6 required secrets

```bash
gh secret set FERRY_JIRA_BASE_URL         --body "https://YOUR-ORG.atlassian.net"
gh secret set FERRY_JIRA_EMAIL            --body "you@example.com"
gh secret set FERRY_JIRA_API_TOKEN        --body "<atlassian-api-token>"
gh secret set ANTHROPIC_API_KEY           --body "<sk-ant-...>"
gh secret set FERRY_REVIEW_TRANSITION_ID  --body "<jira-transition-id-for-In-Review>"
gh secret set FERRY_ITER_TRANSITION_ID    --body "<jira-transition-id-for-Changes-Requested>"
```

Verify: `gh secret list --repo YOUR_ORG/YOUR_REPO | grep FERRY` must show 6 secrets and 1 variable.

> **Finding Jira transition IDs:** Run `curl -u you@example.com:<token> https://YOUR-ORG.atlassian.net/rest/api/3/issue/PROJ-1/transitions`. Note the numeric `id` for the "In Review" and "Changes Requested" transitions.

### Step 3 — Enable workflow permissions

```bash
gh api -X PUT /repos/YOUR_ORG/YOUR_REPO/actions/permissions/workflow \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=true
```

Or via the UI: **Settings → Actions → General → Workflow permissions → Read and write**.

### Step 4 — Connect Jira → GitHub

Import the automation rules JSON the wizard generated at **Jira → Project Settings → Automation → Import rules**. If your Jira tier doesn't support import, create 4 rules manually — one per Ferry column:

- **Trigger:** Issue transitioned to `<column>`
- **Action:** Send web request (POST `https://api.github.com/repos/YOUR_ORG/YOUR_REPO/dispatches`)
- **Body** (example for the Refiner column):

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

Set `event_type` and `phase` to `ferry-dev` / `ferry-review` / `ferry-iterate` for the other three columns.

### SHA pinning (recommended)

Pin the installed stubs to an exact commit SHA rather than the floating tag:

```bash
LATEST_SHA=$(gh api repos/big-emotion/ferry/git/refs/tags/v0.4.0 --jq '.object.sha')
sed -i.bak "s|@v0.4.0|@${LATEST_SHA}|g" .github/workflows/ferry-*.yml && rm .github/workflows/ferry-*.yml.bak
git add .github/workflows/ && git commit -m "chore(ferry): pin to SHA ${LATEST_SHA}"
```

Refresh pinned SHAs every 1–2 months, or configure [Dependabot for GitHub Actions](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/keeping-your-actions-up-to-date-with-dependabot).

### Smoke test

Create a **Story** ticket in Jira and move it to **Refinement**. Within ~5 seconds the `Ferry — Refine` workflow should appear in GitHub Actions. Approve the sub-tasks, move the ticket to **In Development**, and watch the loop: Developer opens a draft PR and auto-transitions the ticket to _In Review_ (FR18); Reviewer runs when CI is green and either marks the PR ready (FR24 — `ferry:approved` label) or transitions to _Changes Requested_ (FR24); Iterator applies findings and transitions back to _In Review_ (FR28).

**Ferry never merges** — you merge the PR yourself when satisfied.

### Operations setup (required)

Add two scheduled maintenance workflows after your smoke test passes:

```bash
# Stale-ticket reconciler — required, runs every 30 min
curl -fsSL "https://raw.githubusercontent.com/big-emotion/ferry/v0.4.0/examples/consumer-setup/workflows/ferry-reconcile.yml" \
  -o ".github/workflows/ferry-reconcile.yml"

# Daily cost check — required, runs at 06:00 UTC
curl -fsSL "https://raw.githubusercontent.com/big-emotion/ferry/v0.4.0/examples/consumer-setup/workflows/ferry-cost-daily.yml" \
  -o ".github/workflows/ferry-cost-daily.yml"

git add .github/workflows/ferry-reconcile.yml .github/workflows/ferry-cost-daily.yml
git commit -m "chore(ferry): add reconciler and cost-daily workflows (required)"
git push
```

Quick install checklist:

```
[ ] Audit issue created + FERRY_AUDIT_ISSUE variable set
[ ] 6 secrets set (FERRY_JIRA_BASE_URL, FERRY_JIRA_EMAIL, FERRY_JIRA_API_TOKEN,
    ANTHROPIC_API_KEY, FERRY_REVIEW_TRANSITION_ID, FERRY_ITER_TRANSITION_ID)
[ ] Workflow permissions = read+write
[ ] 4 Jira automation rules created and enabled
[ ] Smoke test passed (ferry-refine green, draft PR opened)
[ ] ferry-reconcile.yml added (required)
[ ] ferry-cost-daily.yml added (required)
```

---

## Lifecycle commands

| Command                                     | What it does                     |
| ------------------------------------------- | -------------------------------- |
| `npx -p @big-emotion/ferry ferry-init`      | Scaffold Ferry into a new repo   |
| `npx -p @big-emotion/ferry ferry-doctor`    | Diagnose configuration issues    |
| `npx -p @big-emotion/ferry ferry-update`    | Upgrade Ferry to a newer version |
| `npx -p @big-emotion/ferry ferry-uninstall` | Remove Ferry from a repo         |

`ferry-doctor` will warn when a newer version is available:

```
! Ferry update available: v0.4.0 → v0.4.1
  Run `npx -p @big-emotion/ferry@0.4.1 ferry-update` to upgrade
```

See [`MIGRATIONS.md`](MIGRATIONS.md) for consumer-visible changes per release.

---

## Upgrading Ferry

To upgrade the pinned Ferry version in your workflow files without re-entering credentials:

```bash
npx -p @big-emotion/ferry@<new-version> ferry-update
```

Options:

| Flag               | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `--dry-run`        | Print the diff, write nothing                        |
| `--yes`            | Skip confirmation prompt                             |
| `--from <version>` | Override autodetected current version                |
| `--to <version>`   | Target a specific version (default: package version) |

---

## Examples

The canonical agent prompts live in [`prompts/`](prompts/) — that is the single source of truth for each agent's LLM instructions and expected output schema. Consumers can enrich them per project without breaking the Ferry contract by creating `prompts/<agent>.extra.md` files. See [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) for full customization options.

The [`examples/`](examples/) directory ships reference artifacts you can copy into your install:

- [`consumer-setup/workflows/`](examples/consumer-setup/workflows/) — consumer workflow stubs to copy into `.github/workflows/`
- [`ferry-audit.jsonl`](examples/ferry-audit.jsonl) — sample audit log lines (≥ 20 lines, all phases)

The canonical schemas live in [`src/schemas/`](src/schemas/) (not duplicated here).

---

## Reviewer-grade tool

A small interactive CLI is shipped to grade reviewer output and emit a `reviewer_grade` audit line:

```bash
tsx scripts/ferry-grade.ts <pr-number>
```

It prompts for four integers (Substantive / Specific / Correct / Actionable, each 0–2) and prints one JSON audit line. Verdict thresholds and the **Correct=0 cap** rule are defined in [`scripts/grade.ts`](scripts/grade.ts).

---

## Development

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run format:check # prettier
```

All gates must pass before opening a PR against `main`.

This project is developed using the [BMad Method](https://github.com/bmadcode/BMAD-METHOD) — an AI-driven agile workflow with structured epics, stories, and agent-assisted implementation.

Ferry was inspired by [OpenAI Symphony](https://github.com/openai/symphony) — an exploration of agentic software development pipelines. Ferry takes the same idea and makes it GitHub Actions–native, Jira-driven, and multi-provider.

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute.

---

## MCP remote servers (HTTP/SSE)

The developer agent can call **remote MCP servers** directly through the Anthropic Messages API (beta connector `mcp-client-2025-11-20`). The API proxies all MCP tool calls server-side — Ferry does not run any local MCP client.

### Enabling MCP for the developer agent

Set the `AGENT_MCP_SERVERS` environment variable (repository variable or secret) to a JSON array:

```json
[
  {
    "name": "context7",
    "url": "https://mcp.context7.com/mcp"
  },
  {
    "name": "github",
    "url": "https://api.githubcopilot.com/mcp",
    "authorization_token": "<your-token>",
    "allowed_tools": ["search_code", "get_file_contents"]
  }
]
```

Each entry accepts:

| Field                 | Required | Description                                  |
| --------------------- | -------- | -------------------------------------------- |
| `name`                | yes      | Logical name used in prompts and audit logs  |
| `url`                 | yes      | HTTP/SSE endpoint — **must be `https://`**   |
| `authorization_token` | no       | Bearer token forwarded to the MCP server     |
| `allowed_tools`       | no       | Allowlist — only these MCP tools are exposed |
| `denied_tools`        | no       | Denylist — these MCP tools are hidden        |

**Constraints**

- HTTP/SSE transport only — stdio MCP servers are not supported via this path.
- Tool calls only — MCP prompts and resources are not in scope.
- Only available when the developer agent uses the Anthropic provider; not supported on Bedrock or Vertex.
- Not eligible for Anthropic Zero Data Retention.

**First-party example — context7**

[context7](https://github.com/upstash/context7) serves up-to-date library documentation as an MCP tool. To enable it:

```json
AGENT_MCP_SERVERS=[{"name":"context7","url":"https://mcp.context7.com/mcp"}]
```

**Audit logs**

`mcp_tool_use` blocks are logged to stderr as `[ferry:dev-tool] mcp_tool=<name> server=<server>` and reflected in the token-usage counters in the final `[ferry:dev-action]` summary line.

### Per-ticket capability boost via Jira labels

By default, `AGENT_MCP_SERVERS` loads every configured server for **every** ticket. If you want specific tickets to opt into heavy capabilities (e.g. Sentry, Playwright) without inflating the default prompt, declare a `labels:` section in `ferry.config.yaml` (or `.json`):

```yaml
labels:
  ferry:mcp/context7:
    mcp_servers: [context7]

  ferry:mcp/sentry:
    mcp_servers: [sentry]
    tools: [fetch_runtime_logs] # only expose this tool from the Sentry server

  ferry:profile/frontend:
    mcp_servers: [context7, playwright] # profile = curated bundle
```

Then add the matching label to your Jira ticket (e.g. `ferry:mcp/context7`). Ferry unions all matching entries and passes the resulting server list to the agent.

**Security — allowlist is the trust boundary.** Only labels explicitly declared in `ferry.config` are honoured. Any `ferry:*` label on the Jira ticket that is not in the config is logged to stderr and ignored. This prevents anyone with Jira edit rights from pointing Ferry at an arbitrary MCP server.

**Iterator re-reads labels each cycle.** The Iterator agent re-reads labels from Jira at the start of each review→iterate cycle (i.e., each time the iterate workflow runs), not from a stale envelope. If a reviewer or human adds `ferry:mcp/sentry` between iteration 1 and iteration 2, iteration 2 picks it up automatically.

**Backward compatibility.** If the `labels:` section is absent from `ferry.config`, all servers in `AGENT_MCP_SERVERS` are passed through unchanged — existing behaviour is preserved.

---

## Cost governance

Ferry is designed for a typical pilot budget: **≤ 200€/provider/month**, **≤ 1.50€ average per story**. A daily cron checks provider usage and warns at 50% of the cap. HTTP 429/402 responses auto-pause affected tickets via the `ferry:paused` label.

---

## Contributors

| Role                 | GitHub                                   |
| -------------------- | ---------------------------------------- |
| Creator & maintainer | [@jean-noe](https://github.com/jean-noe) |

---

## Star History (lol)

[![Star History Chart](https://api.star-history.com/svg?repos=big-emotion/ferry&type=date)](https://star-history.com/#big-emotion/ferry&Date)

---

## License

MIT
