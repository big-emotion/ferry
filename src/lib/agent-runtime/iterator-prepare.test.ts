import { describe, it, expect, vi, afterEach } from 'vitest';
import { prepareIterator } from './iterator-prepare.js';
import type { TrackerIssue } from '../io/tracker/types.js';
import type { McpServerConfig } from '../llm/agent-loop/types.js';
import type { ResolvedCapabilities } from '../labels/capabilities.js';
import type { LabelCapability } from '../config.js';

const REPO_ROOT = '/workspace/repo';

const issue: TrackerIssue = {
  key: 'PROJ-200',
  summary: 'Fix the regression',
  description: 'Steps to reproduce…',
  comments: [],
  labels: [],
  issueType: 'Bug',
  issueTypeRaw: 'Bug',
};

const mcpPool: McpServerConfig[] = [
  { name: 'context7', url: 'https://mcp.context7.com/mcp' },
  { name: 'jira', url: 'https://example.com/jira' },
];

const emptyCapabilities: ResolvedCapabilities = {
  mcpServerNames: [],
  serverAllowedTools: {},
  triggeredLabels: [],
  unknownFerryLabels: [],
};

const buildSystemStub = (name: string) => `SYSTEM(${name})`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('prepareIterator', () => {
  it('builds the iterator system prompt, ticket block, initial prompt and threads the idempotency marker', () => {
    const ctx = prepareIterator({
      ticketKey: 'PROJ-200',
      issue,
      headSha: 'abcdef1234567890abcdef1234567890abcdef12',
      reviewComment: 'CHANGES_REQUESTED: please fix the off-by-one in foo.ts.',
      mergeConflicts: [],
      existingLog: 'a1b2c3d feat: initial work',
      mcpPool,
      configLabels: undefined,
      capabilities: emptyCapabilities,
      idempotencyMarker: '[ferry:iterator:abcdef1]',
      typeOverride: undefined,
      repoRoot: REPO_ROOT,
      _buildSystem: buildSystemStub,
    });

    expect(ctx.system).toBe('SYSTEM(iterate)');
    expect(ctx.idempotencyMarker).toBe('[ferry:iterator:abcdef1]');
    expect(ctx.ticketBlock).toContain('TICKET: PROJ-200');
    expect(ctx.ticketBlock).toContain('TITLE: Fix the regression');
    expect(ctx.initialPrompt).toContain('## Jira Ticket');
    expect(ctx.initialPrompt).toContain('TICKET: PROJ-200');
    expect(ctx.initialPrompt).toContain('## Review Findings (fix only what is listed here)');
    expect(ctx.initialPrompt).toContain('CHANGES_REQUESTED: please fix the off-by-one in foo.ts.');
    expect(ctx.initialPrompt).toContain(
      '## Existing commits on branch\na1b2c3d feat: initial work',
    );
    expect(ctx.initialPrompt).toContain('When you have fixed all findings, call the `done` tool.');
    expect(ctx.initialPrompt).not.toContain('## Merge Conflicts');
  });

  it('inserts a merge-conflict section when conflicts are present', () => {
    const ctx = prepareIterator({
      ticketKey: 'PROJ-200',
      issue,
      headSha: '1234567abcd',
      reviewComment: 'CHANGES_REQUESTED',
      mergeConflicts: ['src/a.ts', 'src/b.ts'],
      existingLog: '',
      mcpPool,
      configLabels: undefined,
      capabilities: emptyCapabilities,
      idempotencyMarker: '[ferry:iterator:1234567]',
      typeOverride: undefined,
      repoRoot: REPO_ROOT,
      _buildSystem: buildSystemStub,
    });

    expect(ctx.initialPrompt).toContain(
      '## Merge Conflicts (resolve these first, before fixing review findings)\n- src/a.ts\n- src/b.ts',
    );
    expect(ctx.initialPrompt).not.toContain('## Existing commits on branch');
  });

  it('keeps the full MCP pool when no labels config is provided (filter is a no-op)', () => {
    const ctx = prepareIterator({
      ticketKey: 'PROJ-200',
      issue,
      headSha: 'abcdef1',
      reviewComment: '',
      mergeConflicts: [],
      existingLog: '',
      mcpPool,
      configLabels: undefined,
      capabilities: emptyCapabilities,
      idempotencyMarker: '[ferry:iterator:abcdef1]',
      typeOverride: undefined,
      repoRoot: REPO_ROOT,
      _buildSystem: buildSystemStub,
    });

    // No labels config → hasLabelsConfig=false → filterMcpServers returns the pool unfiltered
    expect(ctx.mcpServers).toEqual(mcpPool);
    expect(ctx.capabilities.mcpServerNames).toEqual([]);
  });

  it('filters the MCP pool down to capability-triggered servers when labels config is provided', () => {
    const configLabels: Record<string, LabelCapability> = {
      'ferry:docs': { mcp_servers: ['context7'] },
    };
    const triggeredCapabilities: ResolvedCapabilities = {
      mcpServerNames: ['context7'],
      serverAllowedTools: { context7: [] },
      triggeredLabels: ['ferry:docs'],
      unknownFerryLabels: [],
    };

    const ctx = prepareIterator({
      ticketKey: 'PROJ-200',
      issue: { ...issue, labels: ['ferry:docs'] },
      headSha: 'abcdef1',
      reviewComment: '',
      mergeConflicts: [],
      existingLog: '',
      mcpPool,
      configLabels,
      capabilities: triggeredCapabilities,
      idempotencyMarker: '[ferry:iterator:abcdef1]',
      typeOverride: undefined,
      repoRoot: REPO_ROOT,
      _buildSystem: buildSystemStub,
    });

    // Only context7 should remain — the unfiltered pool also has 'jira'.
    expect(ctx.mcpServers.map((s) => s.name)).toEqual(['context7']);
  });

  it('forwards the typeOverride into the ticket block', () => {
    const ctx = prepareIterator({
      ticketKey: 'PROJ-200',
      issue,
      headSha: 'abcdef1',
      reviewComment: '',
      mergeConflicts: [],
      existingLog: '',
      mcpPool,
      configLabels: undefined,
      capabilities: emptyCapabilities,
      idempotencyMarker: '[ferry:iterator:abcdef1]',
      typeOverride: 'Spike',
      repoRoot: REPO_ROOT,
      _buildSystem: buildSystemStub,
    });

    expect(ctx.ticketBlock).toContain('TYPE: Spike');
  });
});
