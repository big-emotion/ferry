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

import {
  buildJiraBundle,
  stepJiraBundle,
  buildRouterJiraBundle,
  buildRouterManualSetupDoc,
  stepRouterJiraBundle,
  DEFAULT_STATUS_NAMES,
} from './jira-bundle.js';

const WORKSPACE_ID = '75eb33f5-5dd0-4328-b0e6-8bb3f4e0af91';
const PROJECT_ID = '10033';

describe('buildJiraBundle', () => {
  it('returns cloud:true at top level with no version or type fields', () => {
    const bundle = buildJiraBundle('owner', 'repo', WORKSPACE_ID, PROJECT_ID);
    expect(bundle.cloud).toBe(true);
    expect(bundle).not.toHaveProperty('version');
    expect(bundle).not.toHaveProperty('type');
  });

  it('returns 5 rules — one per agent, merger included (ADR-0005 rev. 2)', () => {
    const bundle = buildJiraBundle('owner', 'repo', WORKSPACE_ID, PROJECT_ID);
    expect(bundle.rules).toHaveLength(5);
  });

  it('each rule uses components array with correct action type', () => {
    const bundle = buildJiraBundle('owner', 'repo', WORKSPACE_ID, PROJECT_ID);
    for (const rule of bundle.rules) {
      expect(rule).not.toHaveProperty('actions');
      expect(rule.components).toHaveLength(1);
      expect(rule.components[0]?.component).toBe('ACTION');
      expect(rule.components[0]?.type).toBe('jira.issue.outgoing.webhook');
    }
  });

  it('trigger uses real Jira Cloud component/type format', () => {
    const bundle = buildJiraBundle('owner', 'repo', WORKSPACE_ID, PROJECT_ID);
    for (const rule of bundle.rules) {
      expect(rule.trigger.component).toBe('TRIGGER');
      expect(rule.trigger.type).toBe('jira.issue.event.trigger:transitioned');
      expect(rule.trigger.schemaVersion).toBe(1);
    }
  });

  it('trigger toStatus is an array of NAME objects', () => {
    const bundle = buildJiraBundle('owner', 'repo', WORKSPACE_ID, PROJECT_ID);
    const firstRule = bundle.rules[0]!;
    expect(Array.isArray(firstRule.trigger.value.toStatus)).toBe(true);
    expect(firstRule.trigger.value.toStatus[0]).toEqual({
      type: 'NAME',
      value: DEFAULT_STATUS_NAMES.refine,
    });
  });

  it('uses custom status names when provided', () => {
    const custom = {
      refine: 'Ready for Refine',
      dev: 'Ready for Dev',
      review: 'Awaiting Review',
      iterate: 'Needs Changes',
      merge: 'To Merge',
    };
    const bundle = buildJiraBundle('owner', 'repo', WORKSPACE_ID, PROJECT_ID, custom);
    const statuses = bundle.rules.map((r) => r.trigger.value.toStatus[0]?.value);
    expect(statuses).toContain('Ready for Refine');
    expect(statuses).toContain('Ready for Dev');
    expect(statuses).toContain('Awaiting Review');
    expect(statuses).toContain('Needs Changes');
    expect(statuses).toContain('To Merge');
  });

  it('default iterate status is Changes Requested not Iteration', () => {
    const bundle = buildJiraBundle('owner', 'repo', WORKSPACE_ID, PROJECT_ID);
    const statuses = bundle.rules.map((r) => r.trigger.value.toStatus[0]?.value);
    expect(statuses).toContain('Changes Requested');
    expect(statuses).not.toContain('Iteration');
  });

  it('trigger value has required event fields', () => {
    const bundle = buildJiraBundle('owner', 'repo', WORKSPACE_ID, PROJECT_ID);
    for (const rule of bundle.rules) {
      expect(rule.trigger.value.eventKey).toBe('jira:issue_updated');
      expect(rule.trigger.value.issueEvent).toBe('issue_generic');
      expect(Array.isArray(rule.trigger.value.eventFilters)).toBe(true);
    }
  });

  it('action uses contentType:custom with customBody', () => {
    const bundle = buildJiraBundle('owner', 'repo', WORKSPACE_ID, PROJECT_ID);
    for (const rule of bundle.rules) {
      const action = rule.components[0]!;
      expect(action.value.contentType).toBe('custom');
      expect(typeof action.value.customBody).toBe('string');
      expect(() => JSON.parse(action.value.customBody)).not.toThrow();
    }
  });

  it('Authorization header has headerSecure:true', () => {
    const bundle = buildJiraBundle('owner', 'repo', WORKSPACE_ID, PROJECT_ID);
    for (const rule of bundle.rules) {
      const headers = rule.components[0]!.value.headers;
      const authHeader = headers.find((h) => h.name === 'Authorization');
      expect(authHeader).toBeDefined();
      expect(authHeader?.headerSecure).toBe(true);
    }
  });

  it('non-auth headers have headerSecure:false', () => {
    const bundle = buildJiraBundle('owner', 'repo', WORKSPACE_ID, PROJECT_ID);
    const headers = bundle.rules[0]!.components[0]!.value.headers;
    for (const h of headers) {
      if (h.name !== 'Authorization') {
        expect(h.headerSecure).toBe(false);
      }
    }
  });

  it('dispatch URL uses correct owner and repo', () => {
    const bundle = buildJiraBundle('my-owner', 'my-repo', WORKSPACE_ID, PROJECT_ID);
    for (const rule of bundle.rules) {
      expect(rule.components[0]!.value.url).toBe(
        'https://api.github.com/repos/my-owner/my-repo/dispatches',
      );
    }
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

describe('stepJiraBundle', () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('writes ferry-jira-automation-rules.beta.json (not .json)', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-test-'));
    const result = stepJiraBundle(tmpDir, 'acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    expect(result.ok).toBe(true);
    const betaPath = join(tmpDir, 'ferry-jira-automation-rules.beta.json');
    expect(() => readFileSync(betaPath, 'utf8')).not.toThrow();
    // old filename must NOT be created
    expect(() => readFileSync(join(tmpDir, 'ferry-jira-automation-rules.json'), 'utf8')).toThrow();
  });

  it('writes ferry-jira-automation-setup.md manual fallback', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-md-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const mdPath = join(tmpDir, 'ferry-jira-automation-setup.md');
    const content = readFileSync(mdPath, 'utf8');
    expect(content).toContain('Ferry — Jira Automation Setup');
    expect(content).toContain('acme-corp/acme-app');
  });

  it('JSON output is valid and contains 5 rules', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-json-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-rules.beta.json'), 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
    const bundle = JSON.parse(content) as { rules: unknown[] };
    expect(bundle.rules).toHaveLength(5);
  });

  it('JSON output ends with a newline', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-nl-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-rules.beta.json'), 'utf8');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('markdown includes all 5 default phase status names', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-phases-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-setup.md'), 'utf8');
    expect(content).toContain('Refinement');
    expect(content).toContain('In Development');
    expect(content).toContain('In Review');
    expect(content).toContain('Changes Requested');
    expect(content).toContain('Ready to Merge');
  });

  it('markdown uses custom status names when provided', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-custom-'));
    const custom = {
      refine: 'Backlog Refine',
      dev: 'Ready for Dev',
      review: 'Awaiting Review',
      iterate: 'Needs Rework',
      merge: 'To Merge',
    };
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID, custom);
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-setup.md'), 'utf8');
    expect(content).toContain('Backlog Refine');
    expect(content).toContain('Ready for Dev');
    expect(content).toContain('Awaiting Review');
    expect(content).toContain('Needs Rework');
    expect(content).toContain('To Merge');
  });

  it('markdown does not contain a real Authorization token', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-auth-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-setup.md'), 'utf8');
    // Must not contain a real GitHub PAT pattern (ghp_ prefix)
    expect(content).not.toMatch(/ghp_[A-Za-z0-9]{36}/);
    // Should only contain the placeholder
    expect(content).toContain('YOUR_GITHUB_PAT_WITH_REPO_SCOPE');
  });

  it('dispatch URL uses correct owner and repo', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-url-'));
    stepJiraBundle(tmpDir, 'my-owner', 'my-repo', WORKSPACE_ID, PROJECT_ID);
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-rules.beta.json'), 'utf8');
    expect(content).toContain('https://api.github.com/repos/my-owner/my-repo/dispatches');
  });

  it('output contains real ARI in ruleScope', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-ari-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-rules.beta.json'), 'utf8');
    expect(content).toContain(`ari:cloud:jira:${WORKSPACE_ID}:project/${PROJECT_ID}`);
  });
});

describe('buildRouterJiraBundle — single any-column rule', () => {
  const bundle = buildRouterJiraBundle('acme', 'app', WORKSPACE_ID, PROJECT_ID);

  it('returns exactly ONE rule', () => {
    expect(bundle.rules).toHaveLength(1);
    expect(bundle.cloud).toBe(true);
  });

  it('fires on any transition — empty From AND To status filters', () => {
    const trigger = bundle.rules[0].trigger;
    expect(trigger.type).toBe('jira.issue.event.trigger:transitioned');
    expect(trigger.value.fromStatus).toEqual([]);
    expect(trigger.value.toStatus).toEqual([]);
  });

  it('sends event_type ferry-transition with to_status in the payload', () => {
    const body = (bundle.rules[0].components[0].value as { customBody: string }).customBody;
    const parsed = JSON.parse(body) as {
      event_type: string;
      client_payload: Record<string, string>;
    };
    expect(parsed.event_type).toBe('ferry-transition');
    expect(parsed.client_payload.phase).toBe('transition');
    expect(parsed.client_payload.to_status).toBe('{{issue.status.name}}');
    // idempotency scheme identical to the legacy rules
    expect(parsed.client_payload.event_id).toBe('{{issue.key}}-{{issue.id}}');
    expect(parsed.client_payload.source).toBe('jira-column');
  });

  it('keeps the Authorization header secret', () => {
    const headers = (
      bundle.rules[0].components[0].value as {
        headers: Array<{ name: string; headerSecure: boolean }>;
      }
    ).headers;
    const auth = headers.find((h) => h.name === 'Authorization');
    expect(auth?.headerSecure).toBe(true);
  });
});

describe('buildRouterManualSetupDoc', () => {
  const doc = buildRouterManualSetupDoc('acme', 'app');

  it('documents exactly one rule with empty status filters', () => {
    expect(doc).toContain('**one** Jira Automation rule');
    expect(doc).toContain('leave **From status** and **To status** empty');
    expect(doc.match(/### Rule:/g)).toHaveLength(1);
  });

  it('explains that the merger is unreachable from a column move (ADR-0005)', () => {
    expect(doc).toContain('ADR-0005');
    expect(doc).toContain('ferry-merge');
  });

  it('never contains a real token', () => {
    expect(doc).toContain('YOUR_GITHUB_PAT_WITH_REPO_SCOPE');
    expect(doc).not.toMatch(/Bearer gh[ps]_[A-Za-z0-9]/);
  });
});

describe('stepRouterJiraBundle', () => {
  let tmpDir: string;
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('writes a single-rule JSON bundle and the router setup doc', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-router-jb-'));
    stepRouterJiraBundle(tmpDir, 'acme', 'app', WORKSPACE_ID, PROJECT_ID);
    const json = JSON.parse(
      readFileSync(join(tmpDir, 'ferry-jira-automation-rules.beta.json'), 'utf8'),
    ) as { rules: unknown[] };
    expect(json.rules).toHaveLength(1);
    const md = readFileSync(join(tmpDir, 'ferry-jira-automation-setup.md'), 'utf8');
    expect(md).toContain('router model');
    expect(md).toContain('ferry-transition');
  });
});
