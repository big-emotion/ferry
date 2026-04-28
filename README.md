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

### Step 7 — Copy workflows and CODEOWNERS into the target repo

From this Ferry repository, copy:

- All files from `.github/workflows/*.yml`
- The file `.github/CODEOWNERS`

…into the corresponding paths of the target repo. Commit and push.

The first dispatch (e.g. moving a ticket to **Refinement**) will trigger `refine.yml`. Watch the **Actions** tab on the target repo for the run, then check the Jira ticket for the refiner's comment.

---

## Examples

The [`examples/`](examples/) directory ships reference artifacts you can copy into your install:

- [`acme-corp-setup.md`](examples/acme-corp-setup.md) — concrete end-to-end pilot setup
- [`state.v1.schema.json`](examples/state.v1.schema.json) — schema for the per-ticket state envelope
- [`event.v1.schema.json`](examples/event.v1.schema.json) — schema for `repository_dispatch` payloads
- [`ferry-audit.jsonl`](examples/ferry-audit.jsonl) — sample audit log lines (≥ 20 lines, all phases)
- [`prompt-templates/`](examples/prompt-templates/) — starter prompts for each agent role (refiner, developer, reviewer, iterator)
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

## Cost governance

Ferry is designed for a typical pilot budget: **≤ 200€/provider/month**, **≤ 1.50€ average per story**. A daily cron checks provider usage and warns at 50% of the cap. HTTP 429/402 responses auto-pause affected tickets via the `ferry:paused` label.

---

## Contributors

| Role | GitHub |
|---|---|
| Creator & maintainer | [@jean-noe](https://github.com/jean-noe) |

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=big-emotion/ferry&type=date)](https://star-history.com/#big-emotion/ferry&Date)

---

## License

MIT
