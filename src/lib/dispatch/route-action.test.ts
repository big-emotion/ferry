import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRouteAction } from './route-action.js';

/**
 * Routing-CLI integration tests (ADR-0006 §3, issue #300).
 *
 * Exercises the env/IO shell around the pure `resolveExecutionPath` resolver:
 * envelope parsing, Jira label fetch (mocked), ferry.config loading (real, from
 * a tmpdir), and GITHUB_OUTPUT writes. The pure resolver itself is unit-tested
 * separately in src/lib/cc-wrappers/routing.test.ts — here we only assert that
 * the right inputs reach it and the right outputs land.
 */

const ENVELOPE = {
  version: 'v1' as const,
  event_id: '01HZZZZZZZZZZZZZZZZZZZZZZ1',
  ticket_key: 'TEST-1',
  phase: 'dev' as const,
  source: 'jira-column' as const,
  ts: '2026-05-20T00:00:00.000Z',
};

function makeMockResponse(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body ?? {}),
  } as unknown as Response;
}

function jiraIssueWith(labels: string[]): unknown {
  return {
    id: '10001',
    key: ENVELOPE.ticket_key,
    fields: {
      summary: 'test',
      description: null,
      comment: { comments: [] },
      labels,
      issuetype: { name: 'Story' },
    },
  };
}

function withTempRepo(configYaml: string | null): {
  cwd: string;
  outputFile: string;
  cleanup: () => void;
} {
  const cwd = mkdtempSync(join(tmpdir(), 'ferry-route-test-'));
  if (configYaml !== null) {
    writeFileSync(join(cwd, 'ferry.config.yaml'), configYaml, 'utf8');
  }
  // The .github dir needs to exist for some loaders that probe for it.
  mkdirSync(join(cwd, '.github'), { recursive: true });
  const outputFile = join(cwd, 'gh-output');
  writeFileSync(outputFile, '', 'utf8');
  return {
    cwd,
    outputFile,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

function setEnv(overrides: Record<string, string>): void {
  for (const [k, v] of Object.entries(overrides)) {
    vi.stubEnv(k, v);
  }
}

const BASE_ENV = {
  FERRY_ENVELOPE_PAYLOAD: JSON.stringify(ENVELOPE),
  FERRY_AGENT_ROLE: 'developer',
  FERRY_JIRA_BASE_URL: 'https://acme.atlassian.net',
  FERRY_JIRA_EMAIL: 'bot@acme.com',
  FERRY_JIRA_API_TOKEN: 'token',
};

describe('route-action: resolves and emits execution path', () => {
  let originalCwd: string;
  let tmp: ReturnType<typeof withTempRepo>;

  beforeEach(() => {
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (tmp) tmp.cleanup();
  });

  it('emits path=claude-code when label `ferry:claude-code` is present', async () => {
    tmp = withTempRepo(null); // No config → defaults; the heuristic + default produce script-like behaviour.
    process.chdir(tmp.cwd);
    setEnv({ ...BASE_ENV, GITHUB_OUTPUT: tmp.outputFile });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeMockResponse(200, jiraIssueWith(['ferry:claude-code']))),
    );

    const decision = await runRouteAction();

    expect(decision.path).toBe('claude-code');
    expect(decision.reason).toBe('label');
  });

  it('emits path=script when label `ferry:no-claude-code` is present', async () => {
    tmp = withTempRepo(null);
    process.chdir(tmp.cwd);
    setEnv({ ...BASE_ENV, GITHUB_OUTPUT: tmp.outputFile });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeMockResponse(200, jiraIssueWith(['ferry:no-claude-code']))),
    );

    const decision = await runRouteAction();

    expect(decision.path).toBe('script');
    expect(decision.reason).toBe('label');
  });

  it('emits path=script (hard lock) when ferry.config has execution_path: script, regardless of label', async () => {
    tmp = withTempRepo('execution_path: script\n');
    process.chdir(tmp.cwd);
    setEnv({ ...BASE_ENV, GITHUB_OUTPUT: tmp.outputFile });
    vi.stubGlobal(
      'fetch',
      // Even with the claude-code label, the explicit script lock wins.
      vi.fn().mockResolvedValue(makeMockResponse(200, jiraIssueWith(['ferry:claude-code']))),
    );

    const decision = await runRouteAction();

    expect(decision.path).toBe('script');
    expect(decision.reason).toBe('default');
  });

  it('defaults to claude-code for an Anthropic-only config with no label override', async () => {
    tmp = withTempRepo(
      // Default config is already Anthropic-only (claude-sonnet for every agent),
      // so an empty config yields the claude-code conditional default.
      '',
    );
    process.chdir(tmp.cwd);
    setEnv({ ...BASE_ENV, GITHUB_OUTPUT: tmp.outputFile });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeMockResponse(200, jiraIssueWith([]))));

    const decision = await runRouteAction();

    expect(decision.path).toBe('claude-code');
    expect(decision.reason).toBe('default');
  });

  it('emits path=codex-cli for OpenAI role config and ferry:codex-cli label', async () => {
    tmp = withTempRepo(`models:
  dev:
    provider: openai
    model: gpt-5-codex
`);
    process.chdir(tmp.cwd);
    setEnv({ ...BASE_ENV, GITHUB_OUTPUT: tmp.outputFile });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeMockResponse(200, jiraIssueWith(['ferry:codex-cli']))),
    );

    const decision = await runRouteAction();

    expect(decision.path).toBe('codex-cli');
    expect(decision.reason).toBe('label');
  });

  it('writes both `path` and `reason` to $GITHUB_OUTPUT in the `name=value\\n` form', async () => {
    tmp = withTempRepo(null);
    process.chdir(tmp.cwd);
    setEnv({ ...BASE_ENV, GITHUB_OUTPUT: tmp.outputFile });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeMockResponse(200, jiraIssueWith(['ferry:claude-code']))),
    );

    await runRouteAction();

    const { readFileSync } = await import('node:fs');
    const out = readFileSync(tmp.outputFile, 'utf8');
    expect(out).toContain('path=claude-code\n');
    expect(out).toContain('reason=label\n');
  });
});
