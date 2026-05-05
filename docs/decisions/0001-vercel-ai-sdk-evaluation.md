# 0001 — Vercel AI SDK Evaluation: Multi-Provider Foundation

**Status:** Rejected  
**Date:** 2026-05-05  
**Issue:** [#225](https://github.com/big-emotion/ferry/issues/225) — Phase 0 spike  
**Relates to:** [#216](https://github.com/big-emotion/ferry/issues/216) (multi-provider plan), [#218](https://github.com/big-emotion/ferry/issues/218), [#219](https://github.com/big-emotion/ferry/issues/219)

---

## Goal

Evaluate whether `ai` (Vercel AI SDK) + `@ai-sdk/{anthropic,openai,google}` should replace
Ferry's per-provider LLM call and agent-loop implementations, reducing the cost of adding
OpenAI and Google agent loops in #218 / #219 from "rewrite three loops" to "rewrite one loop once."

---

## Scope Examined

| Layer                             | File                                                   | Current approach            |
| --------------------------------- | ------------------------------------------------------ | --------------------------- |
| Simple single-turn call           | `src/lib/llm/{anthropic,openai,google}.ts` + `call.ts` | Per-provider invokers       |
| Agent loop (tool use, multi-turn) | `src/lib/llm/agent-loop/anthropic.ts`                  | Raw Anthropic Messages API  |
| HTTP MCP connector                | same, `beta.messages.create`                           | Anthropic server-side beta  |
| Stdio MCP connector               | `src/lib/mcp/pool.ts`                                  | Client-side subprocess pool |

---

## Criteria (from #225)

All four must pass for adoption. Any failure is grounds for rejection.

### 1. Anthropic `cache_control` → equivalent token breakdown ✅

`@ai-sdk/anthropic` v1.x supports `providerOptions.anthropic.cacheControl: { type: 'ephemeral' }` on messages and tools, which maps directly to Anthropic's `cache_control` API field. The SDK passes it through unchanged. Token accounting fields (`cache_creation_input_tokens`, `cache_read_input_tokens`) are returned in the response's `usage` object and exposed by AI SDK's `usage` property. This criterion **passes** — spec-equivalent without live smoke test.

> **Caveat:** The rolling cache-breakpoint management in `agent-loop/anthropic.ts` (stripping the `cache_control` marker from the previous tool-result turn before adding it to the new one) is custom logic that AI SDK does not automate. It would still need to be maintained manually as middleware or pre-processing.

### 2. `@ai-sdk/mcp` supports the HTTP MCP connector ❌ HARD BLOCKER

Ferry uses Anthropic's proprietary server-side MCP connector, currently in beta:

```typescript
// agent-loop/anthropic.ts
await anthropic.beta.messages.create({
  ...baseParams,
  mcp_servers: [{ type: 'url', name, url, authorization_token }],
  betas: ['mcp-client-2025-11-20'],
});
```

In this model, **Anthropic's API server** connects to the HTTP MCP endpoint, executes tool calls, and returns `mcp_tool_use` blocks in the response — already executed. The client never connects to the MCP server.

`@ai-sdk/mcp` is a **client-side** MCP connector. It uses `experimental_createMCPClient` to connect the calling machine to MCP servers, exposes their tools as regular tool definitions, and the caller executes results locally. This is architecturally incompatible with Ferry's HTTP MCP path:

|                            | Anthropic server-side MCP        | `@ai-sdk/mcp` (client-side)        |
| -------------------------- | -------------------------------- | ---------------------------------- |
| Who connects to MCP server | Anthropic's API servers          | The client machine (GitHub runner) |
| MCP URL exposed to         | Anthropic (on their infra)       | GitHub Actions runner              |
| Tool execution             | Server-side, invisible to client | Client executes, threads result    |
| Response block type        | `mcp_tool_use` (pre-executed)    | Standard `tool_use` / tool result  |

Switching to `@ai-sdk/mcp` for the HTTP MCP path would:

- Require consumer HTTP MCP servers to be reachable from GitHub Actions runners (vs. just Anthropic's servers)
- Change the security boundary for all consumers relying on this path
- Force consumers to manage MCP auth credentials in the runner environment, not just in Anthropic's connector configuration

This criterion **fails**. The gap cannot be papered over with a shim.

> **Stdio MCP** (client-side subprocess pool, `src/lib/mcp/pool.ts`) is already client-side and could in principle use `@ai-sdk/mcp`. This is orthogonal to the blocker above.

### 3. Stable `ai` version supports `ToolLoopAgent` + `stopWhen` ❌

`ToolLoopAgent` and `stopWhen` are `ai@7.0.0-canary.x` features. The latest stable release is `ai@6.x`, which provides `generateText({ maxSteps: N })` for multi-turn tool use.

The stable v6 loop stops when either: no tool calls are returned, or `maxSteps` is exhausted. It has no mechanism to stop on a specific tool call (`done`). Ferry's agent loop is designed around the `done` tool as the _only_ termination mechanism (the model calls `done` when work is complete). A custom `stopWhen` predicate is required to replicate this.

Without `ToolLoopAgent` + `stopWhen` (v7+), replicating Ferry's loop on v6 requires:

1. An outer `while` loop checking tool results for a `done` call after each `generateText` invocation
2. Custom handling for commit-and-stop mode (85% budget threshold) that restricts the available tool set
3. Message-history mutation between iterations (budget warnings, cache-breakpoint rotation)

This is functionally equivalent to writing the agent loop from scratch — the AI SDK saves only the HTTP request/response threading, not the application-level logic.

This criterion **fails** for stable v6 (and v7 canary is not acceptable per the issue's own constraints).

### 4. Refiner pilot passes typecheck + lint + tests ⬛

Not implemented. Criteria 2 and 3 both fail, so the adoption decision is negative before implementation.

---

## Cost and Bundle Impact

| Package             | Action             | Approx. size (minified) |
| ------------------- | ------------------ | ----------------------- |
| `ai` (core)         | Add                | ~350 KB                 |
| `@ai-sdk/anthropic` | Add                | ~60 KB                  |
| `@ai-sdk/openai`    | Add                | ~55 KB                  |
| `@ai-sdk/google`    | Add                | ~55 KB                  |
| `openai`            | Remove             | ~500 KB                 |
| `@google/genai`     | Remove             | ~200 KB                 |
| `@anthropic-ai/sdk` | Stays (agent loop) | ~420 KB                 |

Net bundle delta: approximately **+340 KB** (the `ai` core and provider adapters do not fully offset the removed SDKs once `@anthropic-ai/sdk` is retained). The `.ferry/` bundles use esbuild tree-shaking, so actual impact depends on import surface. This is not a blocker on its own but is worth tracking.

---

## Token-Accounting Parity

The AI SDK's `usage` object for Anthropic includes `cacheCreationInputTokens` and `cacheReadInputTokens`, renamed from the raw API's `cache_creation_input_tokens` / `cache_read_input_tokens`. Mapping is one rename away. Parity is achievable with no loss of information.

---

## Decision

**Rejected.** Two of the four mandatory criteria fail:

- **HTTP MCP gap (criterion 2)** is a hard architectural blocker with no acceptable workaround that preserves the current security model.
- **`ToolLoopAgent`/`stopWhen` not stable (criterion 3)** means v6 cannot cleanly express Ferry's `done`-tool termination semantics.

### What this means for #218 / #219

Proceed with the **original plan from #216**: write native OpenAI and Google agent loops, following the same interface as `src/lib/llm/agent-loop/anthropic.ts`. Each loop lives in its own file; the `AgentLoop` interface in `types.ts` is the contract.

The existing `createLlmCall` in `call.ts` (simple single-turn calls for Refiner and cost-governance) already supports all three providers and is not the bottleneck. No changes are needed there.

---

## Re-evaluation Triggers

Re-open this evaluation when **all** of the following are true:

1. `ai` stable (non-canary) ships `ToolLoopAgent` + `stopWhen`.
2. Either (a) Anthropic's HTTP MCP beta is supported by `@ai-sdk/mcp` with a server-side delegation model, **or** (b) no active Ferry consumers use HTTP MCP servers.
3. `@ai-sdk/anthropic` supports `authToken` (OAuth bearer token) for Claude.ai Pro subscriptions, matching the `resolveAnthropicAuth` contract in `src/lib/llm/anthropic-auth.ts`.

---

## Alternatives Not Pursued in This Spike

- **Anthropic Agent SDK** (`@anthropic-ai/sdk/agents`) — already addressed by ADR 0003 (deferred pending prompt-caching + mixed MCP support).
- **LangChain / LlamaIndex** — ADR 0003 rejects these for the same dependency-weight and abstraction-leakage reasons that apply here.
- **Partial adoption (simple calls only)** — The simple call path (`call.ts`) already supports three providers cleanly in ~150 lines across three files. Replacing it with AI SDK adds two large packages (`ai` + three adapters) while retaining `@anthropic-ai/sdk` for the agent loop. The marginal code savings (~40 lines) do not justify the dependency cost.
