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
    expect(names).toContain('FERRY_ANTHROPIC_API_KEY');
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
});

// ── buildJiraBundle ───────────────────────────────────────────────────────────

describe('buildJiraBundle', () => {
  it('produces exactly 4 rules', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app');
    expect(bundle.rules).toHaveLength(4);
  });

  it('sets cloud:true with no version or type fields', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app');
    expect(bundle.cloud).toBe(true);
    expect(bundle).not.toHaveProperty('version');
    expect(bundle).not.toHaveProperty('type');
  });

  it('uses the correct dispatch URL for all rules', () => {
    const bundle = buildJiraBundle('my-org', 'my-repo');
    const expected = 'https://api.github.com/repos/my-org/my-repo/dispatches';
    for (const rule of bundle.rules) {
      expect(rule.components[0]?.value.url).toBe(expected);
    }
  });

  it('uses the four Ferry event types', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app');
    const bodies = bundle.rules.map(
      (r) =>
        JSON.parse(r.components[0]?.value.customBody ?? '{}') as { event_type: string },
    );
    const eventTypes = bodies.map((b) => b.event_type);
    expect(eventTypes).toContain('ferry-refine');
    expect(eventTypes).toContain('ferry-dev');
    expect(eventTypes).toContain('ferry-review');
    expect(eventTypes).toContain('ferry-iterate');
  });

  it('includes {{issue.key}} in each rule body', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app');
    for (const rule of bundle.rules) {
      const body = JSON.parse(rule.components[0]?.value.customBody ?? '{}') as {
        client_payload: { ticket_key: string };
      };
      expect(body.client_payload.ticket_key).toBe('{{issue.key}}');
    }
  });

  it('creates all rules in DISABLED state', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app');
    for (const rule of bundle.rules) {
      expect(rule.state).toBe('DISABLED');
    }
  });

  it('triggers on the real Jira Cloud transitioned event', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app');
    for (const rule of bundle.rules) {
      expect(rule.trigger.type).toBe('jira.issue.event.trigger:transitioned');
      expect(rule.trigger.component).toBe('TRIGGER');
    }
  });

  it('maps phases to correct Jira column names', () => {
    const bundle = buildJiraBundle('acme-corp', 'acme-app');
    const statuses = bundle.rules.map((r) => r.trigger.value.toStatus[0]?.value);
    expect(statuses).toContain('Refinement');
    expect(statuses).toContain('In Development');
    expect(statuses).toContain('In Review');
    expect(statuses).toContain('Iteration');
  });
});

// ── workflowTemplates ─────────────────────────────────────────────────────────

describe('workflowTemplates', () => {
  it('returns 6 workflow files', () => {
    expect(workflowTemplates('v1')).toHaveLength(6);
  });

  it('includes all required workflow filenames', () => {
    const names = workflowTemplates('v1').map((t) => t.filename);
    expect(names).toContain('ferry-refine.yml');
    expect(names).toContain('ferry-dev.yml');
    expect(names).toContain('ferry-review.yml');
    expect(names).toContain('ferry-iterate.yml');
    expect(names).toContain('ferry-reconciler.yml');
    expect(names).toContain('ferry-audit-daily.yml');
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

  it('each agent workflow calls the Ferry reusable workflow', () => {
    const agentFiles = [
      'ferry-refine.yml',
      'ferry-dev.yml',
      'ferry-review.yml',
      'ferry-iterate.yml',
    ];
    for (const tmpl of workflowTemplates('v1')) {
      if (agentFiles.includes(tmpl.filename)) {
        expect(tmpl.content).toContain('big-emotion/ferry/.github/workflows/');
        expect(tmpl.content).toContain('secrets: inherit');
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
});
