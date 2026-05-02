import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../prompt.js', () => ({
  printSuccess: vi.fn(),
  print: vi.fn(),
  printSkip: vi.fn(),
  printWarn: vi.fn(),
  printError: vi.fn(),
}));

import { buildJiraBundle, stepJiraBundle } from './jira-bundle.js';

describe('buildJiraBundle', () => {
  it('returns cloud:true at top level with no version or type fields', () => {
    const bundle = buildJiraBundle('owner', 'repo');
    expect(bundle.cloud).toBe(true);
    expect(bundle).not.toHaveProperty('version');
    expect(bundle).not.toHaveProperty('type');
  });

  it('returns 4 rules', () => {
    const bundle = buildJiraBundle('owner', 'repo');
    expect(bundle.rules).toHaveLength(4);
  });

  it('each rule uses components array with correct action type', () => {
    const bundle = buildJiraBundle('owner', 'repo');
    for (const rule of bundle.rules) {
      expect(rule).not.toHaveProperty('actions');
      expect(rule.components).toHaveLength(1);
      expect(rule.components[0]?.component).toBe('ACTION');
      expect(rule.components[0]?.type).toBe('jira.issue.outgoing.webhook');
    }
  });

  it('trigger uses real Jira Cloud component/type format', () => {
    const bundle = buildJiraBundle('owner', 'repo');
    for (const rule of bundle.rules) {
      expect(rule.trigger.component).toBe('TRIGGER');
      expect(rule.trigger.type).toBe('jira.issue.event.trigger:transitioned');
      expect(rule.trigger.schemaVersion).toBe(1);
    }
  });

  it('trigger toStatus is an array of NAME objects', () => {
    const bundle = buildJiraBundle('owner', 'repo');
    const firstRule = bundle.rules[0]!;
    expect(Array.isArray(firstRule.trigger.value.toStatus)).toBe(true);
    expect(firstRule.trigger.value.toStatus[0]).toEqual({ type: 'NAME', value: 'Refinement' });
  });

  it('trigger value has required event fields', () => {
    const bundle = buildJiraBundle('owner', 'repo');
    for (const rule of bundle.rules) {
      expect(rule.trigger.value.eventKey).toBe('jira:issue_updated');
      expect(rule.trigger.value.issueEvent).toBe('issue_generic');
      expect(Array.isArray(rule.trigger.value.eventFilters)).toBe(true);
    }
  });

  it('action uses contentType:custom with customBody', () => {
    const bundle = buildJiraBundle('owner', 'repo');
    for (const rule of bundle.rules) {
      const action = rule.components[0]!;
      expect(action.value.contentType).toBe('custom');
      expect(typeof action.value.customBody).toBe('string');
      expect(() => JSON.parse(action.value.customBody)).not.toThrow();
    }
  });

  it('Authorization header has headerSecure:true', () => {
    const bundle = buildJiraBundle('owner', 'repo');
    for (const rule of bundle.rules) {
      const headers = rule.components[0]!.value.headers;
      const authHeader = headers.find((h) => h.name === 'Authorization');
      expect(authHeader).toBeDefined();
      expect(authHeader?.headerSecure).toBe(true);
    }
  });

  it('non-auth headers have headerSecure:false', () => {
    const bundle = buildJiraBundle('owner', 'repo');
    const headers = bundle.rules[0]!.components[0]!.value.headers;
    for (const h of headers) {
      if (h.name !== 'Authorization') {
        expect(h.headerSecure).toBe(false);
      }
    }
  });

  it('dispatch URL uses correct owner and repo', () => {
    const bundle = buildJiraBundle('my-owner', 'my-repo');
    for (const rule of bundle.rules) {
      expect(rule.components[0]!.value.url).toBe(
        'https://api.github.com/repos/my-owner/my-repo/dispatches',
      );
    }
  });

  it('each rule has ruleScope with ARI placeholder', () => {
    const bundle = buildJiraBundle('owner', 'repo');
    for (const rule of bundle.rules) {
      expect(rule.ruleScope.resources).toHaveLength(1);
      expect(rule.ruleScope.resources[0]).toContain('YOUR_WORKSPACE_ID');
    }
  });
});

describe('stepJiraBundle', () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('writes ferry-jira-automation-rules.beta.json (not .json)', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-test-'));
    const result = stepJiraBundle(tmpDir, 'acme-corp', 'acme-app');
    expect(result.ok).toBe(true);
    const betaPath = join(tmpDir, 'ferry-jira-automation-rules.beta.json');
    expect(() => readFileSync(betaPath, 'utf8')).not.toThrow();
    // old filename must NOT be created
    expect(() => readFileSync(join(tmpDir, 'ferry-jira-automation-rules.json'), 'utf8')).toThrow();
  });

  it('writes ferry-jira-automation-setup.md manual fallback', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-md-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app');
    const mdPath = join(tmpDir, 'ferry-jira-automation-setup.md');
    const content = readFileSync(mdPath, 'utf8');
    expect(content).toContain('Manual Setup');
    expect(content).toContain('acme-corp/acme-app');
  });

  it('JSON output is valid and contains 4 rules', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-json-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app');
    const content = readFileSync(
      join(tmpDir, 'ferry-jira-automation-rules.beta.json'),
      'utf8',
    );
    expect(() => JSON.parse(content)).not.toThrow();
    const bundle = JSON.parse(content) as { rules: unknown[] };
    expect(bundle.rules).toHaveLength(4);
  });

  it('JSON output ends with a newline', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-nl-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app');
    const content = readFileSync(
      join(tmpDir, 'ferry-jira-automation-rules.beta.json'),
      'utf8',
    );
    expect(content.endsWith('\n')).toBe(true);
  });

  it('markdown includes all 4 phase names', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-phases-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app');
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-setup.md'), 'utf8');
    expect(content).toContain('Refinement');
    expect(content).toContain('In Development');
    expect(content).toContain('In Review');
    expect(content).toContain('Iteration');
  });

  it('markdown does not contain a real Authorization token', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-auth-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app');
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-setup.md'), 'utf8');
    // Must not contain a real GitHub PAT pattern (ghp_ prefix)
    expect(content).not.toMatch(/ghp_[A-Za-z0-9]{36}/);
    // Should only contain the placeholder
    expect(content).toContain('YOUR_GITHUB_PAT_WITH_REPO_SCOPE');
  });
});
