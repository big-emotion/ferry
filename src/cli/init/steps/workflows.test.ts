import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../prompt.js', () => ({
  printSuccess: vi.fn(),
  printSkip: vi.fn(),
  printWarn: vi.fn(),
  printError: vi.fn(),
  print: vi.fn(),
}));

import { installWorkflows, scaffoldCodeowners } from './workflows.js';
import type { WorkflowEntry } from '../types.js';

const TEMPLATES: WorkflowEntry[] = [
  { filename: 'ferry-refine.yml', content: 'refine-content' },
  { filename: 'ferry-dev.yml', content: 'dev-content' },
];

describe('installWorkflows', () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('creates the workflow directory and writes new files', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-wf-test-'));
    const workflowDir = join(tmpDir, '.github', 'workflows');

    const result = installWorkflows(workflowDir, TEMPLATES, false);

    expect(result.ok).toBe(true);
    expect(existsSync(join(workflowDir, 'ferry-refine.yml'))).toBe(true);
    expect(existsSync(join(workflowDir, 'ferry-dev.yml'))).toBe(true);
    expect(readFileSync(join(workflowDir, 'ferry-refine.yml'), 'utf8')).toBe('refine-content');
  });

  it('skips file when existing content matches template', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-wf-skip-'));
    const workflowDir = join(tmpDir, '.github', 'workflows');

    installWorkflows(workflowDir, TEMPLATES, false);
    vi.clearAllMocks();

    const result = installWorkflows(workflowDir, TEMPLATES, false);
    expect(result.ok).toBe(true);
  });

  it('does not overwrite when content differs and overwrite is false', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-wf-noover-'));
    const workflowDir = join(tmpDir, '.github', 'workflows');

    installWorkflows(workflowDir, TEMPLATES, false);
    writeFileSync(join(workflowDir, 'ferry-refine.yml'), 'modified-content', 'utf8');

    installWorkflows(workflowDir, TEMPLATES, false);

    expect(readFileSync(join(workflowDir, 'ferry-refine.yml'), 'utf8')).toBe('modified-content');
  });

  it('overwrites file when content differs and overwrite is true', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-wf-over-'));
    const workflowDir = join(tmpDir, '.github', 'workflows');

    installWorkflows(workflowDir, TEMPLATES, false);
    writeFileSync(join(workflowDir, 'ferry-refine.yml'), 'old-content', 'utf8');

    installWorkflows(workflowDir, TEMPLATES, true);

    expect(readFileSync(join(workflowDir, 'ferry-refine.yml'), 'utf8')).toBe('refine-content');
  });

  it('handles empty templates list', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-wf-empty-'));
    const workflowDir = join(tmpDir, '.github', 'workflows');
    const result = installWorkflows(workflowDir, [], false);
    expect(result.ok).toBe(true);
  });
});

describe('scaffoldCodeowners', () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('creates a new CODEOWNERS file when none exists', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-co-new-'));

    const result = scaffoldCodeowners(tmpDir, 'my-org');

    expect(result.ok).toBe(true);
    const content = readFileSync(join(tmpDir, '.github', 'CODEOWNERS'), 'utf8');
    expect(content).toContain('.github/workflows/ferry-*.yml @my-org');
  });

  it('appends ferry entry to existing CODEOWNERS without ferry entries', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-co-append-'));
    const githubDir = join(tmpDir, '.github');
    mkdirSync(githubDir, { recursive: true });
    writeFileSync(join(githubDir, 'CODEOWNERS'), '* @team-lead\n', 'utf8');

    const result = scaffoldCodeowners(tmpDir, 'my-org');

    expect(result.ok).toBe(true);
    const content = readFileSync(join(githubDir, 'CODEOWNERS'), 'utf8');
    expect(content).toContain('* @team-lead');
    expect(content).toContain('.github/workflows/ferry-*.yml @my-org');
  });

  it('skips when CODEOWNERS already contains ferry entries', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-co-skip-'));
    const githubDir = join(tmpDir, '.github');
    mkdirSync(githubDir, { recursive: true });
    writeFileSync(
      join(githubDir, 'CODEOWNERS'),
      '.github/workflows/ferry-*.yml @existing-owner\n',
      'utf8',
    );

    scaffoldCodeowners(tmpDir, 'my-org');

    const content = readFileSync(join(githubDir, 'CODEOWNERS'), 'utf8');
    expect(content).not.toContain('@my-org');
    expect(content).toContain('@existing-owner');
  });
});
