/**
 * Daily provider spend check (FR45, NFR-C4).
 *
 * Pure evaluator that takes per-provider monthly + daily spend in EUR and a
 * cap, and emits an alert payload when any provider crosses the 50% mark.
 * Side effects (posting to ferry-audit, applying ferry:spend-cap) live in
 * audit-daily.yml; we only compute the decision here.
 */

export interface ProviderSpend {
  name: string;
  monthly_eur: number;
  daily_eur: number;
}

export interface DailyCheckInput {
  capEur: number;
  providers: ProviderSpend[];
}

export interface SpendAlert {
  provider: string;
  percent: number;
  monthly_eur: number;
  daily_eur: number;
  cap_eur: number;
}

export interface DailyCheckOutcome {
  outcome: 'ok' | 'alert';
  alerts: SpendAlert[];
}

const SOFT_THRESHOLD = 0.5;

export function evaluateDailyCheck(input: DailyCheckInput): DailyCheckOutcome {
  const cap = Math.max(0.01, input.capEur);
  const threshold = parseFloat(process.env.FERRY_BUDGET_ALERT_RATIO ?? '') || SOFT_THRESHOLD;
  const alerts: SpendAlert[] = [];
  for (const p of input.providers) {
    const ratio = p.monthly_eur / cap;
    if (ratio >= threshold) {
      alerts.push({
        provider: p.name,
        percent: Math.round(ratio * 1000) / 10,
        monthly_eur: p.monthly_eur,
        daily_eur: p.daily_eur,
        cap_eur: cap,
      });
    }
  }
  return {
    outcome: alerts.length > 0 ? 'alert' : 'ok',
    alerts,
  };
}

function fmtEur(v: number): string {
  const safe = v < 0 ? 0 : v;
  return `€${safe.toFixed(2)}`;
}

export function formatSpendAlert(a: SpendAlert): string {
  return `⚠️ Spend alert: ${a.provider} at ${a.percent}% of ${fmtEur(a.cap_eur)} cap (${fmtEur(a.monthly_eur)}). Daily cost: ${fmtEur(a.daily_eur)}.`;
}
