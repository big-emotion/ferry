# MCP Catalog Research (Phase 0 of #319)

Read-only reconnaissance to confirm whether each of the four MCP servers
targeted by epic #319 ships an **official HTTP/SSE remote endpoint** that
works from a **headless GitHub Actions runner** (no browser, no human
interaction, no Figma Desktop app, no persistent OAuth session).

This document is short-lived: it should be folded into `docs/CONFIGURATION.md`
or deleted once Phases 1–4 ship.

## Summary

| Server | Remote HTTP | Headless auth | Verdict for Ferry HTTP-only path |
|---|---|---|---|
| **GitHub** | ✅ `https://api.githubcopilot.com/mcp/` | ✅ PAT bearer | ✅ Ship in Phase 1 |
| **Atlassian** | ✅ `https://mcp.atlassian.com/v1/mcp` | ✅ API token (M2M) or OAuth 2.1 | ✅ Ship in Phase 1 |
| **Figma** | ✅ `https://mcp.figma.com/mcp` | ❌ OAuth-only, `mcp:connect` scope restricted to whitelisted clients | ❌ Blocked — needs decision |
| **Prismic** | ❌ None published | n/a (stdio only via `npx @prismicio/mcp-server`) | ❌ Blocked — needs decision |

## Server-by-server findings

### GitHub MCP

- **Endpoint**: `https://api.githubcopilot.com/mcp/`
- **Transport**: HTTP (streamable)
- **Auth**: OAuth 2.1 (interactive, default) **or** PAT via
  `Authorization: Bearer <PAT>` header (headless-friendly)
- **Scopes**: granted by the PAT itself; subject to org PAT restrictions
- **Tool surface**: large (issues, PRs, repos, code search, Actions, Copilot
  knowledge); split into toolsets so consumers can scope down via
  `?toolsets=...` query params
- **Headless readiness**: ✅ confirmed. Standard pattern is a fine-grained
  PAT stored as a repo secret.

Sources:
- <https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server>
- <https://github.com/github/github-mcp-server>

### Atlassian (Rovo) MCP

- **Endpoint**: `https://mcp.atlassian.com/v1/mcp`
  (note: `https://mcp.atlassian.com/v1/sse` is **deprecated**, support ends
  30 June 2026 — do not use)
- **Transport**: HTTP (streamable)
- **Auth**:
  - OAuth 2.1 bearer (interactive flow), **or**
  - **API token** authentication (machine-to-machine, no consent screen) —
    designed precisely for headless / CI use cases
- **Scope**: Jira, Confluence, Compass on the connected Atlassian Cloud site
- **Headless readiness**: ✅ confirmed. Use API token, store as secret.

Sources:
- <https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/>
- <https://community.atlassian.com/forums/Atlassian-Remote-MCP-Server/Announcing-authentication-via-API-token-for-Atlassian-Rovo-MCP/ba-p/3197014>

### Figma MCP

- **Endpoint**: `https://mcp.figma.com/mcp` (exists, GA)
- **Transport**: HTTP
- **Auth**: **OAuth-only**, scope `mcp:connect`
  - Personal access tokens are **explicitly rejected** by the endpoint
  - The `mcp:connect` scope is **not available to general third-party OAuth
    apps** — Figma whitelists specific MCP clients (VS Code, Cursor,
    Claude Code, OpenAI Codex)
- **Headless readiness**: ❌ blocked for a custom integration like Ferry
  - No service-account / API-token path today
  - The local stdio alternative requires the Figma Desktop app, which is
    not installable on a GitHub Actions runner
- **Status**: requested feature on the Figma forum; no ETA

Sources:
- <https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/>
- <https://forum.figma.com/ask-the-community-7/support-for-pat-personal-access-token-based-auth-in-figma-remote-mcp-47465>
- <https://forum.figma.com/ask-the-community-7/oauth-less-access-to-figma-mcp-tools-47774>

### Prismic MCP

- **Endpoint**: none — there is no hosted Prismic MCP server
- **Transport**: stdio only (`npx -y @prismicio/mcp-server@latest`)
- **Auth**: handled by the local subprocess against the Prismic API
- **Headless readiness**: stdio in a GHA runner is **technically possible**
  (Node is available; `npx` spawns the package), but violates the epic
  decision to ship HTTP-only

Sources:
- <https://github.com/prismicio/prismic-mcp-server>
- <https://prismic.io/docs/ai>

## Decision gate (per Phase 0 acceptance)

Two servers fail the HTTP-only constraint. The epic must pick one path
per blocked server:

### Figma

- **A. Defer** — drop Figma from epic #319; reopen when Figma ships either
  PAT auth or a `mcp:connect` scope open to third-party OAuth apps.
- **B. Stdio exception** — would require the Figma Desktop app, which is
  **not viable in GHA runners**. Effectively the same as deferring for
  Ferry's runtime, even if local dev could use it.
- **C. Build a thin token-broker** — host a small service that performs
  the OAuth dance once and proxies requests with the resulting bearer.
  Significant new infra; out of scope for this epic.

**Recommendation: A (defer Figma).** Track in a new follow-up issue.

### Prismic

- **A. Defer** — drop Prismic from epic #319 until an HTTP endpoint
  exists.
- **B. Stdio exception** — add `stdio` transport support to the catalog
  for Prismic only. Ferry's `src/lib/mcp/pool.ts` already supports stdio;
  the agent-loop already wires it. The Phase 1 catalog grows by one
  branch (HTTP vs stdio). Runner needs Node (already there). Subprocess
  per agent run, started cold, killed on exit.
- **C. Build a thin Prismic→MCP HTTP wrapper** — net-new code, out of
  scope.

**Recommendation: B (stdio exception for Prismic).** Cheap, isolated to
the catalog file, no architectural change. Prismic is the only server
needing this in the foreseeable future, so the special case stays small.

## Net effect on the epic

If the recommendations above are accepted:

- Phase 1 catalog ships **3 servers**: GitHub (HTTP), Atlassian (HTTP),
  Prismic (stdio).
- Figma moves to a follow-up issue gated on upstream Figma support.
- Phases 2–4 are unaffected in scope; they wire whatever the catalog
  exposes.
- The "HTTP/SSE only" epic constraint becomes "HTTP/SSE preferred,
  stdio only when no remote exists" — documented in the catalog
  module.
