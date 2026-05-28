# Decision 0003 — Codex CLI execution path plan

Date: 2026-05-28
Status: Proposed

## Goal

Add a first-class Ferry execution path backed by `openai/codex-action@v1`, comparable to the existing `anthropics/claude-code-action` path, while preserving the same Jira-driven lifecycle and the same consumer-facing repository-dispatch entry points.

The target consumer experience is:

```json
{
  "execution_path": "codex-cli",
  "models": {
    "refiner": { "provider": "openai", "model": "gpt-5-codex" },
    "dev": { "provider": "openai", "model": "gpt-5-codex" },
    "review": { "provider": "openai", "model": "gpt-5-codex" },
    "iterate": { "provider": "openai", "model": "gpt-5-codex" }
  }
}
```

The consumer should only need the usual Ferry Jira/GitHub settings plus `OPENAI_API_KEY`. The existing `provider: openai` / `execution_path: script` path remains supported and unchanged.

## Current state

Ferry already supports OpenAI API calls inside the bundled script runtime through `provider: openai`. That is not the same as running Codex CLI directly. Today the direct-action path is Anthropic-specific:

- `execution_path` accepts only `script` or `claude-code`.
- The route resolver hard-gates direct action execution to Anthropic-only configs.
- Consumer workflow stubs contain `run-agent` and `run-agent-claude-code` jobs, but no `run-agent-codex-cli` job.
- `ferry-cc-prompt` only resolves `prompts/*.claude-code.md` overrides.
- The Jira MCP server is written for the Claude Code path but can be reused by Codex if Codex MCP configuration is passed correctly.

## Reference: `openai/codex-action@v1`

The official action runs Codex CLI in GitHub Actions and starts a secure Responses API proxy from an OpenAI-compatible key. The important inputs for Ferry are:

- `openai-api-key` — secret for the Responses API proxy.
- `prompt` or `prompt-file` — exactly one prompt source.
- `model` — optional Codex model override.
- `effort` — optional reasoning-effort override.
- `sandbox` — `workspace-write`, `read-only`, or `danger-full-access`; default is `workspace-write`.
- `working-directory` — passed to `codex exec --cd`.
- `codex-args` — extra arguments forwarded to `codex exec`.
- `output-file` and `final-message` — optional final message capture.
- `safety-strategy` — default `drop-sudo`; relevant because later steps in the same job cannot rely on `sudo` after the action runs.

Important operational implications:

- Dependencies that need network access should be installed before the Codex step, because Codex's default sandbox disables direct network access.
- The action can run on Linux/macOS with safety strategies; Windows requires `unsafe`.
- If Ferry needs privileged Jira/GitHub operations, a local MCP server or native tools must be configured intentionally rather than assuming the bundled script runtime is present.

## Non-goals for the first release

- Do not replace the existing OpenAI `script` provider path.
- Do not attempt exact token/cost parity with the script path; direct-action cost remains best-effort unless Codex exposes durable usage metadata.
- Do not allow automatic merges. Ferry's no-auto-merge invariant remains non-negotiable.
- Do not introduce Azure OpenAI as a first-class Ferry path in the first increment, although the design should leave room for `responses-api-endpoint` later.
- Do not support Codex OAuth-only authentication in GitHub Actions; use `OPENAI_API_KEY` first.

## Design principles

1. **Make the path explicit.** Use a distinct `execution_path: "codex-cli"` value and distinct labels so users can tell OpenAI API-in-script from Codex CLI-in-action.
2. **Keep routing deterministic.** The route action should continue to emit a single `path` and `reason`; provider gates must fail closed to `script`.
3. **Reuse Ferry contracts.** The Codex path should reuse the existing envelope, audit issue, Jira MCP server, transition IDs, prompt placeholder model, and no-auto-merge doctrine.
4. **Prefer prompt parity over runtime parity.** As with Claude Code, Codex direct action has no Ferry wrapper applying structured JSON; role-specific prompts must encode responsibilities clearly.
5. **Make unsupported states loud.** `ferry-doctor` should detect missing OpenAI keys, incompatible provider/path combinations, missing prompts, and unsupported runners before a consumer discovers the failure mid-run.

## Proposed architecture

### Configuration

Extend the config model:

```ts
export type ExecutionPath = 'script' | 'claude-code' | 'codex-cli';
```

Add routing labels:

- `ferry:codex-cli` — request Codex direct-action path.
- `ferry:no-codex-cli` — force bundled script for the ticket.

Conflict handling should fail closed:

- `ferry:codex-cli` + `ferry:no-codex-cli` => `script` with a warning.
- Multiple direct-action labels, such as `ferry:claude-code` + `ferry:codex-cli`, => `script` with a warning until a precedence policy is explicitly accepted.

Provider gates:

- `claude-code` remains Anthropic-only.
- `codex-cli` is available only when the selected role uses `provider: openai`.
- For the first increment, prefer an OpenAI-only direct-action config for `execution_path: "codex-cli"`. Per-role mixed configs can follow later once the route output can safely express role-local gates and docs explain mixed direct-action semantics.

Suggested defaulting:

- Leave today's default unchanged: unset `execution_path` keeps the current conditional behavior.
- Do not auto-default OpenAI-only repos to Codex CLI in the first release. Require explicit config or label until the path has enough production burn-in.

Optional future config, not required for MVP:

```json
{
  "codex": {
    "sandbox": "workspace-write",
    "safety_strategy": "drop-sudo",
    "effort": "medium",
    "codex_version": ""
  }
}
```

### Prompt system

Generalize `ferry-cc-prompt` rather than duplicating logic blindly:

- New command: `ferry-action-prompt --path <claude-code|codex-cli> --agent <refiner|dev|review|iterate> ...`
- Keep `ferry-cc-prompt` as a backwards-compatible alias.
- Codex override files:
  - `prompts/refiner.codex-cli.md`
  - `prompts/dev.codex-cli.md`
  - `prompts/review.codex-cli.md`
  - `prompts/iterate.codex-cli.md`

The Codex prompts should mirror Claude Code's role contracts but adapt tool wording:

- The agent runs as a direct `openai/codex-action` invocation.
- It must use native git/`gh` where available for branch/PR work.
- It must use the configured Jira MCP server for Jira reads, transitions, and comments.
- It must post exactly one fingerprinted Jira audit comment.
- It must never merge or close PRs.
- It must not modify `.github/`, `.ferry/`, or lockfiles unless the ticket explicitly demands it and the role prompt allows it.

### Workflow jobs

Each consumer workflow should have three mutually exclusive execution jobs:

- `run-agent` for bundled script.
- `run-agent-claude-code` for Anthropic direct action.
- `run-agent-codex-cli` for OpenAI Codex direct action.

The Codex job should run after checkout and any dependency bootstrap. A developer job sketch:

```yaml
run-agent-codex-cli:
  name: Run Developer agent (codex-cli path)
  needs: [route]
  if: needs.route.outputs.path == 'codex-cli'
  runs-on: ${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
  permissions:
    contents: write
    pull-requests: write
    issues: read
  steps:
    - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
    - name: Resolve agent prompt
      id: prompt
      run: >-
        npx -y -p @big-emotion/ferry@vNEXT ferry-action-prompt
        --path codex-cli
        --agent dev
        --ticket-key "${{ github.event.client_payload.ticket_key }}"
        --run-id "${{ github.event.client_payload.event_id }}"
        --review-transition-id "${{ secrets.FERRY_REVIEW_TRANSITION_ID }}"
    - name: Run Codex
      id: codex
      uses: openai/codex-action@v1
      with:
        openai-api-key: ${{ secrets.OPENAI_API_KEY }}
        prompt: ${{ steps.prompt.outputs.prompt }}
        model: ${{ vars.FERRY_DEV_MODEL || 'gpt-5-codex' }}
        effort: ${{ vars.FERRY_CODEX_EFFORT || '' }}
        sandbox: ${{ vars.FERRY_CODEX_SANDBOX || 'workspace-write' }}
        safety-strategy: ${{ vars.FERRY_CODEX_SAFETY_STRATEGY || 'drop-sudo' }}
        codex-args: >-
          ["--config", "mcp_servers.jira.command=\"npx\"", "--config", "mcp_servers.jira.args=[\"-y\",\"-p\",\"@big-emotion/ferry@vNEXT\",\"ferry-jira-mcp\"]"]
```

The MCP configuration syntax must be proven against the Codex CLI version used by `openai/codex-action@v1` before finalizing the workflow. If inline `codex-args` TOML overrides are too brittle, create a checked-in or generated `codex-home/config.toml` before the action step and pass `codex-home`.

### Audit and cost reporting

The existing `emit-audit` jobs can be extended to depend on `run-agent-codex-cli` and choose the non-skipped result. Direct-action cost fields remain `0` until Codex exposes reliable token/cost outputs that Ferry can consume.

The route action should emit audit text like:

```text
[ferry:dev:<run-id>] execution-path: codex-cli (reason: label)
```

### Doctor and init

`ferry-init` should:

- Offer `script`, `claude-code`, and `codex-cli` execution paths.
- Stop asking for `ANTHROPIC_API_KEY` when the selected model providers and execution path do not require it.
- Ask for `OPENAI_API_KEY` when any provider is OpenAI or when `execution_path` is `codex-cli`.
- Generate workflow stubs with the Codex job and documented variables.

`ferry-doctor` should validate:

- `execution_path: "codex-cli"` requires OpenAI providers for supported roles.
- `OPENAI_API_KEY` exists in env or repo secrets.
- `ANTHROPIC_API_KEY` is not treated as globally required for OpenAI-only repos.
- Codex prompt override files are non-empty when present.
- The selected runner and `FERRY_CODEX_SAFETY_STRATEGY` are compatible.
- The no-auto-merge protections remain documented and branch protection is recommended.

### Test strategy

Unit tests:

- Config parser accepts `codex-cli` and rejects unknown values.
- Route resolver handles Codex label, no-Codex label, direct-action label conflicts, OpenAI provider gate, hard `script` lock, and audit formatting.
- Prompt resolver loads bundled Codex prompts and consumer overrides.
- CLI parser supports `--path codex-cli` and keeps `ferry-cc-prompt` compatibility.
- Doctor checks key requirements for OpenAI-only script and Codex direct-action repos.

Workflow/static tests:

- Generated templates contain `run-agent-codex-cli` for all four agents.
- `emit-audit` jobs include Codex results in their `needs` and outcome expressions.
- Bundled `.ferry` and `.github/actions` output is regenerated and clean.

Integration smoke tests:

- Dry-run route with `execution_path: "codex-cli"` and OpenAI-only config emits `path=codex-cli`.
- A small fixture repo exercises prompt resolution and validates the Codex job YAML shape.
- Optional manual canary: a consumer repo with one tiny Jira Story and `OPENAI_API_KEY` verifies branch creation, PR creation, Jira transition, and one audit comment.

## Rollout plan

### Phase 0 — Alignment and issue breakdown

Create the implementation backlog below and verify `openai/codex-action@v1` inputs against the current upstream README/action metadata before coding workflow details.

### Phase 1 — Config and routing foundation

1. Extend `ExecutionPath` to include `codex-cli`.
2. Add label override parsing for `ferry:codex-cli` and `ferry:no-codex-cli`.
3. Add provider-gate logic for Codex.
4. Update audit formatting and tests.
5. Document the new path as experimental/direct-action.

Exit criteria: route action can deterministically choose `script`, `claude-code`, or `codex-cli` with failing-closed conflicts.

### Phase 2 — Prompt infrastructure

1. Introduce generic direct-action prompt resolution.
2. Add bundled `*.codex-cli.md` prompts.
3. Keep `ferry-cc-prompt` backwards-compatible.
4. Add tests for overrides, placeholders, empty prompt rejection, and GitHub multiline output.

Exit criteria: every role can produce a Codex-ready prompt with the same runtime tokens used by the Claude Code prompts.

### Phase 3 — Consumer workflow stubs

1. Add `run-agent-codex-cli` to refiner, developer, reviewer, and iterator templates.
2. Wire `OPENAI_API_KEY`, model, sandbox, effort, safety strategy, and Jira MCP config.
3. Extend audit jobs to include the Codex job.
4. Regenerate committed bundled actions/templates if required by Ferry's release process.

Exit criteria: generated consumer workflows are syntactically valid and route to exactly one execution job.

### Phase 4 — CLI onboarding and doctor

1. Update `ferry-init` questions and generated secrets.
2. Fix OpenAI-only onboarding so Anthropic is not required unless Anthropic is actually used.
3. Add Codex path doctor checks.
4. Update docs, runbook, migration notes, and examples.

Exit criteria: a new OpenAI-only consumer can install Ferry without Anthropic credentials and receives actionable doctor output.

### Phase 5 — Hardening and canary

1. Run unit, typecheck, lint, bundle checks, and workflow smoke tests.
2. Run a canary consumer ticket through Developer and Reviewer on Codex CLI.
3. Record accepted divergences from script and Claude Code paths.
4. Decide whether to keep `codex-cli` opt-in or allow OpenAI-only conditional default in a later release.

Exit criteria: a documented canary proves PR creation, Jira transition, audit comment idempotency, and no auto-merge behavior.

## Proposed GitHub issues

### Issue 1 — Add `codex-cli` execution path to config and routing

Labels: `enhancement`, `codex-cli`, `routing`

Body:

```markdown
## Goal

Add a third Ferry execution path, `codex-cli`, for direct `openai/codex-action@v1` runs while keeping `script` and `claude-code` behavior unchanged.

## Scope

- Extend `ExecutionPath` to `script | claude-code | codex-cli`.
- Accept `execution_path: "codex-cli"` in config parsing/validation.
- Add Jira labels `ferry:codex-cli` and `ferry:no-codex-cli`.
- Fail closed to `script` on conflicting direct-action labels.
- Gate `codex-cli` to OpenAI-supported role configs.
- Emit route audit lines with `execution-path: codex-cli`.

## Acceptance criteria

- Unit tests cover explicit config, labels, conflicts, provider gates, and hard `script` lock.
- Existing Claude Code routing tests still pass unchanged or with intentional fixture updates.
- Docs identify `codex-cli` as explicit opt-in for the first release.
```

### Issue 2 — Add Codex prompt resolver and bundled role prompts

Labels: `enhancement`, `codex-cli`, `prompts`

Body:

```markdown
## Goal

Provide Codex-specific prompts for all Ferry roles and a generic prompt CLI that can serve both Claude Code and Codex direct-action paths.

## Scope

- Add `prompts/refiner.codex-cli.md`, `prompts/dev.codex-cli.md`, `prompts/review.codex-cli.md`, and `prompts/iterate.codex-cli.md`.
- Add `ferry-action-prompt --path <claude-code|codex-cli>`.
- Preserve `ferry-cc-prompt` as a backwards-compatible alias.
- Support consumer overrides under `prompts/*.codex-cli.md`.
- Keep placeholder substitution and multiline `$GITHUB_OUTPUT` behavior.

## Acceptance criteria

- Empty override prompts fail loudly.
- Tests cover bundled prompts, overrides, placeholder validation, and alias compatibility.
- Codex prompts include Jira MCP usage, idempotent audit comments, no merge/close rules, and role-specific transitions.
```

### Issue 3 — Wire `openai/codex-action@v1` into consumer workflow templates

Labels: `enhancement`, `codex-cli`, `github-actions`

Body:

```markdown
## Goal

Add a `run-agent-codex-cli` job to all generated consumer workflows.

## Scope

- Update refiner, developer, reviewer, and iterator workflow templates.
- Pass `OPENAI_API_KEY` through `openai-api-key`.
- Pass prompt, model, effort, sandbox, safety strategy, and Codex MCP configuration.
- Extend `emit-audit` jobs to include Codex job results.
- Document any pre-agent dependency install requirements because Codex sandboxed runs should not assume network access.

## Acceptance criteria

- Exactly one of script, Claude Code, or Codex jobs runs for a route decision.
- Workflow YAML validates in tests/fixtures.
- Direct-action costs remain documented as best-effort/zero until usage metadata exists.
- The workflow does not grant merge permissions or include merge/close commands.
```

### Issue 4 — Update `ferry-init` and `ferry-doctor` for OpenAI-only and Codex CLI installs

Labels: `enhancement`, `codex-cli`, `cli`, `doctor`

Body:

```markdown
## Goal

Make onboarding clean for OpenAI-only consumers and for consumers choosing the Codex direct-action path.

## Scope

- `ferry-init` offers `script`, `claude-code`, and `codex-cli`.
- `ferry-init` asks for Anthropic only when Anthropic is actually required.
- `ferry-init` asks for OpenAI when any OpenAI provider or Codex path is selected.
- `ferry-doctor` no longer treats Anthropic as globally required.
- `ferry-doctor` validates Codex path provider alignment, `OPENAI_API_KEY`, prompt overrides, and runner/safety-strategy compatibility.

## Acceptance criteria

- OpenAI-only script config passes doctor with `OPENAI_API_KEY` and no Anthropic key.
- Codex CLI config fails doctor with actionable remediation when `OPENAI_API_KEY` is missing.
- Claude Code token-exclusivity checks remain intact.
```

### Issue 5 — Document Codex CLI execution path, security model, and rollout canary

Labels: `documentation`, `codex-cli`, `security`

Body:

```markdown
## Goal

Document how the Codex direct-action path works, where it differs from the bundled script and Claude Code paths, and how to canary it safely.

## Scope

- Update configuration reference, install guide, runbook, and overview.
- Explain `execution_path: "codex-cli"`, labels, required secrets, variables, and prompt overrides.
- Document `openai/codex-action@v1` safety strategy and sandbox implications.
- Document no-auto-merge requirements and branch protection expectations.
- Add a manual canary checklist for one small Jira Story.

## Acceptance criteria

- Docs clearly distinguish OpenAI provider in `script` from Codex CLI direct action.
- Canary checklist covers branch creation, PR creation, Jira transition, one audit comment, and no merge.
- Accepted divergences from script/Claude Code paths are explicit.
```

## Open questions

1. What exact Codex CLI MCP configuration syntax should Ferry use inside `openai/codex-action@v1`: inline `codex-args` overrides or a generated `codex-home/config.toml`?
2. Should `codex-cli` support mixed-provider configs per role in the first release, or require OpenAI-only configs for simpler operator expectations?
3. Should Reviewer use `sandbox: read-only` by default while Developer/Iterator use `workspace-write`?
4. Should Ferry expose `responses-api-endpoint` immediately for Azure OpenAI, or defer it to a separate issue?
5. Can Codex final output or future telemetry provide enough usage metadata for non-zero audit cost fields?
