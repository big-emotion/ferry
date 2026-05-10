import { EUR_TO_USD } from '../../lib/llm/pricing.js';
import { groupByPhase } from './aggregate.js';
import type { AuditLine } from './types.js';

export interface PhaseBaseline {
  phase: string;
  runs: number;
  medianUsd: number;
  p90Usd: number;
  medianInputTokens: number;
}

export interface CostBaseline {
  repo: string;
  generatedAt: string;
  windowRuns: number;
  byPhase: PhaseBaseline[];
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function p90(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor(sorted.length * 0.9), sorted.length - 1);
  return sorted[idx]!;
}

export function computeBaseline(lines: AuditLine[], repo: string): CostBaseline {
  const phaseMap = new Map<string, AuditLine[]>();
  for (const line of lines) {
    const existing = phaseMap.get(line.phase);
    if (existing) {
      existing.push(line);
    } else {
      phaseMap.set(line.phase, [line]);
    }
  }

  // Use groupByPhase for consistent grouping order
  const phaseGroups = groupByPhase(lines);

  const byPhase: PhaseBaseline[] = phaseGroups.map((group) => {
    const phaseLines = phaseMap.get(group.key) ?? [];
    const costsUsd = phaseLines.map((l) => l.cost_eur * EUR_TO_USD).sort((a, b) => a - b);
    const inputTokensSorted = phaseLines.map((l) => l.input_tokens).sort((a, b) => a - b);

    return {
      phase: group.key,
      runs: phaseLines.length,
      medianUsd: median(costsUsd),
      p90Usd: p90(costsUsd),
      medianInputTokens: median(inputTokensSorted),
    };
  });

  return {
    repo,
    generatedAt: new Date().toISOString(),
    windowRuns: lines.length,
    byPhase,
  };
}
