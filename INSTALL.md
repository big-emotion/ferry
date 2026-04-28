# Installing Ferry in your repository

This guide is for teams who want to use Ferry in their own project.
Estimated time: ~30 minutes hands-on.

For a fully worked example with concrete values, see [`examples/acme-corp-setup.md`](examples/acme-corp-setup.md).

## Prerequisites

- GitHub repository (any visibility)
- Jira project with a board you control
- Anthropic API key (required); Google AI and OpenAI keys (optional, added when those phases are enabled)

---

## Step 1 — Create a GitHub App

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Name it (e.g. `ferry-yourorg`). Webhook can be left inactive — Ferry uses `repository_dispatch`.
3. Set **repository permissions**:

   | Permission    | Level        |
   |---------------|--------------|
   | Contents      | Read & write |
   | Pull requests | Read & write |
   | Issues        | Read & write |
   | Metadata      | Read         |

   All other permissions: **No access**. Subscribe to **no** events.

4. Click **Create GitHub App**.
5. On the App settings page: note the **App ID**, then click **Generate a private key** and save the `.pem` file.

## Step 2 — Install the App on your repo

1. From the App settings page → **Install App**.
2. Select your org/user → **Only select repositories** → choose your target repo.
3. Confirm.

## Step 3 — Create an Atlassian API token

1. Go to <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. Click **Create API token** → label it `ferry`.
3. Copy the token and note the email of the Atlassian account.

## Step 4 — Configure Jira Automation rules

For each Ferry column (**Refinement**, **In Development**, **In Review**, **Iteration**), create a Jira Automation rule:

- **Trigger:** Issue transitioned → to the target column.
- **Action:** Send web request — `POST` to:

  ```
  https://api.github.com/repos/<owner>/<repo>/dispatches
  ```

  Headers:
  ```
  Accept: application/vnd.github+json
  Authorization: Bearer <fine-grained PAT with contents:write>
  X-GitHub-Api-Version: 2022-11-28
  ```

  Body:
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

  Set `phase` to `refine` / `dev` / `review` / `iterate` to match the column.

## Step 5 — Add repository secrets

In your target repo: **Settings → Secrets and variables → Actions**.

| Secret                    | Value                                        |
|---------------------------|----------------------------------------------|
| `FERRY_APP_ID`            | App ID from step 1                           |
| `FERRY_PRIVATE_KEY`       | Full PEM contents of the private key         |
| `FERRY_JIRA_BASE_URL`     | `https://your-org.atlassian.net`             |
| `FERRY_JIRA_EMAIL`        | Atlassian account email from step 3          |
| `FERRY_JIRA_API_TOKEN`    | Atlassian API token from step 3              |
| `FERRY_ANTHROPIC_API_KEY` | Anthropic API key                            |

## Step 6 — Set provider spend caps

Ferry warns at 50% of cap via the daily cron, but a hard cap on the provider side is your backstop (target: ≤ 200€/provider/month).

- **Anthropic Console** → Billing → set monthly spend limit.
- **Google AI Studio** → Billing → enable budget alerts.
- **OpenAI Platform** → Billing → set hard limit.

## Step 7 — Copy Ferry files into your repo

From this Ferry repository, copy the following paths into your target repo at the same paths:

| Source                                    | Purpose                              |
|-------------------------------------------|--------------------------------------|
| `.ferry/`                                 | Pre-built action bundles             |
| `.github/workflows/refine.yml`            | Refiner agent workflow               |
| `.github/workflows/dev.yml`               | Developer agent workflow             |
| `.github/workflows/review.yml`            | Reviewer agent workflow              |
| `.github/workflows/iterate.yml`           | Iterator agent workflow              |
| `.github/workflows/reconciler.yml`        | Missed-event recovery (cron)         |
| `.github/workflows/audit-daily.yml`       | Daily cost-governance check (cron)   |
| `.github/actions/ferry-envelope-validate/`| Composite action — envelope validation |
| `.github/actions/ferry-emit-audit/`       | Composite action — audit logging     |
| `.github/CODEOWNERS`                      | Code ownership rules                 |

> The `.ferry/` directory contains pre-built JavaScript bundles. Do not edit them by hand — they are regenerated from source by running `npm run build:ferry` in this repository.

Commit and push all copied files to the default branch of your target repo.

---

## Verification

1. Move any **Story**-type ticket to the **Refinement** column on your Jira board.
2. Open the **Actions** tab on your target repo — a workflow run should appear within ~10 seconds.
3. After it completes, the Jira ticket should have a new comment from the GitHub App (`[ferry:refiner:<run_id>] …`) and sub-tasks should appear.

If something goes wrong, check the workflow logs and the `[ferry:audit:<run_id>]` comment on the audit issue.
For a fully worked example, see [`examples/acme-corp-setup.md`](examples/acme-corp-setup.md).
