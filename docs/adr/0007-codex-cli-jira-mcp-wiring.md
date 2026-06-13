# 0007 — Codex CLI execution path uses Ferry-managed Jira MCP wiring

Status: Accepted

Date: 2026-06-13

## Context

Ferry already had routing support for `execution_path: codex-cli`, `ferry:codex-cli`, bundled `*.codex-cli.md` prompts, and `ferry-action-prompt --path codex-cli`. The missing piece was downstream of routing: no generated workflow consumed `path=codex-cli`, so a ticket could opt into the path and then silently run no agent job.

Codex also has no native Jira-label delegation. If Ferry wants Codex to read tickets, create sub-tasks, transition columns, and post fingerprinted audit comments, Ferry must provide that bridge itself.

## Decision

1. Generated consumer workflows include a `run-agent-codex-cli` job for all five roles, gated by `if: needs.route.outputs.path == 'codex-cli'`.
2. The direct Codex invocation is `openai/codex-action`, SHA-pinned in generated workflows.
3. Jira access is provided by Ferry's existing `ferry-jira-mcp` server, declared in a generated `codex-home/config.toml` file produced by the `ferry-codex-config` bin.
4. The generated TOML is secret-free. Jira credentials stay in the workflow job environment via the existing `FERRY_JIRA_*` secrets.
5. `emit-audit` treats Codex like the other direct-action path: job outcome is recorded, token/cost telemetry is emitted as `0`.
6. The Merger has codex-cli parity with the claude-code path: `gh pr merge` is allowed only there, while `gh pr close` remains denied.

## Consequences

- Every route output now has a matching workflow job; `codex-cli` no longer fails by silent skip.
- `ferry-init` and `ferry-doctor` can expose `codex-cli` as a supported execution path instead of a half-wired preview.
- Ferry remains the owner of Jira integration on the Codex path; users should not assume Codex can infer Jira labels or transitions without Ferry's MCP bridge.
