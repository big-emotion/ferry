# Local Runner

`ferry-local` runs a single Ferry phase on the operator's machine from a Jira status transition, without using a GitHub Actions runner.

## Scope

- Reuses the existing `ferry-agent` runtime and prompt stack.
- Reuses GitHub and Jira credentials already required by Ferry.
- Isolates each ticket in `.ferry-local/worktrees/<KEY>` on branch `ferry/<KEY>`.
- Refuses the `merge` phase locally to preserve the ADR-0005 boundary.

## Commands

```bash
npm run ferry-local -- poll --once
npm run ferry-local -- poll --dry-run --once
npm run ferry-local -- serve --port 8787
```

Published installs expose the same entrypoint as:

```bash
ferry-local poll --once
ferry-local serve --port 8787
```

## Required environment

Polling and webhook execution both require the normal Jira credentials:

- `FERRY_JIRA_BASE_URL`
- `FERRY_JIRA_EMAIL`
- `FERRY_JIRA_API_TOKEN`

Webhook mode additionally requires:

- `FERRY_LOCAL_WEBHOOK_SECRET`

The local phase run also needs the same provider and forge credentials that `ferry-agent` needs for the selected phase, such as `GITHUB_TOKEN` and your LLM provider key.

## Status Mapping

`ferry-local` maps Jira statuses from `ferry.config.*`:

- `workflow.agents.refiner.trigger_column` → `refine`
- `workflow.agents.developer.trigger_column` → `dev`
- `workflow.agents.reviewer.trigger_column` → `review`
- `workflow.agents.iterator.trigger_column` → `iterate`
- `Ready to Merge` → refused locally

## Polling

`ferry-local poll` searches Jira for tickets in the configured Ferry workflow columns and processes each match once per observed event id. The event id defaults to `<updated-millis>-<ticket-key>`, which keeps retries idempotent while allowing later transitions to produce a new run.

Use `--once` for cron-driven execution. Without `--once`, the process polls every 30 seconds by default. Override with `FERRY_LOCAL_POLL_INTERVAL_MS`.

## Webhooks

`ferry-local serve` listens for `POST` requests and expects `X-LF-Token` to match `FERRY_LOCAL_WEBHOOK_SECRET`.

Supported payloads:

```json
{
  "issue": {
    "key": "CHAN-1",
    "fields": {
      "status": { "name": "In Development" },
      "updated": "2026-06-13T09:10:11.000Z"
    }
  }
}
```

Or the simplified equivalent:

```json
{
  "ticket_key": "CHAN-1",
  "status": "In Development",
  "ts": "2026-06-13T09:10:11.000Z"
}
```

## Dry run

`--dry-run` prints:

- The synthesized envelope
- The resolved branch
- The resolved worktree path
- The `ferry-agent` command that would run

No git worktree mutation or agent process is started in dry-run mode.

## Security model

- The webhook secret is mandatory for `serve`.
- Secrets are read from env and are never logged by the local runner.
- Each ticket runs in its own worktree to avoid shared working-tree mutation.
- The local runner does not introduce a merge backdoor: `merge` is rejected before invocation.
