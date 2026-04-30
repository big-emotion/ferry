import { describe, it, expect, vi, afterEach } from 'vitest';
import { requireEnv, loadMcpServers } from './env.js';
import { byEventId, byPrHeadSha, byReviewCommentId } from './idempotency.js';
import { buildSystem, loadOptionalPrompt, buildTicketBlock } from './prompt.js';
import { appendOutput } from './output.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

describe('requireEnv', () => {
  it('returns value when env var is set', () => {
    vi.stubEnv('TEST_KEY', 'hello');
    expect(requireEnv('TEST_KEY')).toBe('hello');
  });

  it('throws FerryError when env var is missing', () => {
    delete process.env.TEST_KEY;
    expect(() => requireEnv('TEST_KEY')).toThrow('[ferry:state-invariant]');
  });
});

describe('loadMcpServers', () => {
  it('returns empty array when AGENT_MCP_SERVERS is unset', () => {
    delete process.env.AGENT_MCP_SERVERS;
    expect(loadMcpServers()).toEqual([]);
  });

  it('returns empty array when AGENT_MCP_SERVERS is invalid JSON', () => {
    vi.stubEnv('AGENT_MCP_SERVERS', 'not-json');
    expect(loadMcpServers()).toEqual([]);
  });

  it('returns empty array when AGENT_MCP_SERVERS is not an array', () => {
    vi.stubEnv('AGENT_MCP_SERVERS', '{"name":"x","url":"http://x"}');
    expect(loadMcpServers()).toEqual([]);
  });

  it('filters out entries without name or url', () => {
    vi.stubEnv(
      'AGENT_MCP_SERVERS',
      JSON.stringify([
        { name: 'valid', url: 'http://valid' },
        { name: 'no-url' },
        { url: 'http://no-name' },
        null,
      ]),
    );
    const result = loadMcpServers();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('valid');
  });

  it('returns valid servers with all fields preserved', () => {
    vi.stubEnv(
      'AGENT_MCP_SERVERS',
      JSON.stringify([
        { name: 'srv', url: 'http://srv', authorization_token: 'tok', allowed_tools: ['foo'] },
      ]),
    );
    const result = loadMcpServers();
    expect(result[0]).toMatchObject({
      name: 'srv',
      url: 'http://srv',
      authorization_token: 'tok',
    });
  });
});

// ---------------------------------------------------------------------------
// idempotency marker builders
// ---------------------------------------------------------------------------

describe('byEventId', () => {
  it('formats marker as [ferry:<role>:<eventId>]', () => {
    expect(byEventId('dev', 'ev-123')).toBe('[ferry:dev:ev-123]');
  });
});

describe('byPrHeadSha', () => {
  it('truncates headSha to 7 characters', () => {
    expect(byPrHeadSha('reviewer', 'abcdef1234567890')).toBe('[ferry:reviewer:abcdef1]');
  });

  it('works for short SHAs (no padding)', () => {
    expect(byPrHeadSha('reviewer', 'abc')).toBe('[ferry:reviewer:abc]');
  });
});

describe('byReviewCommentId', () => {
  it('formats marker as [ferry:<role>:<commentId>]', () => {
    expect(byReviewCommentId('iterator', 99)).toBe('[ferry:iterator:99]');
  });
});

// ---------------------------------------------------------------------------
// prompt helpers
// ---------------------------------------------------------------------------

describe('buildTicketBlock', () => {
  const issue = { summary: 'Fix bug', issueType: 'Bug', description: 'It is broken.' };

  it('builds base ticket block without optional fields', () => {
    const result = buildTicketBlock('PROJ-1', issue);
    expect(result).toBe('TICKET: PROJ-1\nTITLE: Fix bug\nTYPE: Bug\nDESCRIPTION:\nIt is broken.');
  });

  it('includes LABELS when opts.labels is provided', () => {
    const result = buildTicketBlock('PROJ-1', issue, { labels: 'foo, bar' });
    expect(result).toContain('LABELS: foo, bar');
  });

  it('shows "none" for empty labels string', () => {
    const result = buildTicketBlock('PROJ-1', issue, { labels: '' });
    expect(result).toContain('LABELS: none');
  });

  it('includes COMMENTS when opts.comments is non-empty', () => {
    const result = buildTicketBlock('PROJ-1', issue, { comments: 'Comment: hello' });
    expect(result).toContain('COMMENTS:\nComment: hello');
  });

  it('omits COMMENTS section when opts.comments is empty string', () => {
    const result = buildTicketBlock('PROJ-1', issue, { comments: '' });
    expect(result).not.toContain('COMMENTS');
  });
});

describe('buildSystem', () => {
  const REPO_ROOT = '/workspace/repo';
  const _readFile = (p: string) => {
    if (p.includes('dev.md')) return 'base system';
    if (p.includes('_project.md')) return 'project conventions';
    return '';
  };

  it('returns base system when no project snippet is found', () => {
    const noSnippet = () => false;
    const readBase = (p: string) => (p.includes('dev.md') ? 'base system' : '');
    const result = buildSystem('dev', REPO_ROOT, { _checkExists: noSnippet, _readFile: readBase });
    expect(result).toBe('base system');
  });

  it('appends project conventions when snippet is present', () => {
    const hasSnippet = (p: string) => p.includes('dev.md') || p.includes('_project.md');
    const result = buildSystem('dev', REPO_ROOT, {
      _checkExists: hasSnippet,
      _readFile: _readFile as (p: string, enc: BufferEncoding) => string,
    });
    expect(result).toContain('base system');
    expect(result).toContain('## Project conventions');
    expect(result).toContain('project conventions');
  });

  it('uses custom separator when specified', () => {
    const hasSnippet = (p: string) => p.includes('dev.md') || p.includes('_project.md');
    const result = buildSystem('dev', REPO_ROOT, {
      extraParts: ['extra'],
      separator: '\n\n---\n\n',
      _checkExists: hasSnippet,
      _readFile: _readFile as (p: string, enc: BufferEncoding) => string,
    });
    expect(result).toContain('\n\n---\n\n');
  });

  it('filters out null/undefined extraParts', () => {
    const noSnippet = () => false;
    const readBase = (p: string) => (p.includes('dev.md') ? 'base system' : '');
    const result = buildSystem('dev', REPO_ROOT, {
      extraParts: [null, undefined, 'extra-part'],
      _checkExists: noSnippet,
      _readFile: readBase,
    });
    expect(result).toContain('extra-part');
    expect(result).not.toContain('null');
  });
});

describe('loadOptionalPrompt', () => {
  const REPO_ROOT = '/workspace/repo';

  it('returns null when the file cannot be read', () => {
    const _readFile = () => {
      throw new Error('ENOENT');
    };
    const result = loadOptionalPrompt(
      'review-comment',
      REPO_ROOT,
      _readFile as unknown as (p: string, enc: BufferEncoding) => string,
    );
    expect(result).toBeNull();
  });

  it('returns file contents when readable', () => {
    const _readFile = () => 'comment template content';
    const result = loadOptionalPrompt(
      'review-comment',
      REPO_ROOT,
      _readFile as unknown as (p: string, enc: BufferEncoding) => string,
    );
    expect(result).toBe('comment template content');
  });
});

// ---------------------------------------------------------------------------
// appendOutput
// ---------------------------------------------------------------------------

describe('appendOutput', () => {
  it('writes token counts to GITHUB_OUTPUT when set', async () => {
    const { writeFileSync } = await import('node:fs');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'ferry-test-'));
    const outFile = join(dir, 'output');
    writeFileSync(outFile, '');
    vi.stubEnv('GITHUB_OUTPUT', outFile);

    appendOutput({ input_tokens: 100, output_tokens: 50 });

    const { readFileSync } = await import('node:fs');
    const contents = readFileSync(outFile, 'utf8');
    expect(contents).toContain('input_tokens=100');
    expect(contents).toContain('output_tokens=50');
    expect(contents).not.toContain('model=');
  });

  it('includes model in output when provided', async () => {
    const { writeFileSync, readFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'ferry-test-'));
    const outFile = join(dir, 'output2');
    writeFileSync(outFile, '');
    vi.stubEnv('GITHUB_OUTPUT', outFile);

    appendOutput({ input_tokens: 10, output_tokens: 5, model: 'claude-opus-4-7' });

    const contents = readFileSync(outFile, 'utf8');
    expect(contents).toContain('model=claude-opus-4-7');
  });

  it('is a no-op when GITHUB_OUTPUT is not set', () => {
    delete process.env.GITHUB_OUTPUT;
    expect(() => appendOutput({ input_tokens: 0, output_tokens: 0 })).not.toThrow();
  });
});
