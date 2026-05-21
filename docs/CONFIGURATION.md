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
  uses: big-emotion/ferry/.github/actions/ferry-run-developer@v0.14.0
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
    uses: big-emotion/ferry/.github/actions/ferry-run-developer@v0.14.0
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

#### Provider capability matrix (agentic phases)

| Capability                    | `anthropic` | `openai`           | `google`           |
| ----------------------------- | ----------- | ------------------ | ------------------ |
| Multi-turn tool use           | ✅          | ✅                 | ✅                 |
| HTTP MCP servers              | ✅          | ❌ (stdio only)    | ❌ (stdio only)    |
| Stdio MCP servers             | ✅          | ✅                 | ✅                 |
| Explicit prompt cache control | ✅          | ❌ (automatic)     | ❌ (not supported) |
| Cache-weighted token budget   | ✅          | ❌ (raw token sum) | ❌ (raw token sum) |
| Expected cost per long run    | Baseline    | ~2–3× higher       | ~2–3× higher       |

**Expected cost differential (approximate, relative to `claude-sonnet-4-6`):**

| Provider / model                  | Relative cost | Notes                                                    |
| --------------------------------- | :-----------: | -------------------------------------------------------- |
| `anthropic` / `claude-sonnet-4-6` |   baseline    | Recommended; prompt caching reduces repeat costs by ~80% |
| `openai` / `gpt-4o`               |     ~1–2×     | No caching discount; good for refiner single-turn use    |
| `openai` / `gpt-4o-mini`          |     ~0.2×     | Cost-effective for light refiner tasks                   |
| `google` / `gemini-2.5-pro`       |    ~0.5–1×    | Competitive for long-context refiner calls               |
| `google` / `gemini-2.5-flash`     |    ~0.05×     | Very low cost; good for high-volume refinement           |

> **HTTP MCP:** Anthropic's HTTP MCP beta connector (`type: url` servers in `AGENT_MCP_SERVERS`) is Anthropic-only. Configuring an HTTP MCP server for an OpenAI or Google run raises a hard error at startup. Use stdio MCP servers for cross-provider compatibility.
>
> **Prompt caching:** Explicit cache breakpoints are an Anthropic-specific API feature. With OpenAI and Google, token budgets (`FERRY_DEV_MAX_INPUT_TOKENS`, `max_tokens_per_run`) are applied against the raw sum of input + output tokens. Anthropic uses a cache-weighted formula (`input + cache_read × 0.1 + cache_creation`) that better approximates actual cost.
>
> **Cost note:** The Developer and Iterator agents run multi-turn agentic loops with many tool calls. Without Anthropic's prompt cache, OpenAI and Google runs are typically 2–3× more expensive for long tasks.
>
> **MCP availability:** Even with `provider: anthropic`, only the Developer and Iterator agents load MCP servers from `AGENT_MCP_SERVERS`. The Refiner and Reviewer ignore MCP configuration regardless of provider.

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

| Field                       | Default    | Description                                                                                                                                                                      |
| --------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git.base_branch`           | `null`     | Branch the Developer checks out from when creating a working branch. `null` resolves to the repository's default branch at runtime via the GitHub API.                           |
| `git.target_branch`         | `null`     | Branch the PR is opened against. `null` defaults to the same branch as `base_branch`.                                                                                            |
| `git.working_branch_prefix` | `"ferry/"` | Prefix for working branches. Accepts a **string** (static, e.g. `"ferry/"`) or a **mapping** object (dynamic per Jira issue type — see below). Mapping requires a `default` key. |

Teams using `develop`, `next`, `release/*`, or any other integration branch as their default should set `base_branch` to that branch name. If `target_branch` differs (e.g., PRs target a staging branch while work branches off `main`), set it explicitly.

```yaml
# ferry.config.yaml — teams using a non-default integration branch
git:
  base_branch: develop # branch to check out from
  target_branch: develop # branch PRs are opened against (omit to default to base_branch)
  working_branch_prefix: ferry/
```

##### Conventional Branch naming (opt-in)

Ferry supports [Conventional Branch](https://conventional-branch.github.io/) naming where the branch prefix encodes the type of work (`feature/`, `bugfix/`, `chore/`, `hotfix/`). Set `working_branch_prefix` to a mapping object whose keys are Jira issue type names and whose `default` key covers anything unmatched:

```yaml
# ferry.config.yaml — Conventional Branch recipe
git:
  working_branch_prefix:
    Bug: bugfix/
    Story: feature/
    Task: chore/
    Epic: feature/
    default: feature/ # fallback for any unrecognised issue type
```

Resolution order at runtime:

1. If the Jira ticket has a `ferry:type:<name>` label and `<name>` is a key in the mapping → use that prefix.
2. Else if the ticket's Jira issue type is a key in the mapping → use that prefix.
3. Else → use `mapping.default`.

When the value is a plain string (the default `"ferry/"`), resolution is always the static string — no issue type lookup is performed.

#### `labels`

Maps Jira ticket labels to MCP server capabilities. If this section is omitted, the full MCP server pool is used unchanged. If the section is present, only MCP servers enabled by the ticket's labels are activated.

> For a full registry of supported MCP servers, transport-type schemas, end-to-end examples, and audit log format, see **[docs/MCP.md](MCP.md)**.

> **MCP configuration is split across two locations:**
>
> - **Pool of servers** (name, URL/command, credentials) — declared in the `AGENT_MCP_SERVERS` GitHub Actions repo **variable** (`gh variable set AGENT_MCP_SERVERS '...'`). This is where all known MCP servers are registered. Two transport types are supported:
>   - **HTTP/SSE** — omit `type` (or set `"type": "url"`); provide a `url` field. Tool calls are proxied server-side through the Anthropic Messages API.
>   - **Stdio** — set `"type": "stdio"`; provide a `command` field. Ferry spawns the binary on the Actions runner and dispatches tool calls client-side.
> - **Per-ticket activation** — declared here in `ferry.config.yaml` § `labels:`. A `ferry:*` label on the Jira ticket selects which servers from the pool are active for that ticket.
>
> A label entry that names a server not present in `AGENT_MCP_SERVERS` is silently ignored at runtime. The pool variable is not part of `ferry.config.yaml`.
>
> **Default MCP servers:** Context7 (`https://mcp.context7.com/mcp`) is enabled by default for all agents that support MCP. To opt out, set the `FERRY_MCP_DEFAULTS_DISABLED` repository variable to `true`. Consumer entries in `AGENT_MCP_SERVERS` that share a name with a default (e.g. `"context7"`) automatically shadow and replace the default, so you can point to your own proxy without disabling defaults entirely.

**Adding a new MCP server — 3 steps:**

1. **Declare in the pool** — add an entry to the `AGENT_MCP_SERVERS` repo variable (HTTP/SSE example):
   ```bash
   gh variable set AGENT_MCP_SERVERS '[{"name":"atlassian","url":"https://mcp.atlassian.com/v1/mcp","authorization_token":"<atlassian-rovo-api-token>"}]'
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

**Unknown labels:** Any `ferry:*` label on a ticket that is not declared in `labels` is logged to stderr and silently ignored — with one exception: the built-in `ferry:type:*` labels described in the next section are always recognised and never trigger this warning.

---

#### Built-in ticket-type label overrides (`ferry:type:*` and `ferry:as/<type>`)

These labels are **hardcoded built-ins** — they require no `ferry.config.json` entry and are always recognised by the Developer, Reviewer, and Iterator agents. Apply them directly to your Jira ticket.

| Label                    | Effect                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ferry:type:enable-task` | Bypass the Task skip (FR6) for this ticket only. Ferry processes it as if it were a Story. Useful for one-off Tasks that should be implemented by Ferry without touching the Refiner. |
| `ferry:type:force-bug`   | Treat the ticket as a **Bug** regardless of its Jira issue type. The agent sees `TYPE: Bug` in the prompt.                                                                            |
| `ferry:type:force-spike` | Treat the ticket as a **Spike** regardless of its Jira issue type.                                                                                                                    |
| `ferry:type:force-story` | Treat the ticket as a **Story** regardless of its Jira issue type.                                                                                                                    |
| `ferry:as/bug`           | Alias of `ferry:type:force-bug` (issue #242) with strict conflict semantics — see below.                                                                                              |
| `ferry:as/spike`         | Alias of `ferry:type:force-spike` (issue #242) with strict conflict semantics.                                                                                                        |
| `ferry:as/story`         | Alias of `ferry:type:force-story` (issue #242) with strict conflict semantics.                                                                                                        |

**How it works:**

- `ferry:type:enable-task` bypasses the FR6 Task filter inside agent actions (Developer, Reviewer, Iterator). The pre-flight `skip-task-type-action` step runs before the Jira issue is fetched and therefore cannot honour this label — if the envelope issue type is `Task`, the pre-flight step still skips and posts a comment. Add the label to a ticket that starts in a non-Task Jira column to avoid the pre-flight trigger entirely, or trigger the agent directly via `repository_dispatch` with a non-Task `issue_type`.
- `ferry:type:force-*` labels replace `issue.issueType` in the prompt without mutating the original Jira record. When active, the terminal Jira comment includes an audit note in the format: `[type override: {"issuetype":"Bug","issuetype_raw":"Story","override":"force-bug"}]`.
- If multiple `force-*` labels are present, the last one in the label list wins.

**`ferry:as/<type>` — alias with strict conflict semantics (issue #242):**

- Maps to the same `typeOverride` field as `ferry:type:force-<type>`. Both namespaces are honoured everywhere `typeOverride` is consumed (prompt block, allowlist evaluation, audit comment payload).
- **Two different `ferry:as/<x>` labels** on the same ticket throw `LabelConflictError` (rather than the legacy last-wins behaviour of `ferry:type:force-*`).
- **Mixing `ferry:as/<a>` with `ferry:type:force-<b>`** that resolve to different values also throws `LabelConflictError`. Same values are vacuous.
- Unknown suffix (e.g. `ferry:as/improvement`) is logged to stderr and ignored.
- **Security invariant — Task-skip is preserved.** `ferry:as/*` does NOT set `bypassTaskSkip`. A Task ticket with `ferry:as/story` is still skipped by FR6, because the Task-skip is a structural defense against Refiner-created sub-task loops, not a type filter. Use `ferry:type:enable-task` if you need to bypass the Task-skip; combine it with `ferry:as/story` to also set the effective type.

---

#### Configuration override labels (`ferry:model/*`, `ferry:provider/*`, `ferry:budget/*`, …)

Beyond the MCP capability labels (`ferry:mcp/*`, `ferry:profile/*`) and the ticket-type labels (`ferry:type:*`), Ferry recognises a set of **configuration override labels** that are always active — they require no entry in `ferry.config.yaml` and are parsed by every agent at runtime.

These labels follow the label-wins-over-config precedence: **Jira label > `ferry.config.yaml` > env vars > defaults**.

When one or more override labels are present, the agent posts an audit comment immediately after resolving them:

```
[ferry:<role>:<run-id>] overrides applied: {"modelOverrides":{"dev":{"model":"claude-opus-4-7"}},...}
```

##### Model and provider (`ferry:model/*`, `ferry:provider/*`)

Override the model or provider for any or all agent phases without touching `ferry.config.yaml`.

| Label pattern                       | Example                           | Effect                                                                      |
| ----------------------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| `ferry:model/<model-id>`            | `ferry:model/claude-opus-4-7`     | Use `claude-opus-4-7` for **all four agents** on this ticket                |
| `ferry:model/<phase>/<model-id>`    | `ferry:model/dev/claude-opus-4-7` | Use `claude-opus-4-7` for the Developer only                                |
| `ferry:model/<phase>/<model-id>`    | `ferry:model/review/gpt-4o`       | Use `gpt-4o` for the Reviewer only                                          |
| `ferry:provider/<provider>`         | `ferry:provider/openai`           | Switch to the `openai` provider for **all four agents** — model from config |
| `ferry:provider/<phase>/<provider>` | `ferry:provider/dev/openai`       | Switch to the `openai` provider for the Developer only                      |

Valid `<phase>` values: `refiner`, `dev`, `review`, `iterate`.
Valid `<provider>` values: `anthropic`, `openai`, `google`.
`<model-id>` is a free string passed to the provider SDK (e.g. `claude-opus-4-7`, `gpt-4o`, or an org-scoped name like `openai/gpt-4o`).

**Conflict rules:**

- `ferry:model/<x>` (blanket) + `ferry:model/dev/<y>` (per-phase) — no conflict; per-phase wins for Dev, blanket applies to the other three agents.
- `ferry:model/dev/<x>` + `ferry:model/dev/<y>` (two per-phase labels for the same phase) — conflict; the agent posts a Jira comment and exits non-zero.
- Two blanket model labels (`ferry:model/<x>` + `ferry:model/<y>`) — conflict.
- Same rules apply to provider labels.

**Use case:** keep Sonnet as the repo default; tag the two hardest tickets of the sprint with `ferry:model/claude-opus-4-7` so they get higher-quality output while routine work stays cheap.

##### Budget, iteration, and token caps

Override cost / token budgets and iteration limits for this ticket only.

| Label pattern                 | Example                          | Effect                                                                                                                                                                                                  |
| ----------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ferry:budget/<eur>`          | `ferry:budget/3`                 | Hard EUR cap for this ticket. When the accumulated cost reaches this value the agent exits and the ticket is labeled `ferry:spend-cap`. Positive integer only. Overrides `limits.max_cost_eur_per_run`. |
| `ferry:max-iterations/<n>`    | `ferry:max-iterations/50`        | Cap the agent-loop internal iteration count for this ticket. In the Iterator, hitting this cap is treated as success-of-intent (no `ferry:blocked`). Overrides `limits.max_agent_iterations`.           |
| `ferry:max-tokens/<n>`        | `ferry:max-tokens/4096`          | Cap per-LLM-call output tokens for this ticket. Forwarded to the provider SDK `max_tokens` parameter. Overrides `limits.max_tokens_per_message`.                                                        |
| `ferry:budget/max-cost/<eur>` | `ferry:budget/max-cost/5`        | Cap spend at EUR 5 for this run (overrides `limits.max_cost_eur_per_run`). Accepts decimals (e.g. `2.5`).                                                                                               |
| `ferry:budget/max-tokens/<n>` | `ferry:budget/max-tokens/200000` | Cap input tokens at 200 000 (overrides `limits.max_tokens_per_run`). Must be a positive integer.                                                                                                        |

**`ferry:budget/<eur>` behaviour:** Budget is checked before each LLM call using the accumulated token counts for the current run. When the EUR limit is hit:

- The agent throws a spend-cap error and exits the current phase.
- `ferry:spend-cap` is applied to the ticket.
- A Jira audit comment is posted naming the ticket and EUR consumed.

> **Bundled-script path only.** Mid-run EUR enforcement (and therefore `ferry:budget/<eur>`, `limits.max_cost_eur_per_run`, and the `ferry:spend-cap` label) does **not** apply on the `claude-code-action` execution path — see [Execution paths & accepted divergences](#execution-paths--accepted-divergences).

**Conflict rules:** Duplicate labels for the same field (e.g. two `ferry:budget/<n>` labels with different values) are a conflict — the agent posts a Jira comment and exits non-zero. `ferry:budget/<eur>` and `ferry:budget/max-cost/<eur>` set the same config field (`limits.max_cost_eur_per_run`); they can coexist as they are separate fields, but the last one applied via `applyTicketOverrides` wins — avoid combining them.

##### Phase skips (`ferry:skip/*`)

Force a specific phase to exit immediately without doing any work. Useful for tickets that don't need the full Ferry pipeline (e.g. a trivial typo fix that doesn't warrant a refinement pass).

| Label                | Effect                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ferry:skip/refiner` | Refiner exits immediately — the ticket goes straight to Dev when triggered.                                                                                         |
| `ferry:skip/dev`     | Developer exits immediately — no branch, no PR, no implementation.                                                                                                  |
| `ferry:skip/review`  | Reviewer auto-approves the PR without running the review loop. **Dangerous** — requires the `safety.allow_skip_review` opt-in (see below) and is ignored otherwise. |
| `ferry:skip/iter`    | Iterator becomes a no-op — review feedback is not auto-iterated. Alias: `ferry:skip/iterate`.                                                                       |

Multiple `ferry:skip/*` labels for **different** phases coexist additively (e.g. `ferry:skip/refiner` + `ferry:skip/iter` is allowed). Duplicate labels for the same phase are deduplicated silently.

**Safety opt-in for `ferry:skip/review`:** Because bypassing the review phase auto-approves the PR, the label is ignored unless the repository owner has opted in by setting:

```yaml
# ferry.config.yaml
safety:
  allow_skip_review: true # default: false
```

Without the opt-in, the label is treated as unknown — a warning is logged to stderr and review proceeds normally. This prevents a single Jira user from bypassing review without explicit repo-level consent.

When honoured, the Reviewer:

- Posts a `[ferry:reviewer:<run-id>] Auto-approved via ferry:skip/review` comment on the Jira ticket.
- Adds the `ferry:approved` label to the PR.
- Performs `auto_transition_approve` (FR24) if configured and `ferry:no-auto-transition` is not also set.

##### No auto-transition (`ferry:no-auto-transition`)

Disable Ferry's automatic Jira column moves (FR18, FR24, FR28) for this ticket only. The agent still does its work — only the Jira board transition is suppressed, and the engineer moves the column manually.

| Label                      | Effect                                                                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ferry:no-auto-transition` | Suppresses FR18 (Developer → In Review), FR24 (Reviewer → Ready / Changes Requested), and FR28 (Iterator → In Review). The terminal Jira comment notes which transition was skipped (e.g. `FR18 auto-transition skipped`). |

**Use case:** a research spike where the engineer wants to read the agent's output before deciding the next column.

##### Dry-run / read-only (`ferry:dry-run`, `ferry:read-only`)

Let a Jira ticket run Ferry without producing side effects — to validate prompts, MCP wiring, or rough token spend before committing real work.

| Label             | Effect                                                                                                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ferry:dry-run`   | Run every phase but suppress all external writes: no branch push, no PR creation, no Jira label / transition / sub-task writes. The audit comment still posts, prefixed with `[dry-run]` so consumers can spot it in the Jira comment stream. |
| `ferry:read-only` | Refiner runs normally; Developer / Reviewer / Iterator short-circuit at entry with a single `[ferry:<role>:<run-id>] read-only: agent skipped` audit comment and exit cleanly. Useful for "what would Ferry plan for this ticket?".           |

**LLM cost warning:** `ferry:dry-run` only suppresses **external** side effects. LLM calls still happen and **token cost is still incurred**. Each agent logs a `DRY-RUN: LLM calls will still incur cost; no commits or PRs will be pushed.` warning at start. Use `ferry:read-only` to also skip Developer / Reviewer / Iterator LLM calls — only the Refiner pays tokens.

**Combination:** `ferry:dry-run` + `ferry:read-only` is **not a conflict** — the two labels compose. Read-only is stricter (only Refiner runs); combining with dry-run additionally suppresses the Refiner's Jira sub-task creation, so the entire pipeline produces no Jira mutations beyond the audit comment.

**Auto-transitions:** under `ferry:dry-run`, FR18 / FR24 / FR28 are skipped just like with `ferry:no-auto-transition`. The terminal Jira comment notes that the transition was suppressed.

**Use case:** validate a new MCP server configuration or refined prompt by running the full agent loop on a real ticket without touching the repo or the Jira board.

##### Execution-path routing (`ferry:claude-code`, `ferry:no-claude-code`)

> **Read the trade-off first.** The `claude-code-action` path is a direct call into `anthropics/claude-code-action` with no Ferry wrapper around it — see [Execution paths & accepted divergences](#execution-paths--accepted-divergences). Several invariants that the bundled-script path enforces in code become **prompt-enforced** on this path.

Which execution path an agent run takes is decided by a deterministic resolver ([ADR-0006](./adr/0006-claude-code-action-execution-path.md) §3, [#300](https://github.com/big-emotion/ferry/issues/300)). Precedence, highest first:

1. **Explicit `execution_path: "script"`** in `ferry.config.*` — a hard lock; never overridden by the label or the heuristic.
2. **Per-ticket label** — `ferry:claude-code` forces the claude-code-action path; `ferry:no-claude-code` forces the bundled script. Both labels present is **not** a `LabelConflictError`: it fails closed to the safe `script` path.
3. **Automatic heuristic** — a `developer` / `iterator` run with `priorRoundTrips >= routing.claude_code_round_trip_threshold` escalates an otherwise-script default to claude-code.
4. **Conditional default** — explicit `execution_path: "claude-code"`, else `claude-code` for an Anthropic-only consumer, else `script`.

The resolved path **and the reason** (`label` / `heuristic` / `default`) are recorded in the audit comment so the Reconciler observes which path ran and why.

| Config key                                 | Default   | Effect                                                                                     |
| ------------------------------------------ | --------- | ------------------------------------------------------------------------------------------ |
| `execution_path`                           | _(unset)_ | `"script"` (hard lock) or `"claude-code"` (explicit). Unset → conditional default applies. |
| `routing.claude_code_round_trip_threshold` | `2`       | Positive integer N for the developer/iterator escalation heuristic.                        |

`ferry:claude-code` only _selects_ the path — it does not provision the `CLAUDE_CODE_OAUTH_TOKEN` the path needs. The one hard, code-enforced invariant that holds regardless of how the path was chosen is **Ferry never merges code**; on the claude-code path it is enforced by `claude-code-action`'s `--disallowedTools` deny-list plus consumer branch protection (see [Execution paths & accepted divergences](#execution-paths--accepted-divergences)).

##### Extended thinking (`ferry:thinking/*`)

| Label                     | Effect                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `ferry:thinking/on`       | Enable extended-thinking mode for this ticket with the default budget (Anthropic only) |
| `ferry:thinking/extended` | Enable extended-thinking mode with a larger budget for complex tasks (Anthropic only)  |
| `ferry:thinking/off`      | Force-disable extended-thinking mode even if repo defaults enable it                   |

**Anthropic-only:** these labels are only honoured when the resolved provider for the agent is `anthropic`. With `openai` or `google` the flag is ignored at invoke time and the agent logs a `ferry:thinking/* label set but provider is not anthropic — ignoring` warning to stderr. The override stays visible in the audit comment so the user's intent is recorded.

**Budgets:** `on` uses a conservative `budget_tokens` for routine reasoning; `extended` uses a larger budget appropriate for complex refactors or analyses. Both budgets are below the call's `max_tokens` so the SDK accepts them. See [Anthropic extended thinking](https://docs.claude.com/en/docs/build-with-claude/extended-thinking).

**Conflict rule:** any two of `ferry:thinking/on`, `ferry:thinking/extended`, `ferry:thinking/off` on the same ticket is a conflict — the Refiner / Developer / Reviewer / Iterator throws `LabelConflictError`, posts a conflict-audit comment, and exits non-zero.

##### Reviewer rubric (`ferry:strict-review`, `ferry:lenient-review`)

| Label                  | Effect                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ferry:strict-review`  | Reviewer applies a stricter rubric: blocks on missing tests, edge cases, weak naming, incomplete docs              |
| `ferry:lenient-review` | Reviewer applies a more permissive rubric: blocks only on failing tests, unimplemented ACs, conflicts, or security |

A rubric-override directive is appended at the end of the reviewer's system prompt (after `prompts/review.md` and any optional `prompts/review-comment.md` overlay) so it takes precedence over earlier instructions about review strictness.

**Conflict rule:** `ferry:strict-review` + `ferry:lenient-review` on the same ticket is a conflict — the Reviewer throws `LabelConflictError`, posts a conflict-audit comment, and exits non-zero.

**Use case:** a complex refactor gets `ferry:thinking/extended` + `ferry:strict-review` — Ferry takes its time and the Reviewer holds the bar high. A trivial copy change gets `ferry:thinking/off` + `ferry:lenient-review` — fast and cheap.

##### Git overrides (`ferry:git/*`)

| Label             | Effect                                                             |
| ----------------- | ------------------------------------------------------------------ |
| `ferry:git/no-pr` | Developer skips PR creation (branch is pushed but no PR is opened) |

##### Per-ticket branch and PR-state overrides (`ferry:base/*`, `ferry:target/*`, `ferry:pr/*`)

Lets a single Jira ticket pick its own base branch, PR target branch, and PR draft state without editing `ferry.config.yaml`.

| Label                   | Effect                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `ferry:base/<branch>`   | Override `git.base_branch` — the branch Ferry creates the `ferry/...` working branch from |
| `ferry:target/<branch>` | Override `git.target_branch` — the branch the PR is opened against                        |
| `ferry:pr/draft`        | Open the PR as draft regardless of repo default                                           |
| `ferry:pr/ready`        | Open the PR as ready-for-review regardless of repo default                                |

**Branch validation:** `<branch>` must match the regex `^[a-zA-Z0-9._/-]+$` (alphanumerics plus `.`, `_`, `/`, `-`). Anything else — spaces, `$`, shell metacharacters, empty string — is rejected as a parse error: the label is logged to stderr and ignored, and no conflict is raised. This is intentional: a typo in the value should not block the ticket.

**Remote existence:** the Developer agent validates that the resolved base and target branches exist on `origin` before branching off them or opening the PR. A missing branch fails loudly with a Jira comment naming the missing branch and a non-zero exit. The Iterator performs the same check for `baseBranch` before merging the base into the working branch.

**Conflict rules:**

- `ferry:pr/draft` + `ferry:pr/ready` on the same ticket → `LabelConflictError` (field `git.prDraft`).
- Two different `ferry:base/<x>` values → `LabelConflictError` (field `git.baseBranch`).
- Two different `ferry:target/<x>` values → `LabelConflictError` (field `git.targetBranch`).
- Identical duplicates (e.g. two `ferry:base/release-1.x` labels) are accepted as vacuous.

**Security:** `ferry:target/<branch>` can theoretically be abused to ship to a protected branch. Ferry only **opens** the PR — it does not merge — so existing GitHub branch protection rules and CODEOWNERS still apply unchanged. Risk is contained at the merge gate; treat the label as a target-branch hint, not a merge authorization.

**Use case (backport):** a ticket fixing a regression on the maintenance branch is labeled `ferry:base/release-1.x` + `ferry:target/release-1.x` + `ferry:pr/ready`. The Developer agent branches off `release-1.x`, opens a ready-for-review PR against `release-1.x`, and the reviewer can merge straight into the maintenance line.

##### Safety labels

| Label             | Applied by               | Effect                                                                                                                                            |
| ----------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ferry:paused`    | Cost-governance workflow | Agent exits immediately without processing. Applied automatically when spend reaches 50% of the monthly cap. Remove the label manually to resume. |
| `ferry:spend-cap` | Cost-governance workflow | Informational — marks tickets that triggered the spend cap check. No direct effect on agent execution.                                            |

> **Execution-path note:** `ferry:paused` (50% monthly auto-pause) is **weakened** and `ferry:spend-cap` **never fires** on the `claude-code-action` path, because subscription-token spend has no measurable EUR figure. See [Execution paths & accepted divergences](#execution-paths--accepted-divergences).

---

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

#### `safety`

Repo-level opt-ins that gate dangerous Jira-label overrides. All flags default to `false` (the safest behaviour) and must be explicitly enabled by the repository owner.

```yaml
safety:
  allow_skip_review: false # default — set true to honour ferry:skip/review
```

| Field                      | Default | Description                                                                                                                                                                                                                                          |
| -------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `safety.allow_skip_review` | `false` | When `true`, the `ferry:skip/review` label auto-approves the PR at the Reviewer phase (bypassing the review loop). When `false` (default), the label is logged to stderr and ignored. Prevents bypassing review without explicit repo-owner consent. |

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

---

## Execution paths & accepted divergences

Ferry's four agents (Refiner, Developer, Reviewer, Iterator) run via one of two execution paths behind the same `repository_dispatch` boundary:

| Path                     | Reasoning core                          | Providers                   | Per-run EUR cap  | Auth                                     |
| ------------------------ | --------------------------------------- | --------------------------- | ---------------- | ---------------------------------------- |
| **Bundled script**       | Ferry's deterministic agent loop        | Anthropic / OpenAI / Google | Enforced         | `ANTHROPIC_API_KEY` / provider keys      |
| **`claude-code-action`** | `anthropics/claude-code-action@v1` loop | Anthropic only              | **Not enforced** | `CLAUDE_CODE_OAUTH_TOKEN` (subscription) |

The **bundled-script path is unchanged** — its deterministic agent loop, structured-output schema, code-enforced idempotency, audit-line emission, and per-run EUR cap all behave exactly as documented elsewhere in this reference.

### How the claude-code path runs

For a `ferry:claude-code` ticket each agent job is **one direct call** into `anthropics/claude-code-action@v1`: a `checkout` step followed by that single action step. There is **no Ferry wrapper** around it — no prepare/apply composite actions, no intermediate JSON artifact, no structured-output "contract" layer. The agent does its own Jira work through a Ferry-shipped MCP server ([`ferry-jira-mcp`](#ferry-jira-mcp-jira-access-for-the-claude-code-path)) and its own GitHub work through `claude-code-action`'s native `git` / `gh` tools. The reviewer job is additionally fronted by the deterministic [`ferry-ci-gate`](#ferry-ci-gate-reviewer-ci-pre-gate) composite action.

Authentication is `CLAUDE_CODE_OAUTH_TOKEN` only — `ANTHROPIC_API_KEY` is **forbidden** on this path ([ADR-0006](./adr/0006-claude-code-action-execution-path.md) §6). The provider gate still applies: the claude-code path is only available to an Anthropic-only consumer configuration.

### The accepted trade-off: prompt-enforced, not code-enforced

Because there is no wrapper bracketing the LLM, several behaviors that the bundled-script path guarantees in deterministic code become **prompt-enforced** on the claude-code path — the agent is instructed to honour them, but no Ferry code verifies the outcome:

- **Idempotency** — fingerprinted comments and repeatable file operations are described in the prompt; they are not validated by a wrapper.
- **Audit-line emission** — the agent is asked to post the `[ferry:<role>:<run-id>] ...` audit line itself; there is no deterministic step that emits it.
- **"Agents rarely transition columns"** — FR18 / FR24 / FR28 and the "no other transitions" discipline are prompt instructions, not code-gated transitions.

This is **accepted by design**: the claude-code path trades the wrapper's hard guarantees for a direct, lower-overhead call. Operators who need code-enforced idempotency and audit emission should keep that work on the bundled-script path.

### The one hard invariant: Ferry never merges code

The single invariant that stays **code-enforced** on the claude-code path is the no-merge rule ([ADR-0005](./adr/0005-no-auto-merge-invariant.md)). It is enforced two ways:

1. **`claude-code-action`'s `--disallowedTools`** denies `gh pr merge` and `gh pr close`, so the agent loop cannot merge or close a PR.
2. **GitHub branch protection on the consumer's default branch** — this is now a **required consumer setting**. The tool deny-list is a client-side control; branch protection is the authoritative server-side gate. Without it the no-merge guarantee does not hold server-side. Configure a branch-protection rule (or ruleset) on your default branch — at minimum require a pull request before merging — when you enable the claude-code path.

### Other accepted divergences

These remain accepted, by-design differences on the claude-code path — all are cost/safety-budget concerns:

1. **`ferry:spend-cap` does not fire (no per-run EUR cap).** The action's agent loop cannot raise a mid-loop EUR error, so `ferry:budget/<eur>` and `limits.max_cost_eur_per_run` have **no effect** and the `ferry:spend-cap` label never appears. A run is bounded only by `--max-turns` and the job `timeout-minutes`. Under Claude subscription billing there is no per-run EUR figure to enforce against.

2. **Daily cost-governance auto-pause is weakened.** The 50%-of-monthly-cap `ferry:paused` backstop depends on a measurable EUR figure. Subscription-token spend is not measurable, so it cannot trip from claude-code-path spend. Bundled-script-path tickets are still governed normally.

3. **EUR-cost telemetry is `0` on the claude-code path.** With no wrapper to capture token/cost values, the `cost_eur` and token audit fields are emitted as `0` (best-effort by design). See [COST.md → Cost telemetry on the claude-code path](./COST.md#cost-telemetry-on-the-claude-code-execution-path).

### `ferry-jira-mcp` — Jira access for the claude-code path

On the claude-code path the agent reaches Jira through **`ferry-jira-mcp`**, a Ferry-owned stdio MCP server shipped as the `ferry-jira-mcp` bin of the `@big-emotion/ferry` npm package. It authenticates with the same token-auth env Ferry already uses — `FERRY_JIRA_BASE_URL`, `FERRY_JIRA_EMAIL`, `FERRY_JIRA_API_TOKEN`.

It exposes six tools: `get_issue`, `list_subtasks`, `create_subtask`, `get_transitions`, `transition_issue`, `post_comment`.

The consumer's claude-code workflow wires it into `claude-code-action` via `claude_args --mcp-config`, launching the server with `npx -y -p @big-emotion/ferry ferry-jira-mcp`.

### `ferry-ci-gate` — reviewer CI pre-gate

`ferry-ci-gate` is a deterministic composite action that runs **before** the reviewer's claude-code job. It resolves the PR for the ticket branch, reads the CI check-runs, and classifies them with the same pure `gateCi()` logic the bundled-script path uses:

- **CI pending** → the reviewer job is **skipped silently**.
- **CI red** → the reviewer job is **skipped**; the gate posts a changes-requested PR comment and transitions the ticket (FR24).
- **CI green** → the reviewer job **proceeds**.

By short-circuiting on pending/red CI deterministically, the gate avoids spending an LLM call on a review that cannot succeed.

---

## GitLab (experimental)

> **Experimental** — see [#210](https://github.com/big-emotion/ferry/issues/210). Same artifact may break across minor versions until promoted.

Ferry can run on GitLab CI as an alternative to GitHub Actions. Selection is controlled by the `FERRY_FORGE` env var:

| `FERRY_FORGE`   | Behaviour                                       |
| --------------- | ----------------------------------------------- |
| unset (default) | GitHub Actions runner — current production path |
| `github`        | same as unset                                   |
| `gitlab`        | GitLab REST adapter (experimental)              |

### GitLab-specific env vars

| Variable                              | Required when                            | Description                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FERRY_GITLAB_TOKEN`                  | always (under GitLab)                    | Project access token with `api` scope; used for MR read/write and label management. Set the existing `GITHUB_TOKEN` env to the same value (the agent runtime expects it). |
| `FERRY_GITLAB_API_BASE`               | optional                                 | Defaults to `https://gitlab.com/api/v4`. Set to your self-managed instance's API URL when applicable (e.g. `https://gitlab.example/api/v4`).                              |
| `FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN` | when chaining pipelines via `dispatch()` | Pipeline trigger token created at Settings → CI/CD → Pipeline triggers.                                                                                                   |
| `FERRY_GITLAB_TRIGGER_REF`            | optional                                 | Defaults to `main`. The ref that `dispatch()` triggers the downstream pipeline on.                                                                                        |

### Wiring Jira Automation → GitLab pipeline trigger

Every column transition that fires a Ferry agent maps to one Jira Automation rule whose webhook POSTs to the GitLab pipeline-trigger endpoint:

```http
POST {API_BASE}/projects/{ENCODED_PATH}/trigger/pipeline
Content-Type: application/x-www-form-urlencoded

token={FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN}&
ref={FERRY_GITLAB_TRIGGER_REF}&
variables[FERRY_DISPATCH_TYPE]=ferry-{role}&
variables[FERRY_ENVELOPE_PAYLOAD]={JSON envelope (same shape as the GitHub repository_dispatch payload)}
```

The four `FERRY_DISPATCH_TYPE` values are `ferry-refine`, `ferry-dev`, `ferry-review`, `ferry-iterate`. The envelope JSON shape is identical to what you'd send as `repository_dispatch.client_payload` on GitHub — no schema divergence between forges.

### Templates

Copy-pasteable GitLab CI templates live in [`examples/consumer-setup-gitlab/`](../examples/consumer-setup-gitlab). Each role has a ~10-line include file that:

1. Installs Node ≥ 20 (alpine image).
2. `npm install -g @big-emotion/ferry@${FERRY_VERSION}`.
3. Runs `ferry-agent run --role <role>`.

### Scaffolding with `ferry-init --forge gitlab`

Instead of copying the templates by hand, run the wizard from your consumer repo:

```bash
npx -p @big-emotion/ferry ferry-init --forge gitlab
```

The wizard:

1. Detects the GitLab project from `git remote get-url origin` (gitlab.com and self-managed instances). Pass `--project namespace/project` to override (subgroups are supported, e.g. `acme/team/widgets`).
2. Writes the six GitLab CI files (`refine`, `dev`, `review`, `iterate`, `reconcile`, `cost-daily`) under `ci/ferry/` in your repo. Include them from your top-level `.gitlab-ci.yml` via `include:`.
3. Prints the project-access-token scopes (`api`) and the CI/CD variables you must set in **Settings → CI/CD → Variables**: `FERRY_VERSION`, `FERRY_JIRA_BASE_URL`, `FERRY_JIRA_EMAIL`, `FERRY_JIRA_API_TOKEN`, `FERRY_GITLAB_TOKEN`, `FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN`, `FERRY_REVIEW_TRANSITION_ID`, `FERRY_ITER_TRANSITION_ID`, `FERRY_APPROVE_TRANSITION_ID`, `FERRY_AUDIT_ISSUE`, plus at least one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY`. Mark every token-bearing variable **Masked + Protected**.

Re-running the wizard is **idempotent** — files whose content already matches the template are reported as up-to-date; files you have edited locally are left intact and listed as "would overwrite". Pass `--force` to replace them. Pass `--dry-run` to preview without touching the working tree.

Tokens are **never** read or stored by the CLI: the wizard tells you which variables to create in GitLab, you set them there.

### Updating the pinned version (`ferry-update --forge gitlab`)

Bump the pinned Ferry version across every `.gitlab-ci.yml` (and per-role include) in one command:

```bash
npx -p @big-emotion/ferry@<new-version> ferry-update --forge gitlab
```

What it does:

- Discovers `.gitlab-ci.yml` and any `*.gitlab-ci.yml` includes under the repo root (caps recursion at depth 3; skips `node_modules`, `.git`, `dist`, etc.).
- Rewrites a `FERRY_VERSION: <ver>` assignment under `variables:` to the target version (quoted or unquoted; preserves the surrounding indentation and any trailing comment).
- Rewrites a literal `@big-emotion/ferry@<ver>` pin in a `script:` line.
- Leaves the `${FERRY_VERSION}` / `$FERRY_VERSION` interpolation form untouched — that value lives in CI/CD UI variables (Settings → CI/CD → Variables), not in YAML.
- Prints a unified diff before writing. Pass `--dry-run` to preview without modifying files, or `--yes` to skip the confirmation prompt.
- Idempotent: rerunning after convergence produces no diff.
- After the rewrite, `MIGRATIONS.md` entries scoped to `forge: gitlab` (or with no `forge:` field, i.e. `both`) are printed as **Manual follow-ups required (gitlab)**.

Exit code: `0` on success, `1` on parse or write failure.

### Pipeline status mapping

The reviewer's CI gate is forge-neutral, so collapsing GitLab pipeline statuses into Ferry's `green | red | pending` enum happens inside the GitLab adapter:

| GitLab pipeline status                                                            | Ferry status |
| --------------------------------------------------------------------------------- | ------------ |
| `success`, `skipped`, `manual`                                                    | `green`      |
| `failed`, `canceled`                                                              | `red`        |
| `created`, `pending`, `running`, `preparing`, `waiting_for_resource`, `scheduled` | `pending`    |

### Token scopes (GitLab project access token)

- `api` (full read/write).

The token must be able to: read MRs, create MR notes, set/unset MR labels, update MR titles (for the `Draft:` → ready transition), and trigger pipelines.

### Validating a GitLab install with `ferry-doctor`

```sh
npx -p @big-emotion/ferry ferry-doctor --forge gitlab \
  --project owner/repo \
  --token "$FERRY_GITLAB_TOKEN" \
  --trigger-token "$FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN"
```

The five probes are:

1. **GitLab project access** — `GET /projects/:id` with `Authorization: Bearer <token>`. Requires token scopes `api` and `read_repository`.
2. **GitLab token scopes** — `GET /personal_access_tokens/self` to verify the `api` scope is present. Project access tokens (which cannot self-introspect) get a `[WARN]` rather than a `[FAIL]` and must be checked manually under Settings → Access tokens.
3. **GitLab pipeline trigger** — `GET /projects/:id/triggers` to verify the configured `FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN` is registered on the project (requires `api` scope + Maintainer role).
4. **GitLab CI/CD variables** — `GET /projects/:id/variables` to check every required key (`FERRY_VERSION`, `FERRY_JIRA_*`, `FERRY_GITLAB_*`, `FERRY_*_TRANSITION_ID`, `FERRY_AUDIT_ISSUE`) plus at least one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY`. Missing keys are surfaced individually with `[FAIL] <KEY>`. Unmasked token-bearing variables emit a `[WARN]`.
5. **Jira → GitLab webhook** — marked `[MANUAL]`: cannot be probed from `ferry-doctor`. Confirm by firing a test execution of each Jira Automation rule that targets `{API_BASE}/projects/:id/trigger/pipeline` and verifying a pipeline starts in GitLab.

Exit code is `0` if no `[FAIL]`, `1` otherwise. All flags fall back to environment variables (`FERRY_GITLAB_API_BASE`, `FERRY_GITLAB_TOKEN`, `FERRY_GITLAB_PROJECT_PATH`, `FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN`).

### Uninstalling Ferry from a GitLab project

```bash
# Plan only — no files changed:
npx -p @big-emotion/ferry ferry-uninstall --forge gitlab

# Actually delete Ferry includes + stub files:
npx -p @big-emotion/ferry ferry-uninstall --forge gitlab --apply
```

What the CLI **does** (locally, with `--apply`):

- Removes `include:` entries from the project's root `.gitlab-ci.yml` that reference one of the six canonical Ferry templates (`refine.gitlab-ci.yml`, `dev.gitlab-ci.yml`, `review.gitlab-ci.yml`, `iterate.gitlab-ci.yml`, `reconcile.gitlab-ci.yml`, `cost-daily.gitlab-ci.yml`). User-authored `include:` lines are left intact.
- Deletes the matching template stub files at the repo root.
- If stripping Ferry includes leaves `.gitlab-ci.yml` with no meaningful content, the file is **kept** on disk with a printed notice — the CLI never deletes a file that might still hold project-level CI config you authored.

What the CLI **does not do** (no GitLab API call is ever made):

- Revoke the project access token (`FERRY_GITLAB_TOKEN`).
- Revoke the pipeline trigger token (`FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN`).
- Delete any CI/CD variable.
- Disable or remove Jira Automation rules.

Instead, the CLI prints deep-link URLs to **Settings → Access Tokens**, **Settings → CI/CD → Triggers**, and **Settings → CI/CD → Variables**, plus the full list of variables to remove (every `FERRY_*` from the install README, plus your LLM provider key if it was added solely for Ferry). The remote project URL is auto-detected from `git remote get-url origin`; override with `--project-url <url>`.

Re-running `ferry-uninstall --forge gitlab` on an already-cleaned repo prints `Nothing to remove` and exits 0 — the local cleanup is idempotent.

### Promotion checklist

GitLab support remains marked experimental until every box on [#210](https://github.com/big-emotion/ferry/issues/210) is ticked: at least one consumer has run a full Refiner→Developer→Reviewer→Iterator cycle in prod, `ferry-doctor --forge gitlab` ([#214](https://github.com/big-emotion/ferry/issues/214)) has caught a real misconfiguration, and no open P0/P1 issues against the adapter.
