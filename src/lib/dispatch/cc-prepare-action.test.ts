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

// Mutable mock seam for `createRunnerFromEnv`. Tests assign a partial CIRunner
// stub into `runnerStub`; the factory mock returns it (cast to CIRunner).
// Tests that don't set it leave `runnerStub = undefined`, and the factory
// returns a runner that throws on any method call — which lets the existing
// section-5 "no GITHUB_TOKEN" assertions stay green (they never reach the
// factory because `requireEnv('GITHUB_TOKEN')` throws first).
const runnerMocks = vi.hoisted(() => ({
  runnerStub: undefined as undefined | Record<string, unknown>,
}));
vi.mock('./runner/factory.js', () => ({
  createRunnerFromEnv: (): unknown =>
    runnerMocks.runnerStub ??
    new Proxy(
      {},
      {
        get(_t, prop): unknown {
          return () => {
            throw new Error(
              `cc-prepare-action.test: runner.${String(prop)} called but no runnerStub was set`,
            );
          };
        },
      },
    ),
}));

import {
  type CcPrepareOutputs,
  type RoleSpecificInput,
  prepareCcJob,
  runCcPrepareAction,
} from './cc-prepare-action.js';
import { JiraTracker } from '../io/tracker/jira/tracker.js';
import { CC_OUTPUT_ARTIFACT_PATH } from '../claude-code/output-artifact.js';
import { CLAUDE_CODE_JOB_PERMISSIONS } from '../claude-code/job-permissions.js';
import { gatedPush } from '../claude-code/secret-scan-gate.js';
import { FerryError } from '../errors/index.js';
import { NO_AUTO_MERGE_DENY } from '../claude-code/tool-policy.js';
import { DEFAULT_FERRY_CONFIG, type FerryConfig } from '../config.js';
import type { TrackerIssue } from '../io/tracker/types.js';
import type { EventEnvelopeV1 } from '../envelope/types.js';
import type { PR, PRFile } from './runner/types.js';
import type { ResolvedCapabilities } from '../labels/capabilities.js';
import type { ScanResult } from '../safety/scan.js';

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
  // Structural push-blocking invariant: claude_args MUST carry --disallowedTools
  // with git push and gh pr merge denied. This is the #303 / ADR-0002 §D gate.
  const disallowedIdx = out.claudeArgs.indexOf('--disallowedTools');
  expect(disallowedIdx).toBeGreaterThanOrEqual(0);
  const disallowed = out.claudeArgs[disallowedIdx + 1] ?? '';
  expect(disallowed).toContain('Bash(git push:*)');
  expect(disallowed).toContain('Bash(gh pr merge:*)');
  // Least-privilege permissions block must be present.
  expect(out.permissionsYaml).toContain('permissions:');
  expect(out.permissionsYaml).toContain('contents: write');
  expect(out.permissionsYaml).toContain('pull-requests: write');
  expect(out.permissionsYaml).toContain('issues: write');
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
      // Satisfy the new CLAUDE_CODE_OAUTH_TOKEN presence check (#351 item 2) by
      // default. Tests that exercise the missing-token path can override.
      CLAUDE_CODE_OAUTH_TOKEN: 'oat-test-stub',
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
// 5. runCcPrepareAction — non-refiner roles reach the role-specific resolver
// ──────────────────────────────────────────────────────────────────────────

describe('runCcPrepareAction — non-refiner roles are wired into the entrypoint (#350)', () => {
  // Before #350 the composite refused with a #333 hint for any non-refiner
  // role. Now developer / reviewer / iterator all advance past the role
  // dispatch and require GITHUB_TOKEN for the runner — proving the role
  // branches are in place. We do NOT mock GitHub here; the assertion is on
  // the error message, which must mention GITHUB_TOKEN (and must NOT mention
  // the old #333 hint).
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
      // Satisfy the new CLAUDE_CODE_OAUTH_TOKEN presence check (#351 item 2).
      CLAUDE_CODE_OAUTH_TOKEN: 'oat-test-stub',
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
    it(`role=${role}: dispatches into the role branch (no #333 refusal)`, async () => {
      tmp = withTempRepo('');
      process.chdir(tmp.cwd);
      // GITHUB_TOKEN intentionally absent — the role branch demands it via
      // `resolveRoleRuntimeContext`, which proves we reached the new code path.
      // Explicitly clear GITHUB_TOKEN because the CI environment sets it, which
      // would otherwise cause requireEnv('GITHUB_TOKEN') to succeed and reach
      // runner.getRepoDefaultBranch before the expected throw.
      vi.stubEnv('GITHUB_TOKEN', '');
      for (const [k, v] of Object.entries(
        baseEnv({ GITHUB_OUTPUT: tmp.outputFile, FERRY_AGENT_ROLE: role }),
      )) {
        vi.stubEnv(k, v);
      }
      vi.stubEnv('GITHUB_TOKEN', '');
      stubJiraGetIssue();

      const promise = runCcPrepareAction();
      await expect(promise).rejects.toThrow(/GITHUB_TOKEN/);
      await expect(promise).rejects.not.toThrow(/#333/);
    });
  }
});

// 6. Hardening invariants (ADR-0002 §accepted-divergences points 3 & 4, #303)
// ──────────────────────────────────────────────────────────────────────────

describe('prepareCcJob — tool-policy and job-permissions hardening (#303)', () => {
  it('claude_args always contains --disallowedTools for every role', async () => {
    const roles = [
      { role: 'developer' as const, input: devInput() },
      { role: 'reviewer' as const, input: reviewerInput() },
      { role: 'iterator' as const, input: iteratorInput() },
      { role: 'refiner' as const, input: refinerInput() },
    ];
    for (const { role, input } of roles) {
      const out = await prepareCcJob({ envelope, issue, role, input });
      expect(out.claudeArgs).toContain('--disallowedTools');
      const idx = out.claudeArgs.indexOf('--disallowedTools');
      const disallowed = out.claudeArgs[idx + 1] ?? '';
      for (const rule of NO_AUTO_MERGE_DENY) {
        expect(disallowed).toContain(rule);
      }
    }
  });

  it('permissionsYaml is the canonical least-privilege block for all roles', async () => {
    const roles = [
      { role: 'developer' as const, input: devInput() },
      { role: 'refiner' as const, input: refinerInput() },
    ];
    for (const { role, input } of roles) {
      const out = await prepareCcJob({ envelope, issue, role, input });
      expect(out.permissionsYaml).toContain('permissions:');
      for (const [scope, level] of Object.entries(CLAUDE_CODE_JOB_PERMISSIONS)) {
        expect(out.permissionsYaml).toContain(`${scope}: ${level}`);
      }
      // id-token: write is required for claude-code-action@v1 OIDC auth (#353).
      expect(out.permissionsYaml).toContain('id-token: write');
      // Must not grant dangerous extra scopes beyond the canonical set.
      expect(out.permissionsYaml).not.toContain('actions: write');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 7. Integration: secret-scan-gate — push is structurally gated (#303,
//    ADR-0002 §accepted-divergences point 4)
//
//    The LLM is denied git push by the tool policy (verified above). The ONLY
//    sanctioned push is through `gatedPush`. These tests verify that invariant
//    end-to-end: a push carrying a planted secret is always aborted; a clean
//    push succeeds.
// ──────────────────────────────────────────────────────────────────────────

describe('secret-scan-gate integration — gatedPush is the sole push mechanism (#303)', () => {
  const CLEAN: ScanResult = { leaksFound: false, findings: [] };
  const DIRTY: ScanResult = {
    leaksFound: true,
    findings: [
      {
        ruleId: 'aws-access-key',
        description: 'AWS access key',
        file: 'src/config.ts',
        startLine: 5,
        endLine: 5,
      },
    ],
  };

  it('gatedPush aborts and never invokes push when a planted secret is found', async () => {
    const scan = vi.fn().mockResolvedValue(DIRTY);
    const push = vi.fn();
    await expect(gatedPush({ repoRoot: '/repo', scan, push })).rejects.toBeInstanceOf(FerryError);
    expect(push).not.toHaveBeenCalled();
  });

  it('gatedPush error carries only the finding count, never the secret content', async () => {
    const scan = vi.fn().mockResolvedValue(DIRTY);
    const push = vi.fn();
    const err = await gatedPush({ repoRoot: '/repo', scan, push }).catch((e) => e);
    expect(err).toBeInstanceOf(FerryError);
    expect((err as FerryError).code).toBe('state-invariant');
    // Only the count is surfaced — never the finding body or secret value.
    expect(JSON.stringify((err as FerryError).context)).not.toContain('AWS access key');
    expect((err as FerryError).context).toMatchObject({ reason: 'secret-scan-hit', findings: 1 });
  });

  it('gatedPush proceeds and invokes push exactly once on a clean tree', async () => {
    const scan = vi.fn().mockResolvedValue(CLEAN);
    const push = vi.fn().mockResolvedValue(undefined);
    await expect(gatedPush({ repoRoot: '/repo', scan, push })).resolves.toBe('pushed');
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('scan runs strictly before push — structural ordering invariant', async () => {
    const calls: string[] = [];
    const scan = vi.fn().mockImplementation(async () => {
      calls.push('scan');
      return CLEAN;
    });
    const push = vi.fn().mockImplementation(async () => {
      calls.push('push');
    });
    await gatedPush({ repoRoot: '/repo', scan, push });
    expect(calls).toEqual(['scan', 'push']);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 8. runCcPrepareAction — pr_number is always written to $GITHUB_OUTPUT (#350)
// ──────────────────────────────────────────────────────────────────────────

describe('runCcPrepareAction — pr_number output (#350)', () => {
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

  it('reviewer: writes pr_number=42 when an open PR exists for the branch (#351)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ferry-cc-prepare-test-'));
    writeFileSync(join(cwd, 'ferry.config.yaml'), '', 'utf8');
    const outputFile = join(cwd, 'gh-output');
    writeFileSync(outputFile, '', 'utf8');
    tmp = { cwd, outputFile, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
    process.chdir(cwd);

    // Mock runner — only the methods reviewer cc-prepare actually invokes need
    // to be defined. `getRepoDefaultBranch` is consulted because the default
    // ferry config has `base_branch: null`.
    const pr = {
      number: 42,
      title: 'feat: signup',
      baseRef: 'main',
      headRef: 'ferry/PROJ-400',
      headSha: 'deadbeef1234567890abcdef1234567890abcdef',
      mergeable: true,
    };
    runnerMocks.runnerStub = {
      getRepoDefaultBranch: () => Promise.resolve('main'),
      listPRsForBranch: () => Promise.resolve([pr]),
      getPR: () => Promise.resolve(pr),
      listPRFiles: () => Promise.resolve([]),
      listPRCommits: () => Promise.resolve([]),
    };

    const env: Record<string, string> = {
      FERRY_ENVELOPE_PAYLOAD: JSON.stringify(envelope),
      FERRY_AGENT_ROLE: 'reviewer',
      FERRY_JIRA_BASE_URL: 'https://acme.atlassian.net',
      FERRY_JIRA_EMAIL: 'bot@acme.com',
      FERRY_JIRA_API_TOKEN: 'token',
      GITHUB_REPO: 'big-emotion/ferry',
      GITHUB_TOKEN: 'gh-token-stub',
      GITHUB_OUTPUT: outputFile,
      CLAUDE_CODE_OAUTH_TOKEN: 'oat-test-stub',
      // Point to the repo's real prompts/ dir — buildSystem() reads it.
      FERRY_PROMPTS_DIR: join(originalCwd, 'prompts'),
    };
    for (const [k, v] of Object.entries(env)) {
      vi.stubEnv(k, v);
    }
    vi.spyOn(JiraTracker.prototype, 'getIssue').mockResolvedValue(issue);

    try {
      await runCcPrepareAction();

      const written = readFileSync(outputFile, 'utf8');
      expect(written).toMatch(/^pr_number=42$/m);
    } finally {
      runnerMocks.runnerStub = undefined;
    }
  });

  it('refiner: writes an empty pr_number= line (refiner has no PR)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ferry-cc-prepare-test-'));
    writeFileSync(join(cwd, 'ferry.config.yaml'), '', 'utf8');
    const outputFile = join(cwd, 'gh-output');
    writeFileSync(outputFile, '', 'utf8');
    tmp = { cwd, outputFile, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
    process.chdir(cwd);

    const env: Record<string, string> = {
      FERRY_ENVELOPE_PAYLOAD: JSON.stringify(envelope),
      FERRY_AGENT_ROLE: 'refiner',
      FERRY_JIRA_BASE_URL: 'https://acme.atlassian.net',
      FERRY_JIRA_EMAIL: 'bot@acme.com',
      FERRY_JIRA_API_TOKEN: 'token',
      GITHUB_REPO: 'big-emotion/ferry',
      GITHUB_OUTPUT: outputFile,
      // Satisfy the new CLAUDE_CODE_OAUTH_TOKEN presence check (#351 item 2).
      CLAUDE_CODE_OAUTH_TOKEN: 'oat-test-stub',
      // Point to the repo's real prompts/ dir — buildSystem() reads it.
      FERRY_PROMPTS_DIR: join(originalCwd, 'prompts'),
    };
    for (const [k, v] of Object.entries(env)) {
      vi.stubEnv(k, v);
    }
    vi.spyOn(JiraTracker.prototype, 'getIssue').mockResolvedValue(issue);

    await runCcPrepareAction();

    const written = readFileSync(outputFile, 'utf8');
    expect(written).toMatch(/^pr_number=$/m);
  });
});
