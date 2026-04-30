# src/lib — module index

Each module has exactly one responsibility. If you are not sure where to put new code, read the description; if it does not fit, propose a new module rather than stretching an existing one.

| Module | Single responsibility |
|---|---|
| `agent-runtime/` | Shared shell for agent entrypoints: env loading, prompt assembly, git checkpointing, secret-scan wiring, GitHub context bootstrap. |
| `audit/` | Emit one idempotency-guarded audit comment per run to the configured GitHub issue. |
| `dispatch/` | Phase → workflow routing table, GHA-backed `CIRunner` abstraction, dry-run helpers, cancel-in-progress policy assertions, and the task-skip composite-action entrypoint. |
| `envelope/` | Validate incoming `repository_dispatch` payloads against the JSON schema. |
| `errors/` | `FerryError` class and structured error codes. |
| `io/` | All external I/O: GitHub Octokit helpers, Jira REST client, comment upsert, idempotency-marker string utilities, retry, spend-cap classification, TLDR summarisation, and the tracker abstraction. |
| `labels/` | Resolve ticket labels against `ferry.config` to derive MCP servers and tool allowlists per run. |
| `llm/` | LLM provider clients (Anthropic, OpenAI, Google), `call` / `pricing` helpers, the Anthropic agent loop, and `delimitUntrusted` for prompt injection defence. |
| `mcp/` | MCP server bootstrap helpers (composing pool, secret expansion). |
| `prompts/` | Resolve prompt paths from the bundled action directory or the local repo, plus optional project-context snippet loading. |
| `safety/` | Gitleaks-based secret scanner (`scanWithGitleaks`). |
