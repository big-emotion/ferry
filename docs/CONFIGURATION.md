# Ferry Configuration Reference

This document is the canonical reference for all consumer-configurable parameters. The consumer workflow stubs (`.github/workflows/ferry-*.yml`) link here rather than maintaining their own parameter lists.

## Quick Summary

Ferry is configured through three layers, applied in order (later layers override earlier ones):

1. **`ferry.config.json`** in your repository root — model selection, limits, MCP label mapping
2. **GitHub repository variables** (`vars.*`) — per-repo overrides without touching the config file
3. **GitHub secrets** (`secrets.*`) — credentials and transition IDs

---

## Secrets

Add these under **Settings → Secrets and variables → Actions → Secrets** in your GitHub repository.

### Required for all agents

| Secret                 | Description                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `FERRY_JIRA_BASE_URL`  | Your Jira instance URL, e.g. `https://acme.atlassian.net`                                              |
| `FERRY_JIRA_EMAIL`     | Atlassian account email used for Jira API calls                                                        |
| `FERRY_JIRA_API_TOKEN` | Atlassian API token — [generate one here](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `ANTHROPIC_API_KEY`    | Anthropic API key — [get one here](https://console.anthropic.com/account/keys)                         |

### Required when using non-Anthropic providers

| Secret                | Provider | Description                                                                       |
| --------------------- | -------- | --------------------------------------------------------------------------------- |
| `FERRY_OPENAI_KEY`    | `openai` | OpenAI API key — required when any phase is configured with `provider: openai`    |
| `FERRY_GOOGLE_AI_KEY` | `google` | Google AI API key — required when any phase is configured with `provider: google` |

### Required for specific agents

| Secret                       | Used by             | Description                                                                                                                                                       |
| ---------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FERRY_REVIEW_TRANSITION_ID` | Developer, Iterator | Jira transition ID that moves a ticket **into** the **In Review** column (FR18 / FR28). Find it via the Jira REST API: `GET /rest/api/3/issue/{key}/transitions`. |
| `FERRY_ITER_TRANSITION_ID`   | Reviewer            | Jira transition ID that moves a ticket **into** the **Changes Requested** column (FR24, when the reviewer requests changes). Same API call as above.              |

> **Finding Jira transition IDs:** Call `GET https://<your-domain>.atlassian.net/rest/api/3/issue/<TICKET-KEY>/transitions` with Basic Auth. The response lists available transitions with their `id` and `name`. Use the ID (a number string like `"31"`) for the secret value.

---

## Repository Variables

Add these under **Settings → Secrets and variables → Actions → Variables** in your GitHub repository.

### Required

| Variable            | Default           | Description                                                                                                                                                         |
| ------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FERRY_AUDIT_ISSUE` | (none — required) | GitHub Issue number used as the audit log. Ferry writes deduplication entries here to prevent duplicate runs. Create a blank issue in your repo and use its number. |

### Optional

| Variable                      | Default             | Affects         | Description                                                                                              |
| ----------------------------- | ------------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `FERRY_REFINER_PROVIDER`      | (from config)       | Refiner agent   | Override the LLM provider for the Refiner. Must be `anthropic`, `openai`, or `google`.                   |
| `FERRY_REFINER_MODEL`         | (from config)       | Refiner agent   | Override the model ID for the Refiner.                                                                   |
| `FERRY_DEV_PROVIDER`          | (from config)       | Developer agent | Override the LLM provider for the Developer. Currently only `anthropic` is supported for agentic phases. |
| `FERRY_DEV_MODEL`             | (from config)       | Developer agent | Override the model ID for the Developer.                                                                 |
| `FERRY_REVIEW_PROVIDER`       | (from config)       | Reviewer agent  | Override the LLM provider for the Reviewer. Currently only `anthropic` is supported for agentic phases.  |
| `FERRY_REVIEW_MODEL`          | `claude-sonnet-4-6` | Reviewer agent  | Override the model ID for the Reviewer.                                                                  |
| `FERRY_ITER_PROVIDER`         | (from config)       | Iterator agent  | Override the LLM provider for the Iterator. Currently only `anthropic` is supported for agentic phases.  |
| `FERRY_ITER_MODEL`            | `claude-sonnet-4-6` | Iterator agent  | Override the model ID for the Iterator.                                                                  |
| `FERRY_ITER_MAX_INPUT_TOKENS` | `500000`            | Iterator agent  | Input token budget per Iterator run. Mapped to `limits.max_tokens_per_run` internally.                   |

---

## `ferry.config.json`

Create `ferry.config.json`, `ferry.config.yaml`, or `ferry.config.yml` at the **root of your repository**. All fields are optional — omit any section to use the defaults.

Ferry reads the config file from `GITHUB_WORKSPACE` (the checked-out repo root) at the start of each agent run.

> **`ferry.config.*` is never auto-generated by `ferry-init`.** A missing file means Ferry uses its built-in defaults — which is the right starting point for most teams. Only create this file when you actually want to override a default. Generating a file that merely restates the defaults adds noise and creates a second source of truth that can drift from the bundled defaults over time.

### Full annotated example

```json
{
  "models": {
    "refiner": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-6"
    },
    "dev": {
      "provider": "anthropic",
      "model": "claude-opus-4-5"
    },
    "review": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-6"
    },
    "iterate": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-6"
    }
  },
  "limits": {
    "max_iterations": 3,
    "max_agent_iterations": 200,
    "max_tokens_per_run": 500000,
    "max_tokens_per_message": 16384,
    "max_cost_eur_per_run": 10
  },
  "ticket_types": {
    "refine_allowlist": ["Story", "Bug", "Spike"],
    "dev_allowlist": ["Story", "Bug", "Spike"]
  },
  "git": {
    "base_branch": null,
    "target_branch": null,
    "working_branch_prefix": "ferry/"
  },
  "labels": {
    "ferry:mcp/context7": {
      "mcp_servers": ["context7"]
    },
    "ferry:mcp/sentry": {
      "mcp_servers": ["sentry"],
      "tools": ["fetch_runtime_logs", "list_issues"]
    }
  }
}
```

### Field reference

#### `models`

Each agent phase can be configured independently. All `models.*` fields are optional.

Ferry supports three LLM providers: **`anthropic`**, **`openai`**, and **`google`**. Provider support varies by phase:

| Phase     | Supported providers             | Notes                                                           |
| --------- | ------------------------------- | --------------------------------------------------------------- |
| `refiner` | `anthropic`, `openai`, `google` | Uses a single-turn LLM call — all providers work                |
| `dev`     | `anthropic`                     | Uses an agentic tool-use loop; OpenAI/Google support is planned |
| `review`  | `anthropic`                     | Uses an agentic tool-use loop; OpenAI/Google support is planned |
| `iterate` | `anthropic`                     | Uses an agentic tool-use loop; OpenAI/Google support is planned |

> **MCP:** Model Context Protocol (MCP) server integration is Anthropic-only and is not available when using other providers.

| Field                     | Default               | Description                                                                           |
| ------------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `models.refiner.provider` | `"anthropic"`         | LLM provider for the Refiner agent. Accepts `"anthropic"`, `"openai"`, or `"google"`. |
| `models.refiner.model`    | `"claude-sonnet-4-6"` | Model ID for the Refiner agent (overridden by `FERRY_REFINER_MODEL` env var)          |
| `models.dev.provider`     | `"anthropic"`         | LLM provider for the Developer agent. Currently only `"anthropic"` is supported.      |
| `models.dev.model`        | `"claude-opus-4-5"`   | Model ID for the Developer agent (overridden by `FERRY_DEV_MODEL` env var)            |
| `models.review.provider`  | `"anthropic"`         | LLM provider for the Reviewer agent. Currently only `"anthropic"` is supported.       |
| `models.review.model`     | `"claude-sonnet-4-6"` | Model ID for the Reviewer agent (overridden by `FERRY_REVIEW_MODEL` env var)          |
| `models.iterate.provider` | `"anthropic"`         | LLM provider for the Iterator agent. Currently only `"anthropic"` is supported.       |
| `models.iterate.model`    | `"claude-sonnet-4-6"` | Model ID for the Iterator agent (overridden by `FERRY_ITER_MODEL` env var)            |

#### `limits`

All `limits.*` fields are optional and accept positive numbers (integers unless noted otherwise).

| Field                                    | Default  | Env var override                        | Description                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | -------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limits.max_iterations`                  | `3`      | —                                       | **Integer, ≥ 1; recommended range 1–10.** Number of review→iterate cycles the Iterator runs before Ferry halts. When the cap is exceeded while findings remain, Ferry throws an oscillation error and stops — the ticket stays in its current Jira column for manual resolution. |
| `limits.max_agent_iterations`            | `200`    | `FERRY_DEV_MAX_ITERATIONS`              | Internal LLM agent loop cap per single agent run (guards against runaway tool-call loops)                                                                                                                                                                                        |
| `limits.max_tokens_per_run`              | `500000` | `FERRY_DEV_MAX_INPUT_TOKENS`            | Input token budget per agent run (overridden by `FERRY_ITER_MAX_INPUT_TOKENS` for Iterator)                                                                                                                                                                                      |
| `limits.max_tokens_per_message`          | `16384`  | `FERRY_DEV_MAX_TOKENS`                  | Maximum output tokens per individual LLM API call                                                                                                                                                                                                                                |
| `limits.max_cost_eur_per_run`            | `10`     | `FERRY_MAX_COST_EUR_PER_RUN`            | Cost budget in EUR per agent run — Ferry aborts if this is exceeded                                                                                                                                                                                                              |
| `limits.bash_timeout_ms`                 | `60000`  | `FERRY_BASH_TIMEOUT_MS`                 | Default bash command timeout in ms for the Developer agent tool loop                                                                                                                                                                                                             |
| `limits.bash_timeout_max_ms`             | `300000` | `FERRY_BASH_TIMEOUT_MAX_MS`             | Maximum bash command timeout the agent may request; hard ceiling on `timeout_ms` in the `bash` tool                                                                                                                                                                              |
| `limits.grep_timeout_ms`                 | `30000`  | `FERRY_GREP_TIMEOUT_MS`                 | Timeout for the Developer agent's `search_files` (grep) tool                                                                                                                                                                                                                     |
| `limits.anthropic_verify_timeout_ms`     | `10000`  | `FERRY_ANTHROPIC_VERIFY_TIMEOUT_MS`     | Timeout for Anthropic API key verification during `ferry-init`                                                                                                                                                                                                                   |
| `limits.jira_retry_base_delay_ms`        | `2000`   | `FERRY_JIRA_RETRY_BASE_DELAY_MS`        | Base delay for exponential backoff on Jira API retries                                                                                                                                                                                                                           |
| `limits.jira_retry_max_attempts`         | `3`      | `FERRY_JIRA_RETRY_MAX_ATTEMPTS`         | Maximum number of Jira API retry attempts per operation                                                                                                                                                                                                                          |
| `limits.envelope_instructions_chars`     | `2000`   | `FERRY_ENVELOPE_INSTRUCTIONS_CHARS`     | Maximum characters for the `instructions` field in the event envelope — longer values are silently truncated                                                                                                                                                                     |
| `limits.project_snippet_bytes`           | `2048`   | `FERRY_PROJECT_SNIPPET_BYTES`           | Maximum bytes for `prompts/_project.md` — content beyond this is truncated before injection into the agent system prompt                                                                                                                                                         |
| `limits.agent_extension_bytes`           | `4096`   | `FERRY_AGENT_EXTENSION_BYTES`           | Maximum bytes for `prompts/<agent>.extra.md` extension files                                                                                                                                                                                                                     |
| `limits.tldr_total_chars`                | `500`    | `FERRY_TLDR_TOTAL_CHARS`                | Maximum characters for the full TL;DR block written by the Developer (FR55). Exceeding this throws an error.                                                                                                                                                                     |
| `limits.tldr_verdict_chars`              | `40`     | `FERRY_TLDR_VERDICT_CHARS`              | Maximum characters for the Reviewer verdict field in the TL;DR block                                                                                                                                                                                                             |
| `limits.file_display_chars`              | `40000`  | `FERRY_FILE_DISPLAY_CHARS`              | Maximum characters returned when the Reviewer or other agents fetch file content from GitHub                                                                                                                                                                                     |
| `limits.refiner_subtask_cap`             | `12`     | `FERRY_REFINER_SUBTASK_CAP`             | Maximum subtasks per Refiner batch — additional subtasks are silently dropped                                                                                                                                                                                                    |
| `limits.refiner_touch_paths_cap`         | `20`     | `FERRY_REFINER_TOUCH_PATHS_CAP`         | Maximum `touch_paths` entries the Refiner may return — exceeding this throws a spec-too-broad error                                                                                                                                                                              |
| `limits.reviewer_max_iterations`         | `40`     | `FERRY_REVIEWER_MAX_ITERATIONS`         | Maximum tool-use iterations inside a single Reviewer loop run                                                                                                                                                                                                                    |
| `limits.reviewer_max_tokens`             | `16384`  | `FERRY_REVIEWER_MAX_TOKENS`             | Maximum output tokens per Reviewer LLM call                                                                                                                                                                                                                                      |
| `limits.reconciler_stale_window_minutes` | `20`     | `FERRY_RECONCILER_STALE_WINDOW_MINUTES` | Minutes since the last audit comment after which the Reconciler considers a ticket stale and re-dispatches it                                                                                                                                                                    |

#### `ticket_types`

Controls which Jira issue types Ferry will process.

| Field                           | Default                     | Description                                                                    |
| ------------------------------- | --------------------------- | ------------------------------------------------------------------------------ |
| `ticket_types.refine_allowlist` | `["Story", "Bug", "Spike"]` | Jira issue types the Refiner will process. Tickets of other types are skipped. |
| `ticket_types.dev_allowlist`    | `["Story", "Bug", "Spike"]` | Jira issue types the Developer will process.                                   |

#### `git`

Controls the Git branching strategy used by the Developer and Iterator agents. All three fields default to values that work without any configuration — omit this section entirely to use the defaults.

| Field                       | Default    | Description                                                                                                                                            |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `git.base_branch`           | `null`     | Branch the Developer checks out from when creating a working branch. `null` resolves to the repository's default branch at runtime via the GitHub API. |
| `git.target_branch`         | `null`     | Branch the PR is opened against. `null` defaults to the same branch as `base_branch`.                                                                  |
| `git.working_branch_prefix` | `"ferry/"` | Prefix for working branches created by the Developer agent (e.g., `ferry/PROJ-123`). Must be a non-empty string.                                       |

Teams using `develop`, `next`, `release/*`, or any other integration branch as their default should set `base_branch` to that branch name. If `target_branch` differs (e.g., PRs target a staging branch while work branches off `main`), set it explicitly.

```yaml
# ferry.config.yaml — teams using a non-default integration branch
git:
  base_branch: develop # branch to check out from
  target_branch: develop # branch PRs are opened against (omit to default to base_branch)
  working_branch_prefix: ferry/
```

#### `labels`

Maps Jira ticket labels to MCP server capabilities. If this section is omitted, the full MCP server pool is used unchanged. If the section is present, only MCP servers enabled by the ticket's labels are activated.

```json
"labels": {
  "<jira-label-name>": {
    "mcp_servers": ["<server-name>", ...],
    "tools": ["<tool-name>", ...]
  }
}
```

| Sub-field     | Required | Description                                                                                                              |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `mcp_servers` | No       | List of MCP server names to enable when this label is present                                                            |
| `tools`       | No       | If provided, restrict the listed servers to only these tool names. If omitted, all tools from those servers are allowed. |

**Merging behaviour:** When a ticket has multiple `ferry:*` labels, their server and tool lists are merged (union). If one label grants all tools (`tools` omitted) and another restricts tools for the same server, the "all tools" grant wins for that server.

**Unknown labels:** Any `ferry:*` label on a ticket that is not declared in `labels` is logged to stderr and silently ignored.

#### `workflow.agents`

Maps each Ferry agent to a Jira column and controls which auto-transitions are enabled. All fields are optional — omit any section to use the defaults shown below.

```yaml
workflow:
  agents:
    refiner:
      trigger_column: 'Refinement'
      auto_transition: null # refiner never auto-transitions
    developer:
      trigger_column: 'In Development'
      auto_transition: 'In Review' # FR18 — set null to disable
    reviewer:
      trigger_column: 'In Review'
      auto_transition_approve: null # optional: set to a column to auto-move on approval
      auto_transition_changes: 'Changes Requested' # FR24 — set null to disable
    iterator:
      trigger_column: 'Changes Requested'
      auto_transition: 'In Review' # FR28 — set null to disable
```

**Defaults reproduce today's behavior exactly** (FR18, FR24, FR28 all enabled with the column names above).

| Field                                              | Default               | Description                                                                                                                                                                             |
| -------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow.agents.refiner.trigger_column`           | `"Refinement"`        | Jira column that triggers the Refiner. Used by `ferry-doctor` to validate column existence.                                                                                             |
| `workflow.agents.developer.trigger_column`         | `"In Development"`    | Jira column that triggers the Developer.                                                                                                                                                |
| `workflow.agents.developer.auto_transition`        | `"In Review"`         | Column to move the ticket into after the Developer finishes (FR18). Set to `null` to disable — humans drive the transition. Requires `FERRY_REVIEW_TRANSITION_ID` secret when non-null. |
| `workflow.agents.reviewer.trigger_column`          | `"In Review"`         | Jira column that triggers the Reviewer.                                                                                                                                                 |
| `workflow.agents.reviewer.auto_transition_approve` | `null`                | Column to move the ticket into when the Reviewer approves. `null` = no transition (default). Requires `FERRY_APPROVE_TRANSITION_ID` secret when non-null.                               |
| `workflow.agents.reviewer.auto_transition_changes` | `"Changes Requested"` | Column to move the ticket into when the Reviewer requests changes (FR24). Set to `null` to disable. Requires `FERRY_ITER_TRANSITION_ID` secret when non-null.                           |
| `workflow.agents.iterator.trigger_column`          | `"Changes Requested"` | Jira column that triggers the Iterator.                                                                                                                                                 |
| `workflow.agents.iterator.auto_transition`         | `"In Review"`         | Column to move the ticket into after the Iterator finishes (FR28). Set to `null` to disable. Requires `FERRY_REVIEW_TRANSITION_ID` secret when non-null.                                |

> **Finding Jira transition IDs for custom columns:** Call `GET https://<your-domain>.atlassian.net/rest/api/3/issue/<TICKET-KEY>/transitions` with Basic Auth. Match the transition `name` to your target column and use the `id` field as the secret value.

> **`ferry-doctor` validates columns:** When `workflow.agents` is present in your config, `ferry-doctor` calls the Jira API to confirm each `trigger_column` and `auto_transition` value exists in your project. Run `ferry-doctor` after changing column names.

---

## Environment variable overrides (P0 — production behavior)

The following env vars must be set as **GitHub Actions Variables** (or injected into the runner environment). They take precedence over `ferry.config.json` values.

| Env var                             | Default | Description                                                                                      |
| ----------------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `FERRY_HTTP_TIMEOUT_MS`             | `15000` | Timeout in ms for outbound HTTPS calls made by Ferry CLI commands (`ferry-init`, `ferry-doctor`) |
| `FERRY_DISPATCH_POLL_INTERVAL_MS`   | `3000`  | How often `ferry-doctor` polls for the synthetic dispatch probe workflow run                     |
| `FERRY_DISPATCH_PROBE_TIMEOUT_MS`   | `45000` | How long `ferry-doctor` waits for the synthetic dispatch probe to appear before timing out       |
| `FERRY_LLM_RETRY_BASE_DELAY_MS`     | `2000`  | Base delay for LLM provider retry backoff (applies to Anthropic, OpenAI, Google utility calls)   |
| `FERRY_LLM_RETRY_MAX_ATTEMPTS`      | `3`     | Maximum retry attempts for LLM utility calls before giving up                                    |
| `FERRY_LLM_UTILITY_MAX_TOKENS`      | `4096`  | Maximum output tokens for single-turn LLM utility calls (e.g. Refiner)                           |
| `FERRY_REVIEW_PATCH_TRUNCATE_CHARS` | `20000` | Maximum characters of a diff patch the Reviewer receives per `get_file_patch` tool call          |
| `FERRY_REVIEW_FILE_TRUNCATE_CHARS`  | `40000` | Maximum characters of file content the Reviewer receives per `get_file_content` tool call        |
| `FERRY_BASH_OUTPUT_MAX_BYTES`       | `65536` | Maximum bytes of combined stdout+stderr returned by the Developer agent's `bash` tool            |
| `FERRY_BUDGET_ALERT_RATIO`          | `0.5`   | Fraction of monthly budget that triggers a spend alert (0–1 inclusive); default is 50%           |
| `FERRY_AUDIT_ROTATION_THRESHOLD`    | `900`   | Comment count at which the audit issue is rotated to a new issue (GitHub cap is 1000)            |

`ferry-doctor` warns when any of these env vars is set to a value outside a safe operating range.

---

## What is hardcoded vs. configurable

The following are intentionally not configurable by consumers:

| Parameter                                        | Why hardcoded                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| PR/comment fingerprint formats                   | Required for idempotency                                                                                            |
| Internal workflow defaults for Refiner/Developer | Set via `ferry.config.json`; use the `models.*` fields or `FERRY_*_MODEL` / `FERRY_*_PROVIDER` env vars to override |
| Audit issue comment format                       | Required for deduplication                                                                                          |

---

## Configuration precedence summary

For any given setting, the last value wins:

```
ferry.config.json defaults
  → ferry.config.json values
    → Environment / repository variables
        (FERRY_REFINER_PROVIDER, FERRY_REFINER_MODEL,
         FERRY_DEV_PROVIDER, FERRY_DEV_MODEL,
         FERRY_REVIEW_PROVIDER, FERRY_REVIEW_MODEL,
         FERRY_ITER_PROVIDER, FERRY_ITER_MODEL,
         FERRY_ITER_MAX_INPUT_TOKENS)

git.base_branch / git.target_branch (when null)
  → resolved from GitHub API (repo default_branch) at runtime
```

Secrets (`ANTHROPIC_API_KEY`, `FERRY_OPENAI_KEY`, `FERRY_GOOGLE_AI_KEY`) are credentials only — they do not participate in model or limit configuration.
