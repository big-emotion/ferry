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

| Secret | Description |
|--------|-------------|
| `FERRY_JIRA_BASE_URL` | Your Jira instance URL, e.g. `https://acme.atlassian.net` |
| `FERRY_JIRA_EMAIL` | Atlassian account email used for Jira API calls |
| `FERRY_JIRA_API_TOKEN` | Atlassian API token — [generate one here](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `ANTHROPIC_API_KEY` | Anthropic API key — [get one here](https://console.anthropic.com/account/keys) |

### Required for specific agents

| Secret | Used by | Description |
|--------|---------|-------------|
| `FERRY_REVIEW_TRANSITION_ID` | Developer, Iterator | Jira transition ID that moves a ticket **into** the **In Review** column (FR18 / FR28). Find it via the Jira REST API: `GET /rest/api/3/issue/{key}/transitions`. |
| `FERRY_ITER_TRANSITION_ID` | Reviewer | Jira transition ID that moves a ticket **into** the **Changes Requested** column (FR24, when the reviewer requests changes). Same API call as above. |

> **Finding Jira transition IDs:** Call `GET https://<your-domain>.atlassian.net/rest/api/3/issue/<TICKET-KEY>/transitions` with Basic Auth. The response lists available transitions with their `id` and `name`. Use the ID (a number string like `"31"`) for the secret value.

---

## Repository Variables

Add these under **Settings → Secrets and variables → Actions → Variables** in your GitHub repository.

### Required

| Variable | Default | Description |
|----------|---------|-------------|
| `FERRY_AUDIT_ISSUE` | (none — required) | GitHub Issue number used as the audit log. Ferry writes deduplication entries here to prevent duplicate runs. Create a blank issue in your repo and use its number. |

### Optional

| Variable | Default | Affects | Description |
|----------|---------|---------|-------------|
| `FERRY_REVIEW_MODEL` | `claude-sonnet-4-6` | Reviewer agent | Override the model used by the Reviewer. Must be a model ID supported by the configured provider. |
| `FERRY_ITER_MODEL` | `claude-sonnet-4-6` | Iterator agent | Override the model used by the Iterator. |
| `FERRY_ITER_MAX_INPUT_TOKENS` | `500000` | Iterator agent | Input token budget per Iterator run. Mapped to `limits.max_tokens_per_run` internally. |

> **Note:** There is no `FERRY_DEV_MODEL` or `FERRY_REFINE_MODEL` repository variable — those agents use their defaults from `ferry.config.json`. Use the config file to override those models.

---

## `ferry.config.json`

Create `ferry.config.json`, `ferry.config.yaml`, or `ferry.config.yml` at the **root of your repository**. All fields are optional — omit any section to use the defaults.

Ferry reads the config file from `GITHUB_WORKSPACE` (the checked-out repo root) at the start of each agent run.

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

Each agent can be configured independently. All `models.*` fields are optional.

| Field | Default | Description |
|-------|---------|-------------|
| `models.refiner.provider` | `"anthropic"` | LLM provider. Currently only `"anthropic"` is wired through the consumer workflow stubs. |
| `models.refiner.model` | `"claude-sonnet-4-6"` | Model ID for the Refiner agent |
| `models.dev.provider` | `"anthropic"` | LLM provider for the Developer agent |
| `models.dev.model` | `"claude-opus-4-5"` | Model ID for the Developer agent |
| `models.review.provider` | `"anthropic"` | LLM provider for the Reviewer agent |
| `models.review.model` | `"claude-sonnet-4-6"` | Model ID for the Reviewer agent (overridden by `FERRY_REVIEW_MODEL` var) |
| `models.iterate.provider` | `"anthropic"` | LLM provider for the Iterator agent |
| `models.iterate.model` | `"claude-sonnet-4-6"` | Model ID for the Iterator agent (overridden by `FERRY_ITER_MODEL` var) |

> Ferry currently uses the Anthropic Messages API exclusively. Anthropic Agent SDK support is the next roadmap item.

#### `limits`

All `limits.*` fields are optional and accept positive numbers.

| Field | Default | Description |
|-------|---------|-------------|
| `limits.max_iterations` | `3` | **Integer, ≥ 1; recommended range 1–10.** Number of review→iterate cycles the Iterator runs before Ferry halts. When the cap is exceeded while findings remain, Ferry throws an oscillation error and stops — the ticket stays in its current Jira column for manual resolution. |
| `limits.max_agent_iterations` | `200` | Internal LLM agent loop cap per single agent run (guards against runaway tool-call loops) |
| `limits.max_tokens_per_run` | `500000` | Input token budget per agent run (overridden by `FERRY_ITER_MAX_INPUT_TOKENS` for Iterator) |
| `limits.max_tokens_per_message` | `16384` | Maximum output tokens per individual LLM API call |
| `limits.max_cost_eur_per_run` | `10` | Cost budget in EUR per agent run — Ferry aborts if this is exceeded |

#### `ticket_types`

Controls which Jira issue types Ferry will process.

| Field | Default | Description |
|-------|---------|-------------|
| `ticket_types.refine_allowlist` | `["Story", "Bug", "Spike"]` | Jira issue types the Refiner will process. Tickets of other types are skipped. |
| `ticket_types.dev_allowlist` | `["Story", "Bug", "Spike"]` | Jira issue types the Developer will process. |

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

| Sub-field | Required | Description |
|-----------|----------|-------------|
| `mcp_servers` | No | List of MCP server names to enable when this label is present |
| `tools` | No | If provided, restrict the listed servers to only these tool names. If omitted, all tools from those servers are allowed. |

**Merging behaviour:** When a ticket has multiple `ferry:*` labels, their server and tool lists are merged (union). If one label grants all tools (`tools` omitted) and another restricts tools for the same server, the "all tools" grant wins for that server.

**Unknown labels:** Any `ferry:*` label on a ticket that is not declared in `labels` is logged to stderr and silently ignored.

---

## What is hardcoded vs. configurable

The following are intentionally not configurable by consumers:

| Parameter | Why hardcoded |
|-----------|---------------|
| Jira column transitions (except the two IDs above) | Managed by Ferry's internal state machine |
| Branch naming (`ferry/<ticket-key>`) | Required by Ferry's state logic |
| PR/comment fingerprint formats | Required for idempotency |
| `FERRY_MODEL` env var used by Refiner/Developer workflows | Set to `claude-sonnet-4-6` internally; use `ferry.config.json` to change those models |
| Audit issue comment format | Required for deduplication |

---

## Configuration precedence summary

For any given setting, the last value wins:

```
ferry.config.json defaults
  → ferry.config.json values
    → GitHub repository variables (FERRY_REVIEW_MODEL, FERRY_ITER_MODEL, FERRY_ITER_MAX_INPUT_TOKENS)
```

Secrets are credentials only — they do not participate in model or limit configuration.
