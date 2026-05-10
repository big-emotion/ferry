import type { AuditLine } from './types.js';
import { filterLines, groupByTicket } from './aggregate.js';

export type Severity = 'info' | 'warn';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence: string[];
  estimatedSavingEurPerMonth: number;
  action: string;
}

export interface AdviceResult {
  findings: Finding[];
  analysedRuns: number;
  dateRange: { from: string; to: string };
}

// ---------------------------------------------------------------------------
// Heuristic 1 — low cache hit rate (requires audit logs from Ferry ≥ v0.11)
// Ref: #176
// ---------------------------------------------------------------------------

function heuristicLowCacheHit(lines: AuditLine[]): Finding | null {
  const withCache = lines.filter((l) => l.cache_read_input_tokens !== undefined);
  if (withCache.length < 5) return null;

  const byPhase = new Map<string, { cacheRead: number; totalInput: number }>();
  for (const l of withCache) {
    const cacheRead = l.cache_read_input_tokens ?? 0;
    const totalInput = l.input_tokens;
    const existing = byPhase.get(l.phase);
    if (existing) {
      existing.cacheRead += cacheRead;
      existing.totalInput += totalInput;
    } else {
      byPhase.set(l.phase, { cacheRead, totalInput });
    }
  }

  const lowPhases: string[] = [];
  for (const [phase, stats] of byPhase) {
    if (stats.totalInput === 0) continue;
    if (stats.cacheRead / stats.totalInput < 0.3) {
      lowPhases.push(phase);
    }
  }

  if (lowPhases.length === 0) return null;

  const totalCostEur = withCache.reduce((s, l) => s + l.cost_eur, 0);
  const potentialSaving = (totalCostEur * 0.5 * 0.7) / (withCache.length / 30);

  return {
    id: 'low-cache-hit',
    severity: 'warn',
    title: 'Cache hit rate below 30%',
    detail: `Phase(s) ${lowPhases.join(', ')} have a cache_read / total_input ratio below 0.3. Cache misses mean you are paying full price for repeated prompt prefix tokens.`,
    evidence: lowPhases.map((p) => {
      const s = byPhase.get(p)!;
      return `${p}: ${s.totalInput > 0 ? ((s.cacheRead / s.totalInput) * 100).toFixed(1) : 0}% cache hit`;
    }),
    estimatedSavingEurPerMonth: Math.round(potentialSaving * 100) / 100,
    action:
      'Ensure your system prompt prefix is stable across runs. Move frequently-changing content (issue description, PR diff) after the stable prefix. See prompts/<agent>.md for the current prefix layout.',
  };
}

// ---------------------------------------------------------------------------
// Heuristic 2 — Iterator hitting max_iterations cap
// Approximation: a ticket that has ≥ 3 iterate-phase runs likely hit the loop
// cap at some point (default cap is 3 per ticket). Ref: #168, #187
// ---------------------------------------------------------------------------

function heuristicIteratorCap(lines: AuditLine[]): Finding | null {
  const iterateByTicket = new Map<string, number>();
  for (const l of lines) {
    if (l.phase === 'iterate') {
      iterateByTicket.set(l.ticket, (iterateByTicket.get(l.ticket) ?? 0) + 1);
    }
  }

  const capTickets = Array.from(iterateByTicket.entries())
    .filter(([, count]) => count >= 3)
    .map(([ticket]) => ticket);

  const totalIterateTickets = iterateByTicket.size;
  if (totalIterateTickets === 0) return null;
  const capRate = capTickets.length / totalIterateTickets;
  if (capRate < 0.3) return null;

  const iterateTotal = lines.filter((l) => l.phase === 'iterate').length;

  const iterateCostPerRun =
    lines.filter((l) => l.phase === 'iterate').reduce((s, l) => s + l.cost_eur, 0) / iterateTotal;
  const potentialSaving = capTickets.length * iterateCostPerRun * 0.4;

  return {
    id: 'iterator-cap',
    severity: 'warn',
    title: 'Iterator hitting iteration cap on >30% of tickets',
    detail: `${capTickets.length} ticket(s) have ≥3 iterate-phase runs, suggesting the iteration cap is being reached. Review the review-feedback density or raise limits.max_iterations in ferry.config.json.`,
    evidence: capTickets.slice(0, 5).map((t) => `${t}: ${iterateByTicket.get(t)} iterate runs`),
    estimatedSavingEurPerMonth: Math.round(potentialSaving * 100) / 100,
    action:
      'Reduce Reviewer strictness (prompts/review.extra.md) or tighten sub-task granularity so each iteration resolves more findings. Alternatively, raise limits.max_iterations if the extra rounds deliver value.',
  };
}

// ---------------------------------------------------------------------------
// Heuristic 3 — Refiner reading too much context
// Ref: #178, #182, #185
// ---------------------------------------------------------------------------

function heuristicRefinerHeavy(lines: AuditLine[]): Finding | null {
  const refinerLines = lines.filter((l) => l.phase === 'refine');
  if (refinerLines.length < 3) return null;

  const avgInput = refinerLines.reduce((s, l) => s + l.input_tokens, 0) / refinerLines.length;
  if (avgInput <= 50_000) return null;

  const heavyRuns = refinerLines.filter((l) => l.input_tokens > 50_000);
  const potentialSaving =
    heavyRuns.reduce((s, l) => s + l.cost_eur, 0) * 0.4 * (30 / refinerLines.length);

  return {
    id: 'refiner-input-heavy',
    severity: 'warn',
    title: 'Refiner averaging >50k input tokens',
    detail: `Average Refiner input is ${Math.round(avgInput / 1000)}k tokens — above the 50k threshold. High input token counts inflate cost and latency without proportional quality gain.`,
    evidence: heavyRuns
      .slice(0, 3)
      .map(
        (l) => `${l.ticket} (run ${l.run_id}): ${Math.round(l.input_tokens / 1000)}k input tokens`,
      ),
    estimatedSavingEurPerMonth: Math.round(potentialSaving * 100) / 100,
    action:
      'Add a prompts/_project.md file to narrow the Refiner\'s project context. Use --context-budget or limits.max_tokens_per_run to cap input. See docs/CONFIGURATION.md § "Token and iteration limits".',
  };
}

// ---------------------------------------------------------------------------
// Heuristic 4 — Cost outlier tickets (above p95)
// ---------------------------------------------------------------------------

function heuristicCostOutliers(lines: AuditLine[]): Finding | null {
  const byTicket = groupByTicket(lines);
  if (byTicket.length < 5) return null;

  const costs = byTicket.map((g) => g.costEur).sort((a, b) => a - b);
  const p90 = costs[Math.floor(costs.length * 0.9)] ?? costs[costs.length - 1] ?? 0;
  const median = costs[Math.floor(costs.length * 0.5)] ?? 0;

  if (median === 0) return null;

  const outliers = byTicket.filter((g) => g.costEur > p90 && g.costEur > median * 3);
  if (outliers.length === 0) return null;

  return {
    id: 'cost-outlier',
    severity: 'warn',
    title: `${outliers.length} ticket(s) exceed p90 cost threshold and >3× median`,
    detail: `These tickets consumed disproportionate spend. They are likely large/complex tasks or runaway agent loops. Investigate and consider splitting the ticket or capping budget.`,
    evidence: outliers
      .slice(0, 5)
      .map(
        (g) => `${g.key}: €${g.costEur.toFixed(4)} (${(g.costEur / median).toFixed(1)}× median)`,
      ),
    estimatedSavingEurPerMonth:
      Math.round(outliers.reduce((s, g) => s + g.costEur * 0.5, 0) * 100) / 100,
    action:
      'Set COST_TICKET_MAX_USD (or limits.max_cost_per_ticket in ferry.config.json) to cap runaway tickets. Consider splitting large tickets into smaller sub-tasks before Ferry processes them.',
  };
}

// ---------------------------------------------------------------------------
// Heuristic 5 — Expensive model for cheap phase (Opus on Refiner)
// Ref: #142
// ---------------------------------------------------------------------------

function heuristicProviderMismatch(lines: AuditLine[]): Finding | null {
  const refinerOpus = lines.filter(
    (l) => l.phase === 'refine' && l.model.toLowerCase().includes('opus'),
  );
  if (refinerOpus.length === 0) return null;

  const refinerAll = lines.filter((l) => l.phase === 'refine');
  const opusFraction = refinerOpus.length / refinerAll.length;
  if (opusFraction < 0.5) return null;

  const opusCost = refinerOpus.reduce((s, l) => s + l.cost_eur, 0);
  const sonnetCostEstimate = opusCost * (2.79 / 13.95);
  const monthlySaving =
    (opusCost - sonnetCostEstimate) * (30 / refinerOpus.length) * refinerOpus.length;

  return {
    id: 'provider-phase-mismatch',
    severity: 'info',
    title: 'Opus used for Refiner phase — Sonnet is sufficient',
    detail: `${refinerOpus.length} Refiner run(s) used Opus. The Refiner is a single-turn summarisation task where Sonnet delivers equivalent quality at ~5× lower cost.`,
    evidence: [
      `${refinerOpus.length}/${refinerAll.length} Refiner runs used Opus (${(opusFraction * 100).toFixed(0)}%)`,
    ],
    estimatedSavingEurPerMonth: Math.round(monthlySaving * 100) / 100,
    action:
      'Set FERRY_REFINER_MODEL=claude-sonnet-4-6 (or models.refine.model in ferry.config.json). See docs/CONFIGURATION.md § "Model and provider overrides".',
  };
}

// ---------------------------------------------------------------------------
// Heuristic 6 — High output token ratio (LLM "rambling" between tool calls)
// output_tokens / (input_tokens + output_tokens) > 0.15 for tool-heavy phases
// ---------------------------------------------------------------------------

function heuristicHighOutputRatio(lines: AuditLine[]): Finding | null {
  const toolPhases = lines.filter((l) => l.phase === 'dev' || l.phase === 'iterate');
  if (toolPhases.length < 5) return null;

  const highRatio = toolPhases.filter((l) => {
    const total = l.input_tokens + l.output_tokens;
    return total > 0 && l.output_tokens / total > 0.15;
  });

  if (highRatio.length / toolPhases.length < 0.3) return null;

  const wasted = highRatio.reduce((s, l) => {
    const total = l.input_tokens + l.output_tokens;
    const excessOutputRatio = l.output_tokens / total - 0.1;
    return s + l.cost_eur * excessOutputRatio;
  }, 0);

  return {
    id: 'high-output-ratio',
    severity: 'info',
    title: 'High output/total token ratio in dev/iterate phases',
    detail: `${highRatio.length}/${toolPhases.length} dev/iterate runs have output tokens exceeding 15% of total tokens. In tool-use loops the model should mostly invoke tools (low output); high output suggests the model is thinking out loud or writing long explanations between tool calls.`,
    evidence: highRatio.slice(0, 3).map((l) => {
      const total = l.input_tokens + l.output_tokens;
      return `${l.ticket} (${l.phase}, run ${l.run_id}): ${((l.output_tokens / total) * 100).toFixed(1)}% output ratio`;
    }),
    estimatedSavingEurPerMonth:
      Math.round(wasted * (30 / toolPhases.length) * toolPhases.length * 100) / 100,
    action:
      'Tighten the Developer/Iterator system prompt to discourage prose between tool calls. Add "respond only with tool calls — no explanatory text" to prompts/dev.extra.md.',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyseAuditLog(
  allLines: AuditLine[],
  opts: { since?: Date; until?: Date; severity?: Severity } = {},
): AdviceResult {
  const filtered = filterLines(allLines, { since: opts.since, until: opts.until });

  const heuristics = [
    heuristicLowCacheHit,
    heuristicIteratorCap,
    heuristicRefinerHeavy,
    heuristicCostOutliers,
    heuristicProviderMismatch,
    heuristicHighOutputRatio,
  ];

  const findings: Finding[] = [];
  for (const h of heuristics) {
    const finding = h(filtered);
    if (!finding) continue;
    if (opts.severity === 'warn' && finding.severity === 'info') continue;
    findings.push(finding);
  }

  findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'warn' ? -1 : 1;
    return b.estimatedSavingEurPerMonth - a.estimatedSavingEurPerMonth;
  });

  const timestamps = filtered.map((l) => l.timestamp).sort();
  return {
    findings,
    analysedRuns: filtered.length,
    dateRange: {
      from: timestamps[0]?.slice(0, 10) ?? '',
      to: timestamps[timestamps.length - 1]?.slice(0, 10) ?? '',
    },
  };
}

export function formatAdviceReport(result: AdviceResult): string {
  const lines: string[] = [];
  lines.push('# Ferry Cost Advice');
  lines.push('');
  lines.push(
    `**Analysed:** ${result.analysedRuns} runs` +
      (result.dateRange.from ? ` (${result.dateRange.from} – ${result.dateRange.to})` : ''),
  );
  lines.push(`**Findings:** ${result.findings.length}`);
  lines.push('');

  if (result.findings.length === 0) {
    lines.push('_No actionable findings. Looking good!_');
    return lines.join('\n');
  }

  for (const f of result.findings) {
    const icon = f.severity === 'warn' ? '⚠️' : 'ℹ️';
    lines.push(`## ${icon} ${f.title}`);
    lines.push('');
    lines.push(f.detail);
    lines.push('');
    if (f.evidence.length > 0) {
      lines.push('**Evidence:**');
      for (const e of f.evidence) lines.push(`- ${e}`);
      lines.push('');
    }
    if (f.estimatedSavingEurPerMonth > 0) {
      lines.push(`**Estimated saving:** ~€${f.estimatedSavingEurPerMonth.toFixed(2)}/month`);
      lines.push('');
    }
    lines.push(`**Action:** ${f.action}`);
    lines.push('');
  }

  return lines.join('\n');
}
