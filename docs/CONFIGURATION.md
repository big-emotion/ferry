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

| Secret           | Provider | Description                                                                       |
| ---------------- | -------- | --------------------------------------------------------------------------------- |
| `OPENAI_API_KEY` | `openai` | OpenAI API key — required when any phase is configured with `provider: openai`    |
| `GOOGLE_API_KEY` | `google` | Google AI API key — required when any phase is configured with `provider: google` |

> **Legacy aliases:** `FERRY_OPENAI_KEY` and `FERRY_GOOGLE_AI_KEY` are accepted as fallbacks for backwards compatibility, but `OPENAI_API_KEY` / `GOOGLE_API_KEY` are the canonical names used by the workflow stubs.

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

All variables marked **wired** below are read directly by the standard consumer workflow stubs in `examples/consumer-setup/workflows/`. Unwired variables are read by `src/lib/config.ts` if present in the agent runtime env, but the standard workflow stubs do not set them — use `ferry.config.yaml` for those instead.

#### Model and provider overrides

| Variable                 | Default             | Wired?          | Affects         | Description                                                                                                        |
| ------------------------ | ------------------- | --------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `FERRY_DEV_MODEL`        | `claude-sonnet-4-6` | yes (`dev`)     | Developer agent | Override the model ID for the Developer. Wired via the `ferry_dev_model` composite action input.                   |
| `FERRY_DEV_PROVIDER`     | `anthropic`         | yes (`dev`)     | Developer agent | LLM provider override for the Developer (`anthropic` / `openai` / `google`). MCP integration requires `anthropic`. |
| `FERRY_REVIEW_MODEL`     | `claude-sonnet-4-6` | yes (`review`)  | Reviewer agent  | Override the model ID for the Reviewer. Wired via the `ferry_review_model` composite action input.                 |
| `FERRY_REVIEW_PROVIDER`  | `anthropic`         | yes (`review`)  | Reviewer agent  | LLM provider override for the Reviewer (`anthropic` / `openai` / `google`). MCP integration requires `anthropic`.  |
| `FERRY_ITER_MODEL`       | `claude-sonnet-4-6` | yes (`iterate`) | Iterator agent  | Override the model ID for the Iterator. Wired via the `ferry_iter_model` composite action input.                   |
| `FERRY_ITER_PROVIDER`    | `anthropic`         | yes (`iterate`) | Iterator agent  | LLM provider override for the Iterator (`anthropic` / `openai` / `google`). MCP integration requires `anthropic`.  |
| `FERRY_REFINER_MODEL`    | `claude-sonnet-4-6` | yes (`refine`)  | Refiner agent   | Override the model ID for the Refiner. Wired via the `ferry_refiner_model` composite action input.                 |
| `FERRY_REFINER_PROVIDER` | `anthropic`         | yes (`refine`)  | Refiner agent   | LLM provider override for the Refiner (`anthropic` / `openai` / `google`).                                         |

#### Token and iteration limits

| Variable                        | Default  | Wired?                 | Affects                    | Description                                                                                                |
| ------------------------------- | -------- | ---------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `FERRY_DEV_MAX_INPUT_TOKENS`    | `500000` | yes (`dev`)            | Developer agent            | Input token budget per Developer run. Overrides `limits.max_tokens_per_run`.                               |
| `FERRY_ITER_MAX_INPUT_TOKENS`   | `500000` | yes (`iterate`)        | Iterator agent             | Input token budget per Iterator run. Overrides `limits.max_tokens_per_run` for the Iterator.               |
| `FERRY_DEV_MAX_TOKENS`          | `16384`  | yes (`dev`, `iterate`) | Developer, Iterator agents | Maximum output tokens per LLM call. Overrides `limits.max_tokens_per_message`.                             |
| `FERRY_DEV_MAX_ITERATIONS`      | `200`    | yes (`dev`, `iterate`) | Developer, Iterator agents | Maximum agent loop iterations per run. Overrides `limits.max_agent_iterations`.                            |
| `FERRY_REVIEWER_MAX_ITERATIONS` | `40`     | yes (`review`)         | Reviewer agent             | Maximum tool-use iterations inside a single Reviewer loop run. Overrides `limits.reviewer_max_iterations`. |
| `FERRY_REVIEWER_MAX_TOKENS`     | `16384`  | yes (`review`)         | Reviewer agent             | Maximum output tokens per Reviewer LLM call. Overrides `limits.reviewer_max_tokens`.                       |

#### Cost and retry controls (all agents)

| Variable                        | Default | Wired?                                     | Affects    | Description                                                                                          |
| ------------------------------- | ------- | ------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------- |
| `FERRY_MAX_COST_EUR_PER_RUN`    | `10`    | yes (`dev`, `iterate`, `review`, `refine`) | All agents | Cost budget in EUR per agent run. Ferry aborts if exceeded. Overrides `limits.max_cost_eur_per_run`. |
| `FERRY_LLM_RETRY_MAX_ATTEMPTS`  | `3`     | yes (`dev`, `iterate`, `review`, `refine`) | All agents | Maximum retry attempts for LLM utility calls before giving up.                                       |
| `FERRY_JIRA_RETRY_MAX_ATTEMPTS` | `3`     | yes (`dev`, `iterate`, `review`, `refine`) | All agents | Maximum Jira API retry attempts per operation. Overrides `limits.jira_retry_max_attempts`.           |

#### Developer / Iterator tool limits

| Variable                    | Default  | Wired?                 | Affects                    | Description                                                                                      |
| --------------------------- | -------- | ---------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| `FERRY_BASH_TIMEOUT_MAX_MS` | `300000` | yes (`dev`, `iterate`) | Developer, Iterator agents | Maximum bash command timeout the agent may request (ms). Overrides `limits.bash_timeout_max_ms`. |

#### Refiner-specific

| Variable                    | Default | Wired?         | Affects       | Description                                                                 |
| --------------------------- | ------- | -------------- | ------------- | --------------------------------------------------------------------------- |
| `FERRY_REFINER_SUBTASK_CAP` | `12`    | yes (`refine`) | Refiner agent | Maximum subtasks per Refiner batch. Overrides `limits.refiner_subtask_cap`. |

---

## Pre/Post-Agent Command Hooks

Each composite action (`ferry-run-developer`, `ferry-run-iterator`, `ferry-run-reviewer`, `ferry-run-refiner`) exposes three optional inputs that let consumers inject shell commands around the agent run without modifying Ferry's source.

These inputs are passed in the `with:` block of your consumer workflow when you call the composite action.

| Input                       | Default | Description                                                                                                                                                                                       |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre_agent_command`         | `''`    | Shell command to run **after** checkout + Ferry setup but **before** the agent starts. Skipped when empty. Typical use: `npm ci`, dependency caching, env setup.                                  |
| `pre_agent_timeout_minutes` | `'3'`   | Timeout in minutes for the pre-agent step. Ignored when `pre_agent_command` is empty.                                                                                                             |
| `post_agent_command`        | `''`    | Shell command to run **after** the agent finishes. **Always executes** (`if: always()`) — runs on agent success, failure, and cancellation. Typical use: cleanup, artifact upload, notifications. |

The pre-agent step runs in `GITHUB_WORKSPACE` (your checked-out repo root), after Ferry's own `npm ci` has completed. Use multi-line commands with `|` for scripts longer than one command.

**Example — install consumer dependencies before the Developer agent:**

```yaml
- name: Run Developer agent
  id: run-developer
  uses: big-emotion/ferry/.github/actions/ferry-run-developer@v0.9.0
  with:
    payload: ${{ toJson(github.event.client_payload) }}
    # ... required inputs ...
    pre_agent_command: |
      npm ci --prefer-offline
    pre_agent_timeout_minutes: '5'
```

**Example — combined with `actions/cache@v4` (cache set up in a prior step, populated here):**

```yaml
steps:
  - name: Checkout repository
    uses: actions/checkout@...

  - name: Cache node_modules
    uses: actions/cache@v4
    with:
      path: node_modules
      key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}

  - name: Run Developer agent
    uses: big-emotion/ferry/.github/actions/ferry-run-developer@v0.9.0
    with:
      payload: ${{ toJson(github.event.client_payload) }}
      # ... required inputs ...
      pre_agent_command: npm ci --prefer-offline
```

---

## `ferry.config.json`

Create `ferry.config.json`, `ferry.config.yaml`, or `ferry.config.yml` at the **root of your repository**. All fields are optional — omit any section to use the defaults.

Ferry reads the config file from `GITHUB_WORKSPACE` (the checked-out repo root) at the start of each agent run.

> **What `ferry-init` writes.** When the wizard runs against a repo without an existing config, it generates a minimal `ferry.config.yaml` containing **only** the `workflow.agents` block (Jira column names + auto-transitions captured from your prompts). Every other section (`models`, `limits`, `ticket_types`, `git`, `labels`) is omitted so the bundled defaults apply. If `ferry.config.yaml` (or `.json`/`.yml`) already exists, the wizard skips this step unless `--overwrite` is passed. Add additional sections by hand only when you actually want to override a default — restating defaults adds noise and creates a second source of truth that can drift over time.

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
      "model": "claude-sonnet-4-6"
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

### Provider × phase matrix

| Phase     | `anthropic`     | `openai`        | `google`        | Required secret    |
| --------- | --------------- | --------------- | --------------- | ------------------ |
| `refiner` | ✅ Full support | ✅ Full support | ✅ Full support | matching key below |
| `dev`     | ✅ Full support | ✅ Supported    | ✅ Supported    | matching key below |
| `review`  | ✅ Full support | ✅ Supported    | ✅ Supported    | matching key below |
| `iterate` | ✅ Full support | ✅ Supported    | ✅ Supported    | matching key below |

**Provider-specific caveats:**

| Capability                                 | `anthropic` | `openai` | `google` |
| ------------------------------------------ | :---------: | :------: | :------: |
| MCP server integration (`labels:`)         |     ✅      |    ❌    |    ❌    |
| Prompt cache breakpoints                   |     ✅      |    ❌    |    ❌    |
| Agentic tool-use loop (dev/review/iterate) |     ✅      |    ✅    |    ✅    |
| Single-turn LLM call (refiner)             |     ✅      |    ✅    |    ✅    |

**Expected cost differential (approximate, relative to `claude-sonnet-4-6`):**

| Provider / model                  | Relative cost | Notes                                                    |
| --------------------------------- | :-----------: | -------------------------------------------------------- |
| `anthropic` / `claude-sonnet-4-6` |   baseline    | Recommended; prompt caching reduces repeat costs by ~80% |
| `openai` / `gpt-4o`               |     ~1–2×     | No caching discount; good for refiner single-turn use    |
| `openai` / `gpt-4o-mini`          |     ~0.2×     | Cost-effective for light refiner tasks                   |
| `google` / `gemini-2.5-pro`       |    ~0.5–1×    | Competitive for long-context refiner calls               |
| `google` / `gemini-2.5-flash`     |    ~0.05×     | Very low cost; good for high-volume refinement           |

> **MCP:** Model Context Protocol (MCP) server integration (`AGENT_MCP_SERVERS`, `labels:` in config) is **Anthropic-only**. If you set `provider: openai` or `provider: google` for the Developer or Iterator, MCP servers are not loaded even if `AGENT_MCP_SERVERS` is set.
>
> **Prompt caching:** Explicit cache breakpoints are an Anthropic-specific API feature. With non-Anthropic providers, Ferry omits cache control headers — costs will not be reduced by caching on long system prompts.
>
> **Agentic phases:** Even with `provider: anthropic`, **only the Developer and Iterator agents consume `AGENT_MCP_SERVERS`**. The Refiner and Reviewer do not load MCP servers regardless of provider or configuration.

| Field                     | Default               | Description                                                                                                                                      |
| ------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `models.refiner.provider` | `"anthropic"`         | LLM provider for the Refiner. Accepts `"anthropic"`, `"openai"`, or `"google"`.                                                                  |
| `models.refiner.model`    | `"claude-sonnet-4-6"` | Model ID for the Refiner (overridden by `FERRY_REFINER_MODEL`). Use a model ID valid for your chosen provider (e.g. `gpt-4o`, `gemini-2.5-pro`). |
| `models.dev.provider`     | `"anthropic"`         | LLM provider for the Developer. Accepts `"anthropic"`, `"openai"`, or `"google"`. Note: MCP server integration requires `"anthropic"`.           |
| `models.dev.model`        | `"claude-sonnet-4-6"` | Model ID for the Developer (overridden by `FERRY_DEV_MODEL`). Use a model ID matching your chosen provider.                                      |
| `models.review.provider`  | `"anthropic"`         | LLM provider for the Reviewer. Accepts `"anthropic"`, `"openai"`, or `"google"`. Note: MCP server integration requires `"anthropic"`.            |
| `models.review.model`     | `"claude-sonnet-4-6"` | Model ID for the Reviewer (overridden by `FERRY_REVIEW_MODEL`). Use a model ID matching your chosen provider.                                    |
| `models.iterate.provider` | `"anthropic"`         | LLM provider for the Iterator. Accepts `"anthropic"`, `"openai"`, or `"google"`. Note: MCP server integration requires `"anthropic"`.            |
| `models.iterate.model`    | `"claude-sonnet-4-6"` | Model ID for the Iterator (overridden by `FERRY_ITER_MODEL`). Use a model ID matching your chosen provider.                                      |

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

> **MCP configuration is split across two locations:**
>
> - **Pool of servers** (name, URL/command, credentials) — declared in the `AGENT_MCP_SERVERS` GitHub Actions repo **variable** (`gh variable set AGENT_MCP_SERVERS '...'`). This is where all known MCP servers are registered. Two transport types are supported:
>   - **HTTP/SSE** — omit `type` (or set `"type": "url"`); provide a `url` field. Tool calls are proxied server-side through the Anthropic Messages API.
>   - **Stdio** — set `"type": "stdio"`; provide a `command` field. Ferry spawns the binary on the Actions runner and dispatches tool calls client-side.
> - **Per-ticket activation** — declared here in `ferry.config.yaml` § `labels:`. A `ferry:*` label on the Jira ticket selects which servers from the pool are active for that ticket.
>
> A label entry that names a server not present in `AGENT_MCP_SERVERS` is silently ignored at runtime. The pool variable is not part of `ferry.config.yaml`.

**Adding a new MCP server — 3 steps:**

1. **Declare in the pool** — add an entry to the `AGENT_MCP_SERVERS` repo variable (HTTP/SSE example):
   ```bash
   gh variable set AGENT_MCP_SERVERS '[{"name":"figma","url":"https://mcp.figma.com/mcp","authorization_token":"<pat>"}]'
   ```
   For a stdio server, use `"type":"stdio"` and `"command"` instead of `"url"`:
   ```bash
   gh variable set AGENT_MCP_SERVERS '[{"type":"stdio","name":"my-tool","command":"npx","args":["-y","@my-org/mcp-server"]}]'
   ```
2. **Map a `ferry:*` label** — add an entry under `labels:` in `ferry.config.yaml` referencing the server name.
3. **Activate per ticket** — add the matching `ferry:*` label to your Jira ticket before triggering the Developer or Iterator.

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

## Prompt customization

Each agent runs a layered system prompt assembled at runtime by `src/lib/agent-runtime/prompt.ts` (composition) and `src/lib/prompts/resolve.ts` (file resolution):

```
bundled prompt (prompts/<agent>.md, shipped with Ferry)
  + prompts/<agent>.extra.md     (optional per-agent extension)
  + prompts/_project.md          (optional project-wide context, appended last)
```

Both extension files live in **your consumer repository**, alongside `.github/workflows/ferry-*.yml`. They are loaded at the start of every agent run from `GITHUB_WORKSPACE`. Agent prompt names map to `dev`, `iterate`, `refiner`, and `review`.

| File                       | Purpose                                                                                                                                                        | Size cap (default)                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `prompts/_project.md`      | Project-wide context appended to **every** agent (refiner, developer, reviewer, iterator). Use for stack details, in-house conventions, repository-wide rules. | `2048` bytes (`limits.project_snippet_bytes`) |
| `prompts/refiner.extra.md` | Refiner-only extension. Use for ticket-shape rules ("always emit a sub-task for migration", "skip refining tickets labelled `wontfix`").                       | `4096` bytes (`limits.agent_extension_bytes`) |
| `prompts/dev.extra.md`     | Developer-only extension. Use for build-system specifics, code-gen guardrails, repo-specific test commands.                                                    | `4096` bytes (`limits.agent_extension_bytes`) |
| `prompts/review.extra.md`  | Reviewer-only extension. Use for review-priority rules ("flag any new dependency", "block PRs without a TL;DR").                                               | `4096` bytes (`limits.agent_extension_bytes`) |
| `prompts/iterate.extra.md` | Iterator-only extension. Mirrors the developer extension but applies during the iterate phase.                                                                 | `4096` bytes (`limits.agent_extension_bytes`) |

**Rules:**

- **Never edit the bundled `prompts/<agent>.md` shipped inside Ferry** — that breaks the contract Ferry's tests rely on. Always extend via the `.extra.md` mechanism.
- Files larger than the configured cap are silently truncated (left-anchored). Raise the cap via `limits.project_snippet_bytes` / `limits.agent_extension_bytes` in `ferry.config.yaml` if you need more headroom.
- Missing files are silently skipped — no need to create empty placeholders.
- Composition is deterministic: bundled prompt first, then the agent's `.extra.md` (under a `## Project-specific guidance for <agent>` heading), then `_project.md` (under a `## Project conventions` heading). Later content cannot remove earlier instructions; treat it as additive only.

To verify which extension files Ferry picked up on a given run, search the agent's job log for `loaded <name>.extra.md` (channel `ferry:prompts`). Files that fell over the cap log `<name>.extra.md exceeds limit — truncating`.

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
        (FERRY_REFINER_PROVIDER, FERRY_REFINER_MODEL, FERRY_REFINER_SUBTASK_CAP,
         FERRY_DEV_PROVIDER, FERRY_DEV_MODEL,
         FERRY_DEV_MAX_INPUT_TOKENS, FERRY_DEV_MAX_TOKENS, FERRY_DEV_MAX_ITERATIONS,
         FERRY_REVIEW_PROVIDER, FERRY_REVIEW_MODEL,
         FERRY_REVIEWER_MAX_ITERATIONS, FERRY_REVIEWER_MAX_TOKENS,
         FERRY_ITER_PROVIDER, FERRY_ITER_MODEL, FERRY_ITER_MAX_INPUT_TOKENS,
         FERRY_BASH_TIMEOUT_MAX_MS,
         FERRY_MAX_COST_EUR_PER_RUN,
         FERRY_LLM_RETRY_MAX_ATTEMPTS, FERRY_JIRA_RETRY_MAX_ATTEMPTS)

git.base_branch / git.target_branch (when null)
  → resolved from GitHub API (repo default_branch) at runtime
```

Secrets (`ANTHROPIC_API_KEY`, `FERRY_OPENAI_KEY`, `FERRY_GOOGLE_AI_KEY`) are credentials only — they do not participate in model or limit configuration.
