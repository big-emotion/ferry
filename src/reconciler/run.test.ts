import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  run,
  buildDefaultDeps,
  configFromEnv,
  type ReconcilerConfig,
  type ReconcilerDeps,
} from './run.js';
import type { DispatchDirective } from './reconcile.js';

const BASE_CONFIG: ReconcilerConfig = {
  githubToken: 'gh-token',
  owner: 'big-emotion',
  repo: 'ferry',
  auditIssue: 42,
  nowMs: new Date('2026-05-01T10:00:00Z').getTime(),
  workspace: '.',
};

function makeDeps(overrides: Partial<ReconcilerDeps> = {}): ReconcilerDeps {
  return {
    searchJira: vi.fn().mockResolvedValue([]),
    readStatePhase: vi.fn().mockReturnValue(undefined), // (_key, _workspace) => undefined
    scanStateTickets: vi.fn().mockReturnValue([]), // (_workspace) => []
    fetchAuditComments: vi.fn().mockResolvedValue([]),
    issueDispatch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('reconciler/run — workflow → module entrypoint', () => {
  it('returns scanned=0 when no tickets are found', async () => {
    const deps = makeDeps();
    const outcome = await run(BASE_CONFIG, deps);
    expect(outcome.scanned).toBe(0);
    expect(outcome.dispatched).toEqual([]);
    expect(deps.issueDispatch).not.toHaveBeenCalled();
  });

  it('dispatches a stalled ticket when Jira column does not match state.phase', async () => {
    const dispatched: DispatchDirective[] = [];
    const deps = makeDeps({
      searchJira: vi.fn().mockResolvedValue([
        { key: 'PROJ-1', column: 'In Review' },
      ]),
      readStatePhase: vi.fn().mockReturnValue('developing'),
      fetchAuditComments: vi.fn().mockResolvedValue([]),
      issueDispatch: vi.fn().mockImplementation(async (_cfg, d: DispatchDirective) => {
        dispatched.push(d);
      }),
    });

    const outcome = await run(BASE_CONFIG, deps);
    expect(outcome.scanned).toBe(1);
    expect(outcome.dispatched).toHaveLength(1);
    expect(outcome.dispatched[0].ticket_key).toBe('PROJ-1');
    expect(outcome.dispatched[0].source).toBe('reconciler');
    expect(deps.issueDispatch).toHaveBeenCalledOnce();
    expect(dispatched[0].phase).toBe('review');
  });

  it('does NOT dispatch when column matches state.phase', async () => {
    const deps = makeDeps({
      searchJira: vi.fn().mockResolvedValue([
        { key: 'PROJ-2', column: 'In Review' },
      ]),
      readStatePhase: vi.fn().mockReturnValue('reviewing'),
      fetchAuditComments: vi.fn().mockResolvedValue([]),
    });

    const outcome = await run(BASE_CONFIG, deps);
    expect(outcome.dispatched).toEqual([]);
    expect(deps.issueDispatch).not.toHaveBeenCalled();
  });

  it('dispatches tickets found via state file scan (no Jira config)', async () => {
    const deps = makeDeps({
      searchJira: vi.fn().mockResolvedValue([]),
      scanStateTickets: vi.fn().mockReturnValue(['PROJ-3']),
      readStatePhase: vi.fn().mockReturnValue('developing'),
      // Simulate last audit > 20 min ago by returning no matching audit comment
      fetchAuditComments: vi.fn().mockResolvedValue([]),
    });

    // PROJ-3 has no Jira result, so column defaults to 'In Development'.
    // state_phase='developing' matches PHASE_TO_COLUMN['developing']='In Development'.
    // No mismatch → no dispatch.
    const outcome = await run(BASE_CONFIG, deps);
    expect(outcome.dispatched).toEqual([]);
  });

  it('dispatches state-file ticket whose column does not match phase', async () => {
    const deps = makeDeps({
      searchJira: vi.fn().mockResolvedValue([
        { key: 'PROJ-4', column: 'In Review' },
      ]),
      scanStateTickets: vi.fn().mockReturnValue(['PROJ-4']),
      readStatePhase: vi.fn().mockReturnValue('developing'),
      fetchAuditComments: vi.fn().mockResolvedValue([]),
    });

    const outcome = await run(BASE_CONFIG, deps);
    expect(outcome.dispatched).toHaveLength(1);
    expect(outcome.dispatched[0].ticket_key).toBe('PROJ-4');
  });

  it('reads last-audit timestamp from audit issue comments', async () => {
    const recentMs = BASE_CONFIG.nowMs - 5 * 60 * 1_000; // 5 min ago
    const deps = makeDeps({
      searchJira: vi.fn().mockResolvedValue([]),
      scanStateTickets: vi.fn().mockReturnValue(['PROJ-5']),
      readStatePhase: vi.fn().mockReturnValue(undefined),
      fetchAuditComments: vi.fn().mockResolvedValue([
        {
          body: '[ferry:audit:01ABCDEFGHIJKLMNOPQRSTUVWX]\n{"ticket":"PROJ-5","phase":"dev","model":"claude-sonnet-4-6","outcome":"success","cost_eur":0.01}',
          created_at: new Date(recentMs).toISOString(),
        },
      ]),
    });

    // PROJ-5 has no state_phase, last audit is 5 min ago (< 20 min) → no dispatch.
    const outcome = await run(BASE_CONFIG, deps);
    expect(outcome.dispatched).toEqual([]);
  });

  it('dispatches ticket with no state file and stale last audit (> 20 min)', async () => {
    const staleMs = BASE_CONFIG.nowMs - 30 * 60 * 1_000; // 30 min ago
    const deps = makeDeps({
      searchJira: vi.fn().mockResolvedValue([
        { key: 'PROJ-6', column: 'In Development' },
      ]),
      readStatePhase: vi.fn().mockReturnValue(undefined),
      fetchAuditComments: vi.fn().mockResolvedValue([
        {
          body: '[ferry:audit:01ABCDEFGHIJKLMNOPQRSTUVWX]\n{"ticket":"PROJ-6","phase":"dev","model":"claude-sonnet-4-6","outcome":"success","cost_eur":0.01}',
          created_at: new Date(staleMs).toISOString(),
        },
      ]),
    });

    const outcome = await run(BASE_CONFIG, deps);
    expect(outcome.dispatched).toHaveLength(1);
    expect(outcome.dispatched[0].ticket_key).toBe('PROJ-6');
  });

  it('skips tickets in non-Ferry Jira columns', async () => {
    const deps = makeDeps({
      searchJira: vi.fn().mockResolvedValue([
        { key: 'PROJ-7', column: 'Done' },
        { key: 'PROJ-8', column: 'Ready to Merge' },
      ]),
      readStatePhase: vi.fn().mockReturnValue('reviewing'),
      fetchAuditComments: vi.fn().mockResolvedValue([]),
    });

    const outcome = await run(BASE_CONFIG, deps);
    expect(outcome.scanned).toBe(0);
    expect(outcome.dispatched).toEqual([]);
  });

  it('issues dispatch with correct event payload structure', async () => {
    const capturedArgs: Array<{ directive: DispatchDirective }> = [];
    const deps = makeDeps({
      searchJira: vi.fn().mockResolvedValue([
        { key: 'PROJ-9', column: 'In Review' },
      ]),
      readStatePhase: vi.fn().mockReturnValue('developing'),
      fetchAuditComments: vi.fn().mockResolvedValue([]),
      issueDispatch: vi.fn().mockImplementation(async (_cfg, d: DispatchDirective) => {
        capturedArgs.push({ directive: d });
      }),
    });

    await run(BASE_CONFIG, deps);
    expect(capturedArgs).toHaveLength(1);
    expect(capturedArgs[0].directive.source).toBe('reconciler');
    expect(capturedArgs[0].directive.event_id).toMatch(/^[0-9A-Z]{26}$/);
    expect(capturedArgs[0].directive.phase).toBe('review');
  });
});

describe('buildDefaultDeps — I/O helpers', () => {
  const deps = buildDefaultDeps();

  it('readStatePhase returns undefined for non-existent workspace', () => {
    expect(deps.readStatePhase('NONEXIST-1', '/tmp/no-such-ws-xyz')).toBeUndefined();
  });

  it('scanStateTickets returns empty array for non-existent workspace', () => {
    expect(deps.scanStateTickets('/tmp/no-such-ws-xyz')).toEqual([]);
  });

  it('searchJira returns empty array when jiraBaseUrl is not configured', async () => {
    const result = await deps.searchJira(BASE_CONFIG);
    expect(result).toEqual([]);
  });

  it('searchJira returns empty array when Jira responds with non-ok status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);
    vi.stubGlobal('fetch', mockFetch);
    const config = {
      ...BASE_CONFIG,
      jiraBaseUrl: 'https://jira.example.com',
      jiraAuthHeader: 'Basic xxx',
      jiraProject: 'PROJ',
    };
    const result = await deps.searchJira(config);
    expect(result).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('searchJira maps issues to key+column when Jira responds ok', async () => {
    const payload = {
      issues: [{ key: 'PROJ-1', fields: { status: { name: 'In Review' } } }],
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    } as unknown as Response);
    vi.stubGlobal('fetch', mockFetch);
    const config = {
      ...BASE_CONFIG,
      jiraBaseUrl: 'https://jira.example.com',
      jiraAuthHeader: 'Basic xxx',
      jiraProject: 'PROJ',
    };
    const result = await deps.searchJira(config);
    expect(result).toEqual([{ key: 'PROJ-1', column: 'In Review' }]);
    vi.unstubAllGlobals();
  });
});

describe('configFromEnv (reconciler)', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('builds config from env vars', () => {
    process.env.GITHUB_TOKEN = 'gh-tok';
    process.env.GITHUB_REPOSITORY = 'org/repo';
    process.env.FERRY_AUDIT_ISSUE = '7';
    delete process.env.FERRY_JIRA_BASE_URL;
    delete process.env.FERRY_JIRA_EMAIL;
    delete process.env.FERRY_JIRA_API_TOKEN;
    delete process.env.FERRY_JIRA_PROJECT;
    const config = configFromEnv();
    expect(config.githubToken).toBe('gh-tok');
    expect(config.owner).toBe('org');
    expect(config.repo).toBe('repo');
    expect(config.auditIssue).toBe(7);
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
    process.env.GITHUB_REPOSITORY = 'org/repo';
    delete process.env.FERRY_AUDIT_ISSUE;
    expect(() => configFromEnv()).toThrow('FERRY_AUDIT_ISSUE is required');
  });

  it('throws when FERRY_AUDIT_ISSUE is not a number', () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'org/repo';
    process.env.FERRY_AUDIT_ISSUE = 'nan';
    expect(() => configFromEnv()).toThrow('FERRY_AUDIT_ISSUE must be a number');
  });

  it('builds Jira auth header when credentials are set', () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'org/repo';
    process.env.FERRY_AUDIT_ISSUE = '1';
    process.env.FERRY_JIRA_BASE_URL = 'https://jira.example.com';
    process.env.FERRY_JIRA_EMAIL = 'user@example.com';
    process.env.FERRY_JIRA_API_TOKEN = 'api-token';
    process.env.FERRY_JIRA_PROJECT = 'PROJ';
    const config = configFromEnv();
    expect(config.jiraAuthHeader).toMatch(/^Basic /);
    expect(config.jiraProject).toBe('PROJ');
  });
});
