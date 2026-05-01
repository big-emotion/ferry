import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../prompt.js', () => ({
  printSuccess: vi.fn(),
  print: vi.fn(),
  printSkip: vi.fn(),
  printWarn: vi.fn(),
  printError: vi.fn(),
}));

import { stepJiraBundle } from './jira-bundle.js';

describe('stepJiraBundle', () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('writes ferry-jira-automation-rules.json to the repo root', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-test-'));
    const result = stepJiraBundle(tmpDir, 'acme-corp', 'acme-app');
    expect(result.ok).toBe(true);
    const outPath = join(tmpDir, 'ferry-jira-automation-rules.json');
    expect(() => readFileSync(outPath, 'utf8')).not.toThrow();
  });

  it('output file contains valid JSON', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-json-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app');
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-rules.json'), 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('output JSON contains 4 automation rules', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-rules-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app');
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-rules.json'), 'utf8');
    const bundle = JSON.parse(content) as { rules: unknown[] };
    expect(bundle.rules).toHaveLength(4);
  });

  it('dispatch URL uses correct owner and repo', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-url-'));
    stepJiraBundle(tmpDir, 'my-owner', 'my-repo');
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-rules.json'), 'utf8');
    expect(content).toContain('https://api.github.com/repos/my-owner/my-repo/dispatches');
  });

  it('output file ends with a newline', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-jb-nl-'));
    stepJiraBundle(tmpDir, 'acme-corp', 'acme-app');
    const content = readFileSync(join(tmpDir, 'ferry-jira-automation-rules.json'), 'utf8');
    expect(content.endsWith('\n')).toBe(true);
  });
});
