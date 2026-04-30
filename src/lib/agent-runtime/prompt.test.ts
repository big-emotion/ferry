import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildSystem } from './prompt.js';

const REPO_ROOT = '/workspace/repo';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('buildSystem agent extension composition', () => {
  const baseFor = (name: string) => `BASE-${name}`;
  const extensionFor = (name: string) => `EXTENSION-${name}`;
  const projectContent = 'PROJECT-CONVENTIONS';

  function makeReadFile(parts: {
    base?: boolean;
    extension?: boolean;
    project?: boolean;
  }): (p: string, enc: BufferEncoding) => string {
    return (p: string) => {
      if (p.endsWith('.extra.md')) {
        return parts.extension ? extensionFor('dev') : '';
      }
      if (p.endsWith('_project.md')) {
        return parts.project ? projectContent : '';
      }
      if (p.endsWith('dev.md')) {
        return parts.base ? baseFor('dev') : '';
      }
      return '';
    };
  }

  it('preserves prior behavior when no agent extension is present', () => {
    const check = (p: string) => p.endsWith('dev.md') || p.endsWith('_project.md');
    const result = buildSystem('dev', REPO_ROOT, {
      _checkExists: check,
      _readFile: makeReadFile({ base: true, project: true }),
    });
    expect(result).toBe(`BASE-dev\n\n## Project conventions\n\n${projectContent}`);
    expect(result).not.toContain('## Project-specific guidance');
  });

  it('injects extension between base and extraParts; project snippet stays last', () => {
    const check = (p: string) =>
      p.endsWith('dev.md') || p.endsWith('dev.extra.md') || p.endsWith('_project.md');
    const result = buildSystem('dev', REPO_ROOT, {
      extraParts: ['EXTRA-A', 'EXTRA-B'],
      _checkExists: check,
      _readFile: makeReadFile({ base: true, extension: true, project: true }),
    });
    const expected = [
      'BASE-dev',
      '## Project-specific guidance for dev\n\nEXTENSION-dev',
      'EXTRA-A',
      'EXTRA-B',
      `## Project conventions\n\n${projectContent}`,
    ].join('\n\n');
    expect(result).toBe(expected);
  });

  it('injects the extension header exactly once when extension is present', () => {
    const check = (p: string) => p.endsWith('dev.md') || p.endsWith('dev.extra.md');
    const result = buildSystem('dev', REPO_ROOT, {
      _checkExists: check,
      _readFile: makeReadFile({ base: true, extension: true }),
    });
    const matches = result.match(/## Project-specific guidance for dev/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(result).toContain('EXTENSION-dev');
  });

  it('omits the extension header when no <name>.extra.md exists', () => {
    const check = (p: string) => p.endsWith('dev.md');
    const result = buildSystem('dev', REPO_ROOT, {
      extraParts: ['EXTRA-A'],
      _checkExists: check,
      _readFile: makeReadFile({ base: true }),
    });
    expect(result).toBe('BASE-dev\n\nEXTRA-A');
    expect(result).not.toContain('## Project-specific guidance');
  });
});
