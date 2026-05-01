import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  run,
  parseMonthlySpend,
  buildDefaultDeps,
  configFromEnv,
  type CostCheckConfig,
  type CostCheckDeps,
} from './run.js';

const BASE_CONFIG: CostCheckConfig = {
  githubToken: 'gh-token',
  owner: 'big-emotion',
  repo: 'ferry',
  auditIssue: 42,
  capEur: 200,
  nowMs: new Date('2026-05-15T08:00:00Z').getTime(),
};

function makeDeps(overrides: Partial<CostCheckDeps> = {}): CostCheckDeps {
  return {
    fetchAuditComments: vi.fn().mockResolvedValue([]),
    postAuditAlert: vi.fn().mockResolvedValue(undefined),
    applyJiraPauseLabel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeAuditComment(
  ticket: string,
  model: string,
  costEur: number,
  created_at: string,
): { body: string; created_at: string } {
  return {
    body: `[ferry:audit:01ABCDEFGHIJKLMNOPQRSTUVWX]\n${JSON.stringify({ ticket, model, cost_eur: costEur, outcome: 'success' })}`,
    created_at,
  };
}

describe('cost-governance/run — workflow → module entrypoint', () => {
  describe('parseMonthlySpend', () => {
    it('sums cost_eur by provider within the current calendar month', () => {
      const comments = [
        makeAuditComment('PROJ-1', 'claude-sonnet-4-6', 10, '2026-05-01T00:00:00Z'),
        makeAuditComment('PROJ-1', 'claude-opus-4-7', 20, '2026-05-10T00:00:00Z'),
        makeAuditComment('PROJ-2', 'gpt-4o', 15, '2026-05-12T00:00:00Z'),
        // Previous month — must be excluded from monthly total
        makeAuditComment('PROJ-1', 'claude-sonnet-4-6', 50, '2026-04-30T23:59:59Z'),
      ];

      const nowMs = new Date('2026-05-15T08:00:00Z').getTime();
      const spend = parseMonthlySpend(comments, nowMs);

      expect(spend.get('anthropic')?.monthly_eur).toBeCloseTo(30);
      expect(spend.get('openai')?.monthly_eur).toBeCloseTo(15);
      // Previous month's spend must NOT appear
      expect(spend.get('anthropic')?.monthly_eur).toBeLessThan(80);
    });

    it('computes daily_eur as spend in the last 24 hours', () => {
      const nowMs = new Date('2026-05-15T08:00:00Z').getTime();
      const recentIso = new Date(nowMs - 6 * 60 * 60 * 1_000).toISOString(); // 6h ago
      const oldIso = new Date(nowMs - 25 * 60 * 60 * 1_000).toISOString(); // 25h ago

      const comments = [
        makeAuditComment('PROJ-1', 'claude-sonnet-4-6', 5, recentIso),
        makeAuditComment('PROJ-1', 'claude-sonnet-4-6', 100, oldIso),
      ];

      const spend = parseMonthlySpend(comments, nowMs);
      expect(spend.get('anthropic')?.daily_eur).toBeCloseTo(5);
    });

    it('infers provider from model name', () => {
      const comments = [
        makeAuditComment('T-1', 'claude-haiku-4-5', 1, '2026-05-01T00:00:00Z'),
        makeAuditComment('T-2', 'gpt-4o-mini', 2, '2026-05-01T00:00:00Z'),
        makeAuditComment('T-3', 'gemini-2.5-pro', 3, '2026-05-01T00:00:00Z'),
      ];

      const nowMs = new Date('2026-05-15T00:00:00Z').getTime();
      const spend = parseMonthlySpend(comments, nowMs);

      expect(spend.has('anthropic')).toBe(true);
      expect(spend.has('openai')).toBe(true);
      expect(spend.has('google')).toBe(true);
    });

    it('returns empty map when no audit comments exist', () => {
      const spend = parseMonthlySpend([], Date.now());
      expect(spend.size).toBe(0);
    });

    it('ignores non-audit comments', () => {
      const comments = [
        { body: 'Just a regular comment about the PR.', created_at: '2026-05-10T00:00:00Z' },
        { body: null, created_at: '2026-05-10T00:00:00Z' },
      ];
      const spend = parseMonthlySpend(comments, new Date('2026-05-15T00:00:00Z').getTime());
      expect(spend.size).toBe(0);
    });
  });

  describe('run', () => {
    it('returns ok when all providers under 50% cap', async () => {
      const comments = [
        makeAuditComment('PROJ-1', 'claude-sonnet-4-6', 30, '2026-05-10T00:00:00Z'),
      ];
      const deps = makeDeps({
        fetchAuditComments: vi.fn().mockResolvedValue(comments),
      });

      const outcome = await run(BASE_CONFIG, deps);
      expect(outcome.outcome).toBe('ok');
      expect(outcome.alerts).toEqual([]);
      expect(deps.postAuditAlert).not.toHaveBeenCalled();
      expect(deps.applyJiraPauseLabel).not.toHaveBeenCalled();
    });

    it('posts alert and applies ferry:paused when provider exceeds 50% of cap', async () => {
      // 200 EUR cap; 103 EUR = 51.5% — should trigger alert
      const comments = [
        makeAuditComment('PROJ-1', 'claude-sonnet-4-6', 103, '2026-05-10T00:00:00Z'),
      ];
      const deps = makeDeps({
        fetchAuditComments: vi.fn().mockResolvedValue(comments),
      });

      const outcome = await run(BASE_CONFIG, deps);
      expect(outcome.outcome).toBe('alert');
      expect(outcome.alerts).toHaveLength(1);
      expect(outcome.alerts[0].provider).toBe('anthropic');
      expect(deps.postAuditAlert).toHaveBeenCalledOnce();
      const [, alertBody] = vi.mocked(deps.postAuditAlert).mock.calls[0];
      expect(alertBody).toContain('[ferry:cost-check:daily]');
      expect(alertBody).toContain('anthropic');
    });

    it('calls applyJiraPauseLabel with active ticket keys from audit log', async () => {
      const comments = [
        makeAuditComment('PROJ-2', 'claude-sonnet-4-6', 120, '2026-05-10T00:00:00Z'),
        makeAuditComment('PROJ-3', 'claude-opus-4-7', 5, '2026-05-11T00:00:00Z'),
      ];
      const deps = makeDeps({
        fetchAuditComments: vi.fn().mockResolvedValue(comments),
      });

      // Total: 125 EUR on anthropic, cap 200 EUR → 62.5% → alert
      await run(BASE_CONFIG, deps);
      expect(deps.applyJiraPauseLabel).toHaveBeenCalledOnce();
      const [, tickets] = vi.mocked(deps.applyJiraPauseLabel).mock.calls[0];
      expect(tickets).toContain('PROJ-2');
      expect(tickets).toContain('PROJ-3');
    });

    it('does NOT call applyJiraPauseLabel when outcome is ok', async () => {
      const comments = [
        makeAuditComment('PROJ-4', 'claude-sonnet-4-6', 10, '2026-05-10T00:00:00Z'),
      ];
      const deps = makeDeps({
        fetchAuditComments: vi.fn().mockResolvedValue(comments),
      });

      const outcome = await run(BASE_CONFIG, deps);
      expect(outcome.outcome).toBe('ok');
      expect(deps.applyJiraPauseLabel).not.toHaveBeenCalled();
    });

    it('handles empty audit log gracefully', async () => {
      const deps = makeDeps();
      const outcome = await run(BASE_CONFIG, deps);
      expect(outcome.outcome).toBe('ok');
      expect(outcome.alerts).toEqual([]);
    });
  });
});

describe('buildDefaultDeps', () => {
  it('applyJiraPauseLabel returns early when jiraBaseUrl is missing', async () => {
    const deps = buildDefaultDeps();
    await expect(deps.applyJiraPauseLabel(BASE_CONFIG, ['PROJ-1'])).resolves.toBeUndefined();
  });

  it('applyJiraPauseLabel returns early when ticketKeys is empty', async () => {
    const config = {
      ...BASE_CONFIG,
      jiraBaseUrl: 'https://jira.example.com',
      jiraAuthHeader: 'Basic xxx',
    };
    const deps = buildDefaultDeps();
    await expect(deps.applyJiraPauseLabel(config, [])).resolves.toBeUndefined();
  });

  it('applyJiraPauseLabel calls fetch for each key and handles errors gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', mockFetch);
    const config = {
      ...BASE_CONFIG,
      jiraBaseUrl: 'https://jira.example.com',
      jiraAuthHeader: 'Basic xxx',
    };
    const deps = buildDefaultDeps();
    await expect(deps.applyJiraPauseLabel(config, ['PROJ-1'])).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe('configFromEnv', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('builds config from env vars with defaults', () => {
    process.env.GITHUB_TOKEN = 'gh-test-token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.FERRY_AUDIT_ISSUE = '42';
    delete process.env.FERRY_SPEND_CAP_EUR;
    delete process.env.FERRY_JIRA_BASE_URL;
    delete process.env.FERRY_JIRA_EMAIL;
    delete process.env.FERRY_JIRA_API_TOKEN;
    const config = configFromEnv();
    expect(config.githubToken).toBe('gh-test-token');
    expect(config.owner).toBe('owner');
    expect(config.repo).toBe('repo');
    expect(config.auditIssue).toBe(42);
    expect(config.capEur).toBe(200);
    expect(config.jiraBaseUrl).toBeUndefined();
    expect(config.jiraAuthHeader).toBeUndefined();
  });

  it('throws when GITHUB_TOKEN is missing', () => {
    delete process.env.GITHUB_TOKEN;
    expect(() => configFromEnv()).toThrow('GITHUB_TOKEN is required');
  });

  it('throws when GITHUB_REPOSITORY is missing', () => {
    process.env.GITHUB_TOKEN = 'tok';
    delete process.env.GITHUB_REPOSITORY;
    expect(() => configFromEnv()).toThrow('GITHUB_REPOSITORY is required');
  });

  it('throws when FERRY_AUDIT_ISSUE is missing', () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    delete process.env.FERRY_AUDIT_ISSUE;
    expect(() => configFromEnv()).toThrow('FERRY_AUDIT_ISSUE is required');
  });

  it('throws when FERRY_AUDIT_ISSUE is not a number', () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.FERRY_AUDIT_ISSUE = 'nan';
    expect(() => configFromEnv()).toThrow('FERRY_AUDIT_ISSUE must be a number');
  });

  it('throws when FERRY_SPEND_CAP_EUR is invalid', () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.FERRY_AUDIT_ISSUE = '1';
    process.env.FERRY_SPEND_CAP_EUR = '-5';
    expect(() => configFromEnv()).toThrow('FERRY_SPEND_CAP_EUR must be a positive number');
  });

  it('builds Jira auth header when credentials are set', () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.FERRY_AUDIT_ISSUE = '1';
    process.env.FERRY_JIRA_BASE_URL = 'https://jira.example.com';
    process.env.FERRY_JIRA_EMAIL = 'user@example.com';
    process.env.FERRY_JIRA_API_TOKEN = 'api-token';
    const config = configFromEnv();
    expect(config.jiraAuthHeader).toMatch(/^Basic /);
    expect(config.jiraBaseUrl).toBe('https://jira.example.com');
  });
});
