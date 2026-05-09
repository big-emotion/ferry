# Ferry MCP Integration

Ferry supports **Model Context Protocol (MCP)** servers to extend agent capabilities during development and iteration. MCP servers expose tools (e.g. library docs, design systems, monitoring) that the agent can invoke mid-run.

## Agent coverage

| Agent     | MCP support | Notes |
| --------- | ----------- | ----- |
| Refiner   | No          | Single-turn LLM call; no tool loop |
| Developer | Yes         | Reads `AGENT_MCP_SERVERS` |
| Reviewer  | No          | Uses its own built-in tool loop; ignores `AGENT_MCP_SERVERS` |
| Iterator  | Yes         | Reads `AGENT_MCP_SERVERS`; re-reads Jira labels each cycle |

## Server registry

Known servers used with Ferry, ready to drop into `AGENT_MCP_SERVERS`:

| Name | Transport | URL / Command | Purpose | Notes |
| ---- | --------- | ------------- | ------- | ----- |
| `context7` | HTTP | `https://mcp.context7.com/mcp` | Up-to-date library and framework docs | No auth required |
| `figma` | HTTP | `https://mcp.figma.com/mcp` | Fetch design nodes and frames | Requires `authorization_token` (Figma PAT) |
| `playwright` | Stdio | `npx @playwright/mcp` | Browser automation | Requires Playwright installed on the runner |
| `sentry` | HTTP/Stdio | Varies | Runtime error logs and issue context | See Sentry MCP docs for auth |

Add any server above to `AGENT_MCP_SERVERS` and the corresponding label entry to `ferry.config.yaml` — see [Per-ticket capability boost](#per-ticket-capability-boost-via-jira-labels) below.

## Two transport types

### HTTP/SSE servers (Anthropic-proxied)

Set the `AGENT_MCP_SERVERS` environment variable (repository variable or secret) to a JSON array:

```json
[
  {
    "name": "context7",
    "url": "https://mcp.context7.com/mcp"
  },
  {
    "name": "github",
    "url": "https://api.githubcopilot.com/mcp",
    "authorization_token": "<your-token>",
    "allowed_tools": ["search_code", "get_file_contents"]
  }
]
```

| Field | Required | Description |
| ----- | -------- | ----------- |
| `name` | yes | Logical name used in prompts and audit logs |
| `url` | yes | HTTP/SSE endpoint — **must be `https://`** |
| `authorization_token` | no | Bearer token forwarded to the MCP server |
| `allowed_tools` | no | Allowlist — only these tools are exposed to the agent |
| `denied_tools` | no | Denylist — these tools are hidden from the agent |

**Constraints**

- Tool calls only — MCP prompts and resources are not in scope.
- Only available when the agent uses the Anthropic provider (`mcp-client-2025-11-20` beta connector). Not supported on Bedrock or Vertex. Not eligible for Anthropic Zero Data Retention.
- The routing logic (beta header, `mcp_servers` param, `mcp_toolset` entries) is covered by unit tests with a mocked Anthropic client. There are no live-network integration tests for this path — use with caution in production until the Anthropic beta stabilizes.

### Stdio servers (client-side)

Stdio MCP servers run as local subprocesses on the GitHub Actions runner:

```json
[
  {
    "type": "stdio",
    "name": "my-tool",
    "command": "npx",
    "args": ["-y", "@my-org/mcp-server"],
    "env": {
      "MY_API_KEY": "<your-key>"
    },
    "allowed_tools": ["tool_a", "tool_b"]
  }
]
```

| Field | Required | Description |
| ----- | -------- | ----------- |
| `type` | yes | Must be `"stdio"` |
| `name` | yes | Logical name used in prompts and audit logs |
| `command` | yes | Executable to spawn (must be on `PATH` in the runner) |
| `args` | no | Array of command-line arguments |
| `env` | no | Additional environment variables injected into the subprocess |
| `allowed_tools` | no | Allowlist — only these tools are exposed to the agent |
| `denied_tools` | no | Denylist — these tools are hidden from the agent |

**Constraints**

- The binary named in `command` must be pre-installed (or installable via a `run:` step) in the GitHub Actions runner image.
- Runs entirely client-side — not proxied through the Anthropic API, so Zero Data Retention and Bedrock/Vertex restrictions do not apply.
- Tool calls only — MCP prompts and resources are not in scope.
- Only available when the agent uses the Anthropic provider.

## Per-ticket capability boost via Jira labels

By default, `AGENT_MCP_SERVERS` loads every configured server for **every** ticket. To scope servers to specific tickets, declare a `labels:` section in `ferry.config.yaml`:

```yaml
labels:
  ferry:mcp/context7:
    mcp_servers: [context7]

  ferry:mcp/sentry:
    mcp_servers: [sentry]
    tools: [fetch_runtime_logs]

  ferry:profile/frontend:
    mcp_servers: [context7, playwright]
```

Then add the matching label to your Jira ticket (e.g. `ferry:mcp/context7`). Ferry unions all matching entries.

**Security — allowlist is the trust boundary.** Only labels explicitly declared in `ferry.config` are honoured. Any `ferry:*` label not in the config is logged and ignored — this prevents Jira editors from pointing Ferry at an arbitrary MCP server.

**Iterator re-reads labels each cycle.** The Iterator re-reads Jira labels at the start of each review→iterate cycle, not from the stale envelope. Labels added mid-iteration are picked up automatically.

**Backward compatibility.** If the `labels:` section is absent, all servers in `AGENT_MCP_SERVERS` are passed through unchanged.

## End-to-end example — Figma for UI refactors

**Step 1 — Declare the server** (`AGENT_MCP_SERVERS` repo variable):

```json
[
  {
    "name": "figma",
    "url": "https://mcp.figma.com/mcp",
    "authorization_token": "<your-figma-pat>",
    "allowed_tools": ["get_node", "get_file"]
  }
]
```

**Step 2 — Map a label** in `ferry.config.yaml`:

```yaml
labels:
  ferry:mcp/figma:
    mcp_servers: [figma]
```

**Step 3 — Tell the agent when to use it** in `prompts/dev.extra.md`:

```markdown
## Figma design reference

When the ticket references a Figma frame URL or node ID,
call `figma.get_node` before editing any UI component.
If no Figma link is present, skip the tool call.
```

**Step 4 — Label the Jira ticket** with `ferry:mcp/figma` before moving it to _In Development_.

> MCP tools are passive — the agent must be explicitly told when to invoke them. Without instructions in `prompts/dev.extra.md`, the tool will be available but never called.

## Audit logs

`mcp_tool_use` blocks are logged to stderr as:

```
[ferry:dev-tool] mcp_tool=<name> server=<server>
```

and reflected in the token-usage counters in the final `[ferry:dev-action]` summary line.
