import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolvePromptPath } from './resolve.js';

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
