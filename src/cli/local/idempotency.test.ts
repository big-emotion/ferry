import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalIdempotencyStore } from './idempotency.js';

describe('LocalIdempotencyStore', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('marks a new event once and rejects duplicates', () => {
    const root = mkdtempSync(join(tmpdir(), 'ferry-local-idem-'));
    dirs.push(root);
    const store = new LocalIdempotencyStore(root);

    expect(store.markIfUnseen('CHAN-1', '1749805811000-CHAN-1')).toBe(true);
    expect(store.markIfUnseen('CHAN-1', '1749805811000-CHAN-1')).toBe(false);
  });

  it('recovers from a corrupted seen-state file', () => {
    const root = mkdtempSync(join(tmpdir(), 'ferry-local-idem-'));
    dirs.push(root);
    mkdirSync(join(root, '.ferry-local'), { recursive: true });
    writeFileSync(join(root, '.ferry-local', 'seen.json'), '{bad json', {
      encoding: 'utf8',
      flag: 'w',
    });
    const store = new LocalIdempotencyStore(root);

    expect(store.markIfUnseen('CHAN-2', '1749805811000-CHAN-2')).toBe(true);
  });
});
