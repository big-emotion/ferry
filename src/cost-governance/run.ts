/**
 * CLI entrypoint for the daily provider spend check (FR45, NFR-C4).
 *
 * Wires evaluateDailyCheck() to real I/O:
 *   - GitHub audit issue comments to compute monthly/daily spend per provider
 *   - GitHub issue comment to post the alert when threshold is crossed
 *   - Jira label ferry:paused on active tickets when 50% cap is reached
 *
 * Called from .github/workflows/cost-daily.yml on a daily cron schedule.
 */

import { fileURLToPath } from 'url';
import { Octokit } from '@octokit/rest';
import {
  evaluateDailyCheck,
  formatSpendAlert,
  type ProviderSpend,
  type DailyCheckOutcome,
} from './daily-check.js';

const MODEL_TO_PROVIDER: Array<[RegExp, string]> = [
  [/^claude-/i, 'anthropic'],
  [/^gpt-|^o\d/i, 'openai'],
  [/^gemini-|^models\/gemini-/i, 'google'],
];

function inferProvider(model: string): string {
  for (const [pattern, provider] of MODEL_TO_PROVIDER) {
    if (pattern.test(model)) return provider;
  }
  return 'unknown';
}

interface AuditLine {
  ticket?: string;
  model?: string;
  cost_eur?: number;
  daily_eur?: number;
}

export interface CostCheckConfig {
  githubToken: string;
  owner: string;
  repo: string;
  auditIssue: number;
  capEur: number;
  nowMs: number;
  jiraBaseUrl?: string;
  jiraAuthHeader?: string;
}

export interface CostCheckDeps {
  fetchAuditComments(
    config: CostCheckConfig,
  ): Promise<Array<{ body: string | null; created_at: string }>>;
  postAuditAlert(config: CostCheckConfig, body: string): Promise<void>;
  applyJiraPauseLabel(
    config: CostCheckConfig,
    ticketKeys: string[],
  ): Promise<void>;
}

export function buildDefaultDeps(): CostCheckDeps {
  return {
    fetchAuditComments(config) {
      const octokit = new Octokit({ auth: config.githubToken });
      return octokit.paginate(octokit.rest.issues.listComments, {
        owner: config.owner,
        repo: config.repo,
        issue_number: config.auditIssue,
        per_page: 100,
      }) as unknown as Promise<Array<{ body: string | null; created_at: string }>>;
    },

    async postAuditAlert(config, body) {
      const octokit = new Octokit({ auth: config.githubToken });
      await octokit.rest.issues.createComment({
        owner: config.owner,
        repo: config.repo,
        issue_number: config.auditIssue,
        body,
      });
    },

    async applyJiraPauseLabel(config, ticketKeys) {
      if (!config.jiraBaseUrl || !config.jiraAuthHeader || ticketKeys.length === 0) return;
      const headers = { Authorization: config.jiraAuthHeader, 'Content-Type': 'application/json' };
      for (const key of ticketKeys) {
        try {
          await fetch(`${config.jiraBaseUrl}/rest/api/3/issue/${key}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ update: { labels: [{ add: 'ferry:paused' }] } }),
          });
          console.log(`[cost-check] applied ferry:paused to ${key}`);
        } catch (err) {
          console.warn(
            `[cost-check] failed to label ${key}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    },
  };
}

// Parse all audit comments, grouping spend by provider for the current calendar month.
export function parseMonthlySpend(
  comments: Array<{ body: string | null; created_at: string }>,
  nowMs: number,
): Map<string, ProviderSpend> {
  const nowDate = new Date(nowMs);
  const currentYear = nowDate.getUTCFullYear();
  const currentMonth = nowDate.getUTCMonth();
  const oneDayMs = 24 * 60 * 60 * 1_000;

  const monthly = new Map<string, number>();
  const daily = new Map<string, number>();
  const activeTickets = new Set<string>();

  for (const c of comments) {
    if (!c.body?.includes('[ferry:audit:')) continue;
    const m = c.body.match(/\[ferry:audit:[^\]]+\]\n([\s\S]+)/);
    if (!m) continue;
    try {
      const line = JSON.parse(m[1]) as AuditLine;
      const model = line.model ?? '';
      const provider = inferProvider(model);
      const costEur = typeof line.cost_eur === 'number' ? line.cost_eur : 0;
      const commentDate = new Date(c.created_at);

      if (
        commentDate.getUTCFullYear() === currentYear &&
        commentDate.getUTCMonth() === currentMonth
      ) {
        monthly.set(provider, (monthly.get(provider) ?? 0) + costEur);
      }

      if (nowMs - commentDate.getTime() < oneDayMs) {
        daily.set(provider, (daily.get(provider) ?? 0) + costEur);
      }

      if (line.ticket) activeTickets.add(line.ticket);
    } catch {
      // ignore malformed comments
    }
  }

  const result = new Map<string, ProviderSpend>();
  const allProviders = new Set([...monthly.keys(), ...daily.keys()]);
  for (const provider of allProviders) {
    result.set(provider, {
      name: provider,
      monthly_eur: monthly.get(provider) ?? 0,
      daily_eur: daily.get(provider) ?? 0,
    });
  }
  return result;
}

export async function run(
  config: CostCheckConfig,
  deps: CostCheckDeps = buildDefaultDeps(),
): Promise<DailyCheckOutcome> {
  const comments = await deps.fetchAuditComments(config);
  const spendByProvider = parseMonthlySpend(comments, config.nowMs);

  const providers = [...spendByProvider.values()];
  const outcome = evaluateDailyCheck({ capEur: config.capEur, providers });

  if (outcome.outcome === 'alert') {
    const alertLines = outcome.alerts.map(formatSpendAlert).join('\n');
    const body = `[ferry:cost-check:daily]\n${alertLines}`;
    console.log('[cost-check] spend threshold exceeded — posting alert');
    await deps.postAuditAlert(config, body);

    // Collect active ticket keys from audit comments to apply ferry:paused.
    const activeTickets = new Set<string>();
    for (const c of comments) {
      if (!c.body?.includes('[ferry:audit:')) continue;
      const m = c.body.match(/\[ferry:audit:[^\]]+\]\n([\s\S]+)/);
      if (!m) continue;
      try {
        const line = JSON.parse(m[1]) as { ticket?: string };
        if (line.ticket) activeTickets.add(line.ticket);
      } catch {
        // ignore
      }
    }

    await deps.applyJiraPauseLabel(config, [...activeTickets]);
  } else {
    console.log('[cost-check] all providers under threshold — no action needed');
  }

  console.log(
    `[cost-check] outcome=${outcome.outcome} alerts=${outcome.alerts.length} providers_checked=${providers.length}`,
  );
  return outcome;
}

export function configFromEnv(): CostCheckConfig {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) throw new Error('GITHUB_TOKEN is required');
  const githubRepository = process.env.GITHUB_REPOSITORY;
  if (!githubRepository) throw new Error('GITHUB_REPOSITORY is required (owner/repo)');
  const auditIssueStr = process.env.FERRY_AUDIT_ISSUE;
  if (!auditIssueStr) throw new Error('FERRY_AUDIT_ISSUE is required');
  const auditIssue = parseInt(auditIssueStr, 10);
  if (isNaN(auditIssue))
    throw new Error(`FERRY_AUDIT_ISSUE must be a number, got: ${auditIssueStr}`);
  const capEurStr = process.env.FERRY_SPEND_CAP_EUR ?? '200';
  const capEur = parseFloat(capEurStr);
  if (isNaN(capEur) || capEur <= 0)
    throw new Error(`FERRY_SPEND_CAP_EUR must be a positive number, got: ${capEurStr}`);

  const [owner, repo] = githubRepository.split('/');

  const jiraBaseUrl = process.env.FERRY_JIRA_BASE_URL;
  const jiraEmail = process.env.FERRY_JIRA_EMAIL;
  const jiraApiToken = process.env.FERRY_JIRA_API_TOKEN;
  const jiraAuthHeader =
    jiraEmail && jiraApiToken
      ? `Basic ${Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64')}`
      : undefined;

  return {
    githubToken,
    owner,
    repo,
    auditIssue,
    capEur,
    nowMs: Date.now(),
    jiraBaseUrl,
    jiraAuthHeader,
  };
}

// Only run when invoked directly — not when imported in tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(configFromEnv())
    .then((outcome) => {
      console.log(`Cost check done: ${outcome.outcome}, ${outcome.alerts.length} alert(s)`);
    })
    .catch((err: unknown) => {
      console.error('[cost-check] fatal:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
