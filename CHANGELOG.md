# Changelog

All notable changes to Ferry are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Ferry uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2026-04-30

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
- **Release workflow** — `.github/workflows/release.yml` automates build, version tagging, and GitHub release notes.

### Changed

- `package.json` `version` set to `1.0.0`; `private: true` removed to allow npm distribution.

---

[1.0.0]: https://github.com/big-emotion/ferry/releases/tag/v1.0.0
