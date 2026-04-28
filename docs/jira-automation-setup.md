# Jira Automation Setup for Ferry

This document explains how to wire Jira automation rules to trigger each of Ferry's four pipeline stages: **Refine → Dev → Review → Iterate**. Follow it from scratch in any repo that copies Ferry.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Jira automation rules](#2-jira-automation-rules)
3. [Name and enable each rule](#3-name-and-enable-each-rule)
4. [Verify end-to-end](#4-verify-end-to-end)
5. [Common pitfalls](#5-common-pitfalls)

---

## 1. Prerequisites

All steps below are one-time, per target repo.

### A. GitHub PAT

Create a fine-grained token at `github.com/settings/personal-access-tokens/new`:

| Setting | Value |
|---|---|
| Resource owner | your GitHub org or user |
| Repository access | target repo only |
| Permissions — Contents | **Write** |
| Permissions — Actions | **Write** |
| Permissions — Pull requests | **Write** |
| Permissions — Metadata | **Read** (required by GitHub) |

> **Recommendation:** use a dedicated bot GitHub account (`ferry-bot`), not a personal account. This prevents loop triggers (agent acts → Jira sees the actor → re-fires automation) and keeps the audit trail clean.

### B. GitHub Secrets

In the target repo: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret name | Value |
|---|---|
| `FERRY_JIRA_BASE_URL` | `https://your-org.atlassian.net` |
| `FERRY_JIRA_EMAIL` | email of the Jira API user |
| `FERRY_JIRA_API_TOKEN` | Jira API token — create at `id.atlassian.com/manage-profile/security/api-tokens` |
| `FERRY_REVIEW_TRANSITION_ID` | Jira transition ID for the move to "In Review" (see step C) |
| `ANTHROPIC_API_KEY` | Claude API key |

> `GITHUB_TOKEN` is automatically provided by GitHub Actions — no configuration needed.

### C. Find Jira transition IDs

Run this against any ticket in the target project to list available transitions and their IDs:

```bash
curl -u EMAIL:JIRA_API_TOKEN \
  -H "Accept: application/json" \
  "https://YOUR-DOMAIN.atlassian.net/rest/api/3/issue/ANY-123/transitions"
```

Note the `id` value for each transition you need — at minimum, the one that moves a ticket to **"In Review"** (used by `FERRY_REVIEW_TRANSITION_ID`).

### D. Create the ferry-audit GitHub Issue

1. In the target repo, create an Issue titled exactly **`ferry-audit`**.
2. Note its number (e.g., `42`).
3. In **Settings → Secrets and variables → Actions → Variables**, add:
   - Name: `FERRY_AUDIT_ISSUE`
   - Value: `42` (the issue number)

> This is a **variable**, not a secret. The audit issue accumulates JSON audit lines appended by `emitAudit()`.

### E. Verify dispatch works

Before setting up Jira automation, confirm that a manual `repository_dispatch` reaches GitHub Actions:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_PAT" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/OWNER/REPO/dispatches \
  -d '{
    "event_type": "ferry-dev",
    "client_payload": {
      "version": "v1",
      "event_id": "1745876263000-TEST-1",
      "ticket_key": "TEST-1",
      "phase": "dev",
      "source": "jira-column",
      "ts": "2025-01-01T00:00:00Z",
      "issue_type": "Story"
    }
  }'
```

| HTTP status | Meaning |
|---|---|
| `204` | OK — GitHub accepted the dispatch |
| `404` | Wrong `OWNER/REPO` in the URL, or PAT lacks Actions permission |
| `422` | Malformed payload (check JSON syntax) |

---

## 2. Jira automation rules

Create one rule per stage. In Jira: **Project settings → Automation → Create rule**.

### Common structure for all four rules

**Trigger:** `Issue transitioned → To status: <target column>`

**Condition (optional but recommended):** `Issue fields condition → Issue type → is one of → Story, Bug`

> This filters out Task tickets at the Jira level. Ferry's `shouldProcessTicketType()` also enforces this in code, but filtering in Jira is cheaper — it avoids the HTTP round-trip entirely.

**Action:** `Send web request`

| Field | Value |
|---|---|
| URL | `https://api.github.com/repos/OWNER/REPO/dispatches` |
| Method | `POST` |
| Body type | `Custom data` |

Add these three headers:

```
Authorization: Bearer YOUR_PAT
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

---

### Per-stage payloads


#### Refine

Trigger: ticket moved to **"Refine"** (or "Ready to Refine" — whatever your board column is named).

```json
{
  "event_type": "ferry-refine",
  "client_payload": {
    "version": "v1",
    "event_id": "{{now.toMillis}}-{{issue.key}}",
    "ticket_key": "{{issue.key}}",
    "phase": "refine",
    "source": "jira-column",
    "ts": "{{now.jiraDate}}",
    "issue_type": "{{issue.issuetype.name}}"
  }
}
```

---

#### Dev

Trigger: ticket moved to **"In Progress"** (or "Dev").

```json
{
  "event_type": "ferry-dev",
  "client_payload": {
    "version": "v1",
    "event_id": "{{now.toMillis}}-{{issue.key}}",
    "ticket_key": "{{issue.key}}",
    "phase": "dev",
    "source": "jira-column",
    "ts": "{{now.jiraDate}}",
    "issue_type": "{{issue.issuetype.name}}"
  }
}
```

---

#### Review

Trigger: ticket moved to **"In Review"**.

> The Review and Iterate agents are currently stubs. The automation rule is correct and will dispatch — the workflow will simply exit early until the agents are fully implemented.

```json
{
  "event_type": "ferry-review",
  "client_payload": {
    "version": "v1",
    "event_id": "{{now.toMillis}}-{{issue.key}}",
    "ticket_key": "{{issue.key}}",
    "phase": "review",
    "source": "jira-column",
    "ts": "{{now.jiraDate}}",
    "issue_type": "{{issue.issuetype.name}}"
  }
}
```

---

#### Iterate

Trigger: ticket moved to **"Changes Requested"** (or "Iterate").

```json
{
  "event_type": "ferry-iterate",
  "client_payload": {
    "version": "v1",
    "event_id": "{{now.toMillis}}-{{issue.key}}",
    "ticket_key": "{{issue.key}}",
    "phase": "iterate",
    "source": "jira-column",
    "ts": "{{now.jiraDate}}",
    "issue_type": "{{issue.issuetype.name}}"
  }
}
```

---


## 3. Name and enable each rule

| Rule name | Trigger column |
|---|---|
| `Ferry → Refine` | Refine / Ready to Refine |
| `Ferry → Dev` | In Progress / Dev |
| `Ferry → Review` | In Review |
| `Ferry → Iterate` | Changes Requested / Iterate |

- Set the **owner** to your Jira service/bot account (same one used for the API token).
- Toggle the rule **ON**.

---

## 4. Verify end-to-end

1. Move a **Story** ticket from Backlog → Refine in Jira.
2. **Jira:** Project settings → Automation → Audit log — the `Ferry → Refine` rule should show **Completed** with HTTP `204`.
3. **GitHub:** Actions tab → a `ferry-refine` workflow run should appear.
4. **GitHub:** When the run completes, open the `ferry-audit` issue — a JSON audit line should have been appended.
5. **Jira:** The ticket should have a new comment from `ferry-bot`.

> If the Jira audit log shows `204` but no GitHub workflow appears: check that `event_type` in the payload (`ferry-refine`) exactly matches the `types:` array in `refine.yml`. A single character difference (hyphen vs. underscore, wrong case) will silently drop the event.

---

## 5. Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `401` from Jira automation action | PAT expired or wrong scope | Regenerate PAT with Contents + Actions + Pull requests write |
| `404` from GitHub API | Wrong `OWNER/REPO` in URL | Double-check the exact org/repo path (case-sensitive) |
| `422` from GitHub API | Malformed JSON body | Open Jira automation audit log → expand the failed run → inspect the rendered payload |
| Automation fires but nothing happens in GitHub | `event_type` string doesn't match `types:` in the workflow | Compare character by character — `ferry-dev` not `ferry_dev` |
| Duplicate workflow runs for the same ticket move | Jira automation fires on self-transition when Ferry writes a comment | Add condition: `Initiator → email → is not → ferry-bot@your-org.com` |
| Loop: Ferry moves ticket column → Jira fires automation again | Same as above | Same fix |
| PR not created by dev agent | Missing `pull-requests: write` permission in `dev.yml` | Already set in `dev.yml` — check that no org policy overrides it |
| Ticket has `ferry:paused` or `needs-human` label | Previous run hit a spend cap or escalation | Manually remove the label after investigating the `ferry-audit` issue |
