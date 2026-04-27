# Ferry

> **GitHub Actions–native agent pipeline for Jira-driven automated development.**

Ferry connects your Jira board to a fully autonomous dev loop — Refiner, Developer, Reviewer, and Iterator agents run as GitHub Actions workflows, triggered by column transitions and labels on your Jira tickets.

> ⚠️ **Privacy notice:** Ticket content, sub-tasks, comments, and code diffs are transmitted to third-party LLM providers (Anthropic, Google AI, OpenAI). Review your provider's data-retention policy before use.

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

Ferry **never merges** and **never moves Jira columns** autonomously except for three explicit transitions (Developer→In Review, Reviewer→Ready to Merge or Changes Requested, Iterator→In Review).

---

## Requirements

- GitHub repository (target repo where Ferry runs)
- Jira Cloud Standard or Premium (outbound web requests required)
- LLM provider accounts: Anthropic, Google AI, OpenAI
- GitHub App with scopes: `contents:write`, `pull-requests:write`, `issues:write`, `metadata:read`

---

## Setup

Full installation instructions are in Story 1.8 (coming soon). The short version:

1. Create a GitHub App with the scopes above and install it on the target repo
2. Create an Atlassian API token
3. Configure Jira Automation rules to send `repository_dispatch` events on column transitions
4. Populate the 6 required repository secrets (see below)
5. Set hard spend caps on each provider console
6. Copy `.github/workflows/*.yml` and `.github/CODEOWNERS` into the target repo

### Required secrets

| Secret | Description |
|--------|-------------|
| `FERRY_APP_ID` | GitHub App ID |
| `FERRY_PRIVATE_KEY` | GitHub App private key (PEM) |
| `FERRY_JIRA_BASE_URL` | e.g. `https://your-org.atlassian.net` |
| `FERRY_JIRA_EMAIL` | Atlassian account email |
| `FERRY_JIRA_API_TOKEN` | Atlassian API token |
| `FERRY_ANTHROPIC_API_KEY` | Anthropic API key |

---

## Development

```bash
npm ci
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run lint      # eslint
```

All tests must pass before opening a PR against `main`.

This project is developed using the [BMad Method](https://github.com/bmadcode/BMAD-METHOD) — an AI-driven agile workflow with structured epics, stories, and agent-assisted implementation. Planning artifacts live in `_bmad-output/planning-artifacts/` and story files in `_bmad-output/implementation-artifacts/`.

---

## Cost governance

Ferry is designed for the chancellerie pilot budget: **≤ 200€/provider/month**, **≤ 1.50€ average per story**. A daily cron checks provider usage and warns at 50% of the cap. HTTP 429/402 responses auto-pause affected tickets.

---

## License

MIT
