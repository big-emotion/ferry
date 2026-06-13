import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkClaudeCodePromptOverrides } from './claude-code-prompts.js';

describe('checkClaudeCodePromptOverrides', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ferry-cc-doctor-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is green with no overrides when prompts/ is absent', () => {
    const result = checkClaudeCodePromptOverrides({ repoRoot: dir });
    expect(result.status).toBe('green');
    expect(result.detail).toMatch(/bundled defaults/);
  });

  it('warns and lists each detected legacy full override', () => {
    mkdirSync(join(dir, 'prompts'), { recursive: true });
    writeFileSync(join(dir, 'prompts', 'dev.claude-code.md'), 'custom');
    writeFileSync(join(dir, 'prompts', 'review.claude-code.md'), 'custom');
    const result = checkClaudeCodePromptOverrides({ repoRoot: dir });
    expect(result.status).toBe('yellow');
    expect(result.detail).toContain('prompts/dev.claude-code.md');
    expect(result.detail).toContain('prompts/review.claude-code.md');
  });

  it('warns when a legacy claude-code full override is present', () => {
    mkdirSync(join(dir, 'prompts'), { recursive: true });
    writeFileSync(join(dir, 'prompts', 'dev.claude-code.md'), 'custom');
    const result = checkClaudeCodePromptOverrides({ repoRoot: dir });
    expect(result.status).toBe('yellow');
    expect(result.detail).toContain('prompts/dev.claude-code.md');
    expect(result.detail).toContain('prompts/dev.claude-code.local.md');
  });

  it('is green when only a local overlay is present', () => {
    mkdirSync(join(dir, 'prompts'), { recursive: true });
    writeFileSync(join(dir, 'prompts', 'dev.claude-code.local.md'), 'custom');
    const result = checkClaudeCodePromptOverrides({ repoRoot: dir });
    expect(result.status).toBe('green');
    expect(result.detail).toContain('prompts/dev.claude-code.local.md');
  });

  it('ignores a script-path <agent>.md override', () => {
    mkdirSync(join(dir, 'prompts'), { recursive: true });
    writeFileSync(join(dir, 'prompts', 'dev.md'), 'script-path override');
    const result = checkClaudeCodePromptOverrides({ repoRoot: dir });
    expect(result.detail).toMatch(/No claude-code prompt overrides/);
  });
});
