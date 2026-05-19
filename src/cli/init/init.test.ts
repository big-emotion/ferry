import { describe, it, expect } from 'vitest';
import { buildSecrets } from './steps/secrets.js';
import { buildJiraBundle } from './steps/jira-bundle.js';
import { workflowTemplates } from './templates.js';

// ── buildSecrets ─────────────────────────────────────────────────────────────

describe('buildSecrets', () => {
  const cfg = {
    appId: '1234567',
    privateKey: '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----',
    jiraBaseUrl: 'https://acme.atlassian.net',
    jiraEmail: 'bot@acme.com',
    jiraApiToken: 'token-abc',
    anthropicApiKey: 'sk-ant-abc',
  };

  it('returns 6 secrets', () => {
    expect(buildSecrets(cfg)).toHaveLength(6);
  });

  it('maps correct secret names', () => {
    const names = buildSecrets(cfg).map((s) => s.name);
    expect(names).toContain('FERRY_APP_ID');
    expect(names).toContain('FERRY_PRIVATE_KEY');
    expect(names).toContain('FERRY_JIRA_BASE_URL');
    expect(names).toContain('FERRY_JIRA_EMAIL');
    expect(names).toContain('FERRY_JIRA_API_TOKEN');
    expect(names).toContain('ANTHROPIC_API_KEY');
  });

  it('propagates values correctly', () => {
    const secrets = buildSecrets(cfg);
    const entry = secrets.find((s) => s.name === 'FERRY_APP_ID');
    expect(entry?.value).toBe('1234567');
  });

  it('includes description for each secret', () => {
    const secrets = buildSecrets(cfg);
    for (const s of secrets) {
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it('defaults to the script path (ANTHROPIC_API_KEY, no OAuth token)', () => {
    const names = buildSecrets(cfg).map((s) => s.name);
    expect(names).toContain('ANTHROPIC_API_KEY');
    expect(names).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('claude-code path uses CLAUDE_CODE_OAUTH_TOKEN exclusively, never ANTHROPIC_API_KEY', () => {
    const secrets = buildSecrets({
      ...cfg,
      executionPath: 'claude-code',
      claudeCodeOauthToken: 'sk-ant-oat-xyz',
    });
    const names = secrets.map((s) => s.name);
    expect(names).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(names).not.toContain('ANTHROPIC_API_KEY');
    expect(secrets.find((s) => s.name === 'CLAUDE_CODE_OAUTH_TOKEN')?.value).toBe('sk-ant-oat-xyz');
    // GitHub App + Jira secrets are still reused unchanged.
    expect(names).toContain('FERRY_APP_ID');
    expect(names).toContain('FERRY_JIRA_API_TOKEN');
    expect(secrets).toHaveLength(6);
  });
});

// ── buildJiraBundle ───────────────────────────────────────────────────────────

const WORKSPACE_ID = '75eb33f5-5dd0-4328-b0e6-8bb3f4e0af91';
const PROJECT_ID = '10033';

describe('buildJiraBundle', () => {
  it('produces exactly 4 rules', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    expect(bundle.rules).toHaveLength(4);
  });

  it('sets cloud:true with no version or type fields', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    expect(bundle.cloud).toBe(true);
    expect(bundle).not.toHaveProperty('version');
    expect(bundle).not.toHaveProperty('type');
  });

  it('uses the correct dispatch URL for all rules', () => {
    const bundle = buildJiraBundle('my-org', 'my-repo', WORKSPACE_ID, PROJECT_ID);
    const expected = 'https://api.github.com/repos/my-org/my-repo/dispatches';
    for (const rule of bundle.rules) {
      expect(rule.components[0]?.value.url).toBe(expected);
    }
  });

  it('uses the four Ferry event types', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const bodies = bundle.rules.map(
      (r) => JSON.parse(r.components[0]?.value.customBody ?? '{}') as { event_type: string },
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
      const body = JSON.parse(rule.components[0]?.value.customBody ?? '{}') as {
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

  it('triggers on the real Jira Cloud transitioned event', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    for (const rule of bundle.rules) {
      expect(rule.trigger.type).toBe('jira.issue.event.trigger:transitioned');
      expect(rule.trigger.component).toBe('TRIGGER');
    }
  });

  it('maps phases to correct Jira column names', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app', WORKSPACE_ID, PROJECT_ID);
    const statuses = bundle.rules.map((r) => r.trigger.value.toStatus[0]?.value);
    expect(statuses).toContain('Refinement');
    expect(statuses).toContain('In Development');
    expect(statuses).toContain('In Review');
    expect(statuses).toContain('Changes Requested');
  });
});

// ── workflowTemplates ─────────────────────────────────────────────────────────

describe('workflowTemplates', () => {
  it('returns 4 workflow files', () => {
    expect(workflowTemplates('v1')).toHaveLength(4);
  });

  it('includes all required workflow filenames', () => {
    const names = workflowTemplates('v1').map((t) => t.filename);
    expect(names).toContain('ferry-refine.yml');
    expect(names).toContain('ferry-dev.yml');
    expect(names).toContain('ferry-review.yml');
    expect(names).toContain('ferry-iterate.yml');
  });

  it('embeds the ferry version tag in each agent workflow', () => {
    const templates = workflowTemplates('v2');
    const agentFiles = [
      'ferry-refine.yml',
      'ferry-dev.yml',
      'ferry-review.yml',
      'ferry-iterate.yml',
    ];
    for (const tmpl of templates) {
      if (agentFiles.includes(tmpl.filename)) {
        expect(tmpl.content).toContain('@v2');
      }
    }
  });

  it('each agent workflow calls Ferry composite actions directly (no reusable workflow, no secrets: inherit)', () => {
    const agentFiles = [
      'ferry-refine.yml',
      'ferry-dev.yml',
      'ferry-review.yml',
      'ferry-iterate.yml',
    ];
    for (const tmpl of workflowTemplates('v1')) {
      if (agentFiles.includes(tmpl.filename)) {
        expect(tmpl.content).toContain('big-emotion/ferry/.github/actions/');
        expect(tmpl.content).not.toContain('big-emotion/ferry/.github/workflows/');
        expect(tmpl.content).not.toContain('secrets: inherit');
      }
    }
  });

  it('ferry-dev.yml declares write permissions', () => {
    const dev = workflowTemplates('v1').find((t) => t.filename === 'ferry-dev.yml');
    expect(dev?.content).toContain('contents: write');
    expect(dev?.content).toContain('pull-requests: write');
  });

  it('ferry-review.yml declares checks: read permission', () => {
    const review = workflowTemplates('v1').find((t) => t.filename === 'ferry-review.yml');
    expect(review?.content).toContain('checks: read');
  });

  it('ferry-refine.yml triggers on ferry-refine event', () => {
    const refine = workflowTemplates('v1').find((t) => t.filename === 'ferry-refine.yml');
    expect(refine?.content).toContain('ferry-refine');
  });

  it('script path is byte-identical whether the path is implicit or explicit', () => {
    expect(workflowTemplates('v1', 'script')).toEqual(workflowTemplates('v1'));
  });

  it('script path contains no claude-code guard or header', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
      expect(tmpl.content).not.toContain('Execution path: claude-code');
    }
  });

  it('claude-code path materializes a fail-fast CLAUDE_CODE_OAUTH_TOKEN guard in every agent workflow', () => {
    for (const tmpl of workflowTemplates('v1', 'claude-code')) {
      expect(tmpl.content).toContain('# Execution path: claude-code');
      expect(tmpl.content).toContain('Require CLAUDE_CODE_OAUTH_TOKEN');
      expect(tmpl.content).toContain(
        'CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}',
      );
      expect(tmpl.content).toContain('exit 1');
      // The guard goes in the agent job only — exactly one occurrence per file.
      const occurrences = tmpl.content.split('Require CLAUDE_CODE_OAUTH_TOKEN').length - 1;
      expect(occurrences).toBe(1);
    }
  });

  it('claude-code guard runs before the agent action', () => {
    const dev = workflowTemplates('v1', 'claude-code').find((t) => t.filename === 'ferry-dev.yml');
    const guardIdx = dev?.content.indexOf('Require CLAUDE_CODE_OAUTH_TOKEN') ?? -1;
    const agentIdx = dev?.content.indexOf('ferry-run-developer') ?? -1;
    expect(guardIdx).toBeGreaterThan(-1);
    expect(agentIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(agentIdx);
  });
});
