# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the Ferry project. Each ADR documents a significant design or implementation decision, explaining the context that drove it, the decision made, and its consequences.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](./0001-three-fr-auto-transitions.md) | Three FR auto-transitions (FR18, FR24, FR28) | Accepted |
| [0002](./0002-ferry-bundles-committed.md) | Ferry bundles committed to the repository | Accepted |
| [0003](./0003-anthropic-messages-vs-agent-sdk.md) | Anthropic Messages API over Agent SDK | Accepted |
| [0004](./0004-idempotency-via-comment-markers.md) | Idempotency via comment markers | Accepted |
| [0005](./0005-no-auto-merge-invariant.md) | No auto-merge invariant | Accepted |

## ADR Template

```markdown
# NNNN — Title

**Status:** Accepted | Superseded by NNNN | Deprecated  
**Date:** YYYY-MM-DD

## Context

What is the situation, constraint, or problem that necessitated a decision?
Include relevant forces, requirements, and background.

## Decision

What was decided? State it clearly and concisely.

## Consequences

What are the outcomes — positive, negative, or neutral — of this decision?

## Alternatives Considered

What other options were evaluated? Why were they rejected?
```

## Statuses

- **Accepted** — in effect
- **Superseded by NNNN** — replaced by a later ADR
- **Deprecated** — no longer applies but kept for historical record
