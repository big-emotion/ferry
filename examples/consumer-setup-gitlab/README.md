# Ferry on GitLab — consumer setup (experimental)

> **Experimental** — see [#210](https://github.com/big-emotion/ferry/issues/210). The GitLab adapter has not yet been exercised end-to-end in production. Same artifact may break across minor versions until the experimental flag is dropped.

## What this is

Copy-pasteable GitLab CI templates that wire Ferry's four agents (Refiner / Developer / Reviewer / Iterator) plus the two scheduled jobs (reconciler / cost-governance) into a GitLab project. Mirrors `examples/consumer-setup/workflows/` for GitHub Actions.

## Prerequisites

| Requirement                                  | Where it comes from                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| GitLab project access token with `api` scope | Project → Settings → Access tokens. Save as `FERRY_GITLAB_TOKEN` (masked, protected).                                                |
| Pipeline trigger token                       | Project → Settings → CI/CD → Pipeline triggers → **Add trigger**. Save as `FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN` (masked, protected). |
| Jira API token                               | Atlassian → Personal Access Tokens. Save as `FERRY_JIRA_API_TOKEN` (masked, protected).                                              |
| LLM provider key                             | Anthropic, OpenAI, or Google. At least one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` (masked, protected).         |

## Install

1. **Run the GitLab installer**:

   ```bash
   npx -p @big-emotion/ferry ferry-init --forge gitlab
   ```

   This writes the canonical templates under `ci/ferry/`.

2. **Include the generated templates** from your root `.gitlab-ci.yml`:

   ```yaml
   include:
     - local: ci/ferry/refine.gitlab-ci.yml
     - local: ci/ferry/dev.gitlab-ci.yml
     - local: ci/ferry/review.gitlab-ci.yml
     - local: ci/ferry/iterate.gitlab-ci.yml
   ```

   Add `ci/ferry/reconcile.gitlab-ci.yml` and `ci/ferry/cost-daily.gitlab-ci.yml` if you want the scheduled maintenance jobs.

3. **Set the CI/CD variables** (Settings → CI/CD → Variables). Mark every token-bearing variable as both **Protected** and **Masked**:
   - `FERRY_VERSION` — e.g. `v1.0.2` (the npm version of `@big-emotion/ferry`)
   - `FERRY_JIRA_BASE_URL`, `FERRY_JIRA_EMAIL`, `FERRY_JIRA_API_TOKEN`
   - `FERRY_GITLAB_TOKEN`, `FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN`
   - `FERRY_REVIEW_TRANSITION_ID`, `FERRY_ITER_TRANSITION_ID`, `FERRY_APPROVE_TRANSITION_ID`
   - `FERRY_AUDIT_ISSUE` — the Jira issue key used as the audit log
   - At least one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`
4. **Wire Jira Automation** for each column transition you want to trigger an agent. Each rule sends a webhook of the form:

   ```http
   POST https://gitlab.example/api/v4/projects/<encoded-path>/trigger/pipeline
   Content-Type: application/x-www-form-urlencoded

   token=<FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN>&
   ref=main&
   variables[FERRY_DISPATCH_TYPE]=ferry-refine&
   variables[FERRY_ENVELOPE_PAYLOAD]={"version":"v1","event_id":"…","ticket_key":"ACME-1","phase":"refine","source":"jira-column","ts":"2026-…Z"}
   ```

   The `FERRY_DISPATCH_TYPE` values for the four roles are: `ferry-refine`, `ferry-dev`, `ferry-review`, `ferry-iterate`.

5. **Run a smoke test** — move a Jira Story to the Ferry refinement column and confirm that GitLab starts a pipeline with `FERRY_DISPATCH_TYPE=ferry-refine`.

6. **Validate the install**:

   ```bash
   npx -p @big-emotion/ferry ferry-doctor --forge gitlab \
     --project owner/repo \
     --token "$FERRY_GITLAB_TOKEN" \
     --trigger-token "$FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN"
   ```

7. **(Optional) Scheduled jobs** — under Settings → CI/CD → Schedules, add one schedule for the reconciler (recommended every 10 minutes, set CI variable `schedule_reconcile=true`) and one for cost governance (daily, `schedule_cost_daily=true`). Include `ci/ferry/reconcile.gitlab-ci.yml` and `ci/ferry/cost-daily.gitlab-ci.yml` from the top-level pipeline file to wire them in.

## Status

GitLab support is **experimental** until a real consumer has run a full Refiner → Developer → Reviewer → Iterator cycle in production for at least two weeks. The promotion checklist lives on [#210](https://github.com/big-emotion/ferry/issues/210). Until then:

- The bundled artifact may break across minor releases.
- `ferry-doctor --forge gitlab` ships today, but its Jira webhook verification step remains manual because Ferry cannot probe Jira Automation from the CLI.
- Record-replay HTTP fixtures in Ferry's own CI now cover the adapter, but a real consumer production loop is still the gate to remove the experimental label.

If you hit issues, please open a bug report on [big-emotion/ferry](https://github.com/big-emotion/ferry/issues) referencing #210.
