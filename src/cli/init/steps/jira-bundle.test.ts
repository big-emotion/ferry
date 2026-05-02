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

const WORKSPACE_ID = '75eb33f5-5dd0-4328-b0e6-8bb3f4e0af91';
const PROJECT_ID = '10033';

describe('stepJiraBundle', () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('writes ferry-jira-automation-rules.json to the repo root', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-test-'));
    const result = stepJiraBundle(tmpDir, 'acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    expect(result.ok).toBe(true);
    const outPath = join(tmpDir, 'ferry-jira-automation-rules.json');
    expect(() => readFileSync(outPath, 'utf8')).not.toThrow();
  });

  it('output file contains valid JSON', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-json-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-rules.json'), 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('output JSON contains 4 automation rules', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-rules-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-rules.json'), 'utf8');
    const bundle = JSON.parse(content) as { rules: unknown[] };
    expect(bundle.rules).toHaveLength(4);
  });

  it('dispatch URL uses correct owner and repo', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-url-'));
    stepJiraBundle(tmpDir, 'my-owner', 'my-repo', WORKSPACE_ID, PROJECT_ID);
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-rules.json'), 'utf8');
    expect(content).toContain('https://api.github.com/repos/my-owner/my-repo/dispatches');
  });

  it('output file ends with a newline', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-nl-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-rules.json'), 'utf8');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('output contains real ARI in ruleScope', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-ari-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-rules.json'), 'utf8');
    expect(content).toContain(
      `ari:cloud:jira:${WORKSPACE_ID}:project/${PROJECT_ID}`,
    );
  });
});

describe('buildJiraBundle', () => {
  it('produces exactly 4 rules', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    expect(bundle.rules).toHaveLength(4);
  });

  it('sets cloud, version, type metadata', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    expect(bundle.cloud).toBe(true);
    expect(bundle.version).toBe(1);
    expect(bundle.type).toBe('AUTOMATION');
  });

  it('uses the correct dispatch URL for all rules', () => {
    const bundle = buildJiraBundle('my-org', 'my-repo', WORKSPACE_ID, PROJECT_ID);
    const expected = 'https://api.github.com/repos/my-org/my-repo/dispatches';
    for (const rule of bundle.rules) {
      expect(rule.actions[0]?.value.url).toBe(expected);
    }
  });

  it('uses the four Ferry event types', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const bodies = bundle.rules.map(
      (r) => JSON.parse(r.actions[0]?.value.body ?? '{}') as { event_type: string },
    );
    const eventTypes = bodies.map((b) => b.event_type);
    expect(eventTypes).toContain('ferry-refine');
    expect(eventTypes).toContain('ferry-dev');
    expect(eventTypes).toContain('ferry-review');
    expect(eventTypes).toContain('ferry-iterate');
  });

  it('includes {{issue.key}} in each rule body', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    for (const rule of bundle.rules) {
      const body = JSON.parse(rule.actions[0]?.value.body ?? '{}') as {
        client_payload: { ticket_key: string };
      };
      expect(body.client_payload.ticket_key).toBe('{{issue.key}}');
    }
  });

  it('creates all rules in DISABLED state', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    for (const rule of bundle.rules) {
      expect(rule.state).toBe('DISABLED');
    }
  });

  it('triggers on ISSUE_TRANSITIONED', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    for (const rule of bundle.rules) {
      expect(rule.trigger.type).toBe('ISSUE_TRANSITIONED');
    }
  });

  it('maps phases to correct Jira column names', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const statuses = bundle.rules.map((r) => r.trigger.value.toStatus.name);
    expect(statuses).toContain('Refinement');
    expect(statuses).toContain('In Development');
    expect(statuses).toContain('In Review');
    expect(statuses).toContain('Iteration');
  });

  it('stamps real ARI into ruleScope.resources for every rule', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const expectedAri = `ari:cloud:jira:${WORKSPACE_ID}:project/${PROJECT_ID}`;
    for (const rule of bundle.rules) {
      expect(rule.ruleScope.resources).toEqual([expectedAri]);
    }
  });

  it('stamps real ARI into trigger.value.eventFilters for every rule', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const expectedAri = `ari:cloud:jira:${WORKSPACE_ID}:project/${PROJECT_ID}`;
    for (const rule of bundle.rules) {
      expect(rule.trigger.value.eventFilters).toEqual([expectedAri]);
    }
  });

  it('uses placeholder ARI when workspaceId is a placeholder string', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app', 'YOUR_WORKSPACE_ID', 'YOUR_PROJECT_ID');
    for (const rule of bundle.rules) {
      expect(rule.ruleScope.resources[0]).toBe(
        'ari:cloud:jira:YOUR_WORKSPACE_ID:project/YOUR_PROJECT_ID',
      );
    }
  });
});
