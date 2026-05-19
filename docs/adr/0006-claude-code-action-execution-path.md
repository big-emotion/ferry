# 0006 — claude-code-action as the conditional default execution path

**Status:** Accepted (target architecture — not yet implemented)  
**Date:** 2026-05-19  
**See also:** [0003](./0003-anthropic-messages-vs-agent-sdk.md) (this is a third execution option beyond raw Messages API and Agent SDK), [0004](./0004-idempotency-via-comment-markers.md) (the audit-marker invariant this ADR must preserve), [0005](./0005-no-auto-merge-invariant.md) (the no-auto-merge invariant whose runtime enforcement does **not** automatically extend to this path)

## Context

Ferry's four agents (Refiner, Developer, Reviewer, Iterator) run today via a single execution path: the bundled script `node agent.js run --role <role>`, invoked by the per-agent composite actions, calling the raw provider SDKs through `src/lib/llm/`. This path is multi-provider (Anthropic / OpenAI / Google), has a deterministic agent loop, enforces structured output schemas, validates the `EventEnvelopeV1` payload, emits idempotent fingerprinted audit comments, and is bounded by per-run cost governance.

`anthropics/claude-code-action@v1` already exists in the repository (`.github/workflows/claude.yml`) but only as an unrelated repo-development assistant triggered by `@claude` mentions — it is not part of the pipeline.

Two forces motivate adding it to the pipeline:

1. **A different budget/autonomy profile.** Some tickets — especially those that have already gone through several Refiner/Developer/Reviewer/Iterator round-trips — benefit from letting the LLM act more freely (full Claude Code agent loop with broad tooling) rather than the tightly-scoped deterministic script. This is a deliberately different cost profile.
2. **Lower maintenance for the reasoning core.** The bundled script's value is its _contract_ (envelope, schema, audit, cost), not its agent loop; offloading the loop to a maintained action is attractive when the contract can still be guaranteed.

Hard constraints, established by analysis:

- `claude-code-action` is **Anthropic-only** and an **opaque agent loop**. It cannot itself guarantee `EventEnvelopeV1` validation, structured output schema, fingerprinted audit emission (the Reconciler depends on these — ADR-0004), per-run EUR cost ceiling, or multi-provider routing.
- The Developer sandbox deny-list that enforces the no-auto-merge invariant (ADR-0005) lives in `src/agents/developer/sandbox.ts` and runs **inside the bundled loop**. It does **not** wrap `claude-code-action`'s separate agent loop.
- `claude-code-action@v1` supports an automation mode (explicit `prompt:` input) on arbitrary events, including `repository_dispatch`.

## Decision

Adopt a **two-tier execution model behind one dispatch boundary**:

1. **`claude-code-action` is the conditional default; the bundled script is the conditional fallback.** The default is resolved deterministically from the consumer's configured providers:
   - **Anthropic-only consumer** → `claude-code-action` is the default path for all four agents.
   - **OpenAI or Google configured for any agent** → the bundled script remains the default (the only multi-provider, per-run-EUR-capped path). No silent regression for non-Anthropic consumers.

   The explicit Jira-label override (point 3) takes precedence over this default in **both** cases.

2. **`claude-code-action` replaces only the agent _reasoning core_; the Ferry contract stays in deterministic workflow steps that bracket it.** The four agents' existing prompts are reused verbatim — no prompt rewrite:
   - System prompt = the resolved output of `buildSystem(<role>)` (bundled `prompts/<agent>.md` composed with the consumer's `prompts/<agent>.extra.md` via `src/lib/prompts/resolve.ts`), passed through `claude_args: --append-system-prompt`.
   - Initial prompt = the same `initialPrompt` the script builds today (the `<<<UNTRUSTED>>>` ticket block + `SUBTASKS` / review findings / repo tree), passed via the action's `prompt:` input.

   Per-agent input/output parity (what each agent reads, the exact Jira/GitHub side effects, transitions FR18/FR24/FR28, idempotency markers, and the native-tool ↔ Ferry-tool mapping) is the **parity contract** the wrapping steps must satisfy; it is specified in the implementation epic, not duplicated here. The contract stays in deterministic workflow steps that bracket the action:

   ```
   repository_dispatch
     → step: AJV validate EventEnvelopeV1 (fail-closed)
     → step: compute routing decision (deterministic, from envelope + audit history)
     → claude-code-action  (prompt = injected envelope; Jira via MCP)
     → step: AJV validate structured agent output (fail-closed)
     → step: emit fingerprinted audit comment  [ferry:<role>:<run-id>]
   ```

   Envelope validation, output-schema validation, audit emission, and cost governance are **never delegated to the LLM** — they are non-LLM steps.

3. **Routing policy is deterministic, with an explicit Jira-label override taking precedence over the automatic heuristic.** A workflow step computes the route from the validated envelope (which carries the ticket's Jira labels) plus the audit-comment history (round-trip count). Resolution order, evaluated deterministically:
   1. **Explicit Jira label** — `ferry:claude-code` forces the `claude-code-action` path; `ferry:no-claude-code` forces the bundled script. Names follow Ferry's existing `ferry:`-prefixed label convention and are resolved through the same `resolveTicketOverrides` mechanism as other ticket overrides. Conflicting labels resolve to the safe path (bundled script).
   2. **Automatic heuristic** (only if no explicit label) — escalate to `claude-code-action` when _role ∈ {developer, iterator}_ **AND** _prior Ferry round-trips ≥ N_.
   3. **Conditional default** — per point 1: `claude-code-action` for Anthropic-only consumers, bundled script otherwise.

   The `ferry:claude-code` label still requires the consumer to have the path enabled (Anthropic creds + tool allowlist configured); it _selects_ the path, it does not provision credentials. The explicit label changes routing only — it never overrides the hard invariants: the cost-governance auto-pause (`ferry:paused`) and the no-auto-merge allowlist apply regardless of how the path was chosen. The resolved route **and the reason** (`label` / `heuristic` / `default`) are recorded in the audit comment so the Reconciler observes it.

4. **Cost governance stays at the dispatch/label layer, not inside the action.** `claude-code-action` is bounded crudely by `--max-turns` plus the job `timeout-minutes`; eligibility is gated behind the existing daily cost-governance auto-pause (`ferry:paused` label). The action never receives a per-run EUR cap because it cannot enforce one.

5. **The no-auto-merge invariant (ADR-0005) must be re-established for this path.** Because the bundled sandbox deny-list does not apply, the `claude-code-action` step uses a restricted `--allowedTools` allowlist (no `gh pr merge`, no `git push` to protected refs) and a least-privilege `GITHUB_TOKEN`. This is a precondition of adopting the path, not a follow-up.

6. **The execution path is chosen at install time, and the claude-code path requires `CLAUDE_CODE_OAUTH_TOKEN`.** This supersedes the earlier "reuse `ANTHROPIC_API_KEY` / zero new step" provision.
   - **`ferry-init` offers an explicit path choice.** The wizard asks which execution path to install: **(a) bundled script** (default for non-Anthropic, multi-provider, per-run EUR cap) or **(b) `claude-code-action`** (Anthropic subscription, free agent loop). A consumer can pick either at install time; the choice is recorded in `ferry.config.json` and materialized in the generated workflows. The Jira-label override (point 3) still lets individual tickets switch path afterward.
   - **The claude-code path authenticates _exclusively_ with `CLAUDE_CODE_OAUTH_TOKEN`.** It must **never** use `ANTHROPIC_API_KEY` (`claude_code_oauth_token:` only, never `anthropic_api_key:`). The token is obtained via `claude setup-token` (requires a Claude Pro/Max subscription) and stored as a new repo secret. This is a **required** install element when path (b) is chosen — onboarding is therefore **not** zero-friction for that path.
   - GitHub write access still reuses the existing GitHub App installation token (`github_token:`); Jira still uses the existing `FERRY_JIRA_*` secrets via wrapper steps / MCP. The only new credential is `CLAUDE_CODE_OAUTH_TOKEN`.

7. **The conditional default applies on upgrades too, gated by a version-delta manifest — never a silent flip.** It is not limited to fresh `ferry-init`. `ferry-update` stays **credential-silent for code-only updates** (pre-update credentials keep working); it prompts **only when the crossed `MIGRATIONS.md` `## <from> → <to>` section declares a newly-required secret** (a new declarative `requires-secrets:` line, parallel to the existing `forge:` line), and **only for the ones missing** (diffed against `gh secret list`). For the claude-code transition the entry declares `CLAUDE_CODE_OAUTH_TOKEN`: already set → auto-adopts; missing + interactive → prompts only for that secret then adopts; missing + non-interactive → does not flip, stays on script (zero breakage), prints a mandatory follow-up. An explicit `execution_path: script` is always respected. The path-select branch ships **inert** until the manifest-declared secrets are satisfied. The "never re-prompts for credentials" property is thus **preserved for ordinary updates and merely narrowed**, via a general mechanism reusable by any future release that adds a required secret — not a one-off. Rollback (set `execution_path: script`, re-run `ferry-update`) is symmetric and cannot break a consumer. See [decisions/0002 §G](../decisions/0002-claude-code-path-parity-analysis.md).

See [decisions/0002](../decisions/0002-claude-code-path-parity-analysis.md) for the full install→operate→uninstall reuse/set-aside analysis.

## Consequences

**Positive:**

- Operators gain an explicit, bounded "let the LLM act freely" mode for high-iteration tickets without abandoning Ferry's guarantees on the default path.
- The Ferry contract (envelope, schema, audit, cost) is preserved by deterministic steps regardless of which reasoning core runs — the Reconciler and downstream agents are unaffected.
- The reasoning-core maintenance burden for the opt-in path shifts to a maintained action.
- The execution path is an explicit, recorded install-time choice (script vs claude-code), not an implicit behavior — consumers opt in deliberately and can still switch per-ticket via label.

**Negative:**

- Two execution paths to test and document; the wrapping steps (AJV in/out, audit emission, routing) are new deterministic code that must be unit-tested (TDD) before the path is enabled.
- The `claude-code-action` path is Anthropic-only — which is why the default is _conditional_: it is the default only for Anthropic-only consumers, and the script stays default when OpenAI/Google is configured so multi-provider consumers see no regression.
- ADR-0005 enforcement on this path relies on tool allowlisting + token scoping, which is weaker defense-in-depth than the runtime regex deny-list; a misconfigured allowlist re-opens the auto-merge risk.
- Per-run EUR cost is not enforceable on this path — only coarse turn/time bounds plus the daily auto-pause backstop.
- The claude-code path is not zero-friction: it requires a Claude subscription + `claude setup-token` + a new `CLAUDE_CODE_OAUTH_TOKEN` secret. A fresh consumer must explicitly choose and provision it at install time.
- `ferry-update` gains a manifest-driven credential gate (new `requires-secrets:` line in `MIGRATIONS.md`). This narrows — does not break — the "never re-prompts for credentials" property: silent for code-only updates, prompts only for manifest-declared missing secrets. Non-interactive upgrades still cannot self-adopt the path and require a follow-up interactive run.

## Alternatives Considered

**`claude-code-action` as the unconditional global default** — rejected. It would silently drop multi-provider consumers (Anthropic-only) and remove the per-run EUR ceiling for everyone. **A _conditional_ default was adopted instead**: `claude-code-action` defaults only for Anthropic-only consumers; the script stays default whenever OpenAI/Google is configured, so non-Anthropic consumers keep multi-provider support and the per-run EUR cap with no silent regression.

**Keep the script as the unconditional default (claude-code-action opt-in only)** — superseded by this revision. The original ADR-0006 decision; reversed because for Anthropic-only consumers the maintained-loop + free-action profile is the preferred default, and the conditional rule removes the regression that motivated the original rejection.

**Replace the bundled script entirely** — rejected. This discards the multi-provider loop, the runtime no-auto-merge deny-list (ADR-0005), and per-run cost governance in exchange for one maintained loop — a net loss of guarantees Ferry exists to provide.

**Delegate envelope validation / audit emission to the LLM inside the action's prompt** — rejected. ADR-0004 makes audit markers a load-bearing idempotency mechanism for the Reconciler; an LLM that "usually" emits them produces non-deterministic re-trigger loops. These must be deterministic steps.

**Manual per-ticket selection only (Jira label, no automatic heuristic)** — evaluated, kept as one tier rather than the whole policy. The explicit Jira label is the right primitive for an operator deciding "this specific ticket should run free", and it takes precedence. But a label alone gives no principled answer to _when_ to escalate by default; the automatic heuristic (round-trip count + role) is what makes "let the LLM act freely on already-iterated tickets" a reproducible rule rather than requiring a human to label every ticket. Both tiers are kept, label first.

**Automatic heuristic only (no manual label)** — rejected. Operators need a per-ticket escape hatch in both directions (force claude-code-action, or force the script) without changing global config; the Jira label provides it deterministically and is observable in the ticket itself.
