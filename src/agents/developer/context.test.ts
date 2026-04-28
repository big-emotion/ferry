import { describe, it, expect } from 'vitest';
import { buildContext, MAX_CONTEXT_BYTES, MAX_TOUCH_PATHS } from './context.js';
import { FerryError } from '../../lib/error.js';

const ticket = {
  key: 'CHAN-27',
  title: 'Add login button',
  description: 'A login button on the home page',
};

describe('buildContext (Story 4-1)', () => {
  it('wraps ticket and files in delimited blocks', async () => {
    const readFile = async (p: string) => `// content of ${p}`;
    const out = await buildContext({
      ticket,
      touchPaths: ['src/a.ts', 'src/b.ts'],
      readFile,
    });
    expect(out).toContain('<<<UNTRUSTED>>>');
    expect(out).toContain('<<<END UNTRUSTED>>>');
    expect(out).toContain('CHAN-27');
    expect(out).toContain('<file path="src/a.ts">');
    expect(out).toContain('<file path="src/b.ts">');
    expect(out).toContain('// content of src/a.ts');
  });

  it('throws state-invariant with reason context-too-large when total bytes exceed cap', async () => {
    const big = 'x'.repeat(MAX_CONTEXT_BYTES + 1);
    const readFile = async () => big;
    let caught: unknown;
    try {
      await buildContext({ ticket, touchPaths: ['src/a.ts'], readFile });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FerryError);
    expect((caught as FerryError).code).toBe('state-invariant');
    expect((caught as FerryError).context).toMatchObject({
      reason: 'context-too-large',
    });
  });

  it('throws state-invariant when touchPaths is empty', async () => {
    await expect(
      buildContext({ ticket, touchPaths: [], readFile: async () => '' }),
    ).rejects.toThrow(/missing-touch-paths/);
  });

  it('throws state-invariant when touchPaths is undefined (runtime guard)', async () => {
    let caught: unknown;
    try {
      await buildContext({
        ticket,
        touchPaths: undefined as unknown as string[],
        readFile: async () => '',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FerryError);
    expect((caught as FerryError).code).toBe('state-invariant');
    expect((caught as FerryError).context).toMatchObject({
      reason: 'missing-touch-paths',
    });
  });

  it('throws state-invariant when touchPaths exceeds MAX_TOUCH_PATHS', async () => {
    const tooMany = Array.from({ length: MAX_TOUCH_PATHS + 1 }, (_, i) => `src/f${i}.ts`);
    await expect(
      buildContext({ ticket, touchPaths: tooMany, readFile: async () => '' }),
    ).rejects.toThrow(/too-many-touch-paths/);
  });

  it('exports the documented constants', () => {
    expect(MAX_TOUCH_PATHS).toBe(20);
    expect(MAX_CONTEXT_BYTES).toBe(200_000);
  });
});
