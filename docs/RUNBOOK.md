# Ferry Operator Runbook

On-call playbook for the four most common production incidents.
Each section ends with a concrete command sequence.

> **Scope:** manual recovery steps only — automation is a separate effort (see [PRODUCTION-READINESS-AUDIT.md](PRODUCTION-READINESS-AUDIT.md) §5). Alerting and paging setup is Domain 8 work and is out of scope here.

---

## Table of contents

1. [Stalled ticket (no agent activity in N hours)](#1-stalled-ticket)
2. [Cost spike](#2-cost-spike)
3. [Agent-loop runaway](#3-agent-loop-runaway)
4. [Refiner state-invariant on production traffic (D9 mitigation)](#4-refiner-state-invariant-d9-mitigation)
5. [Rollback Ferry to a previous version](#5-rollback-ferry-to-a-previous-version)
6. [CI red on `main`](#6-ci-red-on-main)

---

## 1. Stalled ticket

A ticket is stalled when it has been sitting in an active Jira column (`Refinement`, `In Development`, `In Review`, `Changes Requested`) for longer than expected and no agent has written a new audit comment.

**Expected cadence:** the reconciler re-triggers stalled tickets every 30 minutes (requires `ferry-reconcile.yml` to be wired). If the reconciler is not wired, tickets stall silently.

### 1.1 Read the audit issue

```bash
# Find the audit issue number
gh variable list --repo YOUR_ORG/YOUR_REPO | grep FERRY_AUDIT_ISSUE

# Fetch the most recent audit comments for a specific ticket
AUDIT_ISSUE=<issue-number>
TICKET=PROJ-42
gh issue view $AUDIT_ISSUE --repo YOUR_ORG/YOUR_REPO --comments \
  | grep -A5 "\[ferry:" \
  | grep "$TICKET" \
  | tail -20
```

Each audit line is a JSON object appended as a comment. Look for the most recent line matching your ticket key. The `phase` field tells you the last successful step (`refine`, `dev`, `review`, `iterate`). The `outcome` field is `ok` or `error`.

### 1.2 Identify the last successful phase

| Jira column       | Expected phase in audit | Workflow to re-trigger |
| ----------------- | ----------------------- | ---------------------- |
| Refinement        | `refine`                | `ferry-refine`         |
| In Development    | `dev`                   | `ferry-dev`            |
| In Review         | `review`                | `ferry-review`         |
| Changes Requested | `iterate`               | `ferry-iterate`        |

If the last audit line shows `"outcome":"error"`, check `reason` and `code` — common codes: `state-invariant` (bad LLM output, see §4), `spend-cap` (see §2), `oscillation` (see §3), `transient` (network blip, safe to retry).

### 1.3 Re-trigger the workflow

**Option A — via `gh workflow run` (preferred):**

```bash
TICKET=PROJ-42
PHASE=dev          # refine | dev | review | iterate
EVENT_TYPE=ferry-$PHASE

gh workflow run ferry-${PHASE}.yml \
  --repo YOUR_ORG/YOUR_REPO \
  --field event_type="$EVENT_TYPE" \
  --field ticket_key="$TICKET" \
  --field phase="$PHASE" \
  --field source="manual-retrigger" \
  --field ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

> The workflow accepts `workflow_dispatch` inputs only if the consumer-side stub exposes them. Alternatively, dispatch via the repository-dispatch API:

```bash
gh api repos/YOUR_ORG/YOUR_REPO/dispatches \
  -X POST \
  -f event_type="ferry-$PHASE" \
  -f 'client_payload[version]=v1' \
  -f "client_payload[ticket_key]=$TICKET" \
  -f "client_payload[phase]=$PHASE" \
  -f 'client_payload[source]=manual-retrigger' \
  -f "client_payload[event_id]=$TICKET-manual-$(date +%s)" \
  -f "client_payload[ts]=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -f 'client_payload[issue_type]=Story'
```

**Option B — move the Jira column:**

Move the ticket out of the stalled column and back in (e.g. move to `In Development` → `Refinement` → `In Development`). This re-fires the Jira automation rule and sends a fresh `repository_dispatch`. Use this when you want to reset state entirely.

### 1.4 Verify the reconciler is running

```bash
gh run list --workflow ferry-reconcile.yml --repo YOUR_ORG/YOUR_REPO --limit 5
```

If no runs appear in the last 30 minutes, the reconciler is not wired. Add it:

```bash
curl -fsSL "https://raw.githubusercontent.com/big-emotion/ferry/v0.7.0/examples/consumer-setup/workflows/ferry-reconcile.yml" \
  -o ".github/workflows/ferry-reconcile.yml"
git add .github/workflows/ferry-reconcile.yml
git commit -m "chore(ferry): add reconciler workflow"
git push
```

### 1.5 When to escalate

Escalate to the Ferry maintainer (`big-emotion/ferry` issues) if:

- The agent fails repeatedly with `state-invariant` on the same ticket (see §4).
- The workflow exits 0 but no audit comment is written (audit-issue append failure).
- The ticket has exceeded the 1000-comment audit-issue cap (silent failure — rotate the audit issue and update `FERRY_AUDIT_ISSUE`).

---

## 2. Cost spike

### 2.1 Read spend from the audit issue

Each agent run appends a `cost_eur` field to its audit comment. The daily check workflow also posts a structured alert.

```bash
AUDIT_ISSUE=<issue-number>

# Extract all cost_eur values for the current month
gh issue view $AUDIT_ISSUE --repo YOUR_ORG/YOUR_REPO --comments --json comments \
  | jq -r '.comments[].body | select(contains("cost_eur")) | @json' \
  | grep -o '"cost_eur":[0-9.]*' \
  | awk -F: '{sum += $2} END {printf "Total this session: €%.4f\n", sum}'
```

The daily cost workflow (`ferry-cost-daily.yml`) posts a spend alert when monthly spend crosses 50% of `FERRY_SPEND_CAP_EUR` (default 200€). Look for lines matching `⚠️ Spend alert:` in the audit issue.

### 2.2 How the 50% auto-pause label works

The `ferry:paused` Jira label is applied by the per-ticket auto-pause guard — not by the daily alert. It fires mid-run when the LLM API returns HTTP 429 (rate-limited) or 402 (payment required). The label prevents further Jira automation triggers from reaching the agent.

The daily alert (`ferry-cost-daily.yml`) is informational only: it posts a comment to the audit issue but does **not** pause tickets automatically.

### 2.3 Manually pause a ticket

```bash
TICKET=PROJ-42
JIRA_BASE_URL=https://YOUR-ORG.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=<atlassian-api-token>

# Apply the ferry:paused label via Jira REST API
curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -X POST "$JIRA_BASE_URL/rest/api/3/issue/$TICKET/labels" \
  -H "Content-Type: application/json" \
  -d '{"update":{"labels":[{"add":"ferry:paused"}]}}'
```

Once `ferry:paused` is on the ticket, the Jira automation rules will still fire (you moved the column), but the Ferry envelope validation rejects the event with `spend-cap` and exits cleanly.

### 2.4 Resume a paused ticket

```bash
# Remove the ferry:paused label
curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -X PUT "$JIRA_BASE_URL/rest/api/3/issue/$TICKET" \
  -H "Content-Type: application/json" \
  -d '{"update":{"labels":[{"remove":"ferry:paused"}]}}'

# Then re-trigger the agent (see §1.3)
```

### 2.5 Reduce the monthly cap

```bash
# Lower the cap to €50 for the rest of the month
gh variable set FERRY_SPEND_CAP_EUR --body "50" --repo YOUR_ORG/YOUR_REPO
```

The next daily check run will use the updated cap. For an immediate effect, also manually pause active tickets (§2.3).

### 2.6 Escalation path

If spend is anomalously high (e.g. 10× the per-story average):

1. Pause all active tickets immediately (§2.3).
2. Check for runaway iteration loops (§3).
3. Check the LLM provider dashboard for unexpected usage outside Ferry (the `cost_eur` in audit comments is computed from token counts, not from the provider bill directly).
4. File an issue at `big-emotion/ferry` if a Ferry agent is re-triggering itself in a loop.

---

## 3. Agent-loop runaway

A runaway occurs when an agent keeps re-triggering without making progress: common signs are many workflow runs for the same ticket within a short window, or an `oscillation` error in the audit log.

### 3.1 Read the iteration count from the audit issue

```bash
AUDIT_ISSUE=<issue-number>
TICKET=PROJ-42

gh issue view $AUDIT_ISSUE --repo YOUR_ORG/YOUR_REPO --comments --json comments \
  | jq -r --arg t "$TICKET" \
    '.comments[].body | select(contains($t)) | select(contains("iterate"))' \
  | grep -o '"iteration":[0-9]*'
```

The Iterator agent cap (default 3, configurable via `limits.max_iterations` in `ferry.config.yaml`) throws an `oscillation` error when `iteration >= cap` and findings remain. You will see:

```json
{ "code": "oscillation", "reason": "iteration-cap-exceeded", "cap": 3, "iteration": 3 }
```

The Reviewer agent has an internal LLM tool-use loop capped at 40 iterations (overridable via `FERRY_REVIEWER_MAX_ITERATIONS`). A runaway in the Reviewer loop logs `review-iteration-cap-exceeded`.

### 3.2 Kill an in-flight workflow run

```bash
# List recent runs for the iterate workflow
gh run list --workflow ferry-iterate.yml --repo YOUR_ORG/YOUR_REPO --limit 10

# Cancel a specific run (replace RUN_ID)
RUN_ID=<run-id>
gh run cancel $RUN_ID --repo YOUR_ORG/YOUR_REPO

# Verify it stopped
gh run view $RUN_ID --repo YOUR_ORG/YOUR_REPO
```

After cancellation, apply `ferry:paused` to the ticket (§2.3) to prevent the Jira automation rule from firing again before you investigate.

### 3.3 Diagnose the oscillation

Common causes:

| Symptom in audit log                       | Likely cause                                        | Action                                                                      |
| ------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------- |
| `"reason":"iteration-cap-exceeded"`        | Reviewer keeps finding issues Iterator can't fix    | Increase cap (§3.4) or manually review the PR diff for a structural blocker |
| `"reason":"review-iteration-cap-exceeded"` | Reviewer's internal tool-use loop exceeded 40 steps | Set `FERRY_REVIEWER_MAX_ITERATIONS` lower; check for adversarial PR content |
| `"reason":"spec-too-broad"`                | Refiner `touch_paths` exceeded cap (too many files) | Break the ticket into smaller stories in Jira                               |
| Repeated `transient` errors                | Network or LLM API instability                      | Wait 10 min; re-trigger manually (§1.3)                                     |

### 3.4 Bump `limits.max_iterations` if needed

In `ferry.config.yaml` in the consumer repo:

```yaml
limits:
  max_iterations: 5 # default is 3; increase only after investigating why 3 isn't enough
```

Commit and push. The change takes effect on the next dispatch — no workflow restart needed.

```bash
git add ferry.config.yaml
git commit -m "chore(ferry): increase max_iterations to 5 for PROJ-42 remediation"
git push
```

### 3.5 When the iteration cap fires automatically

When `oscillation` is thrown, the Iterator agent exits with a non-zero code, appends an error audit line, and does **not** re-trigger the Reviewer. The ticket remains in `Changes Requested` on Jira until a human intervenes. This is the intended safety net — do not try to suppress the error; instead fix the root cause (usually a structural blocker in the PR that the LLM cannot resolve autonomously).

---

## 4. Refiner state-invariant (D9 mitigation)

> **Context (2026-05-02):** A confirmed production failure on `big-emotion/ethniafrica` (run 25262368292, v0.5.2) showed the Refiner's JSON parser fails when the LLM returns any prose preamble before the JSON object. Until the parser-hardening fix (#160) lands, use this section to identify and manually recover affected tickets.

### 4.1 Recognize the error

The structured log line from a failing Refiner looks like:

````json
{
  "code": "state-invariant",
  "reason": "refiner-output-invalid",
  "stage": "parse",
  "sample": "Here is the JSON you asked for:\n\n```json\n{...",
  "text_length": 1847
}
````

Key fields:

- `stage: "parse"` — the raw LLM text could not be `JSON.parse`d (prose preamble or trailing prose).
- `stage: "schema"` — the JSON parsed but failed AJV schema validation; `paths` lists the failing fields.
- `sample` — first 512 chars of the LLM response (useful for diagnosing the preamble pattern).
- `text_length` — total response length.

### 4.2 Read the log from the GitHub Actions run

```bash
TICKET=PROJ-42

# Find the failing run
gh run list --workflow ferry-refine.yml --repo YOUR_ORG/YOUR_REPO --limit 20

# View the log for the failing run
RUN_ID=<run-id>
gh run view $RUN_ID --repo YOUR_ORG/YOUR_REPO --log | grep -A10 "state-invariant"
```

Alternatively, check the audit issue comment for the ticket — the structured error is appended there.

### 4.3 Tag the ticket for manual handling

```bash
TICKET=PROJ-42
JIRA_BASE_URL=https://YOUR-ORG.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=<atlassian-api-token>

# Mark ticket for manual handling (prevents auto-retrigger spam)
curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -X PUT "$JIRA_BASE_URL/rest/api/3/issue/$TICKET" \
  -H "Content-Type: application/json" \
  -d '{"update":{"labels":[{"add":"ferry:paused"},{"add":"ferry:needs-human"}]}}'

# Move ticket out of Refinement to prevent further dispatches
# (move to a holding column, e.g. "Backlog", via Jira UI or API)
```

### 4.4 Manual workaround until #160 lands

The Refiner prompt explicitly says "Reply with JSON only — no prose, no code fences". If the LLM you have configured for the Refiner ignores this instruction, you can switch to a different provider temporarily:

In `ferry.config.yaml`:

```yaml
agents:
  refiner:
    provider: openai # or google; anthropic is the default
    model: gpt-4o
```

Or, if you want to keep Anthropic, try a different model that more reliably follows instruction format:

```yaml
agents:
  refiner:
    model: claude-haiku-4-5-20251001 # smaller models sometimes follow format better
```

After changing the config, remove `ferry:paused`, commit, push, and re-trigger (§1.3).

### 4.5 Escalation

If the error persists after provider/model switch, file an issue at `big-emotion/ferry` referencing the failing run ID and the `sample` field from the audit log. The fix is tracked in #160.

---

## 5. Rollback Ferry to a previous version

### 5.1 When to roll back

Roll back if:

- A Ferry upgrade introduced a confirmed regression in production (failed agent runs, broken audit writes).
- The `ferry-doctor` fails after an upgrade in a way that only appeared in the new version.
- You need to unblock production while a hotfix is prepared upstream.

### 5.2 Identify the target version

```bash
# List available tags upstream
gh api repos/big-emotion/ferry/git/refs/tags --jq '.[].ref' | grep 'refs/tags/v' | sort -V | tail -10
```

Stable releases to consider rolling back to, in descending order:

| Tag      | Notes                                                                  |
| -------- | ---------------------------------------------------------------------- |
| `v0.7.0` | Current recommended pin; expanded inline workflows (cross-org secrets) |
| `v0.6.0` | Previous stable; reusable-workflow form (breaks cross-org secrets)     |
| `v0.5.2` | Safe install path; known Refiner parser bug (D9)                       |
| `v0.5.1` | **Do not use** — Refiner CJS dynamic-require crash                     |
| `v0.5.0` | Stable; missing v0.5.1+ Jira automation JSON fixes                     |

### 5.3 Re-pin consumer workflows

The consumer repo has four Ferry workflow stubs. Re-pin them all:

```bash
# Replace the current pin with the target version
CURRENT=v0.7.0    # what your workflows currently pin
TARGET=v0.6.0     # the version you want to roll back to

sed -i.bak "s|@${CURRENT}|@${TARGET}|g" .github/workflows/ferry-*.yml
rm .github/workflows/ferry-*.yml.bak

# Verify the replacement
grep -h "uses:.*big-emotion/ferry" .github/workflows/ferry-*.yml

git add .github/workflows/
git commit -m "chore(ferry): rollback to ${TARGET} (incident recovery)"
git push
```

Also update the reconciler and cost-daily stubs:

```bash
sed -i.bak "s|FERRY_REF: ${CURRENT}|FERRY_REF: ${TARGET}|g" \
  .github/workflows/ferry-reconcile.yml \
  .github/workflows/ferry-cost-daily.yml
rm .github/workflows/ferry-*.yml.bak
git add .github/workflows/ferry-reconcile.yml .github/workflows/ferry-cost-daily.yml
git commit -m "chore(ferry): rollback reconciler and cost-daily to ${TARGET}"
git push
```

### 5.4 How the floating `@v1` tag interacts with rollback

The `@v1` tag in the `big-emotion/ferry` repo is a **floating** tag that always points to the latest stable `v1.x.y` release. It is advanced by `scripts/retag-major.sh` on every new release.

- If your consumer workflows pin `@v1`, they will automatically follow any new release — **a rollback requires you to pin to an explicit tag** (e.g. `@v0.5.2`) and remove the `@v1` reference.
- The `@v1` tag does **not** roll back automatically when you roll back your consumer — it is upstream state.

```bash
# Check what @v1 currently resolves to upstream
gh api repos/big-emotion/ferry/git/refs/tags/v1 --jq '.object.sha'
```

### 5.5 Verify the rollback

```bash
# Confirm all workflows are pinned to the target version
grep -h "uses:.*big-emotion/ferry" .github/workflows/ferry-*.yml \
  | sort -u

# Trigger a smoke test
# (move a low-risk Story ticket to Refinement in Jira, or use workflow_dispatch)
gh workflow run ferry-refine.yml --repo YOUR_ORG/YOUR_REPO

# Watch the run
gh run watch --repo YOUR_ORG/YOUR_REPO
```

### 5.6 When to file an issue upstream

File a bug at `big-emotion/ferry` if:

- The regression is reproducible with a specific `v0.x.y` tag.
- `ferry-doctor` passes but the agent fails in a way not covered by known issues.
- The rollback itself causes new failures (e.g. a schema incompatibility between the old Ferry version and state files written by the new version).

Include in the upstream issue: the failing run URL, the audit log excerpt, and the `ferry.config.yaml` (redact secrets).

---

## 6. CI red on `main`

### 6.1 Which checks gate publishing

A Ferry release runs the full quality gate before `npm publish`. The following checks must all be green before a tag can publish:

| Check name (in GitHub Actions)    | What it validates                            | Failure impact |
| --------------------------------- | -------------------------------------------- | -------------- |
| `Typecheck`                       | TypeScript compilation (`tsc --noEmit`)      | Blocks publish |
| `Lint & Format`                   | ESLint + Prettier + FR drift                 | Blocks publish |
| `Tests (vitest)`                  | 1025+ unit tests with 75% coverage threshold | Blocks publish |
| `Bundle Drift (check:bundle)`     | `.ferry/` matches `src/` byte-for-byte       | Blocks publish |
| `npm Audit (supply-chain)`        | `npm audit --audit-level=moderate`           | Blocks publish |
| `Secret Scan (gitleaks)`          | gitleaks scan on all committed files         | Blocks publish |
| `Analyze (javascript-typescript)` | CodeQL SAST (high/critical severity = error) | Blocks publish |

The release workflow (`.github/workflows/release.yml`) re-runs all gates before publishing. A green CI on `main` does **not** mean a tag will publish cleanly — the release workflow re-gates.

### 6.2 Identify which gate failed

```bash
# List the most recent CI run on main
gh run list --workflow ferry-ci.yml --repo big-emotion/ferry --branch main --limit 5

# View failed jobs in a run
RUN_ID=<run-id>
gh run view $RUN_ID --repo big-emotion/ferry

# Stream the log of the failing job
gh run view $RUN_ID --repo big-emotion/ferry --log-failed
```

### 6.3 Decision tree: revert vs. roll forward

```
CI red on main
│
├── Gate: Typecheck
│     → Fix the TypeScript error and push a new commit.
│       Revert only if the fix is non-trivial and is blocking a release.
│
├── Gate: Lint & Format
│     → Run `npm run lint --fix && npm run format` locally, push.
│       FR drift failures require adding the new FR tag to docs/REQUIREMENTS.md.
│
├── Gate: Tests (vitest)
│     → Run `npm test` locally. If a snapshot is stale: `npx vitest -u`.
│       A widespread failure after a merge → revert the merge commit.
│
├── Gate: Bundle Drift
│     → Run `npm run build:ferry && git add .ferry/ && git commit -m "build: rebuild bundles"`.
│       Never edit .ferry/ directly.
│
├── Gate: npm Audit
│     → Run `npm audit --audit-level=moderate` locally.
│       If a dep has a known vuln: `npm audit fix` or pin a safe version.
│       If it's a false positive: add an exception to `scripts/npm-audit-check.mjs`.
│
├── Gate: Secret Scan (gitleaks)
│     → Identify the leak: `gh run view $RUN_ID --log-failed | grep "gitleaks"`.
│       If a real secret: rotate it immediately, then remove it from git history.
│       If a false positive: add a `.gitleaks.toml` allowlist entry.
│
└── Gate: CodeQL
      → View findings at Security → Code Scanning in the GitHub repo.
        High/critical = must fix before merging.
        To suppress a confirmed false positive:
          add `// lgtm[<rule-id>]` at the finding location with a rationale comment.
```

### 6.4 Revert a bad merge to `main`

```bash
# Find the commit to revert
git log --oneline main | head -10

# Revert (creates a new commit, does not destroy history)
COMMIT_SHA=<sha-of-bad-commit>
git revert $COMMIT_SHA --no-edit
git push origin main
```

Prefer `git revert` over `git reset --hard` — the latter rewrites history and can break open PRs.

### 6.5 When a release tag is already published with red CI

If a tag was pushed and the release workflow started before CI went red:

1. Let the release workflow finish or cancel it via `gh run cancel`.
2. If `npm publish` already ran: the package is live. Cut a patch release with the fix as soon as possible. Document the bad version in `MIGRATIONS.md`.
3. If `npm publish` did not run: delete the GitHub Release (do not delete the git tag — deletions break consumers who may have SHA-pinned to it). Fix the issue, then push a new tag.

---

## See also

- [`docs/CONFIGURATION.md`](CONFIGURATION.md) — full configuration reference for `ferry.config.yaml`
- [`docs/RELEASING.md`](RELEASING.md) — release pipeline checklist and dual-tag scheme
- [`MIGRATIONS.md`](../MIGRATIONS.md) — consumer-visible changes per release (run `ferry-update` to apply)
- [`docs/PRODUCTION-READINESS-AUDIT.md`](PRODUCTION-READINESS-AUDIT.md) — current audit score and open action items
