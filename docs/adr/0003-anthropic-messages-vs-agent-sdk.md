# 0003 — Anthropic Messages API over Agent SDK

**Status:** Accepted  
**Date:** 2024-01-01  
**See also:** [docs/decisions/0001-vercel-ai-sdk-evaluation.md](../decisions/0001-vercel-ai-sdk-evaluation.md) — May 2026 spike evaluating Vercel AI SDK as a multi-provider loop foundation; rejected (HTTP MCP gap + `ToolLoopAgent` not stable).

## Context

Ferry's agents (Developer, Iterator, Reviewer) require multi-turn LLM interactions with tool use: the model calls tools, receives results, and continues until a terminal condition is met. This is the classic "agent loop" pattern.

Two approaches exist within the Anthropic ecosystem:

1. **Raw Messages API** (`anthropic.messages.create`) — low-level, request/response. The caller is responsible for threading messages, handling `tool_use` blocks, formatting tool results, and deciding when to stop the loop.

2. **Anthropic Agent SDK** — higher-level SDK that manages the agent loop, tool dispatch, and message threading automatically.

Ferry also needs to support MCP (Model Context Protocol) servers for tool execution. Anthropic offers a beta `mcp_servers` parameter on the Messages API that allows the API server itself to connect to HTTP MCP servers and call tools, removing the need for a local MCP client.

## Decision

Ferry uses the **raw Anthropic Messages API** with a custom agent loop implemented in `src/lib/llm/agent-loop/anthropic.ts`.

The loop handles:

- Multi-turn tool-use sequences: after each `tool_use` block, format tool results and re-submit.
- **Two execution paths** based on whether HTTP MCP servers are configured:
  - _HTTP MCP servers present_: call `anthropic.beta.messages.create()` with `mcp_servers` parameter and `betas: ['mcp-client-2025-11-20']`. The API server executes MCP tool calls; the loop only handles the `stop_reason` / result threading.
  - _No HTTP MCP servers (or stdio-only)_: call `anthropic.messages.create()` with standard tool definitions; the loop executes tools locally and threads results manually.
- **Prompt caching**: `cache_control: { type: 'ephemeral' }` markers are placed on the system prompt and the initial user message so that repeated tool-use turns within a session hit the cache rather than re-encoding the full context.

Simple, single-turn LLM calls (cost-governance checks, Refiner's single-pass output) use a thin wrapper in `src/lib/llm/anthropic.ts` that calls `messages.create()` directly without a loop.

### Migration plan

The Anthropic Agent SDK (`@anthropic-ai/sdk/agents`) is a candidate for replacing the custom loop in `src/lib/llm/agent-loop/anthropic.ts`. Migration is deferred until the SDK reaches stability and supports:

- Prompt caching with per-message `cache_control` markers
- Mixed stdio + HTTP MCP server configurations
- Deterministic loop termination hooks (the current loop uses explicit `stop_reason` checks)

When those conditions are met, the migration path is:

1. Replace `agent-loop/anthropic.ts` with an SDK-backed implementation behind the same interface.
2. Keep `src/lib/llm/call.ts` (`createLlmCall`) as the single dispatch point — agent code under `src/agents/**` must not import the loop or SDK directly.
3. Validate with existing `src/lib/llm/call.test.ts` integration tests.

## Consequences

**Positive:**

- Full control over message threading, caching strategy, and loop termination allows Ferry to tune for cost and latency without waiting on SDK updates.
- The beta MCP server integration is available immediately without SDK abstraction overhead.
- The existing loop is well-tested and covers edge cases (max-token stops, malformed tool calls, parallel tool-use blocks) that the SDK may handle differently.

**Negative:**

- Custom loop code is ~300 lines of boilerplate that the SDK would eliminate.
- Tool-result formatting and message threading must be maintained manually; any Anthropic API change in how `tool_use` / `tool_result` blocks work requires updating the loop.
- Contributors unfamiliar with the Messages API need to understand the raw request/response shape before modifying agent behavior.

## Alternatives Considered

**Adopt Anthropic Agent SDK immediately** — rejected because the SDK did not yet fully support prompt caching with `cache_control` markers or the MCP beta at the time Ferry was built. Forcing SDK adoption would have required either forgoing caching (increasing cost significantly on long agent runs) or monkey-patching the SDK internals.

**LangChain / LlamaIndex orchestration** — rejected because these frameworks add large dependency trees, obscure the raw API calls (making debugging harder), and impose their own abstractions for tool use and message history that conflict with Ferry's need to inject MCP server references at the API level.

**OpenAI-compatible wrapper** — rejected because Ferry is intentionally multi-provider (see `src/lib/llm/call.ts` which has branches for Anthropic, OpenAI, and Google). Each provider's agent loop lives in its own file; a shared OpenAI-compatible wrapper would lose provider-specific features like Anthropic's prompt caching and MCP beta.
