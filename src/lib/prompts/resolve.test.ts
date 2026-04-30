import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolvePromptPath, loadProjectSnippet } from './resolve.js';

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
