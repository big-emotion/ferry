# Ferry — Decisions Synthesis (pre-PRD)

Date: 2026-04-23
Status: Input for PRD creation
Source: Synthesis of `00-source-one-pager.md` + `01-review-adversarial.md` + `02-review-edge-cases.md` after user decisions.

## Product name

**Ferry** — evokes the handoff of tickets from one state to another, human-in-the-loop implicit.

## Core pattern (unchanged from source)

- **GitHub Actions** = runtime (no VPS, no daemon)
- **Pull Request** = state machine (body YAML, labels, comments for audit trail)
- **Jira** = source of truth for ticket state
- Column transitions drive the default path; `agent:*` labels or `@agent-name` comments override/relaunch

## Fixed user decisions

| # | Decision |
|---|---|
| 1 | MVP v0.0.1 = **all 4 agents** (Refiner + Developer + Reviewer + Iterator), not phased |
| 2 | Timeline flexible — "take the time you need", no hard deadline |
| 3 | **One** reviewer only (no multi-model debate, despite +27pp benchmark) |
| 4 | Dedicated repository (this one: `~/Documents/Dev/ferry`) |
| 5 | No Cloudflare Worker proxy — Jira → GitHub `repository_dispatch` direct |
| 6 | Concurrency: `cancel-in-progress: true` + manual kill available anytime |
| 7 | Human merges final PR; human moves tickets between columns |
| 8 | Jira **tasks** (not stories) handled manually |
| 9 | Jira plan upgradable if needed |
| 10 | Pilot project: acme-corp (~40 stories) |

## Model routing (finalized)

| Role | Default | Critical path |
|------|---------|---------------|
| Refiner | Gemini 2.5 Flash | — |
| Developer | Gemini 2.5 Pro | **GPT-5.4** (replaces Opus on `critical` label) |
| Reviewer | Claude Sonnet 4.6 | Claude Sonnet 4.6 |
| Iterator | Gemini 2.5 Pro | **GPT-5.4** |

Rationale: Sonnet for review (quality gate). Gemini Pro cheap default for Dev/Iterator. GPT-5.4 for `critical` because it leads SWE-Bench Pro (57.7%) over Opus 4.5 (45.9%).

## CRITICAL findings to integrate in PRD (8)

All 8 become blocking for v0.0.1 due to full-pipeline MVP scope.

- **C1** Prompt injection via ticket description → data-vs-instruction delimiting, tool denylist, output secret scan.
- **C2** Agent tampering `.github/workflows/*.yml` → CODEOWNERS on `.github/**` + path-filter refusing agent PRs that touch workflows.
- **C3** Cost estimate 3× too optimistic (realistic 120–180€, not 45–60€) → publish token-budget table + measure 3 real stories before committing number.
- **C4** Concurrency scope = `ferry-${ticket.key}` cross-workflow, not per-workflow (prevents Refine+Dev collision on same ticket).
- **C5** PR-body YAML has no schema/concurrency protection → move state to bot-owned issue comment (`<!-- ferry:state v1 -->`) OR `.ferry/state.json` in-branch with JSON schema validation.
- **C6** 15-min reconciler cron scanning Ferry columns for stale webhooks (Jira Automation is fire-and-forget).
- **C7** Reviewer vs CI-red behavior must be explicit: Reviewer waits for green OR red CI is auto-finding (no reviewer tokens burned on red).
- **C8** Remove Cloudflare Worker mention from all docs (superseded).

## IMPORTANT findings to integrate (14)

- **I1** Keep Dev = Gemini 2.5 Pro (per user decision — not swapped to Sonnet despite benchmark #4).
- **I2** Pin model IDs per role + document rollback model.
- **I3** Fingerprint findings by (file, line-range, rule-id); resurgent finding = immediate escalation.
- **I4** Per-ticket per-day trigger cap (anti-spam).
- **I5** Preflight invariants every run: PR open, head SHA matches recorded, branch exists, Jira column matches phase. Fail fast → `status:stale`.
- **I6** ULID event ID on every dispatch + dedupe on duplicates.
- **I7** Idempotency markers on all external writes (`[ferry:refiner:run-123]`).
- **I8** Spend cap handling: detect 429/402 → Jira comment "paused until <date>" + label `ferry:paused`.
- **I9** Pre-push secret scan (gitleaks/trufflehog) + GitHub push protection.
- **I10** `npm ci` only + Dependabot + lockfile review.
- **I11** Attachment policy for ticket images/PDFs/Figma (ignore at MVP, document).
- **I12** Refiner hard cap ~12 sub-tasks; empty ticket → `needs-human`, not hallucinate.
- **I13** Refiner two-phase: plan in memory → audit comment → batch create (atomicity).
- **I14** Audit trail: single GitHub Issue/Discussion `ferry-audit` with one JSON line per run. One bookmark URL for 3am debug.

## NICE-TO-HAVE (v2, 10)

Branch namespace prefix · force-push detection · PR closed mid-loop clean exit · human `@mention` pause/resume · UTF-8/RTL test · payload size guard · GitHub outage idempotent retries · merge conflict auto-rebase · dev refuses >50 files · local repro script `scripts/run-local.sh`.

## REJECTED (do not re-open in PRD)

- Multi-model reviewer debate (user: one reviewer).
- VPS-based runner (user: GHA only).

## Cost expectations

- **Announced budget in v0**: 120–180€ for acme-corp pilot (40 stories × ~1.4–4€/story)
- **Hard kill switch**: 200€ per provider via console cap
- **Soft alert**: 50% of kill switch
- **Telemetry**: per-run token + cost JSON line to `ferry-audit`

## What the PRD must cover

1. Product vision + 1-line value prop
2. Personas (ticket author, reviewer/merger, ops/admin)
3. User journeys per agent phase
4. Functional requirements: 4 agents × phases + shared (auth, secrets, state, observability)
5. Non-functional requirements: security (C1, C2, I9), cost (C3), concurrency (C4, I5, I6), resilience (C5, C6, C7)
6. Success metrics: convergence rate, cost per story, escape defect rate, human touch time
7. MVP scope (v0.0.1): all 4 agents end-to-end on acme-corp
8. Explicit non-goals (VPS, multi-reviewer, multi-project, hard quality gate automation)
9. Open questions to resolve during implementation
10. Model routing table (above) + model ID pinning policy
