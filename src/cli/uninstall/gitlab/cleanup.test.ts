import { describe, it, expect } from 'vitest';
import { writeFileSync, existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  FERRY_GITLAB_TEMPLATE_FILES,
  FERRY_GITLAB_CI_VARIABLES,
  detectFerryStubFiles,
  detectFerryIncludesInRoot,
  removeFerryStubFiles,
  removeFerryIncludesFromRoot,
  type CleanupExecOptions,
} from './cleanup.js';

function makeOpts(overrides?: Partial<CleanupExecOptions>): CleanupExecOptions & {
  actions: string[];
  skips: string[];
  errors: string[];
  warns: string[];
} {
  const actions: string[] = [];
  const skips: string[] = [];
  const errors: string[] = [];
  const warns: string[] = [];
  return {
    apply: true,
    onAction: (msg) => actions.push(msg),
    onSkip: (msg) => skips.push(msg),
    onError: (msg) => errors.push(msg),
    onWarn: (msg) => warns.push(msg),
    actions,
    skips,
    errors,
    warns,
    ...overrides,
  };
}

function makeTempRepo(): string {
  return mkdtempSync(join(tmpdir(), 'ferry-uninstall-gitlab-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe('FERRY_GITLAB_TEMPLATE_FILES', () => {
  it('lists all six template files shipped under examples/consumer-setup-gitlab/', () => {
    expect(FERRY_GITLAB_TEMPLATE_FILES).toContain('refine.gitlab-ci.yml');
    expect(FERRY_GITLAB_TEMPLATE_FILES).toContain('dev.gitlab-ci.yml');
    expect(FERRY_GITLAB_TEMPLATE_FILES).toContain('review.gitlab-ci.yml');
    expect(FERRY_GITLAB_TEMPLATE_FILES).toContain('iterate.gitlab-ci.yml');
    expect(FERRY_GITLAB_TEMPLATE_FILES).toContain('reconcile.gitlab-ci.yml');
    expect(FERRY_GITLAB_TEMPLATE_FILES).toContain('cost-daily.gitlab-ci.yml');
    expect(FERRY_GITLAB_TEMPLATE_FILES).toHaveLength(6);
  });
});

describe('FERRY_GITLAB_CI_VARIABLES', () => {
  it('lists the CI/CD variables documented in examples/consumer-setup-gitlab/README.md', () => {
    expect(FERRY_GITLAB_CI_VARIABLES).toContain('FERRY_VERSION');
    expect(FERRY_GITLAB_CI_VARIABLES).toContain('FERRY_JIRA_BASE_URL');
    expect(FERRY_GITLAB_CI_VARIABLES).toContain('FERRY_JIRA_EMAIL');
    expect(FERRY_GITLAB_CI_VARIABLES).toContain('FERRY_JIRA_API_TOKEN');
    expect(FERRY_GITLAB_CI_VARIABLES).toContain('FERRY_GITLAB_TOKEN');
    expect(FERRY_GITLAB_CI_VARIABLES).toContain('FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN');
    expect(FERRY_GITLAB_CI_VARIABLES).toContain('FERRY_REVIEW_TRANSITION_ID');
    expect(FERRY_GITLAB_CI_VARIABLES).toContain('FERRY_ITER_TRANSITION_ID');
    expect(FERRY_GITLAB_CI_VARIABLES).toContain('FERRY_APPROVE_TRANSITION_ID');
    expect(FERRY_GITLAB_CI_VARIABLES).toContain('FERRY_AUDIT_ISSUE');
  });
});

// ── detectFerryStubFiles ──────────────────────────────────────────────────────

describe('detectFerryStubFiles', () => {
  it('returns an empty list when no Ferry templates exist at the repo root', () => {
    const dir = makeTempRepo();
    expect(detectFerryStubFiles(dir)).toEqual([]);
    cleanup(dir);
  });

  it('returns only the Ferry template files that are actually present', () => {
    const dir = makeTempRepo();
    writeFileSync(join(dir, 'refine.gitlab-ci.yml'), '# ferry', 'utf8');
    writeFileSync(join(dir, 'dev.gitlab-ci.yml'), '# ferry', 'utf8');
    // Not a Ferry template — must be ignored:
    writeFileSync(join(dir, 'build.gitlab-ci.yml'), 'build:\n  script: echo hi', 'utf8');

    const found = detectFerryStubFiles(dir);
    expect(found.sort()).toEqual(['dev.gitlab-ci.yml', 'refine.gitlab-ci.yml']);
    cleanup(dir);
  });

  it('detects all six template files when all are present', () => {
    const dir = makeTempRepo();
    for (const f of FERRY_GITLAB_TEMPLATE_FILES) {
      writeFileSync(join(dir, f), '# ferry', 'utf8');
    }
    expect(detectFerryStubFiles(dir).sort()).toEqual([...FERRY_GITLAB_TEMPLATE_FILES].sort());
    cleanup(dir);
  });
});

// ── detectFerryIncludesInRoot ─────────────────────────────────────────────────

describe('detectFerryIncludesInRoot', () => {
  it('returns null when .gitlab-ci.yml does not exist', () => {
    const dir = makeTempRepo();
    expect(detectFerryIncludesInRoot(dir)).toBeNull();
    cleanup(dir);
  });

  it('returns an empty list when .gitlab-ci.yml has no Ferry includes', () => {
    const dir = makeTempRepo();
    writeFileSync(
      join(dir, '.gitlab-ci.yml'),
      ['stages:', '  - build', 'include:', "  - local: 'ci/build.yml'", ''].join('\n'),
      'utf8',
    );
    const result = detectFerryIncludesInRoot(dir);
    expect(result).not.toBeNull();
    expect(result!.ferryIncludeLines).toEqual([]);
    cleanup(dir);
  });

  it('flags include lines that point at Ferry templates', () => {
    const dir = makeTempRepo();
    writeFileSync(
      join(dir, '.gitlab-ci.yml'),
      [
        'stages:',
        '  - build',
        'include:',
        "  - local: 'ci/build.yml'",
        "  - local: 'refine.gitlab-ci.yml'",
        "  - local: 'dev.gitlab-ci.yml'",
        '',
      ].join('\n'),
      'utf8',
    );
    const result = detectFerryIncludesInRoot(dir);
    expect(result).not.toBeNull();
    expect(result!.ferryIncludeLines.length).toBe(2);
    expect(result!.ferryIncludeLines.some((l) => l.includes('refine.gitlab-ci.yml'))).toBe(true);
    expect(result!.ferryIncludeLines.some((l) => l.includes('dev.gitlab-ci.yml'))).toBe(true);
    cleanup(dir);
  });

  it('does not flag arbitrary user includes that mention "ferry" in unrelated paths', () => {
    const dir = makeTempRepo();
    writeFileSync(
      join(dir, '.gitlab-ci.yml'),
      [
        'include:',
        "  - local: 'ci/build.yml'",
        "  - local: 'ferry-custom/my.yml'", // user's own — not a Ferry template
        '',
      ].join('\n'),
      'utf8',
    );
    const result = detectFerryIncludesInRoot(dir);
    expect(result).not.toBeNull();
    expect(result!.ferryIncludeLines).toEqual([]);
    cleanup(dir);
  });
});

// ── removeFerryIncludesFromRoot ───────────────────────────────────────────────

describe('removeFerryIncludesFromRoot', () => {
  it('removes only Ferry include lines, preserving user content', () => {
    const dir = makeTempRepo();
    const ciPath = join(dir, '.gitlab-ci.yml');
    writeFileSync(
      ciPath,
      [
        'stages:',
        '  - build',
        '  - test',
        'include:',
        "  - local: 'ci/build.yml'",
        "  - local: 'refine.gitlab-ci.yml'",
        "  - local: 'dev.gitlab-ci.yml'",
        "  - local: 'ci/test.yml'",
        '',
        'my-job:',
        '  script:',
        '    - echo hello',
        '',
      ].join('\n'),
      'utf8',
    );

    removeFerryIncludesFromRoot(dir, makeOpts());

    const after = readFileSync(ciPath, 'utf8');
    expect(after).toContain("- local: 'ci/build.yml'");
    expect(after).toContain("- local: 'ci/test.yml'");
    expect(after).toContain('my-job:');
    expect(after).not.toContain('refine.gitlab-ci.yml');
    expect(after).not.toContain('dev.gitlab-ci.yml');
    cleanup(dir);
  });

  it('skips when .gitlab-ci.yml is absent', () => {
    const dir = makeTempRepo();
    const opts = makeOpts();
    removeFerryIncludesFromRoot(dir, opts);
    expect(opts.skips.some((s) => s.includes('not present'))).toBe(true);
    expect(opts.actions).toHaveLength(0);
    cleanup(dir);
  });

  it('skips when .gitlab-ci.yml has no Ferry include lines', () => {
    const dir = makeTempRepo();
    const ciPath = join(dir, '.gitlab-ci.yml');
    writeFileSync(ciPath, 'stages:\n  - build\n', 'utf8');
    const opts = makeOpts();
    removeFerryIncludesFromRoot(dir, opts);
    expect(opts.skips.some((s) => s.includes('no Ferry includes'))).toBe(true);
    expect(opts.actions).toHaveLength(0);
    cleanup(dir);
  });

  it('dry-run (apply=false) does not modify the file', () => {
    const dir = makeTempRepo();
    const ciPath = join(dir, '.gitlab-ci.yml');
    const original = [
      'include:',
      "  - local: 'refine.gitlab-ci.yml'",
      "  - local: 'ci/test.yml'",
      '',
    ].join('\n');
    writeFileSync(ciPath, original, 'utf8');

    const opts = makeOpts({ apply: false });
    removeFerryIncludesFromRoot(dir, opts);

    expect(readFileSync(ciPath, 'utf8')).toBe(original);
    expect(opts.actions.some((a) => a.includes('[dry-run]'))).toBe(true);
    cleanup(dir);
  });

  it('warns instead of deleting when removing all Ferry includes leaves the file as a stub', () => {
    const dir = makeTempRepo();
    const ciPath = join(dir, '.gitlab-ci.yml');
    writeFileSync(
      ciPath,
      ['include:', "  - local: 'refine.gitlab-ci.yml'", "  - local: 'dev.gitlab-ci.yml'", ''].join(
        '\n',
      ),
      'utf8',
    );

    const opts = makeOpts();
    removeFerryIncludesFromRoot(dir, opts);

    // File must still exist — user content (or empty stub) is preserved with a notice.
    expect(existsSync(ciPath)).toBe(true);
    expect(opts.warns.some((w) => w.toLowerCase().includes('empty'))).toBe(true);
    cleanup(dir);
  });

  it('is idempotent: a second run on the same repo reports nothing to remove', () => {
    const dir = makeTempRepo();
    const ciPath = join(dir, '.gitlab-ci.yml');
    writeFileSync(
      ciPath,
      ['include:', "  - local: 'ci/build.yml'", "  - local: 'refine.gitlab-ci.yml'", ''].join('\n'),
      'utf8',
    );

    removeFerryIncludesFromRoot(dir, makeOpts());
    const opts2 = makeOpts();
    removeFerryIncludesFromRoot(dir, opts2);

    expect(opts2.actions).toHaveLength(0);
    expect(opts2.skips.some((s) => s.includes('no Ferry includes'))).toBe(true);
    cleanup(dir);
  });
});

// ── removeFerryStubFiles ──────────────────────────────────────────────────────

describe('removeFerryStubFiles', () => {
  it('deletes the Ferry template stub files at the repo root', () => {
    const dir = makeTempRepo();
    writeFileSync(join(dir, 'refine.gitlab-ci.yml'), '# ferry', 'utf8');
    writeFileSync(join(dir, 'dev.gitlab-ci.yml'), '# ferry', 'utf8');

    const opts = makeOpts();
    removeFerryStubFiles(dir, ['refine.gitlab-ci.yml', 'dev.gitlab-ci.yml'], opts);

    expect(existsSync(join(dir, 'refine.gitlab-ci.yml'))).toBe(false);
    expect(existsSync(join(dir, 'dev.gitlab-ci.yml'))).toBe(false);
    expect(opts.actions.some((a) => a.includes('refine.gitlab-ci.yml'))).toBe(true);
    cleanup(dir);
  });

  it('skips when no stub files are passed', () => {
    const dir = makeTempRepo();
    const opts = makeOpts();
    removeFerryStubFiles(dir, [], opts);
    expect(opts.actions).toHaveLength(0);
    cleanup(dir);
  });

  it('dry-run does not delete files', () => {
    const dir = makeTempRepo();
    writeFileSync(join(dir, 'refine.gitlab-ci.yml'), '# ferry', 'utf8');
    const opts = makeOpts({ apply: false });
    removeFerryStubFiles(dir, ['refine.gitlab-ci.yml'], opts);
    expect(existsSync(join(dir, 'refine.gitlab-ci.yml'))).toBe(true);
    expect(opts.actions.some((a) => a.includes('[dry-run]'))).toBe(true);
    cleanup(dir);
  });

  it('is idempotent: removing already-absent files is a no-op', () => {
    const dir = makeTempRepo();
    const opts = makeOpts();
    removeFerryStubFiles(dir, ['refine.gitlab-ci.yml'], opts);
    expect(opts.actions).toHaveLength(0);
    cleanup(dir);
  });
});

// ── End-to-end idempotency ────────────────────────────────────────────────────

describe('gitlab cleanup — idempotency', () => {
  it('running the full cleanup twice produces no diff on the second pass', () => {
    const dir = makeTempRepo();
    // Build a realistic post-init state.
    writeFileSync(
      join(dir, '.gitlab-ci.yml'),
      [
        'stages:',
        '  - build',
        'include:',
        "  - local: 'refine.gitlab-ci.yml'",
        "  - local: 'dev.gitlab-ci.yml'",
        "  - local: 'ci/test.yml'",
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(join(dir, 'refine.gitlab-ci.yml'), '# ferry', 'utf8');
    writeFileSync(join(dir, 'dev.gitlab-ci.yml'), '# ferry', 'utf8');

    // First pass: actions happen.
    const opts1 = makeOpts();
    removeFerryIncludesFromRoot(dir, opts1);
    removeFerryStubFiles(dir, detectFerryStubFiles(dir), opts1);

    // Second pass: nothing to do.
    const opts2 = makeOpts();
    removeFerryIncludesFromRoot(dir, opts2);
    removeFerryStubFiles(dir, detectFerryStubFiles(dir), opts2);

    expect(opts2.actions).toHaveLength(0);
    expect(opts2.errors).toHaveLength(0);
    expect(opts2.skips.length).toBeGreaterThan(0);

    cleanup(dir);
  });
});
