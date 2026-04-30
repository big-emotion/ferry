# Using Ferry in Your Project

Ferry is a GitHub Actions pipeline that automates development workflows triggered by Jira tickets. It reads your Jira ticket, writes code, opens a PR, and reviews it — all without leaving GitHub or Jira.

## Requirements

- **GitHub repository** where you want Ferry to run
- **Jira Cloud** (Standard or Premium) with your project
- **API credentials** (Jira token, LLM provider key)
- ~15 minutes to set up

## What Ferry Does

```
Jira column move → GitHub action triggers → Agent writes code → PR opens → Agent reviews PR
```

When you move a Jira ticket to "In Development", Ferry:
1. **Refiner agent** — reads the ticket, breaks it into sub-tasks (you approve)
2. **Developer agent** — writes code, opens draft PR on `ferry/<ticket>` branch
3. **Reviewer agent** — reviews the PR, posts feedback
4. **Iterator agent** — applies feedback, re-reviews (up to 3 rounds)

You merge the PR when it's ready.

---

## Setup: 3 Steps

### Step 1: Add Ferry workflow files to your repo

Copy the consumer workflow templates into your repo's `.github/workflows/` directory:

```bash
mkdir -p .github/workflows

# Download consumer workflow templates from Ferry repo
curl -o .github/workflows/ferry-refine.yml https://raw.githubusercontent.com/big-emotion/ferry/main/examples/consumer-setup/workflows/ferry-refine.yml
curl -o .github/workflows/ferry-dev.yml https://raw.githubusercontent.com/big-emotion/ferry/main/examples/consumer-setup/workflows/ferry-dev.yml
curl -o .github/workflows/ferry-review.yml https://raw.githubusercontent.com/big-emotion/ferry/main/examples/consumer-setup/workflows/ferry-review.yml
curl -o .github/workflows/ferry-iterate.yml https://raw.githubusercontent.com/big-emotion/ferry/main/examples/consumer-setup/workflows/ferry-iterate.yml
```

These workflows call Ferry's reusable workflows from the Ferry repository. Update the version tag (`@v1` → `@main` for latest, or pin to a release like `@v1.2.3`).

**Important:** You do NOT need to copy any `.github/actions/` files to your repo — Ferry's actions are provided by the Ferry repo itself.

### Step 2: Allow Actions to write to your repository

Go to **Settings → Actions → General → Workflow permissions** and select **Read and write permissions**. Ferry's workflows declare explicit minimal permissions, but GitHub enforces that those permissions cannot exceed the repo-level ceiling.

### Step 3: Add GitHub secrets

Go to **Settings → Secrets and variables → Actions** in your GitHub repo and add:

| Secret | Value | Where to get it |
|--------|-------|-----------------|
| `FERRY_JIRA_BASE_URL` | Your Jira URL (e.g., `https://acme.atlassian.net`) | From your Jira instance |
| `FERRY_JIRA_EMAIL` | Your Atlassian account email | Your Atlassian account |
| `FERRY_JIRA_API_TOKEN` | Atlassian API token | [Generate here](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `ANTHROPIC_API_KEY` | Anthropic API key (for Claude) | [Get here](https://console.anthropic.com/account/keys) |
| `FERRY_REVIEW_TRANSITION_ID` | Jira transition ID → Review column | See [Configuration Reference](CONFIGURATION.md#required-for-specific-agents) |
| `FERRY_ITER_TRANSITION_ID` | Jira transition ID → Iteration column | See [Configuration Reference](CONFIGURATION.md#required-for-specific-agents) |

You also need one **repository variable**: `FERRY_AUDIT_ISSUE` (the number of a blank GitHub Issue to use as Ferry's audit log). See the [Configuration Reference](CONFIGURATION.md) for all available variables and the full `ferry.config.json` schema.

### Step 4: Configure Jira → GitHub webhook

Ferry is triggered when you move a ticket column or add a label in Jira.

1. In Jira, go to **Project Settings → Automations**
2. Create a new rule:
   - **Trigger:** Column transition (e.g., "To In Development")
   - **Action:** Call webhook
   - **URL:** `https://api.github.com/repos/YOUR_ORG/YOUR_REPO/dispatches`
   - **Body:**
     ```json
     {
       "event_type": "ferry-refine",
       "client_payload": {
         "ticket_key": "{{issue.key}}",
         "event_id": "{{#randomString}}20{{/randomString}}"
       }
     }
     ```
   - **Authentication:** Use GitHub Personal Access Token (PAT) with `repo` scope

Or use the Jira-GitHub app integration if your team already has it.

---

## What Happens Next

1. **Move a ticket to "In Development"** in Jira → Ferry triggers automatically
2. **Refiner agent runs** → Posts a comment on the ticket with sub-task breakdown
3. **You approve** by replying or clicking "Ready"
4. **Developer agent runs** → Writes code, opens a draft PR
5. **PR appears in GitHub** on branch `ferry/<TICKET-KEY>`
6. **Reviewer agent runs** → Posts code review feedback as PR comments
7. **You merge** when the code looks good

---

## Verify It's Working

1. Check GitHub Actions tab — you should see workflow runs for `ferry-refine`, `ferry-dev`, etc.
2. Check the PR on `ferry/<TICKET-KEY>` branch
3. If something fails, check the workflow logs to debug

---

## Troubleshooting

| Problem | Check |
|---------|-------|
| Workflows don't trigger | Verify Jira webhook is set up, GitHub secrets are added |
| "Missing secret" error | All four secrets must be added to GitHub repo settings |
| Refiner never posts a comment | Check Jira API credentials, verify the Jira URL is correct |
| Code looks wrong | This is normal early on — Ferry improves with feedback; iterate it |
| "Action not found: `./.github/actions/ferry-envelope-validate`" | You copied Ferry's internal workflows. Use the consumer stubs instead, which call Ferry's reusable workflows — see Step 1 |
| "Resource not accessible by integration" or `checks: read` permission error | Repo workflow permissions ceiling is too low. Enable **Read and write permissions** under Settings → Actions → General → Workflow permissions — see Step 2 |
| Review workflow hangs indefinitely (never starts running jobs) | You have a `concurrency:` block in your consumer `ferry-review.yml`. Remove it — concurrency is managed by Ferry's reusable workflow; duplicating the group expression causes a deadlock because `github.workflow` resolves to the caller's name in both contexts |

---

## Customization

For a full reference of all configurable parameters — models, limits, Jira label capabilities, and the complete `ferry.config.json` schema — see **[docs/CONFIGURATION.md](CONFIGURATION.md)**.

In brief: create a `ferry.config.json` at the root of your repo and specify the model and provider for each agent. Set `FERRY_REVIEW_MODEL` or `FERRY_ITER_MODEL` as GitHub repository variables if you want per-repo overrides without editing the config file. For alternative LLM providers (OpenAI, Google AI), add the corresponding API key secret and set the provider in `ferry.config.json`.

---

## Support

- **Ferry repo:** https://github.com/big-emotion/ferry
- **Issues:** GitHub Issues on the Ferry repo
- **Docs:** README in Ferry repo for detailed architecture and troubleshooting
