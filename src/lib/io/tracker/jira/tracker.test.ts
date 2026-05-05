import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraTracker } from './tracker.js';
import type { JiraRestClient } from '../../jira-rest.js';
import { textToAdf, adfToText } from '../../jira-adf.js';
import type { AdfDoc } from '../../jira-adf.js';

function makeAdf(text: string): AdfDoc {
  return textToAdf(text);
}

function makeMockClient(): JiraRestClient {
  return {
    getIssue: vi.fn(),
    postComment: vi.fn(),
    postTransition: vi.fn(),
    getSubtasks: vi.fn(),
    getSubtaskDetails: vi.fn(),
    putComment: vi.fn(),
    createSubtask: vi.fn(),
    addLabel: vi.fn(),
    getTransitions: vi.fn(),
  } as unknown as JiraRestClient;
}

describe('JiraTracker', () => {
  let client: JiraRestClient;
  let tracker: JiraTracker;

  beforeEach(() => {
    client = makeMockClient();
    tracker = new JiraTracker(client);
  });

  describe('getIssue', () => {
    it('converts ADF description and comments to plain text', async () => {
      const descriptionText = 'This is the description';
      const commentText = 'A comment';
      vi.mocked(client.getIssue).mockResolvedValue({
        id: '1',
        key: 'PROJ-1',
        fields: {
          summary: 'My issue',
          description: makeAdf(descriptionText),
          comment: {
            comments: [{ id: 'c1', body: makeAdf(commentText) }],
          },
          labels: ['bug'],
          issuetype: { name: 'Story' },
        },
      });

      const issue = await tracker.getIssue('PROJ-1');

      expect(issue.key).toBe('PROJ-1');
      expect(issue.summary).toBe('My issue');
      expect(issue.description).toBe(adfToText(makeAdf(descriptionText)));
      expect(issue.comments).toEqual([adfToText(makeAdf(commentText))]);
      expect(issue.labels).toEqual(['bug']);
      expect(issue.issueType).toBe('Story');
      expect(client.getIssue).toHaveBeenCalledWith('PROJ-1');
    });

    it('handles null description without throwing', async () => {
      vi.mocked(client.getIssue).mockResolvedValue({
        id: '2',
        key: 'PROJ-2',
        fields: {
          summary: 'No description',
          description: null,
          comment: { comments: [] },
          labels: [],
          issuetype: { name: 'Bug' },
        },
      });

      const issue = await tracker.getIssue('PROJ-2');
      expect(issue.description).toBe('');
    });
  });

  describe('postComment', () => {
    it('converts plain text to ADF before calling the client', async () => {
      vi.mocked(client.postComment).mockResolvedValue({ id: 'c1', body: makeAdf('') });

      await tracker.postComment('PROJ-1', 'Hello world');

      expect(client.postComment).toHaveBeenCalledWith('PROJ-1', textToAdf('Hello world'));
    });
  });

  describe('getSubtasks', () => {
    it('delegates to the REST client and returns formatted summaries', async () => {
      const expected = ['- [PROJ-2] First subtask', '- [PROJ-3] Second subtask'];
      vi.mocked(client.getSubtasks).mockResolvedValue(expected);

      const result = await tracker.getSubtasks('PROJ-1');

      expect(result).toEqual(expected);
      expect(client.getSubtasks).toHaveBeenCalledWith('PROJ-1');
    });

    it('returns empty array when client returns empty', async () => {
      vi.mocked(client.getSubtasks).mockResolvedValue([]);

      const result = await tracker.getSubtasks('PROJ-1');

      expect(result).toEqual([]);
    });
  });

  describe('addLabel', () => {
    it('delegates to the REST client with the given key and label', async () => {
      vi.mocked(client.addLabel).mockResolvedValue(undefined);

      await tracker.addLabel('PROJ-1', 'ferry:blocked');

      expect(client.addLabel).toHaveBeenCalledWith('PROJ-1', 'ferry:blocked');
    });
  });

  describe('getSubtaskDetails', () => {
    it('converts ADF descriptions and returns TrackerSubtask array', async () => {
      vi.mocked(client.getSubtaskDetails).mockResolvedValue([
        {
          key: 'PROJ-2',
          title: 'First subtask',
          descriptionAdf: makeAdf('do first'),
          status: 'To Do',
        },
        { key: 'PROJ-3', title: 'Second subtask', descriptionAdf: null, status: 'In Progress' },
      ]);

      const result = await tracker.getSubtaskDetails('PROJ-1');

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('PROJ-2');
      expect(result[0].title).toBe('First subtask');
      expect(result[0].description).toBe(adfToText(makeAdf('do first')));
      expect(result[0].status).toBe('To Do');
      expect(result[1].description).toBe('');
      expect(result[1].status).toBe('In Progress');
      expect(client.getSubtaskDetails).toHaveBeenCalledWith('PROJ-1');
    });

    it('returns empty array when client returns empty', async () => {
      vi.mocked(client.getSubtaskDetails).mockResolvedValue([]);

      const result = await tracker.getSubtaskDetails('PROJ-1');

      expect(result).toEqual([]);
    });
  });
});
