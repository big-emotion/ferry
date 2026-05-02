# Changelog

All notable changes to Ferry are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Ferry uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.4.0] — 2026-05-02

### Added

- **`ferry-uninstall` CLI** — removes Ferry workflows, secrets, and variables from a consumer repo (#129).
- **`ferry-update` CLI** — upgrades pinned Ferry versions in consumer workflow files; prints migration notes from `MIGRATIONS.md` (#134).
- **Configurable Jira status names** — `ferry-init` now prompts for Jira column names with sensible defaults (Refinement / In Development / In Review / Changes Requested / Ready to Merge) instead of requiring exact names (#132).
- **Workspace ARI + project ID auto-detection** — `ferry-init` wizard automatically resolves the Jira workspace ARI and project ID via the API (#126).
- **Floating major tag** — `scripts/retag-major.sh` keeps a moving `v1` tag pointing at the latest `0.x.y` release; `release.yml` invokes it after every successful release (#133).

### Changed

- **`docs/CONSUMER-SETUP.md` deleted** — the install story now lives entirely in the README quick-install block. A volunteer with no prior Ferry knowledge can install end-to-end from the README in ≤ 10 minutes (#131, #135).
- **`MIGRATIONS.md` added** — documents consumer-visible changes between releases; `ferry-update` reads it to print manual follow-ups after an upgrade.
- **README "Operations setup" curl URLs pinned to a release tag** — replaces the previous `raw.githubusercontent.com/.../main/...` references with `/v0.4.0/...` to remove the mutable supply-chain pull.

### Fixed

- **Install-flow incoherence between `ferry-init` and the reusable workflows** — `ferry-init` previously scaffolded `ferry-reconciler.yml` and `ferry-audit-daily.yml` stubs that called reusable workflows (`reconciler.yml`, `audit-daily.yml`) which did not exist in `.github/workflows/`. Both broken stubs are now removed; consumers add the working scheduled workflows from `examples/consumer-setup/workflows/` per the README's Operations setup step.
- **Anthropic API key secret renamed** — `ferry-init` previously stored the key as `FERRY_ANTHROPIC_API_KEY`, but the reusable agent workflows read `ANTHROPIC_API_KEY`. Wizard, `ferry-doctor`, and `ferry-uninstall` now use `ANTHROPIC_API_KEY` consistently. See `MIGRATIONS.md` for the manual rename step required for existing installs.
- **`ferry-doctor` now checks for `FERRY_REVIEW_TRANSITION_ID` and `FERRY_ITER_TRANSITION_ID`** — these were always required by the agents (FR18 / FR24 / FR28) but the doctor previously did not flag them as missing.
- **Default ferry workflow ref** — `ferry-init` now defaults the workflow pin to the package version rather than a hardcoded `v1` (#124).
- **Jira automation bundle schema** — fixed bundle schema, added beta label and manual fallback flow (#127).

### Breaking (docs)

- `docs/CONSUMER-SETUP.md` no longer exists. Any bookmarks or links to it should be updated to point to the README.

---

## [0.3.0] — 2026-05-01

### Changed

- **Package renamed to `@big-emotion/ferry`** — The npm package is now scoped under the `big-emotion` org. Bin names (`ferry-init`, `ferry-doctor`) are unchanged; consumers invoke the CLIs via `npx -p @big-emotion/ferry ferry-init` and `npx -p @big-emotion/ferry ferry-doctor`. The unscoped `ferry-init` name was never published — `0.3.0` is the first npm release.
- **Internal composite-action pinning bumped to `@v0.3.0`** — Agent workflows and consumer stubs now reference `big-emotion/ferry/.github/{actions,workflows}/...@v0.3.0`.
- **Consumer install guide updated** — `docs/CONSUMER-SETUP.md` and `docs/RELEASING.md` reflect the new package name and version pin.

### Notes

- `0.2.0` was tagged but never reached npm — the release workflow failed at the publish step (token authorization). All 0.2.0 changes below are included in 0.3.0.

---

## [0.2.0] — 2026-05-01

> Tagged but unpublished — the npm publish step failed due to a token authorization issue. The changes below ship as part of `0.3.0`.

### Added

- **npm publish workflow** — `release.yml` now publishes the CLI package to npm with provenance and creates a GitHub Release on every `v*.*.*` tag push, with full CI gate and `.ferry/` bundle drift check.
- **`ferry-init` / `ferry-doctor` on npm** — CLIs are shipped via the `@big-emotion/ferry` package and runnable as `npx -p @big-emotion/ferry ferry-init` / `npx -p @big-emotion/ferry ferry-doctor` (#63).
- **CodeQL SAST workflow** — `.github/workflows/codeql.yml` adds static analysis on every push and PR.
- **Structured logger** — JSON logger with `correlation_id` propagation across agents and IO helpers.
- **FR registry & drift detector** — `check:fr-drift` script + commit-msg hook ensure FR numbers in code, prompts, and docs stay in sync.
- **Audit issue auto-rotation** — When the audit issue approaches the 1000-comment GitHub cap, Ferry automatically rotates to a new issue and links the previous one.
- **CI gates** — `audit:ci` (npm audit on high/critical), `check-bundle` (`.ferry/` drift), `check:fr-drift`, and explicit per-job `permissions:` blocks on every workflow.
- **Scheduled consumer workflows** — `examples/consumer-setup/workflows/ferry-reconcile.yml` and `ferry-cost-daily.yml` wire the reconciler and cost daily-check on cron.
- **End-to-end pipeline test** — Mocked `refine → dev → review → iterate` flow exercising the three Jira auto-transitions (FR18, FR24, FR28).
- **Architecture decision records** — Foundational ADRs under `docs/adr/`, including ADR-0002 documenting why `.ferry/` bundles are committed.
- **Production-readiness audit** — `docs/PRODUCTION-READINESS-AUDIT.md` with multi-axis scoring (now 7.2 / 10).

### Changed

- **Internal composite-action pinning** — Agent workflows (`refine.yml`, `dev.yml`, `review.yml`, `iterate.yml`) reference `big-emotion/ferry/.github/actions/ferry-*@v0.2.0` instead of `@main`, closing the supply-chain self-replication risk.
- **Consumer install guide** — `docs/CONSUMER-SETUP.md` refreshed with the `@v0.2.0` pin, SHA-pinning recipe, and updated troubleshooting tables.

### Security

- **`execFileSync` migration** — Replaced `execSync` template strings with `execFileSync` in the developer agent loop, removing shell-injection surface on commit/branch operations.

---

## [0.1.0] — 2026-04-30

### Added

- **Four-agent pipeline** — Refiner, Developer, Reviewer, Iterator — orchestrated via GitHub Actions `repository_dispatch` events triggered by Jira column transitions.
- **Envelope validation** — AJV strict-mode validation of all incoming `repository_dispatch` payloads against `event.v1.schema.json`.
- **IO abstraction layer** — Shared GitHub, Jira, and LLM helpers; agent code never imports provider SDKs directly.
- **CI gate** — Reviewer agent blocks on PR CI status before posting a verdict.
- **Idempotent external writes** — All comments and file operations are fingerprinted (`[ferry:<role>:<run-id>]`).
- **Jira auto-transitions** — FR18 (Dev → In Review), FR24 (Reviewer → Changes Requested or ferry:approved label), FR28 (Iterator → In Review).
- **Cost governance** — `src/cost-governance/daily-check.ts` monitors provider spend; `ferry:paused` label auto-applied at 50 % of monthly cap.
- **Reconciler** — `src/reconciler/reconcile.ts` sweeps for missed/stalled tickets.
- **CLIs** — `ferry-init` scaffolds Ferry into a consumer repo; `ferry-doctor` diagnoses configuration issues.
- **Multi-provider LLM support** — Anthropic, OpenAI, and Google providers wired through a single `createLlmCall` entry point.
- **Prompt composition** — Layered system-prompt resolution: bundled prompt + `prompts/<agent>.extra.md` + `prompts/_project.md`.
- **Consumer install guide** — `docs/CONSUMER-SETUP.md` with end-to-end setup in ≤ 25 minutes.
- **Release tooling** — `npm version` lifecycle hook rebuilds `.ferry/` bundles automatically; `docs/RELEASING.md` documents tag strategy and manual cutting steps.

### Changed

- `package.json` `version` set to `0.1.0`; `private: true` removed to allow npm distribution.

---

[0.4.0]: https://github.com/big-emotion/ferry/releases/tag/v0.4.0
[0.3.0]: https://github.com/big-emotion/ferry/releases/tag/v0.3.0
[0.2.0]: https://github.com/big-emotion/ferry/releases/tag/v0.2.0
[0.1.0]: https://github.com/big-emotion/ferry/releases/tag/v0.1.0
