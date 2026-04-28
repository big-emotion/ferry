# Acme Corp pilot — concrete setup walkthrough

This example walks through installing Ferry on the **acme-corp** pilot project end-to-end. It mirrors the seven-step flow in the root `README.md`, with concrete values plugged in. Copy and adapt for your own setup.

> **Time:** ~25 minutes hands-on (NFR-M2 target: 30 min).

---

## Pre-flight

You need:

- Org admin (or repo admin) access to `acme-corp/acme-app` on GitHub.
- Site admin on `your-org.atlassian.net`.
- Anthropic, Google AI, and OpenAI accounts with billing enabled.

---

## Step 1 — Create the GitHub App

1. **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**
2. **GitHub App name:** `ferry-acme-corp`
3. **Homepage URL:** `https://acme-corp.example.com` (placeholder — Ferry doesn't use it)
4. **Webhook:** uncheck **Active**. Ferry uses `repository_dispatch`, not webhooks.
5. **Repository permissions:**
   - Contents → **Read and write**
   - Pull requests → **Read and write**
   - Issues → **Read and write**
   - Metadata → **Read-only** (auto-set)
   - All others → **No access**
6. **Subscribe to events:** none.
7. **Where can this GitHub App be installed?** → **Only on this account**.
8. Click **Create GitHub App**.
9. On the App settings page:
   - Note the **App ID** (e.g. `1234567`).
   - Click **Generate a private key** → save `ferry-acme-corp.YYYY-MM-DD.private-key.pem`.

## Step 2 — Install the App on the target repo

1. Left sidebar → **Install App**.
2. Click **Install** next to the `acme-corp` org.
3. Choose **Only select repositories** → `acme-app`.
4. Confirm.

## Step 3 — Create an Atlassian API token

1. Open **<https://id.atlassian.com/manage-profile/security/api-tokens>**.
2. **Create API token** → label: `ferry-acme-corp-pilot`.
3. Copy the token (you cannot view it again).
4. Note the email for this Atlassian account, e.g. `automation@acme-corp.example.com`.

## Step 4 — Configure Jira Automation rules

In Jira: **Project settings → Automation**.

Create one rule per Ferry column. Below is the rule for the **Refinement** column. Replicate for **In Development** (`phase: dev`), **In Review** (`phase: review`), and **Iteration** (`phase: iterate`).

**Rule: "Refinement → Ferry refine dispatch"**

- **Trigger:** Issue transitioned → **To status: Refinement**.
- **Action 1:** Send web request.
  - URL: `https://api.github.com/repos/acme-corp/acme-app/dispatches`
  - Method: `POST`
  - Headers:
    - `Accept: application/vnd.github+json`
    - `Authorization: Bearer <fine-grained PAT with contents:write or App installation token>`
    - `X-GitHub-Api-Version: 2022-11-28`
    - `Content-Type: application/json`
  - Body:

    ```json
    {
      "event_type": "ferry-dispatch",
      "client_payload": {
        "phase": "refine",
        "ticket_key": "{{issue.key}}",
        "issue_type": "{{issue.issuetype.name}}",
        "actor": "{{initiator.displayName}}",
        "source": "jira-column",
        "ts": "{{now.format(\"yyyy-MM-dd'T'HH:mm:ssXXX\")}}"
      }
    }
    ```

Save and **enable** the rule. Repeat with `phase: dev` for In Development, `phase: review` for In Review, `phase: iterate` for Iteration.

> **Optional add-ons:** label-based re-trigger rules (`agent:refiner`, `agent:developer`, …) and `@mention` rules for `@agent-refiner`, etc. Same body shape, different `source` (`jira-label` or `jira-comment`).

## Step 5 — Populate repository secrets

`acme-corp/acme-app` → **Settings → Secrets and variables → Actions**.

| Name                      | Value                                                     |
| ------------------------- | --------------------------------------------------------- |
| `FERRY_APP_ID`            | `1234567`                                                 |
| `FERRY_PRIVATE_KEY`       | full PEM contents (including `-----BEGIN/END-----` lines) |
| `FERRY_JIRA_BASE_URL`     | `https://acme-corp.atlassian.net`                         |
| `FERRY_JIRA_EMAIL`        | `automation@acme-corp.example.com`                        |
| `FERRY_JIRA_API_TOKEN`    | the token from step 3                                     |
| `FERRY_ANTHROPIC_API_KEY` | from Anthropic Console                                    |

## Step 6 — Hard spend caps

For the acme-corp pilot, target **≤ 200€/provider/month**:

- **Anthropic Console → Plans & Billing → Spend limits** → Monthly limit: `200 EUR`.
- **Google AI Studio → Billing** → enable budget alerts at `100 EUR` and `200 EUR`.
- **OpenAI Platform → Billing → Limits** → Monthly hard limit: `200 USD` (≈ pilot budget).

Ferry warns at 50% of the cap via the daily cost-governance cron.

## Step 7 — Copy workflows + CODEOWNERS

From this Ferry repo into `acme-app`:

```
.github/workflows/refine.yml
.github/workflows/dev.yml
.github/workflows/review.yml
.github/workflows/iterate.yml
.github/workflows/gate-envelope.yml
.github/workflows/cost-governance.yml
.github/CODEOWNERS
```

Commit and push to the default branch.

---

## Verification

1. On the Jira board, drag any **Story**-type ticket to **Refinement**.
2. In `acme-app` → **Actions** tab, you should see a `gate-envelope` run start within ~10 seconds.
3. After it succeeds, `refine.yml` runs. Watch its logs.
4. The Jira ticket should receive a comment from the GitHub App: `[ferry:refiner:<run_id>] …`.
5. Sub-tasks should appear on the ticket within 1–2 minutes.

If anything goes wrong, see the [troubleshooting section in the root README](../README.md) and the `[ferry:audit:<run_id>]` line in the audit issue.
