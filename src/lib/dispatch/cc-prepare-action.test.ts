/**
 * Fixture-driven tests for the ferry-cc-prepare front-step (ADR-0006 §2, issue #331).
 *
 * For each of the four agent roles, this asserts that given a fully-resolved
 * input (envelope + Jira issue + role-specific upstream state), the composite
 * emits byte-stable outputs that downstream `claude-code-action@v1` consumes:
 *
 *   prompt | claude_args (JSON array) | allowed_native_tools (JSON array) |
 *   output_artifact_path | mcp_config (JSON) | idempotency_marker
 *
 * Two structural invariants from ADR-0006 §6 are also exercised at this layer:
 *
 *   1. `CLAUDE_CODE_OAUTH_TOKEN` is never written to stdout / stderr / outputs.
 *   2. The composite refuses to run when:
 *        (a) `ANTHROPIC_API_KEY` is present alongside `CLAUDE_CODE_OAUTH_TOKEN`, or
 *        (b) any configured agent provider is not `anthropic` (defense-in-depth,
 *            mirrors issue #329 — even if the resolver mistakenly emits
 *            `path == 'claude-code'`, cc-prepare refuses to run).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock JiraTracker so runCcPrepareAction tests that need to reach the role
// switch can resolve `tracker.getIssue(...)` without hitting the network.
// Tests that fail earlier (auth invariant, provider gate) never reach this
// code path and are unaffected.
vi.mock('../io/tracker/jira/tracker.js', () => {
  class JiraTracker {
    async getIssue(): Promise<unknown> {
      throw new Error('JiraTracker.getIssue not stubbed in test');
    }
  }
  return { JiraTracker };
});

vi.mock('../io/jira-rest.js', () => {
  class JiraRestClient {
    constructor() {}
  }
  return { JiraRestClient };
});

import {
  type CcPrepareOutputs,
  type RoleSpecificInput,
  prepareCcJob,
  runCcPrepareAction,
} from './cc-prepare-action.js';
import { JiraTracker } from '../io/tracker/jira/tracker.js';
import { CC_OUTPUT_ARTIFACT_PATH } from '../claude-code/output-artifact.js';
import { DEFAULT_FERRY_CONFIG, type FerryConfig } from '../config.js';
import type { TrackerIssue } from '../io/tracker/types.js';
import type { EventEnvelopeV1 } from '../envelope/types.js';
import type { PR, PRFile } from './runner/types.js';
import type { ResolvedCapabilities } from '../labels/capabilities.js';

// ──────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ──────────────────────────────────────────────────────────────────────────

const REPO_ROOT = '/workspace/repo';

const envelope: EventEnvelopeV1 = {
  version: 'v1',
  event_id: 'evt-fixed-001',
  ticket_key: 'PROJ-400',
  phase: 'dev',
  source: 'jira-column',
  ts: '2026-01-01T00:00:00Z',
};

const issue: TrackerIssue = {
  key: 'PROJ-400',
  summary: 'Implement signup',
  description: 'AC: signup endpoint',
  comments: ['First comment'],
  labels: [],
  issueType: 'Story',
  issueTypeRaw: 'Story',
};

const emptyCapabilities: ResolvedCapabilities = {
  mcpServerNames: [],
  serverAllowedTools: {},
  triggeredLabels: [],
  unknownFerryLabels: [],
};

const cfg = DEFAULT_FERRY_CONFIG;

/** Deterministic stub for buildSystem — the prepare functions accept this seam. */
const buildSystemStub = (name: string, _root: string, opts?: { extraParts?: unknown[] }) =>
  `SYSTEM(${name}, parts=${(opts?.extraParts ?? []).length})`;

const loadOptionalPromptStub = () => null;

// ──────────────────────────────────────────────────────────────────────────
// Per-role helpers
// ──────────────────────────────────────────────────────────────────────────

function devInput(): RoleSpecificInput {
  return {
    role: 'developer',
    effectiveCfg: cfg,
    subtasks: ['Step one'],
    testRunner: 'vitest',
    pkgManagerHint: undefined,
    tree: '(unavailable)',
    typeOverride: undefined,
    owner: 'big-emotion',
    repo: 'ferry',
    baseBranch: 'main',
    mcpPool: [],
    dryRun: true, // tests skip the PR-existence probe by default
    // git seam: pretend a fresh branch was created (no prior commits)
    _checkoutOrCreateBranch: () => ({ branchHeadSha: '', existingLog: '' }),
    _configureGitUser: () => {},
    _buildSystem: buildSystemStub,
    _runner: {
      listPRsForBranch: () => Promise.resolve([]),
      listPRFiles: () => Promise.resolve([]),
    },
  };
}

function reviewerInput(): RoleSpecificInput {
  const pr: PR = {
    number: 7,
    title: 'feat: signup',
    baseRef: 'main',
    headRef: 'ferry/feat/PROJ-400',
    headSha: 'deadbeef1234567890abcdef1234567890abcdef',
    mergeable: true,
  };
  const files: PRFile[] = [
    { filename: 'src/signup.ts', status: 'added', additions: 12, deletions: 0, patch: '@@ p' },
  ];
  const commits = [{ sha: 'cafe1234', message: 'feat: signup\n\nbody' }];
  return {
    role: 'reviewer',
    effectiveCfg: cfg,
    pr,
    files,
    commits,
    branchName: 'ferry/feat/PROJ-400',
    typeOverride: undefined,
    reviewRubric: undefined,
    capabilities: emptyCapabilities,
    repoRoot: REPO_ROOT,
    _buildSystem: buildSystemStub,
    _loadOptionalPrompt: loadOptionalPromptStub,
  };
}

function iteratorInput(): RoleSpecificInput {
  return {
    role: 'iterator',
    effectiveCfg: cfg,
    headSha: 'deadbeef1234567890abcdef1234567890abcdef',
    reviewComment: '**Verdict**: Changes Requested\n- fix the null check',
    mergeConflicts: [],
    existingLog: 'abc1234 fix: prior commit',
    mcpPool: [],
    configLabels: undefined,
    capabilities: emptyCapabilities,
    typeOverride: undefined,
    repoRoot: REPO_ROOT,
    _buildSystem: buildSystemStub,
  };
}

function refinerInput(): RoleSpecificInput {
  return {
    role: 'refiner',
    effectiveCfg: cfg,
    existingSubtasks: [],
    priorRefinerRuns: [],
    runLink: 'https://github.com/big-emotion/ferry/actions/runs/0',
    repoRoot: REPO_ROOT,
    _buildSystem: buildSystemStub,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 1. Per-role byte-stable output assertions
// ──────────────────────────────────────────────────────────────────────────

describe('prepareCcJob — per-role outputs are stable and structurally correct', () => {
  it('developer: emits prompt, claude_args, allowed_native_tools, mcp_config, idempotency_marker', async () => {
    const out = await prepareCcJob({ envelope, issue, role: 'developer', input: devInput() });
    expectCommonInvariants(out);
    // developer is read-write → native tool surface is the full set
    expect(out.allowedNativeTools).toEqual(['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']);
    // initial prompt carries the developer's ticket block + subtasks marker
    expect(out.prompt).toContain('TICKET: PROJ-400');
    expect(out.prompt).toContain('SUBTASKS:\nStep one');
    expect(out.prompt).toContain(CC_OUTPUT_ARTIFACT_PATH);
    // idempotency falls back to event_id when no prior branch SHA exists
    expect(out.idempotencyMarker).toBe('[ferry:dev:evt-fixed-001]');
    // claude_args carries the role's --append-system-prompt + --allowedTools
    const args = out.claudeArgs;
    expect(args).toContain('--append-system-prompt');
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe('SYSTEM(dev, parts=0)');
    expect(args).toContain('--allowedTools');
  });

  it('reviewer: emits read-only native tools + reviewer initial prompt + sha7 marker', async () => {
    const out = await prepareCcJob({ envelope, issue, role: 'reviewer', input: reviewerInput() });
    expectCommonInvariants(out);
    expect(out.allowedNativeTools).toEqual(['Read', 'Glob', 'Grep']);
    expect(out.prompt).toContain('## PR Metadata');
    expect(out.prompt).toContain('PR #7');
    expect(out.idempotencyMarker).toBe('[ferry:reviewer:deadbee]');
  });

  it('iterator: emits read-write native tools + iterator initial prompt + sha7 marker', async () => {
    const out = await prepareCcJob({ envelope, issue, role: 'iterator', input: iteratorInput() });
    expectCommonInvariants(out);
    expect(out.allowedNativeTools).toEqual(['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']);
    expect(out.prompt).toContain('## Review Findings');
    expect(out.prompt).toContain('fix the null check');
    expect(out.idempotencyMarker).toBe('[ferry:iterator:deadbee]');
  });

  it('refiner: emits read-only native tools + refiner JSON-mode prompt + event_id marker', async () => {
    const out = await prepareCcJob({ envelope, issue, role: 'refiner', input: refinerInput() });
    expectCommonInvariants(out);
    expect(out.allowedNativeTools).toEqual(['Read', 'Glob', 'Grep']);
    // refiner script-path prompt anchor
    expect(out.prompt).toContain('You are the Ferry Refiner');
    expect(out.prompt).toContain('Reply with JSON only');
    // refiner uses event_id (no PR SHA available)
    expect(out.idempotencyMarker).toBe('[ferry:refiner:evt-fixed-001]');
  });
});

function expectCommonInvariants(out: CcPrepareOutputs): void {
  expect(out.outputArtifactPath).toBe(CC_OUTPUT_ARTIFACT_PATH);
  // mcpConfig is a JSON-encodable object (never undefined; empty pool → { mcpServers: {} }).
  expect(typeof out.mcpConfig).toBe('object');
  expect(out.mcpConfig).not.toBeNull();
  // claudeArgs is a flat array of tokens — no nested objects.
  for (const tok of out.claudeArgs) {
    expect(typeof tok).toBe('string');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 2. Auth invariant + provider gate (ADR-0006 §6)
// ──────────────────────────────────────────────────────────────────────────

describe('runCcPrepareAction — auth + provider gates', () => {
  let originalCwd: string;
  let tmp: { cwd: string; outputFile: string; cleanup: () => void };

  beforeEach(() => {
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (tmp) tmp.cleanup();
  });

  function withTempRepo(configYaml: string): typeof tmp {
    const cwd = mkdtempSync(join(tmpdir(), 'ferry-cc-prepare-test-'));
    writeFileSync(join(cwd, 'ferry.config.yaml'), configYaml, 'utf8');
    const outputFile = join(cwd, 'gh-output');
    writeFileSync(outputFile, '', 'utf8');
    return { cwd, outputFile, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
  }

  function baseEnv(extra: Record<string, string> = {}): Record<string, string> {
    return {
      FERRY_ENVELOPE_PAYLOAD: JSON.stringify(envelope),
      FERRY_AGENT_ROLE: 'developer',
      FERRY_JIRA_BASE_URL: 'https://acme.atlassian.net',
      FERRY_JIRA_EMAIL: 'bot@acme.com',
      FERRY_JIRA_API_TOKEN: 'token',
      GITHUB_REPO: 'big-emotion/ferry',
      ...extra,
    };
  }

  it('refuses when ANTHROPIC_API_KEY is present alongside CLAUDE_CODE_OAUTH_TOKEN', async () => {
    tmp = withTempRepo('');
    process.chdir(tmp.cwd);
    for (const [k, v] of Object.entries(
      baseEnv({
        GITHUB_OUTPUT: tmp.outputFile,
        ANTHROPIC_API_KEY: 'sk-anthropic-XYZ',
        CLAUDE_CODE_OAUTH_TOKEN: 'oat-CLAUDE-XYZ',
      }),
    )) {
      vi.stubEnv(k, v);
    }

    await expect(runCcPrepareAction()).rejects.toThrow(/ANTHROPIC_API_KEY/i);
  });

  it('refuses when any configured provider is not anthropic (defense-in-depth)', async () => {
    // Mix in openai for the dev agent → provider gate must fire.
    tmp = withTempRepo(
      [
        'models:',
        '  refiner:',
        '    provider: anthropic',
        '    model: claude-sonnet-4-6',
        '  dev:',
        '    provider: openai',
        '    model: gpt-5',
        '  review:',
        '    provider: anthropic',
        '    model: claude-sonnet-4-6',
        '  iterate:',
        '    provider: anthropic',
        '    model: claude-sonnet-4-6',
      ].join('\n'),
    );
    process.chdir(tmp.cwd);
    for (const [k, v] of Object.entries(baseEnv({ GITHUB_OUTPUT: tmp.outputFile }))) {
      vi.stubEnv(k, v);
    }

    await expect(runCcPrepareAction()).rejects.toThrow(/anthropic-only|provider/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. OAuth-token never logged
// ──────────────────────────────────────────────────────────────────────────

describe('runCcPrepareAction — CLAUDE_CODE_OAUTH_TOKEN is never logged', () => {
  it('the token value does not appear in stdout/stderr or GITHUB_OUTPUT, even when refusing', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ferry-cc-prepare-test-'));
    writeFileSync(join(cwd, 'ferry.config.yaml'), '', 'utf8');
    const outputFile = join(cwd, 'gh-output');
    writeFileSync(outputFile, '', 'utf8');
    const originalCwd = process.cwd();
    process.chdir(cwd);
    const OAUTH = 'oat-SECRET-DO-NOT-LOG-12345';
    const API_KEY = 'sk-anthropic-XYZ';
    const env: Record<string, string> = {
      FERRY_ENVELOPE_PAYLOAD: JSON.stringify(envelope),
      FERRY_AGENT_ROLE: 'developer',
      FERRY_JIRA_BASE_URL: 'https://acme.atlassian.net',
      FERRY_JIRA_EMAIL: 'bot@acme.com',
      FERRY_JIRA_API_TOKEN: 'token',
      GITHUB_REPO: 'big-emotion/ferry',
      GITHUB_OUTPUT: outputFile,
      ANTHROPIC_API_KEY: API_KEY,
      CLAUDE_CODE_OAUTH_TOKEN: OAUTH,
    };
    for (const [k, v] of Object.entries(env)) {
      vi.stubEnv(k, v);
    }

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await expect(runCcPrepareAction()).rejects.toThrow();
    } finally {
      const allWrites = [
        ...stdoutSpy.mock.calls.map((c) => String(c[0])),
        ...stderrSpy.mock.calls.map((c) => String(c[0])),
      ].join('');
      const outputFileContents = readFileSync(outputFile, 'utf8');
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      process.chdir(originalCwd);
      vi.unstubAllEnvs();
      rmSync(cwd, { recursive: true, force: true });

      expect(allWrites).not.toContain(API_KEY);
      expect(outputFileContents).not.toContain(API_KEY);
      expect(allWrites).not.toContain(OAUTH);
      expect(outputFileContents).not.toContain(OAUTH);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. prepareCcJob — passes anthropicOnly config without complaint
// ──────────────────────────────────────────────────────────────────────────

describe('prepareCcJob — anthropicOnly invariant', () => {
  it('throws if effectiveCfg is not Anthropic-only (defense-in-depth at core boundary)', async () => {
    const mixed: FerryConfig = {
      ...cfg,
      models: {
        ...cfg.models,
        dev: { provider: 'openai', model: 'gpt-5' },
      },
    };
    await expect(
      prepareCcJob({
        envelope,
        issue,
        role: 'developer',
        input: { ...devInput(), effectiveCfg: mixed },
      }),
    ).rejects.toThrow(/anthropic-only|provider/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. runCcPrepareAction — not-yet-wired roles refuse with #333 hint
// ──────────────────────────────────────────────────────────────────────────

describe('runCcPrepareAction — not-yet-wired roles refuse with #333 hint', () => {
  let originalCwd: string;
  let tmp: { cwd: string; outputFile: string; cleanup: () => void };

  beforeEach(() => {
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (tmp) tmp.cleanup();
  });

  function withTempRepo(configYaml: string): typeof tmp {
    const cwd = mkdtempSync(join(tmpdir(), 'ferry-cc-prepare-test-'));
    writeFileSync(join(cwd, 'ferry.config.yaml'), configYaml, 'utf8');
    const outputFile = join(cwd, 'gh-output');
    writeFileSync(outputFile, '', 'utf8');
    return { cwd, outputFile, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
  }

  function baseEnv(extra: Record<string, string> = {}): Record<string, string> {
    return {
      FERRY_ENVELOPE_PAYLOAD: JSON.stringify(envelope),
      FERRY_JIRA_BASE_URL: 'https://acme.atlassian.net',
      FERRY_JIRA_EMAIL: 'bot@acme.com',
      FERRY_JIRA_API_TOKEN: 'token',
      GITHUB_REPO: 'big-emotion/ferry',
      ...extra,
    };
  }

  function stubJiraGetIssue(): void {
    // Each instance of JiraTracker (mocked above) is constructed inside
    // runCcPrepareAction. Hook the prototype `getIssue` so any instance
    // resolves to the test fixture without network IO.
    vi.spyOn(JiraTracker.prototype, 'getIssue').mockResolvedValue(issue);
  }

  for (const role of ['developer', 'reviewer', 'iterator'] as const) {
    it(`refuses with a #333 hint when FERRY_AGENT_ROLE=${role}`, async () => {
      tmp = withTempRepo('');
      process.chdir(tmp.cwd);
      for (const [k, v] of Object.entries(
        baseEnv({ GITHUB_OUTPUT: tmp.outputFile, FERRY_AGENT_ROLE: role }),
      )) {
        vi.stubEnv(k, v);
      }
      stubJiraGetIssue();

      await expect(runCcPrepareAction()).rejects.toThrow(/#333/);
    });
  }
});
