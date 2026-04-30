# src/lib — module index

Each module has exactly one responsibility. If you are not sure where to put new code, read the description; if it does not fit, propose a new module rather than stretching an existing one.

| Module | Single responsibility |
|---|---|
| `audit/` | Emit one idempotency-guarded audit comment per run to the configured GitHub issue. |
| `dispatch/` | Phase → workflow routing table, label/mention trigger parsing, per-ticket daily cap, GHA-backed `CIRunner` abstraction, and cancel-in-progress policy assertions. |
| `envelope/` | Validate incoming `repository_dispatch` payloads against the JSON schema and deduplicate by event ID using GitHub issue comments. |
| `errors/` | `FerryError` class (`index.ts`) and error-code → GitHub-label / Jira-comment-template mapping (`taxonomy.ts`). |
| `fingerprint/` | SHA-256 fingerprint reviewer findings by `{file, line_start, line_end, rule_id}` and detect resurgent (oscillating) findings across iterations. |
| `grade/` | Score a code review along four rubric dimensions (substantive, specific, correct, actionable) and compute the `actionable / weak / rubber_stamp` verdict. |
| `io/` | All external I/O: GitHub Octokit helpers, Jira REST client, comment upsert, idempotency-marker string utilities, retry, spend-cap classification, TLDR summarisation, and the tracker abstraction. |
| `llm/` | LLM provider clients (Anthropic, OpenAI, Google), `call` / `budget` / `pricing` helpers, the Anthropic agent loop, and `delimitUntrusted` for LLM prompt injection defence. |
| `preflight/` | Pre-run invariant checks: event freshness / supersession, halt-label detection (`ferry:paused`, `needs-human`), cancel-recovery / stale-state detection, and full preflight (branch + PR + Jira-column alignment). |
| `safety/` | Static safety guards: `no-auto-merge` policy scanner and the gitleaks-based secret scanner (`scan` + `binary` download/cache). |
| `state/` | Atomic read and write of the per-ticket `.ferry/state.json` file with JSON Schema v1 validation on both sides. |
| `ulid/` | Monotonic ULID generation; thin wrapper around the `ulid` package that preserves the module-level monotonic counter for production use. |
