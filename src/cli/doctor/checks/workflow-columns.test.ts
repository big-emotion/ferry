import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockHttpsGet = vi.hoisted(() => vi.fn());

vi.mock('../../http.js', () => ({
  httpsGet: mockHttpsGet,
}));

import { checkWorkflowColumns } from './workflow-columns.js';

const JIRA_OPTS = {
  jiraBaseUrl: 'https://example.atlassian.net',
  jiraEmail: 'bot@example.com',
  jiraApiToken: 'token',
  jiraProjectKey: 'FER',
};

function writeConfig(root: string, obj: unknown): void {
  writeFileSync(join(root, 'ferry.config.json'), JSON.stringify(obj, null, 2));
}

function mockProjectStatuses(names: string[]): void {
  mockHttpsGet.mockResolvedValue({
    statusCode: 200,
    body: JSON.stringify([{ statuses: names.map((name, i) => ({ id: String(i + 1), name })) }]),
  });
}

describe('checkWorkflowColumns', () => {
  let root: string;

  beforeEach(() => {
    vi.resetAllMocks();
    root = mkdtempSync(join(tmpdir(), 'ferry-doctor-columns-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('skips when no workflow.agents section is configured', async () => {
    writeConfig(root, { limits: { max_iterations: 3 } });
    const res = await checkWorkflowColumns({ repoRoot: root, ...JIRA_OPTS });
    expect(res.status).toBe('skip');
    expect(mockHttpsGet).not.toHaveBeenCalled();
  });

  // The router maps ferry-transition events to agents via these exact
  // trigger_column names, so validating them against the board is what keeps
  // the single any-column Jira rule functional.
  it('validates the four agents trigger_column names against project statuses', async () => {
    writeConfig(root, {
      workflow: {
        agents: {
          refiner: { trigger_column: 'To Refine' },
          developer: { trigger_column: 'To Do' },
          reviewer: { trigger_column: 'In Review' },
          iterator: { trigger_column: 'Changes Requested' },
        },
      },
    });
    mockProjectStatuses(['To Refine', 'To Do', 'In Review', 'Changes Requested', 'Done']);
    const res = await checkWorkflowColumns({ repoRoot: root, ...JIRA_OPTS });
    expect(res.status).toBe('green');
    expect(res.detail).toContain('4 configured column(s)');
  });

  it('is red naming the trigger_column that does not exist on the board', async () => {
    writeConfig(root, {
      workflow: {
        agents: {
          refiner: { trigger_column: 'Backlog Grooming' },
          developer: { trigger_column: 'To Do' },
        },
      },
    });
    mockProjectStatuses(['To Do', 'In Review', 'Done']);
    const res = await checkWorkflowColumns({ repoRoot: root, ...JIRA_OPTS });
    expect(res.status).toBe('red');
    expect(res.detail).toContain('Backlog Grooming');
    expect(res.detail).not.toContain('To Do,');
  });

  it('validates workflow.agents.merger.auto_transition_done against project statuses', async () => {
    writeConfig(root, {
      workflow: {
        agents: {
          developer: { trigger_column: 'To Do' },
          merger: { auto_transition_done: 'Shipped' },
        },
      },
    });
    mockProjectStatuses(['To Do', 'In Review', 'Done']);
    const res = await checkWorkflowColumns({ repoRoot: root, ...JIRA_OPTS });
    expect(res.status).toBe('red');
    expect(res.detail).toContain('Shipped');
  });

  it('is green when the merger done status exists on the board', async () => {
    writeConfig(root, {
      workflow: {
        agents: {
          developer: { trigger_column: 'To Do' },
          merger: { auto_transition_done: 'Done' },
        },
      },
    });
    mockProjectStatuses(['To Do', 'In Review', 'Done']);
    const res = await checkWorkflowColumns({ repoRoot: root, ...JIRA_OPTS });
    expect(res.status).toBe('green');
    expect(res.detail).toContain('2 configured column(s)');
  });

  it('ignores a merger section without auto_transition_done (default null)', async () => {
    writeConfig(root, {
      workflow: {
        agents: {
          developer: { trigger_column: 'To Do' },
          merger: {},
        },
      },
    });
    mockProjectStatuses(['To Do']);
    const res = await checkWorkflowColumns({ repoRoot: root, ...JIRA_OPTS });
    expect(res.status).toBe('green');
    expect(res.detail).toContain('1 configured column(s)');
  });
});
