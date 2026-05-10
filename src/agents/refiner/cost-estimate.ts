import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CostBaseline } from '../../cli/cost/stats.js';
import type { RefinerOutput, RefinerCostEstimate } from './schema.js';

/**
 * Phases that loop (developer + iterator) use an iteration factor to account
 * for retry/review cycles that multiply actual spend vs a single baseline run.
 */
const ITERATION_FACTOR = 1.4;

const ITERATED_PHASES = new Set(['developer', 'dev', 'iterator', 'iterate']);

/**
 * Loads cost-baseline.json from the repo root.
 * Returns null if the file does not exist.
 * Throws if the file exists but contains invalid JSON.
 */
export function loadCostBaseline(repoRoot: string): CostBaseline | null {
  const filePath = join(repoRoot, 'cost-baseline.json');
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return JSON.parse(raw) as CostBaseline;
}

/**
 * Estimates ticket cost from the Refiner plan and the per-phase baseline.
 *
 * - loUsd = sum of phase medians
 * - hiUsd = sum of phase p90s × iteration_factor for developer/iterator phases
 * - confidence: low < 10 baseline runs, medium < 50, high >= 50
 * - baselineRuns = baseline.windowRuns
 */
export function estimateTicketCost(
  _plan: RefinerOutput,
  baseline: CostBaseline,
): RefinerCostEstimate {
  let loUsd = 0;
  let hiUsd = 0;

  for (const phaseBaseline of baseline.byPhase) {
    const factor = ITERATED_PHASES.has(phaseBaseline.phase) ? ITERATION_FACTOR : 1;
    loUsd += phaseBaseline.medianUsd;
    hiUsd += phaseBaseline.p90Usd * factor;
  }

  const baselineRuns = baseline.windowRuns;
  let confidence: 'low' | 'medium' | 'high';
  if (baselineRuns < 10) {
    confidence = 'low';
  } else if (baselineRuns < 50) {
    confidence = 'medium';
  } else {
    confidence = 'high';
  }

  return { loUsd, hiUsd, confidence, baselineRuns };
}
