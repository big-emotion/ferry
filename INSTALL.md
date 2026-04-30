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

## Step 5 — Add repository secrets and variables

In your target repo: **Settings → Secrets and variables → Actions**.

**Secrets** (Settings → Secrets → Actions → New repository secret):

| Secret                       | Value                                                         |
|------------------------------|---------------------------------------------------------------|
| `FERRY_APP_ID`               | App ID from step 1                                            |
| `FERRY_PRIVATE_KEY`          | Full PEM contents of the private key from step 1              |
| `FERRY_JIRA_BASE_URL`        | `https://your-org.atlassian.net`                              |
| `FERRY_JIRA_EMAIL`           | Atlassian account email from step 3                           |
| `FERRY_JIRA_API_TOKEN`       | Atlassian API token from step 3                               |
| `ANTHROPIC_API_KEY`          | Anthropic API key                                             |
| `FERRY_REVIEW_TRANSITION_ID` | Jira transition ID for the "In Review" column transition      |
| `FERRY_ITER_TRANSITION_ID`   | Jira transition ID for the "Iteration" column transition      |

**Variables** (Settings → Variables → Actions → New repository variable):

| Variable             | Value                                                          |
|----------------------|----------------------------------------------------------------|
| `FERRY_AUDIT_ISSUE`  | GitHub Issue number to use as the Ferry audit log              |
| `FERRY_MODEL`        | (optional) Developer model override, default `claude-sonnet-4-6` |
| `FERRY_REVIEW_MODEL` | (optional) Reviewer model override, default `claude-sonnet-4-6` |
| `FERRY_ITER_MODEL`   | (optional) Iterator model override, default `claude-sonnet-4-6` |

To find the Jira transition IDs, use the Jira REST API: `GET /rest/api/3/issue/{issueKey}/transitions`.

## Step 6 — Set provider spend caps

Ferry warns at 50% of cap via the daily cron, but a hard cap on the provider side is your backstop (target: ≤ 200€/provider/month).

- **Anthropic Console** → Billing → set monthly spend limit.
- **Google AI Studio** → Billing → enable budget alerts.
- **OpenAI Platform** → Billing → set hard limit.

## Step 7 — Add caller workflows to your repository

Copy the six workflow stubs from [`examples/consumer-setup/workflows/`](examples/consumer-setup/workflows/) into `.github/workflows/` in your target repo:

| File to copy                                                              | Triggers on              |
|---------------------------------------------------------------------------|--------------------------|
| `examples/consumer-setup/workflows/ferry-refine.yml`                     | `ferry-refine` dispatch  |
| `examples/consumer-setup/workflows/ferry-dev.yml`                        | `ferry-dev` dispatch     |
| `examples/consumer-setup/workflows/ferry-review.yml`                     | `ferry-review` dispatch  |
| `examples/consumer-setup/workflows/ferry-iterate.yml`                    | `ferry-iterate` dispatch |
| `examples/consumer-setup/workflows/ferry-reconciler.yml`                 | Every 15 minutes (cron)  |
| `examples/consumer-setup/workflows/ferry-audit-daily.yml`                | Daily at 09:00 UTC       |

Each file is ~40 lines and references `big-emotion/ferry/actions/*@v1` directly — no `.ferry/` bundle or composite action copy required.

Pin to a specific release tag by replacing `@v1` with e.g. `@v1.2.3`. To upgrade Ferry, bump the tag in all six files.

Also copy `.github/CODEOWNERS` from the Ferry repository to protect workflow files from unreviewed edits.

> **Upgrading from the file-copy path:** If you previously installed Ferry by copying `.ferry/`, `.github/workflows/`, and `.github/actions/` manually, replace those copies with the six caller workflow stubs above, delete your local `.ferry/` directory and the copied composite actions, and confirm the new workflows trigger correctly before removing the old files.

---

## Verification

1. Move any **Story**-type ticket to the **Refinement** column on your Jira board.
2. Open the **Actions** tab on your target repo — a workflow run should appear within ~10 seconds.
3. After it completes, the Jira ticket should have a new comment from the GitHub App (`[ferry:refiner:<run_id>] …`) and sub-tasks should appear.

If something goes wrong, check the workflow logs and the `[ferry:audit:<run_id>]` comment on the audit issue.
For a fully worked example, see [`examples/acme-corp-setup.md`](examples/acme-corp-setup.md).
