# Ferry Cost Report

`ferry-cost-report` is an on-demand CLI that reads your local `ferry-audit.jsonl` file and produces a spend breakdown across phases, models, tickets, and days.

> **Data quality note:** Cost figures depend on `cost_eur` being non-zero in your audit log. If you see `€0.00` everywhere, see [#251](https://github.com/big-emotion/ferry/issues/251) — that issue tracks accurate cost-field population in the audit log writer.

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
