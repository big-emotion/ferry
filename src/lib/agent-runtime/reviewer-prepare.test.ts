import { describe, it, expect } from 'vitest';
import { prepareReviewer } from './reviewer-prepare.js';
import type { TrackerIssue } from '../io/tracker/types.js';
import type { PR, PRFile } from '../dispatch/runner/types.js';
import type { ResolvedCapabilities } from '../labels/capabilities.js';

const REPO_ROOT = '/workspace/repo';

const issue: TrackerIssue = {
  key: 'PROJ-300',
  summary: 'Add feature X',
  description: 'Spec for X',
  comments: [],
  labels: [],
  issueType: 'Story',
  issueTypeRaw: 'Story',
};

const pr: PR = {
  number: 42,
  title: 'feat: add X',
  baseRef: 'main',
  headRef: 'ferry/feat/PROJ-300',
  headSha: 'feedbeefcafebabe1234567890abcdef12345678',
  mergeable: true,
};

const files: PRFile[] = [
  { filename: 'src/a.ts', status: 'modified', additions: 4, deletions: 2, patch: '@@ patch' },
  { filename: 'src/b.ts', status: 'added', additions: 10, deletions: 0, patch: '@@ patch b' },
];

const commits = [
  { sha: 'abc1234deadbeef', message: 'feat: a\n\ndetails' },
  { sha: 'def5678baadf00d', message: 'fix: b' },
];

const emptyCapabilities: ResolvedCapabilities = {
  mcpServerNames: [],
  serverAllowedTools: {},
  triggeredLabels: [],
  unknownFerryLabels: [],
};

const buildSystemStub = (name: string, _root: string, opts?: { extraParts?: unknown[] }) =>
  `SYSTEM(${name}, parts=${(opts?.extraParts ?? []).length})`;

const loadOptionalPromptStub = () => 'OPTIONAL_REVIEW_COMMENT_OVERLAY';

describe('prepareReviewer', () => {
  it('builds the reviewer system prompt with review-comment overlay, no rubric override by default', () => {
    const ctx = prepareReviewer({
      ticketKey: 'PROJ-300',
      issue,
      pr,
      files,
      commits,
      branchName: 'ferry/feat/PROJ-300',
      typeOverride: undefined,
      reviewRubric: undefined,
      capabilities: emptyCapabilities,
      idempotencyMarker: '[ferry:reviewer:feedbee]',
      repoRoot: REPO_ROOT,
      _buildSystem: buildSystemStub,
      _loadOptionalPrompt: loadOptionalPromptStub,
    });

    expect(ctx.system).toBe('SYSTEM(review, parts=1)');
    // No rubric override → system is the base verbatim
    expect(ctx.system).not.toContain('## Rubric override');
  });

  it('applies the strict rubric override when reviewRubric=strict', () => {
    const ctx = prepareReviewer({
      ticketKey: 'PROJ-300',
      issue,
      pr,
      files,
      commits,
      branchName: 'ferry/feat/PROJ-300',
      typeOverride: undefined,
      reviewRubric: 'strict',
      capabilities: emptyCapabilities,
      idempotencyMarker: '[ferry:reviewer:feedbee]',
      repoRoot: REPO_ROOT,
      _buildSystem: buildSystemStub,
      _loadOptionalPrompt: loadOptionalPromptStub,
    });

    expect(ctx.system).toContain('## Rubric override — strict');
  });

  it('applies the lenient rubric override when reviewRubric=lenient', () => {
    const ctx = prepareReviewer({
      ticketKey: 'PROJ-300',
      issue,
      pr,
      files,
      commits,
      branchName: 'ferry/feat/PROJ-300',
      typeOverride: undefined,
      reviewRubric: 'lenient',
      capabilities: emptyCapabilities,
      idempotencyMarker: '[ferry:reviewer:feedbee]',
      repoRoot: REPO_ROOT,
      _buildSystem: buildSystemStub,
      _loadOptionalPrompt: loadOptionalPromptStub,
    });

    expect(ctx.system).toContain('## Rubric override — lenient');
  });

  it('produces an initial prompt with the ticket, PR metadata, commits and changed file list', () => {
    const ctx = prepareReviewer({
      ticketKey: 'PROJ-300',
      issue,
      pr,
      files,
      commits,
      branchName: 'ferry/feat/PROJ-300',
      typeOverride: undefined,
      reviewRubric: undefined,
      capabilities: emptyCapabilities,
      idempotencyMarker: '[ferry:reviewer:feedbee]',
      repoRoot: REPO_ROOT,
      _buildSystem: buildSystemStub,
      _loadOptionalPrompt: loadOptionalPromptStub,
    });

    expect(ctx.initialPrompt).toContain('## Jira Ticket');
    expect(ctx.initialPrompt).toContain('TICKET: PROJ-300');
    expect(ctx.initialPrompt).toContain('PR #42: feat: add X');
    expect(ctx.initialPrompt).toContain('Base: main ← Head: ferry/feat/PROJ-300 (feedbee)');
    expect(ctx.initialPrompt).toContain('Files changed: 2  Commits: 2');
    expect(ctx.initialPrompt).toContain('abc1234 feat: a');
    expect(ctx.initialPrompt).toContain('def5678 fix: b');
    // status is padEnd(8): "modified" stays as-is, "added" becomes "added   "
    expect(ctx.initialPrompt).toContain('modified +4 -2  src/a.ts');
    expect(ctx.initialPrompt).toContain('added    +10 -0  src/b.ts');
    expect(ctx.initialPrompt).toContain('Use get_file_patch to inspect');
    expect(ctx.initialPrompt).not.toContain('MERGE CONFLICTS DETECTED');
  });

  it('emits a merge-conflict warning when pr.mergeable=false or patches contain conflict markers', () => {
    const conflictedFiles: PRFile[] = [
      ...files,
      {
        filename: 'src/c.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: '@@\n+<<<<<<< HEAD\n+ours\n+=======\n+theirs\n+>>>>>>> branch',
      },
    ];
    const ctx = prepareReviewer({
      ticketKey: 'PROJ-300',
      issue,
      pr: { ...pr, mergeable: false },
      files: conflictedFiles,
      commits,
      branchName: 'ferry/feat/PROJ-300',
      typeOverride: undefined,
      reviewRubric: undefined,
      capabilities: emptyCapabilities,
      idempotencyMarker: '[ferry:reviewer:feedbee]',
      repoRoot: REPO_ROOT,
      _buildSystem: buildSystemStub,
      _loadOptionalPrompt: loadOptionalPromptStub,
    });

    expect(ctx.initialPrompt).toContain('⚠️  MERGE CONFLICTS DETECTED');
    expect(ctx.initialPrompt).toContain('mergeable=false');
    expect(ctx.initialPrompt).toContain('conflicted files: src/c.ts');
  });

  it('threads the idempotency marker through unchanged', () => {
    const ctx = prepareReviewer({
      ticketKey: 'PROJ-300',
      issue,
      pr,
      files,
      commits,
      branchName: 'ferry/feat/PROJ-300',
      typeOverride: undefined,
      reviewRubric: undefined,
      capabilities: emptyCapabilities,
      idempotencyMarker: '[ferry:reviewer:feedbee]',
      repoRoot: REPO_ROOT,
      _buildSystem: buildSystemStub,
      _loadOptionalPrompt: loadOptionalPromptStub,
    });

    expect(ctx.idempotencyMarker).toBe('[ferry:reviewer:feedbee]');
  });

  it('exposes the fileMap of filename → patch for the review loop', () => {
    const ctx = prepareReviewer({
      ticketKey: 'PROJ-300',
      issue,
      pr,
      files,
      commits,
      branchName: 'ferry/feat/PROJ-300',
      typeOverride: undefined,
      reviewRubric: undefined,
      capabilities: emptyCapabilities,
      idempotencyMarker: '[ferry:reviewer:feedbee]',
      repoRoot: REPO_ROOT,
      _buildSystem: buildSystemStub,
      _loadOptionalPrompt: loadOptionalPromptStub,
    });

    expect(ctx.fileMap.get('src/a.ts')).toBe('@@ patch');
    expect(ctx.fileMap.get('src/b.ts')).toBe('@@ patch b');
    expect(ctx.fileMap.size).toBe(2);
  });
});
