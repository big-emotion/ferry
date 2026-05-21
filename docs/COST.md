# Ferry Cost Report

`ferry-cost-report` is an on-demand CLI that reads your local `ferry-audit.jsonl` file and produces a spend breakdown across phases, models, tickets, and days.

> **Data quality note:** Cost figures depend on `cost_eur` being non-zero in your audit log. If you see `€0.00` everywhere, see [#251](https://github.com/big-emotion/ferry/issues/251) — that issue tracks accurate cost-field population in the audit log writer. A separate, **expected** zero-cost case is the `claude-code-action` execution path — see [Cost telemetry on the claude-code execution path](#cost-telemetry-on-the-claude-code-execution-path).

---

## Usage

```bash
npx -p @big-emotion/ferry ferry-cost-report [options]
```

### Options

| Flag                  | Description                                              | Default                  |
| --------------------- | -------------------------------------------------------- | ------------------------ |
| `--from <date>`       | ISO date lower bound (e.g. `2026-04-01`)                 | 30 days ago              |
| `--to <date>`         | ISO date upper bound                                     | now                      |
| `--ticket <PROJ-123>` | Filter to a single ticket                                | all tickets              |
| `--phase <phase>`     | Filter by phase: `refine`, `dev`, `review`, `iterate`    | all phases               |
| `--format <fmt>`      | Output format: `md`, `json`, `csv`                       | `md`                     |
| `--out <path>`        | Write output to file instead of stdout                   | stdout                   |
| `--audit-log <path>`  | Path to the audit log file                               | `./ferry-audit.jsonl`    |
| `-h, --help`          | Show usage                                               |                          |

---

## Examples

```bash
# Default: last 30 days, markdown to stdout
npx -p @big-emotion/ferry ferry-cost-report

# Last 7 days, markdown saved to a file
npx -p @big-emotion/ferry ferry-cost-report --from 2026-05-01 --to 2026-05-07 --out report.md

# Single ticket breakdown, JSON output
npx -p @big-emotion/ferry ferry-cost-report --ticket PROJ-42 --format json

# Dev phase only, last 14 days
npx -p @big-emotion/ferry ferry-cost-report --from 2026-04-24 --phase dev

# Use a non-default audit log path
npx -p @big-emotion/ferry ferry-cost-report --audit-log /path/to/ferry-audit.jsonl
```

---

## Sample output (`--format md`)

```
# Ferry Cost Report

**Period:** 2026-04-11 – 2026-05-10
**Total runs:** 47
**Total cost:** €12.34
**Top phases by spend:** dev (€8.90), review (€2.10), iterate (€1.05)

## Spend by phase

| Phase   | Runs | Input tokens | Output tokens | Cost (EUR) | Avg/run  |
| ------- | ---- | ------------ | ------------- | ---------- | -------- |
| dev     | 20   | 16M          | 1.6M          | €8.90      | €0.445   |
| review  | 15   | 5M           | 500k          | €2.10      | €0.140   |
| iterate | 8    | 2M           | 200k          | €1.05      | €0.131   |
| refine  | 4    | 400k         | 40k           | €0.29      | €0.073   |

## Spend by model

| Model                    | Runs | Input tokens | Output tokens | Cost (EUR) | Avg/run |
| ------------------------ | ---- | ------------ | ------------- | ---------- | ------- |
| claude-sonnet-4-6        | 40   | 20M          | 2M            | €11.50     | €0.288  |
| claude-haiku-3-5         | 7    | 3M           | 340k          | €0.84      | €0.120  |

## Spend by ticket (top 20)

| Ticket  | Runs | Cost (EUR) | Avg/run |
| ------- | ---- | ---------- | ------- |
| PROJ-42 | 8    | €4.20      | €0.525  |
| PROJ-37 | 5    | €2.80      | €0.560  |

## Daily spend (last 14 days)

| Date       | Runs | Cost (EUR) |
| ---------- | ---- | ---------- |
| 2026-04-27 | 3    | €0.90      |
| 2026-04-28 | 5    | €1.50      |
| ...        |      |            |

**Daily spend trend:** `▁▂▂▃▅▇▅▃▂▃▅▇▅▃`
**Tokens/run trend:**  `▂▂▃▃▅▇▅▃▂▂▃▅▅▃`

## Anomalies

- High-cost run: abc123 (PROJ-42 / dev) — €1.82 > p95 €1.50
```

---

## How it works

1. `ferry-cost-report` reads `ferry-audit.jsonl` (one JSON object per line) from your local filesystem.
2. Lines are parsed and filtered by the requested date range, ticket, and/or phase.
3. The report groups spend by phase, model, ticket, and day, then renders the chosen format.
4. Anomalies are detected heuristically (runs above p95 cost).

The audit log is populated by Ferry's `ferry-emit-audit` composite action after each agent run. To get a local copy, sync the audit issue comments from GitHub, or use the raw export format (lines starting with `[ferry:audit:<run-id>]` are automatically skipped).

---

## Checking the audit log with `ferry-doctor`

`ferry-doctor` includes a check for the local `ferry-audit.jsonl` file:

- **Red** — file missing or empty
- **Yellow** — fewer than 5 lines (cost reports will be sparse)
- **Green** — 5 or more entries present

Run `npx -p @big-emotion/ferry ferry-doctor` to see the full health check.

---

## Reconciling Ferry spend vs your provider bill (`ferry-cost-reconcile`)

`ferry-cost-reconcile` answers "is Ferry's reported spend close to what Anthropic actually billed me?" by diffing your local `ferry-audit.jsonl` against a provider billing CSV export.

### Getting the Anthropic CSV

In the [Anthropic Console](https://console.anthropic.com) → **Usage** → **Export** (top-right). Select the date range matching your Ferry audit log. The downloaded file has columns: `usage_date_utc`, `model`, `workspace`, `api_key`, `usage_type`, `context_window`, `token_type`, `cost_usd`, `list_price_usd`, `cost_type`, `inference_geo`, `speed`.

### Usage

```bash
npx -p @big-emotion/ferry ferry-cost-reconcile \
  --provider anthropic \
  --provider-csv ./claude_api_cost_2026_05_01_to_2026_05_09.csv \
  --audit-log ./ferry-audit.jsonl
```

### Options

| Flag                    | Description                                                   | Default               |
| ----------------------- | ------------------------------------------------------------- | --------------------- |
| `--provider <name>`     | Provider to reconcile against (`anthropic` only today)        | (required)            |
| `--provider-csv <path>` | Path to the billing CSV export                                | (required)            |
| `--audit-log <path>`    | Ferry audit log path                                          | `./ferry-audit.jsonl` |
| `--tolerance <0-1>`     | Acceptable relative diff before ⚠️ (e.g. `0.10` = 10%)       | `0.10`                |
| `--format <md\|json>`   | Output format                                                 | `md`                  |
| `--out <path>`          | Write output to file instead of stdout                        |                       |
| `-h, --help`            | Show usage                                                    |                       |

### How reconciliation works

1. **Normalize models** — Anthropic's human-readable names (e.g. `Claude Sonnet 4.6`) are mapped to Ferry's model IDs (e.g. `claude-sonnet-4-6`).
2. **Aggregate Ferry** — costs are summed per `(date, model)` and converted from EUR to USD using the same pinned rate as `pricing.ts` (1 USD = 0.93 EUR).
3. **Diff** — for each matched `(date, model)` pair, the absolute relative difference is compared against `--tolerance`.
4. **Report** — matched rows show ✅ (within tolerance) or ⚠️ (outside). Unmatched provider rows (manual usage, unknown models) and unmatched Ferry rows (test runs, date range gaps) are listed separately.

### Interpreting unmatched rows

- **Provider rows Ferry cannot explain** — usage in the provider CSV with no Ferry audit entry. Common causes: manual API calls in the same workspace, models not yet in the normalization table, or runs that predated the current audit log.
- **Ferry runs not found in provider CSV** — Ferry audit entries with no provider match. Common causes: date range mismatch between the CSV and the audit log, test/dry runs that did not reach Anthropic, or non-Anthropic provider runs.

### Provider support

Today only `--provider anthropic` is implemented. OpenAI and Google billing exports follow different CSV schemas — follow-up issues will add them.

---

## Cost telemetry on the claude-code execution path

> **By design.** This note documents the **accepted, by-design** cost-telemetry divergence on the `claude-code-action` execution path so operators can decide before opting in.

Ferry's `cost_eur` audit field is computed from token counts × the provider's published list price (see `pricing.ts`). The bundled-script path authenticates with a metered API key, so this figure is accurate. The `claude-code-action` path authenticates **exclusively** with a Claude **subscription** token (`CLAUDE_CODE_OAUTH_TOKEN`), under which there is **no per-call EUR price** — usage is flat-rate against the subscription, not metered. The claude-code path is also a direct call into `anthropics/claude-code-action` with no Ferry wrapper around the agent loop, so there is nothing to capture per-run token counts either.

Consequence: for runs executed on the `claude-code-action` path, token and cost telemetry are **best-effort** — both the token fields and `cost_eur` are emitted as `0` / null. This is **expected**, not the bug tracked in [#251](https://github.com/big-emotion/ferry/issues/251) (which is about the metered path under-populating the field). Downstream tooling behaves as follows on claude-code-path runs:

| Tool                    | Behavior on `claude-code-action` runs                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ferry-cost-report`     | Both token and `Cost (EUR)` columns show `0` / `€0.00` for these runs — there is no wrapper to capture per-run token counts. Bundled-script-path runs are unaffected. |
| `ferry-cost-reconcile`  | There is no subscription billing CSV to diff against (the Anthropic Console export covers metered API usage only). Claude-code-path runs cannot be reconciled and surface as unmatched Ferry rows. |
| `ferry-cost-advice`     | EUR-saving and token-ratio estimates are skipped for these runs — no token or cost data is recorded. Bundled-script-path runs are unaffected.                          |
| Daily cost-governance   | The 50%-of-monthly-cap auto-pause (`ferry:paused`) backstop is **weakened** — monthly EUR spend is not measurable on a subscription token, so claude-code-path spend cannot trip it. Bundled-script-path tickets are still governed normally. |

**Rationale:** this is the deliberate trade in [ADR-0006](./adr/0006-claude-code-action-execution-path.md) — the `claude-code-action` path is a direct, wrapper-free call that swaps per-run EUR metering for the subscription-billing profile. To keep cost telemetry and the auto-pause backstop fully effective, keep cost-sensitive work on the bundled-script path (the conditional default whenever OpenAI/Google is configured, and selectable at install time for Anthropic-only consumers). For the full set of accepted divergences see [CONFIGURATION.md → Execution paths & accepted divergences](./CONFIGURATION.md#execution-paths--accepted-divergences).

---

## Cost optimisation recommendations (`ferry-cost-advice`)

`ferry-cost-advice` reads your `ferry-audit.jsonl` and surfaces ranked, actionable findings to lower spend.

### Usage

```bash
npx -p @big-emotion/ferry ferry-cost-advice [options]
```

### Options

| Flag                 | Description                                       | Default               |
| -------------------- | ------------------------------------------------- | --------------------- |
| `--audit-log <path>` | Ferry audit log path                              | `./ferry-audit.jsonl` |
| `--from <date>`      | ISO date lower bound                              | 30 days ago           |
| `--to <date>`        | ISO date upper bound                              | now                   |
| `--severity <level>` | Minimum severity: `info` or `warn`                | `info`                |
| `--format <md\|json>`| Output format                                     | `md`                  |
| `--out <path>`       | Write output to file instead of stdout            |                       |
| `-h, --help`         | Show usage                                        |                       |

The CLI always exits 0, even when findings are present — use it in CI without breaking builds.

### Built-in heuristics

| ID | Signal | Severity | Source issue |
| -- | ------ | -------- | ------------ |
| `low-cache-hit` | `cache_read / total_input < 30%` per phase | warn | [#176](https://github.com/big-emotion/ferry/issues/176) |
| `iterator-cap` | >30% of iterate tickets have ≥3 runs (cap hit) | warn | [#168](https://github.com/big-emotion/ferry/issues/168), [#187](https://github.com/big-emotion/ferry/issues/187) |
| `refiner-input-heavy` | Refiner avg input > 50k tokens | warn | [#178](https://github.com/big-emotion/ferry/issues/178), [#182](https://github.com/big-emotion/ferry/issues/182), [#185](https://github.com/big-emotion/ferry/issues/185) |
| `cost-outlier` | Ticket above p90 and >3× median spend | warn | — |
| `provider-phase-mismatch` | Opus used for Refiner phase (Sonnet is sufficient) | info | [#142](https://github.com/big-emotion/ferry/issues/142) |
| `high-output-ratio` | Dev/iterate output tokens >15% of total | info | RTK insight |

Each finding includes: severity, evidence (run IDs / tickets), estimated EUR saving per month, and an action with file/config reference.

### Claude Code skill

The skill ships alongside Ferry in `.claude/skills/ferry-cost-advice/`. Install it by registering the skill in your Claude Code configuration, then invoke it with `/ferry-cost-advice` for an interactive session that runs the CLI and guides you through each fix.

---

## Cost-based ticket estimation

After refining a ticket, Ferry posts an estimated cost range as a Jira comment and applies a label. This gives teams a heads-up before development starts, and allows hard-cap enforcement to refuse tickets that are likely too expensive.

### How it works

1. **Generate a baseline** — run `ferry-cost-stats` against your `ferry-audit.jsonl` to produce `cost-baseline.json` with per-phase median and p90 cost figures.
2. **Refiner reads the baseline** — when `cost-baseline.json` is present in the repo root, the Refiner loads it after producing the plan and computes an estimated cost range.
3. **Comment + label** — the estimate is posted as a Jira comment and a label `ferry:cost-estimate:<lo>-<hi>` is applied.
4. **Hard cap** — if `COST_TICKET_MAX_USD` is set and the estimated high exceeds it, the Refiner posts a cap-refusal comment and exits without creating subtasks.

### Generating the baseline with `ferry-cost-stats`

```bash
npx -p @big-emotion/ferry ferry-cost-stats \
  --audit-log ./ferry-audit.jsonl \
  --repo your-org/your-repo \
  --out ./cost-baseline.json
```

Commit `cost-baseline.json` to your repo root so the Refiner can read it at runtime.

#### Options

| Flag                  | Description                                               | Default                                       |
| --------------------- | --------------------------------------------------------- | --------------------------------------------- |
| `--audit-log <path>`  | Ferry audit log                                           | `./ferry-audit.jsonl`                         |
| `--repo <owner/repo>` | Repository name (for metadata only)                       | `GITHUB_REPOSITORY` env, or `unknown/unknown` |
| `--out <path>`        | Output path for the baseline JSON                         | `./cost-baseline.json`                        |
| `-h, --help`          | Show usage                                                |                                               |

#### Sample output (`cost-baseline.json`)

```json
{
  "repo": "your-org/your-repo",
  "generatedAt": "2026-05-10T00:00:00.000Z",
  "windowRuns": 47,
  "byPhase": [
    {
      "phase": "developer",
      "runs": 20,
      "medianUsd": 0.54,
      "p90Usd": 1.21,
      "medianInputTokens": 12000
    },
    {
      "phase": "refiner",
      "runs": 10,
      "medianUsd": 0.06,
      "p90Usd": 0.12,
      "medianInputTokens": 2500
    }
  ]
}
```

### Refiner estimate comment

When a baseline exists, the Refiner posts a comment like:

```
[ferry:refiner-estimate:<event-id>] Estimated cost: $0.60–$1.89
(confidence: medium, based on 47 runs)
```

And applies the label: `ferry:cost-estimate:0.60-1.89`

### Enforcing a hard cap

Set the `COST_TICKET_MAX_USD` environment variable in your `ferry-refine.yml` workflow:

```yaml
env:
  COST_TICKET_MAX_USD: '5.00'
```

When the estimated high exceeds the cap, the Refiner posts:

```
[ferry:refiner-cap:<event-id>] Estimated cost $0.60–$6.20 exceeds cap $5.00.
Consider splitting this ticket into smaller pieces.
```

And exits without creating subtasks. The ticket remains in its current column for human review.

### Confidence levels

| Confidence | Condition                    |
| ---------- | ---------------------------- |
| `low`      | Fewer than 10 baseline runs  |
| `medium`   | 10–49 baseline runs          |
| `high`     | 50 or more baseline runs     |

### Keeping the baseline fresh

Re-run `ferry-cost-stats` periodically (e.g. weekly via a GitHub Actions schedule) and commit the updated `cost-baseline.json`. Stale baselines still work but may underestimate costs as model pricing evolves.
