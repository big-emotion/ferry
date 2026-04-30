# Ferry Repository Structure

This document explains what each directory does and how Ferry is organized.

## Overview

Ferry is a **GitHub Actions system** that you can use in other projects. This repo contains:
- The Ferry system itself (agents, workflows)
- Published actions that consumer projects use
- Examples and documentation

## Directory Map

### `.ferry/` — Agent Implementation

Contains the Node.js code that runs the agents:
- `refiner-action.js` — Reads Jira ticket, creates sub-tasks
- `dev-action.js` — Writes code, opens PR
- `review-action.js` — Reviews PR, posts feedback
- `iterate-action.js` — Applies feedback, re-reviews
- `validate-action.js` — Validates event payload
- `emit-audit-action.js` — Logs audit data to GitHub Issue
- `package.json` — Dependencies for the above scripts
- `schemas/` — JSON schemas for event validation

### `.github/workflows/` — Ferry's Internal Workflows

These are the **canonical** Ferry workflows. They define:
- How agents are triggered (`repository_dispatch`)
- How they orchestrate (job dependencies)
- Environment setup and secrets

⚠️ **Do NOT copy these directly** to a consumer repo — they reference Ferry's internal `.github/actions/` directory. Instead, use the consumer workflow stubs (see `examples/consumer-setup/workflows/`).

### `.github/actions/` — Ferry's Composite Actions

Composite actions used by Ferry's internal workflows and consumer workflows:
- `ferry-envelope-validate/` — Validates event payload
- `ferry-emit-audit/` — Logs audit data
- `ferry-run-refine/`, `ferry-run-dev/`, `ferry-run-review/`, `ferry-run-iterate/` — Run each agent

Consumer workflows reference these via `uses: ferry-org/ferry/.github/actions/<name>@<ref>`.

### `examples/consumer-setup/` — Consumer Setup Templates

Ready-to-copy workflow files for new consumers:
- `workflows/ferry-refine.yml` — Template for refiner workflow
- `workflows/ferry-dev.yml` — Template for developer workflow
- `workflows/ferry-review.yml` — Template for reviewer workflow
- `workflows/ferry-iterate.yml` — Template for iterator workflow
- `workflows/ferry-audit-daily.yml` — Template for audit log job
- `workflows/ferry-reconciler.yml` — Template for reconciliation job

**Start here** when setting up Ferry in a new project — copy these files to your consumer repo.

### `src/` — Ferry System Source Code

TypeScript source code that builds into the agents:
- `agents/` — Agent implementations
- `schemas/` — Schema validation
- `llm/` — LLM provider integrations
- `jira/` — Jira client
- `prompts/` — System prompts for agents

This is compiled into the `.ferry/` action scripts via `npm run build:ferry`.

### `prompts/` — Agent System Prompts

Plain-text system prompts used by each agent. These define agent behavior:
- `refiner.md` — Refiner agent system prompt
- `developer.md` — Developer agent system prompt
- `reviewer.md` — Reviewer agent system prompt
- `iterator.md` — Iterator agent system prompt

### `config/` — Operational Configuration

Runtime config files consumed by Ferry agents:
- `reviewer-rules.yaml` — Declarative reviewer rules (loaded by the Reviewer agent)

### `docs/` — Documentation

- `CONSUMER.md` — What Ferry is (overview for consumers)
- `CONSUMER-SETUP.md` — How to set up Ferry in a consumer project
- `PROJECT-STRUCTURE.md` — This file
- `reviewer-rubric.md` — 4-dimension grading rubric for the `ferry-grade` CLI

Root-level: `README.md` — Main entry point

## Data Flow

```
1. Consumer repo triggered
       ↓
2. Calls Ferry's reusable workflow (.github/workflows/refine.yml@v1)
       ↓
3. Reusable workflow uses composite action (.github/actions/ferry-run-refine/action.yml)
       ↓
4. Action runs Node.js script (.ferry/refiner-action.js)
       ↓
5. Script calls Jira API + LLM, produces output
       ↓
6. Audit logged to GitHub Issue
```

## When to Edit What

| What | Where | Why |
|------|-------|-----|
| Agent behavior | `src/agents/` + `prompts/` | Rebuild with `npm run build:ferry` |
| Schemas | `src/schemas/` | Rebuild with `npm run build:ferry` |
| Reusable workflows | `.github/workflows/` | Affects all consumers |
| Composite actions | `.github/actions/ferry-*/action.yml` | Affects all consumers |
| Consumer setup docs | `examples/consumer-setup/` + `docs/CONSUMER-SETUP.md` | Affects new consumers |
| Reviewer rules | `config/reviewer-rules.yaml` | Loaded at runtime by Reviewer agent |
| Docs / rubric | `docs/` | Update in place |

## Building Ferry

After editing source code in `src/`:

```bash
npm run build:ferry
```

This compiles TypeScript in `src/` into bundled JavaScript in `.ferry/`.

## Release Process

When publishing a new Ferry version:
1. Update source code in `src/`
2. Run `npm run build:ferry`
3. Commit and push
4. Tag the release (e.g., `v1.2.3`)
5. Consumers update their workflow files to point to the new tag
