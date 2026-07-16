---
name: ferry-audit
description: Production-readiness audit for the Ferry project. Read-only multi-axis assessment that answers four questions — is it production-ready, can a consumer install and run the full Jira→PR→merge cycle, what is the security posture, and is the score close to 8–9/10. Use when the user asks "is Ferry ready", "audit Ferry", "production-readiness check", or invokes /ferry-audit.
metadata:
  author: jnk
  version: '1.3.0'
---

# Ferry Audit

Read-only audit of the Ferry project. Produces a scored, evidence-based report and refreshes `docs/PRODUCTION-READINESS-AUDIT.md`.

This skill **never** modifies source, never bumps versions, never tags, never pushes. It only reads and writes the audit doc.

## When to Activate

- User asks: "is Ferry production-ready", "audit Ferry", "score the project", "is the project ready to ship".
- User asks specifically about consumer install flow viability, security posture, or overall score.
- User invokes `/ferry-audit`.

## Preconditions

Run from the Ferry repo root (`package.json` with `"name": "@big-emotion/ferry"`). If not, stop and tell the user to `cd` into the repo.

## Inputs

Optional argument: `--quick` (skip running the full test suite and coverage; rely on most recent CI run instead).

Default: full audit.

## Workflow

### Step 1 — Snapshot the repo state

Run in parallel via Bash:

- `git status --porcelain` — flag uncommitted changes (audit a dirty tree is fine but report it).
- `git log --oneline -20` — recent commit cadence.
- `git tag --sort=-creatordate | head -10` — release tags (expect immutable `v0.x.y` tags plus the floating `v1`).
- `jq '{name, version, bin}' package.json` — version, bin entries (the consumer CLI surface).
- `ls .github/workflows/ .github/actions/` — workflow surface. Expected workflows: `ferry-ci.yml`, `codeql.yml`, `release.yml`, `claude.yml`, `claude-code-review.yml`. The agent dispatch workflows live in `examples/consumer-setup/workflows/`, **not** here — flag any doc that claims otherwise.
- `ls docs/ prompts/ src/agents/ src/lib/ src/cli/ examples/consumer-setup/workflows/` — structural map.

### Step 2 — Read the existing audit (if present)

Read `docs/PRODUCTION-READINESS-AUDIT.md` if it exists. Keep its scoring rubric and section ordering — this skill **updates** that file rather than replacing the format.

The canonical structure is:

1. Scope and method
2. Overall score (X / 10) — one-line verdict
3. Score per domain (table, 10 domains)
4. Strengths (bulleted)
5. Gaps and risks (per domain, with evidence)
6. Consumer install flow — end-to-end verdict
7. Security posture — dedicated section
8. Prioritized action list (15 max, each tied to an FR or issue)
9. Conclusion

### Step 3 — Gather evidence

Run these in parallel (skip any that fail and note it in the report):

- `npm run typecheck` — compile gate.
- `npm run lint` — lint gate.
- `npm run format:check` — formatting gate.
- `npm test -- --reporter=basic` (or `--quick` → skip and report last CI run instead).
- `npm run check:fr-drift` — every `FR\d+` tag in `src/`, `prompts/`, `docs/` has a registry entry in `docs/REQUIREMENTS.md`.
- `npm run check:bundle` — committed `.ferry/` bundles match `src/` (drift here means consumers execute stale code).
- `npm run audit:ci` — dependency CVE gate (same command release.yml runs).
- `git grep -nE "TODO|FIXME|XXX|HACK" src/ | wc -l` — code debt heuristic.
- `gh run list --limit 5 --workflow=ferry-ci.yml --json status,conclusion,name 2>/dev/null` — recent CI health (best-effort, skip if `gh` not authed).

For security, also check:

- `.gitleaks.toml` exists and is referenced in CI.
- `.github/workflows/codeql.yml` exists.
- Composite actions in `.github/actions/*/action.yml` — pin third-party actions by SHA, not `@main` or `@v1`.
- `src/schemas/event.v1.schema.json` validated in strict AJV mode.
- `src/agents/**` — confirm no direct `@octokit/rest` or Jira imports (`git grep -n "@octokit/rest\|io/tracker" src/agents/ | grep -v test`).
- `package.json` `dependencies` — any pinned to git refs or local paths (red flag).

For **release-tag consistency** (every consumer pulls from these same refs, so any drift is a broken install or a stale CI guard):

- Determine the canonical Ferry tag from `package.json` `.version` → expect `@v<version>` everywhere consumers reach.
- `git grep -nE "big-emotion/ferry/[^@]+@(main|v[0-9.]+)|@big-emotion/ferry@v[0-9.]+" examples/consumer-setup/workflows/` — every Ferry self-reference in the 5 agent stubs should pin to the same tag (both `uses:` lines and the `npx -p @big-emotion/ferry@v…` invocations, including inside `--mcp-config` JSON). Flag every line that:
  - uses `@main` (mutable; supply-chain risk on every consumer install);
  - uses a tag that disagrees with `package.json` `.version` (drift);
  - uses a tag that does not exist in `git tag --list` (broken consumer install).
- `git grep -nE "FERRY_REF:\s*v[0-9.]+" examples/consumer-setup/workflows/` — the 2 ops stubs must match the same tag.
- `git grep -nE "@v[0-9.]+|tags/v[0-9.]+" docs/INSTALL.md docs/RELEASING.md docs/CONFIGURATION.md` — doc references must match.
- Structural tests — the CI gates that hardcode the tag: `src/install-guide.test.ts`, `src/cli/init/templates.test.ts`, `src/cli/doctor/checks/{claude-code-path,codex-cli-path}.test.ts`, `src/lib/codex/config-toml.test.ts`. Confirm they exist AND pass (`npx vitest run <files>`). A passing test that the codebase has drifted past (test asserts an older tag than `package.json`) is a stale guard — flag it.
- Floating tag: `git rev-parse v1 v<version>` — `v1` should point at the same commit as the latest release tag (release.yml retags it via `scripts/retag-major.sh`). A lagging `v1` silently serves old code to `@v1` consumers.

Report the result as a small consistency table:

```
| Location                                                        | Pin       | Status     |
| --------------------------------------------------------------- | --------- | ---------- |
| package.json .version                                           | 0.17.0    | canonical  |
| examples/…/ferry-{refine,dev,review,iterate,merge}.yml (uses:)  | @v0.17.0  | match      |
| examples/…/ferry-*.yml (npx @big-emotion/ferry@v…)              | @v0.17.0  | match      |
| examples/…/ferry-{reconcile,cost-daily}.yml (FERRY_REF)         | v0.17.0   | match      |
| docs/{INSTALL,RELEASING,CONFIGURATION}.md                       | @v0.17.0  | match      |
| structural tests (install-guide, templates, doctor, codex)      | @v0.17.0  | match      |
| git tag --list                                                  | v0.17.0   | exists     |
| floating v1 == v0.17.0                                          | same SHA  | match      |
```

Any row with `MISSING`, `drift`, or `@main` is a P0 supply-chain finding for the Release domain.

### Step 3.5 — Hardcoded values scan (`src/**`)

Ferry's contract is that consumers can tune behavior via env vars / config without forking. Magic numbers and default function parameters embedded in `src/**` are silent coupling — every untunable knob is a future support ticket. Scan and score.

**Scope:** `src/**/*.ts` only. Exclude `*.test.ts`, `__fixtures__/`, `__lint-fixtures__/`, `src/schemas/*.json`.

**What to flag:**

1. **Magic numbers** in runtime logic — timeouts, retries, max attempts, byte/char limits, token caps, thresholds (e.g. spend %), batch sizes, polling intervals, durations (`* 1000`, `* 60`), truncation lengths (`slice(0, N)`, `substring(0, N)`), comparison constants (`if (x > N)`).
2. **Default function parameters** — `function foo(x = 30)`, `(x: number = 100)`, and literal-RHS coalescing like `opts.timeout ?? 30000`.

**Skip:** `0`/`1`/`-1`/`2` used as indices/exit codes/booleans; HTTP status codes; loop counters; math identities; numbers inside log-message templates that are just text.

**Categories** (use these exact buckets in the report):

- Timeouts / Durations
- Retry & Backoff
- Size & Truncation Limits
- Token & LLM Caps
- Cost & Budget Thresholds
- Polling & Batch Sizes
- Scoring & Heuristic Thresholds
- Default Parameters

**Severity:**

- **P0** — must externalize. Affects production behavior, cost, or differs per deployment (LLM retry config, spend %, request timeouts, output-size caps that throttle agents).
- **P1** — should externalize. Likely tuned per consumer (bash/grep timeouts, batch caps, loop iteration caps, file-size limits, default `max_tokens`).
- **P2** — acceptable as-is. Internal tuning constant unlikely to change (jitter ratio, log-truncation hints, doctor recommendation ceilings).

**How to scan:**

```
grep -nE '\b[0-9]{3,}\b' src/**/*.ts | grep -vE '\.test\.|__fixtures__|__lint-fixtures__'
grep -nE '= [0-9]+[,)]|\?\? [0-9]+|\|\| [0-9]+' src/**/*.ts
grep -nE 'setTimeout|slice\(0,|substring\(0,|\.length > [0-9]' src/**/*.ts
```

Read each suspect file to confirm the hit is real (not a string literal, not a comment), capture the line number, and bucket by category + severity.

**Output:** flat markdown list grouped by category, P0 first within each group. Each line: `**Pn** path:line — value — one-line description`.

**Score impact** — feed this into Domain 5 (Architecture) and Domain 8 (Consumer DX):

- 0 P0 / ≤ 5 P1 → no penalty.
- 1–3 P0 or 6–15 P1 → −1 on Domain 5 and Domain 8.
- ≥ 4 P0 or > 15 P1 → −2 on Domain 5 and Domain 8.

Include the hardcoded-values report verbatim under section 5 ("Gaps and risks") of `docs/PRODUCTION-READINESS-AUDIT.md`, in a subsection titled **"Hardcoded values (P0/P1)"**. Only list P0 + P1 in the audit doc — keep P2 in the chat output for the user.

### Step 4 — Score the 10 domains

Use this rubric (1–10 each, weighted equal):

| #   | Domain                     | What to look for                                                                                                                                                                                                 |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Application security       | Input validation (AJV strict), output sanitization, no secrets in logs, idempotent external writes                                                                                                               |
| 2   | Supply-chain security      | Pinned actions (SHA), Dependabot, gitleaks, `audit:ci` clean, CodeQL, `.ferry/` bundle drift gate (`check:bundle`)                                                                                               |
| 3   | Correctness & tests        | Coverage, unit + integration, mocked IO, edge cases, e2e replay of agent pipeline                                                                                                                                |
| 4   | Code quality & lint        | Strict TS, no `any`, ESLint guardrails (agent isolation), Prettier clean                                                                                                                                         |
| 5   | Architecture & boundaries  | IO abstraction respected, agents decoupled, schema-versioned events, **no untunable magic numbers in `src/**` (see Step 3.5)\*\*                                                                                 |
| 6   | Reliability & idempotency  | Fingerprinted comments, dedup on retries, audit trail (audit issue), reconciler wired                                                                                                                            |
| 7   | Observability & ops        | Cost governance wired, audit-emit consistent, error reporting, run-id traceability                                                                                                                               |
| 8   | Consumer DX (install flow) | `ferry-init` works, `ferry-doctor` covers the failure modes, `ferry-update`/`ferry-uninstall` exist, `docs/INSTALL.md` is accurate, **P0/P1 hardcoded values from Step 3.5 don't trap consumers without a fork** |
| 9   | Documentation              | README Quick install, CONTRIBUTING, INSTALL.md, CONFIGURATION.md, RELEASING.md, RUNBOOK.md, ADRs, `docs/REQUIREMENTS.md` FR registry in sync (`check:fr-drift`), prompt customization (`*.extra.md`)             |
| 10  | Release process            | Semver tags, CHANGELOG, **release-tag consistency table from Step 3 has no `MISSING` / `drift` / `@main` rows**, the pinned tag exists in `git tag --list`, floating `v1` up to date                             |

Compute overall score = mean of the 10 domain scores, rounded to one decimal.

### Step 5 — Answer the four user-facing questions

Always include a top section answering the four canonical questions explicitly:

1. **Is the project production-ready?** Yes / No / Conditional, plus the 1–3 blockers.
2. **Can a consumer install and reach the full Jira → PR → merge cycle?** Walk through `docs/INSTALL.md` mentally:
   - `ferry-init` scaffolds correctly? `ferry-doctor` catches the common misconfigurations?
   - All 7 consumer stubs present in `examples/consumer-setup/workflows/` (refine, dev, review, iterate, merge, reconcile, cost-daily)?
   - The four auto-transitions are exercised end-to-end: FR18 (Dev → In Review), FR24 (Reviewer → Changes Requested), FR28 (Iterator → In Review), FR32 (Merger merges on `ferry-merge` dispatch, optional → Done)?
   - Any step in the install guide that has no test or no example?
3. **Security posture?** One short paragraph + bullet list of strengths and gaps. Reference application security, supply chain, secrets handling, and prompt injection / RCE risks in LLM tool calls.
4. **Is the score close to 8–9/10?** Quote the computed score, compare to target, list the top 3 gaps that would close the distance.

### Step 6 — Write the report

Update `docs/PRODUCTION-READINESS-AUDIT.md` in place (preserve the existing structure if present; if absent, create it). Bump the `Date:` field to today's date.

Then output a concise summary to the user (≤ 25 lines): the four answers + the computed score + the top 3 actions. The full detail lives in the file.

### Step 7 — Verification

Before reporting done:

- [ ] All 10 domain scores justified by at least one piece of evidence (command output, file path, line number).
- [ ] The four canonical questions are answered explicitly in section 1 of the report.
- [ ] No score is invented — if a check could not run, mark it `N/A` and explain.
- [ ] `docs/PRODUCTION-READINESS-AUDIT.md` was updated (or created) and the Date field reflects today.
- [ ] Step 3.5 ran: P0 + P1 hardcoded values are listed under "Gaps and risks > Hardcoded values" in the audit doc, and Domains 5 and 8 reflect the penalty (or note that the count was below the threshold).
- [ ] Step 3 release-tag consistency table is included in the Release domain section of the report.

## Output Format

User-facing summary (printed at end):

```
Ferry Audit — <YYYY-MM-DD>
Score: X.X / 10 (target 8–9)

1. Production-ready? <verdict + 1-line reason>
2. Consumer install → Jira → PR → merge cycle? <verdict + 1-line reason>
3. Security posture? <one line>
4. Distance to 8–9? <top 3 actions>

Full report: docs/PRODUCTION-READINESS-AUDIT.md
```

## Out of Scope

- Fixing any gap found. The audit only **reports**.
- Bumping versions, creating tags, updating CHANGELOG. Use the `ferry-release` skill for that.
- Hitting real GitHub / Jira / LLM APIs. The audit is local and read-only.
