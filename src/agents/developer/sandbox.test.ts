import { describe, it, expect } from 'vitest';
import { assertPathUnderRoot, assertWriteAllowed, assertBashAllowed } from './sandbox.js';

const ROOT = '/repo';

describe('assertPathUnderRoot', () => {
  it('resolves relative paths under root', () => {
    expect(assertPathUnderRoot(ROOT, 'src/foo.ts')).toBe('/repo/src/foo.ts');
  });

  it('resolves absolute paths under root', () => {
    expect(assertPathUnderRoot(ROOT, '/repo/src/foo.ts')).toBe('/repo/src/foo.ts');
  });

  it('throws on path traversal', () => {
    expect(() => assertPathUnderRoot(ROOT, '../etc/passwd')).toThrow('Path traversal denied');
  });

  it('throws on absolute path outside root', () => {
    expect(() => assertPathUnderRoot(ROOT, '/etc/passwd')).toThrow('Path traversal denied');
  });

  it('allows root itself', () => {
    expect(assertPathUnderRoot(ROOT, '.')).toBe('/repo');
  });
});

describe('assertWriteAllowed', () => {
  it('allows writes to normal paths', () => {
    expect(() => assertWriteAllowed(ROOT, '/repo/src/foo.ts')).not.toThrow();
  });

  it('denies writes to .github/', () => {
    expect(() => assertWriteAllowed(ROOT, '/repo/.github/workflows/ci.yml')).toThrow(
      'protected path',
    );
  });

  it('denies writes to .ferry/', () => {
    expect(() => assertWriteAllowed(ROOT, '/repo/.ferry/agent.js')).toThrow('protected path');
  });

  it('denies writes to node_modules/', () => {
    expect(() => assertWriteAllowed(ROOT, '/repo/node_modules/lodash/index.js')).toThrow(
      'protected path',
    );
  });

  it('denies writes to .git/', () => {
    expect(() => assertWriteAllowed(ROOT, '/repo/.git/config')).toThrow('protected path');
  });

  it('denies package-lock.json', () => {
    expect(() => assertWriteAllowed(ROOT, '/repo/package-lock.json')).toThrow('protected file');
  });

  it('denies yarn.lock', () => {
    expect(() => assertWriteAllowed(ROOT, '/repo/yarn.lock')).toThrow('protected file');
  });

  it('denies pnpm-lock.yaml', () => {
    expect(() => assertWriteAllowed(ROOT, '/repo/pnpm-lock.yaml')).toThrow('protected file');
  });
});

describe('assertBashAllowed', () => {
  it('allows lint', () => {
    expect(() => assertBashAllowed('pnpm lint')).not.toThrow();
  });

  it('allows typecheck', () => {
    expect(() => assertBashAllowed('npm run typecheck')).not.toThrow();
  });

  it('allows test', () => {
    expect(() => assertBashAllowed('npm test')).not.toThrow();
  });

  it('allows git status', () => {
    expect(() => assertBashAllowed('git status')).not.toThrow();
  });

  it('allows git diff', () => {
    expect(() => assertBashAllowed('git diff HEAD')).not.toThrow();
  });

  it('allows find', () => {
    expect(() => assertBashAllowed('find . -name "*.ts"')).not.toThrow();
  });

  it('denies git push', () => {
    expect(() => assertBashAllowed('git push origin main')).toThrow('deny-list');
  });

  it('denies git reset --hard', () => {
    expect(() => assertBashAllowed('git reset --hard HEAD~1')).toThrow('deny-list');
  });

  it('denies git branch -D', () => {
    expect(() => assertBashAllowed('git branch -D my-branch')).toThrow('deny-list');
  });

  it('denies git rebase', () => {
    expect(() => assertBashAllowed('git rebase main')).toThrow('deny-list');
  });

  it('denies gh pr merge', () => {
    expect(() => assertBashAllowed('gh pr merge 42')).toThrow('deny-list');
  });

  it('denies gh pr close', () => {
    expect(() => assertBashAllowed('gh pr close 42')).toThrow('deny-list');
  });

  it('denies rm -rf', () => {
    expect(() => assertBashAllowed('rm -rf /')).toThrow('deny-list');
  });

  it('denies sudo', () => {
    expect(() => assertBashAllowed('sudo npm install')).toThrow('deny-list');
  });

  it('denies chmod 777', () => {
    expect(() => assertBashAllowed('chmod 777 script.sh')).toThrow('deny-list');
  });

  it('denies curl', () => {
    expect(() => assertBashAllowed('curl https://example.com')).toThrow('deny-list');
  });

  it('denies wget', () => {
    expect(() => assertBashAllowed('wget https://example.com')).toThrow('deny-list');
  });

  it('denies writing to .github/', () => {
    expect(() => assertBashAllowed('echo x > .github/workflows/ci.yml')).toThrow('deny-list');
  });

  it('denies writing to node_modules/', () => {
    expect(() => assertBashAllowed('echo x > node_modules/lodash/index.js')).toThrow('deny-list');
  });
});
