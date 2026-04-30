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

| Phase | Jira column | What the agent does |
|---|---|---|
| **Refiner** | Refinement | Reads the ticket, creates sub-tasks, awaits human approval |
| **Developer** | In Development | Reads approved sub-tasks, opens a draft PR on `ferry/<ticket>` |
| **Reviewer** | In Review | Reads PR diff (green CI only), posts fingerprinted findings |
| **Iterator** | Iteration | Applies findings, re-triggers Reviewer (max 3 rounds) |

---

## How it works

```
Jira column move / label / @mention
        ↓
  repository_dispatch
        ↓
  gate-envelope (validate + dedupe)
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
- A few hours one-time, ~30 minutes hands-on configuration

---

## Setup — 7 steps to first autonomous PR

> **Fast path:** Steps 1–2 take ~5 minutes (GitHub App creation). Steps 3–7 are copy-paste — no local CLI, no script execution. A Jira+GitHub user familiar with both tools can complete everything in under 30 minutes.
>
> 📋 **Installing Ferry in your own repo?** See [`INSTALL.md`](INSTALL.md) for a self-contained guide covering exactly which files to copy and how to configure secrets.
>
> 💡 **Pilot example:** see [`examples/acme-corp-setup.md`](examples/acme-corp-setup.md) for a concrete, end-to-end walkthrough using a sample pilot project.

### Step 1 — Create a GitHub App with scoped permissions

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Name it (e.g. `ferry-yourorg`). Webhook URL can be a placeholder — Ferry uses `repository_dispatch`, not webhooks.
3. Set **repository permissions** (NFR-S6):

   | Permission    | Access       |
   | ------------- | ------------ |
   | Contents      | Read & Write |
   | Pull requests | Read & Write |
   | Issues        | Read & Write |
   | Metadata      | Read         |

   Leave every other permission at **No access**. Subscribe to **no** events.

4. Generate a **private key** (`.pem`). Save it — you'll paste it into a repository secret in step 5.
5. Note the **App ID** shown on the App settings page.

### Step 2 — Install the App on the target repo

1. From the App settings page, click **Install App** in the left sidebar.
2. Select the org/user, then **Only select repositories** → choose the target repo only.
3. Confirm the install.

### Step 3 — Create an Atlassian API token

1. Go to **<https://id.atlassian.com/manage-profile/security/api-tokens>**.
2. Click **Create API token**, give it a label like `ferry`.
3. Copy the token. Note the email address of the Atlassian account that created it.

### Step 4 — Configure Jira Automation rules

For each Ferry column on your Jira board (Refinement, In Development, In Review, Iteration), create a Jira Automation rule:

- **Trigger:** "Issue transitioned to" → the column.
- **Action:** "Send web request" with method `POST` to:

  ```
  https://api.github.com/repos/<owner>/<repo>/dispatches
  ```

  **Headers:**
  - `Accept: application/vnd.github+json`
  - `Authorization: Bearer <fine-grained PAT with contents:write or App-installation token>`
  - `X-GitHub-Api-Version: 2022-11-28`

  **Body (JSON):**

  ```json
  {
    "event_type": "ferry-dispatch",
    "client_payload": {
      "phase": "refine",
      "ticket_key": "{{issue.key}}",
      "issue_type": "{{issue.issuetype.name}}",
      "actor": "{{initiator.displayName}}",
      "source": "jira-column",
      "ts": "{{now}}"
    }
  }
  ```

  Set `phase` to one of: `refine`, `dev`, `review`, `iterate` — matching the column.

Optional: add label-based rules (`agent:refiner`, `agent:developer`, …) and `@mention`-based rules using the same dispatch shape with `source: "jira-label"` or `"jira-comment"`.

### Step 5 — Populate 6 repository secrets

In the target repo: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret                    | Description                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `FERRY_APP_ID`            | GitHub App ID from step 1                                                                   |
| `FERRY_PRIVATE_KEY`       | Full PEM contents of the App private key from step 1                                        |
| `FERRY_JIRA_BASE_URL`     | e.g. `https://your-org.atlassian.net`                                                       |
| `FERRY_JIRA_EMAIL`        | Atlassian account email from step 3                                                         |
| `FERRY_JIRA_API_TOKEN`    | Atlassian API token from step 3                                                             |
| `FERRY_ANTHROPIC_API_KEY` | Anthropic API key (Google AI and OpenAI keys are added later when their phases are enabled) |

### Step 6 — Set hard spend caps on each provider console

Ferry's design budget is **≤ 200€/provider/month** with an average **≤ 1.50€/story**. Provider HTTP 429/402 responses auto-pause affected tickets, but a hard cap on the provider side is your backstop.

1. **Anthropic Console** → Billing → set monthly spend cap.
2. **Google AI Studio** → Billing → enable budget alerts.
3. **OpenAI** → Billing → set hard limit.

Ferry's daily cost-governance cron warns at **50%** of the cap.

### Step 7 — Copy Ferry files into the target repo

From this Ferry repository, copy the following into the corresponding paths of the target repo:

| What to copy | Destination in target repo | Purpose |
|---|---|---|
| `.ferry/` (entire directory) | `.ferry/` | Pre-built action bundles + minimal deps |
| `.github/workflows/*.yml` | `.github/workflows/` | Agent workflow definitions |
| `.github/actions/ferry-envelope-validate/` | `.github/actions/ferry-envelope-validate/` | Composite action — envelope validation |
| `.github/actions/ferry-emit-audit/` | `.github/actions/ferry-emit-audit/` | Composite action — audit logging |
| `.github/CODEOWNERS` | `.github/CODEOWNERS` | Code ownership rules |

> **Note:** The `.ferry/` directory contains pre-built JavaScript bundles and a minimal `package-lock.json`. Do not edit these files by hand — they are regenerated from Ferry's source by running `npm run build:ferry` in this repository.

Commit and push all copied files.

The first dispatch (e.g. moving a ticket to **Refinement**) will trigger `refine.yml`. Watch the **Actions** tab on the target repo for the run, then check the Jira ticket for the refiner's comment.

---

## Examples

The canonical agent prompts live in [`prompts/`](prompts/) — that is the single source of truth for each agent's LLM instructions and expected output schema.

The [`examples/`](examples/) directory ships reference artifacts you can copy into your install:

- [`acme-corp-setup.md`](examples/acme-corp-setup.md) — concrete end-to-end pilot setup
- [`state.v1.schema.json`](examples/state.v1.schema.json) — schema for the per-ticket state envelope
- [`event.v1.schema.json`](examples/event.v1.schema.json) — schema for `repository_dispatch` payloads
- [`ferry-audit.jsonl`](examples/ferry-audit.jsonl) — sample audit log lines (≥ 20 lines, all phases)
- [`reviewer-rules.yaml`](examples/reviewer-rules.yaml) — declarative reviewer rules
- [`reviewer-rubric.md`](examples/reviewer-rubric.md) — 4-dimension review-grading rubric

---

## Reviewer-grade tool

A small interactive CLI is shipped to grade reviewer output and emit a `reviewer_grade` audit line:

```bash
tsx scripts/ferry-grade.ts <pr-number>
```

It prompts for four integers (Substantive / Specific / Correct / Actionable, each 0–2) and prints one JSON audit line. The verdict thresholds and the **Correct=0 cap** rule are documented in [`examples/reviewer-rubric.md`](examples/reviewer-rubric.md).

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

| Field               | Required | Description                                     |
| ------------------- | -------- | ----------------------------------------------- |
| `name`              | yes      | Logical name used in prompts and audit logs      |
| `url`               | yes      | HTTP/SSE endpoint — **must be `https://`**       |
| `authorization_token` | no     | Bearer token forwarded to the MCP server         |
| `allowed_tools`     | no       | Allowlist — only these MCP tools are exposed     |
| `denied_tools`      | no       | Denylist — these MCP tools are hidden            |

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
    tools: [fetch_runtime_logs]   # only expose this tool from the Sentry server

  ferry:profile/frontend:
    mcp_servers: [context7, playwright]   # profile = curated bundle
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

| Role | GitHub |
|---|---|
| Creator & maintainer | [@jean-noe](https://github.com/jean-noe) |

---

## Star History (lol)

[![Star History Chart](https://api.star-history.com/svg?repos=big-emotion/ferry&type=date)](https://star-history.com/#big-emotion/ferry&Date)

---

## License

MIT
