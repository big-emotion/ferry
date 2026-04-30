import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JiraRestClient, createJiraRestClientFromEnv } from './jira-rest.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dir, '../../__fixtures__/jira');

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));
}

function makeMockResponse(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body ?? {}),
  } as unknown as Response;
}

const CONFIG = {
  baseUrl: 'https://acme-corp.atlassian.net',
  email: 'bot@acme-corp.com',
  apiToken: 'test-token',
};

const EXPECTED_AUTH = `Basic ${Buffer.from(`${CONFIG.email}:${CONFIG.apiToken}`).toString('base64')}`;

describe('JiraRestClient', () => {
  let client: JiraRestClient;

  beforeEach(() => {
    client = new JiraRestClient(CONFIG.baseUrl, CONFIG.email, CONFIG.apiToken);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('getIssue', () => {
    it('requests the correct URL with auth and accept headers', async () => {
      const fix = fixture('get-issue-ACME-1.json');
      const mockFetch = vi.fn().mockResolvedValue(makeMockResponse(200, fix));
      vi.stubGlobal('fetch', mockFetch);

      const result = await client.getIssue('ACME-1');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://acme-corp.atlassian.net/rest/api/3/issue/ACME-1?fields=summary,description,comment,labels,issuetype',
      );
      expect((init.headers as Record<string, string>)['Authorization']).toBe(EXPECTED_AUTH);
      expect((init.headers as Record<string, string>)['Accept']).toBe('application/json');
      expect(result.key).toBe('ACME-1');
      expect(result.fields.summary).toBe('Implement feature X');
      expect(result.fields.labels).toEqual(['feature', 'backend']);
    });

    it('throws FerryError("transient") on HTTP 500', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeMockResponse(500)));
      await expect(client.getIssue('ACME-1')).rejects.toMatchObject({ code: 'transient' });
    });

    it('throws FerryError("spend-cap") on HTTP 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeMockResponse(429)));
      await expect(client.getIssue('ACME-1')).rejects.toMatchObject({ code: 'spend-cap' });
    });

    it('throws FerryError("spend-cap") on HTTP 402', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeMockResponse(402)));
      await expect(client.getIssue('ACME-1')).rejects.toMatchObject({ code: 'spend-cap' });
    });
  });

  describe('postComment', () => {
    it('POSTs to the correct URL with ADF body and content-type header', async () => {
      const fix = fixture('post-comment-201.json');
      const mockFetch = vi.fn().mockResolvedValue(makeMockResponse(201, fix));
      vi.stubGlobal('fetch', mockFetch);

      const adfBody = {
        version: 1 as const,
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph' as const,
            content: [{ type: 'text' as const, text: 'hello world' }],
          },
        ],
      };

      await client.postComment('ACME-1', adfBody);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://acme-corp.atlassian.net/rest/api/3/issue/ACME-1/comment');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect((init.headers as Record<string, string>)['Authorization']).toBe(EXPECTED_AUTH);
      const sent = JSON.parse(init.body as string) as { body: unknown };
      expect(sent.body).toEqual(adfBody);
    });
  });

  describe('putComment', () => {
    it('PUTs to the correct URL with comment id', async () => {
      const fix = fixture('put-comment-200.json');
      const mockFetch = vi.fn().mockResolvedValue(makeMockResponse(200, fix));
      vi.stubGlobal('fetch', mockFetch);

      const adfBody = {
        version: 1 as const,
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph' as const,
            content: [{ type: 'text' as const, text: 'updated' }],
          },
        ],
      };

      await client.putComment('ACME-1', '10001', adfBody);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://acme-corp.atlassian.net/rest/api/3/issue/ACME-1/comment/10001');
      expect(init.method).toBe('PUT');
    });
  });

  describe('createSubtask', () => {
    const adfDesc = {
      version: 1 as const,
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph' as const,
          content: [{ type: 'text' as const, text: 'desc' }],
        },
      ],
    };

    it('resolves issuetype from project metadata then POSTs to /rest/api/3/issue', async () => {
      const issuetypesFix = fixture('get-issuetypes-ACME.json');
      const createdFix = fixture('create-subtask-201.json');
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(makeMockResponse(200, issuetypesFix))
        .mockResolvedValueOnce(makeMockResponse(201, createdFix));
      vi.stubGlobal('fetch', mockFetch);

      const result = await client.createSubtask('ACME-1', 'Sub-task title', adfDesc);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [issuetypesUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(issuetypesUrl).toBe(
        'https://acme-corp.atlassian.net/rest/api/3/issue/createmeta/ACME/issuetypes',
      );
      const [createUrl, createInit] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(createUrl).toBe('https://acme-corp.atlassian.net/rest/api/3/issue');
      expect(createInit.method).toBe('POST');
      const body = JSON.parse(createInit.body as string) as {
        fields: {
          project: { key: string };
          parent: { key: string };
          summary: string;
          issuetype: { name: string };
        };
      };
      expect(body.fields.project.key).toBe('ACME');
      expect(body.fields.parent.key).toBe('ACME-1');
      expect(body.fields.summary).toBe('Sub-task title');
      expect(body.fields.issuetype.name).toBe('Subtask');
      expect(result.key).toBe('ACME-2');
    });

    it('resolves French locale issuetype name ("Sous-tâche")', async () => {
      const frIssuetypes = {
        issueTypes: [
          { id: '10000', name: 'Récit', subtask: false },
          { id: '10001', name: 'Sous-tâche', subtask: true },
        ],
      };
      const createdFix = fixture('create-subtask-201.json');
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(makeMockResponse(200, frIssuetypes))
        .mockResolvedValueOnce(makeMockResponse(201, createdFix));
      vi.stubGlobal('fetch', mockFetch);

      await client.createSubtask('CHAN-1', 'Ma sous-tâche', adfDesc);

      const createInit = mockFetch.mock.calls[1][1] as RequestInit;
      const body = JSON.parse(createInit.body as string) as {
        fields: { issuetype: { name: string } };
      };
      expect(body.fields.issuetype.name).toBe('Sous-tâche');
    });

    it('caches the issuetype resolution for the same project', async () => {
      const issuetypesFix = fixture('get-issuetypes-ACME.json');
      const createdFix = fixture('create-subtask-201.json');
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(makeMockResponse(200, issuetypesFix))
        .mockResolvedValue(makeMockResponse(201, createdFix));
      vi.stubGlobal('fetch', mockFetch);

      await client.createSubtask('ACME-1', 'first', adfDesc);
      await client.createSubtask('ACME-2', 'second', adfDesc);

      const issuetypeCalls = (mockFetch.mock.calls as [string][]).filter(([url]) =>
        url.includes('createmeta'),
      );
      expect(issuetypeCalls).toHaveLength(1);
    });

    it('throws FerryError("state-invariant") when project has no subtask issuetype', async () => {
      const noSubtask = { issueTypes: [{ id: '10000', name: 'Story', subtask: false }] };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeMockResponse(200, noSubtask)));

      await expect(client.createSubtask('ACME-1', 'title', adfDesc)).rejects.toMatchObject({
        code: 'state-invariant',
      });
    });
  });

  describe('addLabel', () => {
    it('PUTs with update.labels add directive', async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeMockResponse(204));
      vi.stubGlobal('fetch', mockFetch);

      await client.addLabel('ACME-1', 'ferry:paused');

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://acme-corp.atlassian.net/rest/api/3/issue/ACME-1');
      expect(init.method).toBe('PUT');
      const body = JSON.parse(init.body as string) as {
        update: { labels: Array<{ add: string }> };
      };
      expect(body.update.labels).toEqual([{ add: 'ferry:paused' }]);
    });
  });

  describe('getTransitions', () => {
    it('returns the transitions list', async () => {
      const fix = fixture('get-transitions.json');
      const mockFetch = vi.fn().mockResolvedValue(makeMockResponse(200, fix));
      vi.stubGlobal('fetch', mockFetch);

      const result = await client.getTransitions('ACME-1');

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('https://acme-corp.atlassian.net/rest/api/3/issue/ACME-1/transitions');
      expect(result.transitions).toHaveLength(5);
      expect(result.transitions.find((t) => t.name === 'In Review')?.id).toBe('31');
    });
  });

  describe('postTransition', () => {
    it('POSTs the transition id and handles 204', async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeMockResponse(204));
      vi.stubGlobal('fetch', mockFetch);

      await expect(client.postTransition('ACME-1', '31')).resolves.toBeUndefined();

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://acme-corp.atlassian.net/rest/api/3/issue/ACME-1/transitions');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string) as { transition: { id: string } };
      expect(body.transition.id).toBe('31');
    });
  });
});

describe('createJiraRestClientFromEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws FerryError("state-invariant") when FERRY_JIRA_BASE_URL is missing', () => {
    vi.stubEnv('FERRY_JIRA_BASE_URL', '');
    vi.stubEnv('FERRY_JIRA_EMAIL', 'bot@acme.com');
    vi.stubEnv('FERRY_JIRA_API_TOKEN', 'tok');
    expect(() => createJiraRestClientFromEnv()).toThrow(
      expect.objectContaining({ code: 'state-invariant' }),
    );
  });

  it('throws FerryError("state-invariant") when FERRY_JIRA_EMAIL is missing', () => {
    vi.stubEnv('FERRY_JIRA_BASE_URL', 'https://acme.atlassian.net');
    vi.stubEnv('FERRY_JIRA_EMAIL', '');
    vi.stubEnv('FERRY_JIRA_API_TOKEN', 'tok');
    expect(() => createJiraRestClientFromEnv()).toThrow(
      expect.objectContaining({ code: 'state-invariant' }),
    );
  });

  it('throws FerryError("state-invariant") when FERRY_JIRA_API_TOKEN is missing', () => {
    vi.stubEnv('FERRY_JIRA_BASE_URL', 'https://acme.atlassian.net');
    vi.stubEnv('FERRY_JIRA_EMAIL', 'bot@acme.com');
    vi.stubEnv('FERRY_JIRA_API_TOKEN', '');
    expect(() => createJiraRestClientFromEnv()).toThrow(
      expect.objectContaining({ code: 'state-invariant' }),
    );
  });

  it('returns a JiraRestClient when all env vars are set', () => {
    vi.stubEnv('FERRY_JIRA_BASE_URL', 'https://acme.atlassian.net');
    vi.stubEnv('FERRY_JIRA_EMAIL', 'bot@acme.com');
    vi.stubEnv('FERRY_JIRA_API_TOKEN', 'tok');
    expect(() => createJiraRestClientFromEnv()).not.toThrow();
  });
});
