import { FerryError } from '../error.js';

export interface SessionBudget {
  checkBefore(estimatedInputCostEur: number): void;
  recordUsage(actualCostEur: number): void;
  totalCostEur(): number;
}

export function createSessionBudget(maxCostEur?: number): SessionBudget {
  const envRaw = process.env['FERRY_MAX_COST_EUR_PER_RUN'];
  const envParsed = envRaw ? parseFloat(envRaw) : NaN;
  const cap = maxCostEur ?? (Number.isFinite(envParsed) ? envParsed : 10);
  let total = 0;

  return {
    checkBefore(estimatedInputCostEur: number): void {
      if (total + estimatedInputCostEur > cap) {
        throw new FerryError('spend-cap', {
          reason: 'budget-exceeded',
          sessionTotal: total,
          estimatedAdd: estimatedInputCostEur,
          cap,
        });
      }
    },
    recordUsage(actualCostEur: number): void {
      total += actualCostEur;
    },
    totalCostEur(): number {
      return total;
    },
  };
}
