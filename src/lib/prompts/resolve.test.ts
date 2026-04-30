import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolvePromptPath, loadProjectSnippet, loadAgentExtension } from './resolve.js';

const REPO_ROOT = '/workspace/repo';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolvePromptPath', () => {
  it('returns consumer override path when file exists', () => {
    const check = (p: string) => p === '/workspace/repo/prompts/dev.md';
    const result = resolvePromptPath('dev', REPO_ROOT, check);
    expect(result).toBe('/workspace/repo/prompts/dev.md');
  });

  it('falls back to .ferry default when consumer override is absent', () => {
    const check = () => false;
    const result = resolvePromptPath('dev', REPO_ROOT, check);
    expect(result).toBe('/workspace/repo/.ferry/prompts/dev.md');
  });

  it('uses FERRY_PROMPTS_DIR as override directory when set', () => {
    vi.stubEnv('FERRY_PROMPTS_DIR', '/custom/prompts');
    const check = (p: string) => p === '/custom/prompts/review.md';
    const result = resolvePromptPath('review', REPO_ROOT, check);
    expect(result).toBe('/custom/prompts/review.md');
  });

  it('falls back to default when FERRY_PROMPTS_DIR file is absent', () => {
    vi.stubEnv('FERRY_PROMPTS_DIR', '/custom/prompts');
    const check = () => false;
    const result = resolvePromptPath('review', REPO_ROOT, check);
    expect(result).toBe('/workspace/repo/.ferry/prompts/review.md');
  });

  it('uses FERRY_BUNDLED_PROMPTS_DIR as the default fallback when set', () => {
    vi.stubEnv('FERRY_BUNDLED_PROMPTS_DIR', '/action/path/prompts');
    const check = () => false;
    const result = resolvePromptPath('dev', REPO_ROOT, check);
    expect(result).toBe('/action/path/prompts/dev.md');
  });

  it('consumer override still wins when FERRY_BUNDLED_PROMPTS_DIR is set', () => {
    vi.stubEnv('FERRY_BUNDLED_PROMPTS_DIR', '/action/path/prompts');
    const check = (p: string) => p === '/workspace/repo/prompts/dev.md';
    const result = resolvePromptPath('dev', REPO_ROOT, check);
    expect(result).toBe('/workspace/repo/prompts/dev.md');
  });

  it('only the named phase falls back; other phases unaffected', () => {
    const check = (p: string) => p === '/workspace/repo/prompts/iterate.md';
    const devResult = resolvePromptPath('dev', REPO_ROOT, check);
    const iterResult = resolvePromptPath('iterate', REPO_ROOT, check);
    expect(devResult).toBe('/workspace/repo/.ferry/prompts/dev.md');
    expect(iterResult).toBe('/workspace/repo/prompts/iterate.md');
  });
});

describe('loadProjectSnippet', () => {
  const read = () => 'project conventions content';

  it('returns null when _project.md is absent from both locations', () => {
    const check = () => false;
    expect(loadProjectSnippet(REPO_ROOT, check, read)).toBeNull();
  });

  it('loads from prompts/_project.md when present', () => {
    const check = (p: string) => p === '/workspace/repo/prompts/_project.md';
    const result = loadProjectSnippet(REPO_ROOT, check, read);
    expect(result).toBe('project conventions content');
  });

  it('loads from .ferry/prompts/_project.md when prompts/_project.md absent', () => {
    const check = (p: string) => p === '/workspace/repo/.ferry/prompts/_project.md';
    const readSpy = vi.fn(() => 'ferry default content');
    const result = loadProjectSnippet(REPO_ROOT, check, readSpy);
    expect(result).toBe('ferry default content');
    expect(readSpy).toHaveBeenCalledWith('/workspace/repo/.ferry/prompts/_project.md', 'utf8');
  });

  it('prefers prompts/_project.md over .ferry/prompts/_project.md', () => {
    const check = () => true;
    const readSpy = vi.fn(() => 'content');
    loadProjectSnippet(REPO_ROOT, check, readSpy);
    expect(readSpy).toHaveBeenCalledWith('/workspace/repo/prompts/_project.md', 'utf8');
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  it('truncates content exceeding 2048 bytes', () => {
    const big = 'x'.repeat(3000);
    const readBig = () => big;
    const check = (p: string) => p === '/workspace/repo/prompts/_project.md';
    const result = loadProjectSnippet(REPO_ROOT, check, readBig);
    expect(result).toHaveLength(2048);
    expect(result).toBe('x'.repeat(2048));
  });

  it('respects FERRY_PROMPTS_DIR for the first candidate', () => {
    vi.stubEnv('FERRY_PROMPTS_DIR', '/custom/prompts');
    const check = (p: string) => p === '/custom/prompts/_project.md';
    const readSpy = vi.fn(() => 'custom content');
    const result = loadProjectSnippet(REPO_ROOT, check, readSpy);
    expect(result).toBe('custom content');
    expect(readSpy).toHaveBeenCalledWith('/custom/prompts/_project.md', 'utf8');
  });
});

describe('loadAgentExtension', () => {
  it('returns null when <name>.extra.md is absent', () => {
    const check = () => false;
    const read = vi.fn(() => '');
    expect(loadAgentExtension('reviewer', REPO_ROOT, check, read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('reads from FERRY_PROMPTS_DIR when set', () => {
    vi.stubEnv('FERRY_PROMPTS_DIR', '/custom/prompts');
    const check = (p: string) => p === '/custom/prompts/reviewer.extra.md';
    const readSpy = vi.fn(() => 'reviewer extension content');
    const result = loadAgentExtension('reviewer', REPO_ROOT, check, readSpy);
    expect(result).toBe('reviewer extension content');
    expect(readSpy).toHaveBeenCalledWith('/custom/prompts/reviewer.extra.md', 'utf8');
  });

  it('falls back to <repoRoot>/prompts when FERRY_PROMPTS_DIR is unset', () => {
    const check = (p: string) => p === '/workspace/repo/prompts/dev.extra.md';
    const readSpy = vi.fn(() => 'dev extension content');
    const result = loadAgentExtension('dev', REPO_ROOT, check, readSpy);
    expect(result).toBe('dev extension content');
    expect(readSpy).toHaveBeenCalledWith('/workspace/repo/prompts/dev.extra.md', 'utf8');
  });

  it('truncates content exceeding 4096 bytes and logs a warning', () => {
    const big = 'y'.repeat(5000);
    const check = (p: string) => p === '/workspace/repo/prompts/iterator.extra.md';
    const read = () => big;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = loadAgentExtension('iterator', REPO_ROOT, check, read);
    expect(result).toHaveLength(4096);
    expect(result).toBe('y'.repeat(4096));
    expect(errSpy).toHaveBeenCalledWith(
      '[ferry:prompts] iterator.extra.md exceeds 4096B — truncating',
    );
    errSpy.mockRestore();
  });
});
