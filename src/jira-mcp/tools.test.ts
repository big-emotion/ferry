import { describe, it, expect } from 'vitest';
import { JIRA_MCP_TOOLS, dispatchTool, type JiraMcpDeps } from './tools.js';
import type {
  IssueTracker,
  TrackerIssue,
  TrackerSubtask,
  TrackerTransition,
} from '../lib/io/tracker/types.js';

/** Records every call so tests can assert on the side effects. */
class FakeTracker implements IssueTracker {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  async getIssue(key: string): Promise<TrackerIssue> {
    this.calls.push({ method: 'getIssue', args: [key] });
    return {
      key,
      summary: 'Sample ticket',
      description: 'A description',
      comments: ['first comment'],
      labels: ['ferry:claude-code'],
      issueType: 'Task',
      issueTypeRaw: 'Tâche',
    };
  }

  async postComment(key: string, body: string): Promise<void> {
    this.calls.push({ method: 'postComment', args: [key, body] });
  }

  async getTransitions(key: string): Promise<TrackerTransition[]> {
    this.calls.push({ method: 'getTransitions', args: [key] });
    return [{ id: '11', toStatus: 'In Review' }];
  }

  async postTransition(key: string, transitionId: string): Promise<void> {
    this.calls.push({ method: 'postTransition', args: [key, transitionId] });
  }

  async addLabel(key: string, label: string): Promise<void> {
    this.calls.push({ method: 'addLabel', args: [key, label] });
  }

  async getSubtasks(key: string): Promise<string[]> {
    this.calls.push({ method: 'getSubtasks', args: [key] });
    return [];
  }

  async getSubtaskDetails(key: string): Promise<TrackerSubtask[]> {
    this.calls.push({ method: 'getSubtaskDetails', args: [key] });
    return [{ key: `${key}-1`, title: 'Existing sub-task', description: '', status: 'To Do' }];
  }

  async createSubtask(
    parentKey: string,
    title: string,
    description: string,
  ): Promise<{ id: string }> {
    this.calls.push({ method: 'createSubtask', args: [parentKey, title, description] });
    return { id: `${parentKey}-99` };
  }
}

function makeDeps(tracker: IssueTracker = new FakeTracker()): JiraMcpDeps {
  return {
    tracker,
    getTransitions: async (key) => {
      void key;
      return [
        { id: '11', name: 'In Review' },
        { id: '21', name: 'Done' },
      ];
    },
  };
}

describe('JIRA_MCP_TOOLS', () => {
  it('exposes exactly the six agent-facing tools', () => {
    expect(JIRA_MCP_TOOLS.map((t) => t.name).sort()).toEqual([
      'create_subtask',
      'get_issue',
      'get_transitions',
      'list_subtasks',
      'post_comment',
      'transition_issue',
    ]);
  });

  it('declares strict object input schemas', () => {
    for (const tool of JIRA_MCP_TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });
});

describe('dispatchTool', () => {
  it('get_issue returns the ticket payload', async () => {
    const result = await dispatchTool('get_issue', { key: 'ABC-1' }, makeDeps());
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).summary).toBe('Sample ticket');
  });

  it('list_subtasks returns sub-task details', async () => {
    const result = await dispatchTool('list_subtasks', { key: 'ABC-1' }, makeDeps());
    expect(JSON.parse(result.content[0].text)[0].key).toBe('ABC-1-1');
  });

  it('create_subtask forwards parent, title and description', async () => {
    const tracker = new FakeTracker();
    const result = await dispatchTool(
      'create_subtask',
      { parent_key: 'ABC-1', title: 'New work', description: 'Do the thing' },
      makeDeps(tracker),
    );
    expect(JSON.parse(result.content[0].text).id).toBe('ABC-1-99');
    expect(tracker.calls).toContainEqual({
      method: 'createSubtask',
      args: ['ABC-1', 'New work', 'Do the thing'],
    });
  });

  it('get_transitions lists available transitions', async () => {
    const result = await dispatchTool('get_transitions', { key: 'ABC-1' }, makeDeps());
    expect(JSON.parse(result.content[0].text)).toHaveLength(2);
  });

  it('transition_issue applies the transition', async () => {
    const tracker = new FakeTracker();
    const result = await dispatchTool(
      'transition_issue',
      { key: 'ABC-1', transition_id: '11' },
      makeDeps(tracker),
    );
    expect(JSON.parse(result.content[0].text).ok).toBe(true);
    expect(tracker.calls).toContainEqual({ method: 'postTransition', args: ['ABC-1', '11'] });
  });

  it('post_comment posts the body', async () => {
    const tracker = new FakeTracker();
    await dispatchTool(
      'post_comment',
      { key: 'ABC-1', body: '[ferry:refiner:run-1] done' },
      makeDeps(tracker),
    );
    expect(tracker.calls).toContainEqual({
      method: 'postComment',
      args: ['ABC-1', '[ferry:refiner:run-1] done'],
    });
  });

  it('returns an isError result for an unknown tool', async () => {
    const result = await dispatchTool('delete_everything', {}, makeDeps());
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('unknown tool');
  });

  it('returns an isError result for a missing required argument', async () => {
    const result = await dispatchTool('get_issue', {}, makeDeps());
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('key');
  });

  it('returns an isError result when the tracker throws', async () => {
    const tracker = new FakeTracker();
    tracker.getIssue = async () => {
      throw new Error('jira 503');
    };
    const result = await dispatchTool('get_issue', { key: 'ABC-1' }, makeDeps(tracker));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('jira 503');
  });
});
