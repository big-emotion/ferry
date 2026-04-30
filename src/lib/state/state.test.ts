import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { loadState, writeState } from './index.js';
import { FerryError } from '../errors/index.js';
import type { FerryStateV1 } from './types.js';

const VALID_STATE: FerryStateV1 = {
  version: 'v1',
  ticket_key: 'CHAN-27',
  phase: 'refining',
  run_id: '01JFBK9Q4BVCJAGTYQ6S3XTDMN',
  prompt_version: '0.0.1',
  iteration: 0,
  iteration_history: [],
  updated_at: '2026-04-27T00:00:00.000Z',
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'ferry-state-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadState', () => {
  it('returns null when .ferry/state.json does not exist', async () => {
    const result = await loadState({ ticket_key: 'CHAN-27' }, tmpDir);
    expect(result).toBeNull();
  });

  it('returns typed state for a valid state file', async () => {
    mkdirSync(join(tmpDir, '.ferry'));
    writeFileSync(join(tmpDir, '.ferry', 'state.json'), JSON.stringify(VALID_STATE));
    const result = await loadState({ ticket_key: 'CHAN-27' }, tmpDir);
    expect(result).not.toBeNull();
    expect(result?.ticket_key).toBe('CHAN-27');
    expect(result?.phase).toBe('refining');
  });

  it('throws FerryError("state-invariant") on missing required fields', async () => {
    mkdirSync(join(tmpDir, '.ferry'));
    writeFileSync(
      join(tmpDir, '.ferry', 'state.json'),
      JSON.stringify({ version: 'v1', ticket_key: 'CHAN-27' }),
    );
    await expect(loadState({ ticket_key: 'CHAN-27' }, tmpDir)).rejects.toMatchObject({
      code: 'state-invariant',
    });
  });

  it('throws FerryError("state-invariant") for invalid phase value', async () => {
    mkdirSync(join(tmpDir, '.ferry'));
    const bad = { ...VALID_STATE, phase: 'unknown-phase' };
    writeFileSync(join(tmpDir, '.ferry', 'state.json'), JSON.stringify(bad));
    await expect(loadState({ ticket_key: 'CHAN-27' }, tmpDir)).rejects.toMatchObject({
      code: 'state-invariant',
    });
  });

  it('throws FerryError("state-invariant") when ticket_key mismatch', async () => {
    mkdirSync(join(tmpDir, '.ferry'));
    writeFileSync(join(tmpDir, '.ferry', 'state.json'), JSON.stringify(VALID_STATE));
    await expect(loadState({ ticket_key: 'CHAN-99' }, tmpDir)).rejects.toMatchObject({
      code: 'state-invariant',
    });
  });
});

describe('writeState', () => {
  it('writes valid state and re-reads successfully', async () => {
    await writeState(VALID_STATE, tmpDir);
    const result = await loadState({ ticket_key: 'CHAN-27' }, tmpDir);
    expect(result).toMatchObject({ ticket_key: 'CHAN-27', phase: 'refining' });
  });

  it('does NOT corrupt existing state when writing invalid state', async () => {
    await writeState(VALID_STATE, tmpDir);
    const bad = { ...VALID_STATE, phase: 'totally-invalid' } as unknown as FerryStateV1;
    await expect(writeState(bad, tmpDir)).rejects.toBeInstanceOf(FerryError);
    // Original state still readable
    const result = await loadState({ ticket_key: 'CHAN-27' }, tmpDir);
    expect(result?.phase).toBe('refining');
  });

  it('creates .ferry directory if absent', async () => {
    await writeState(VALID_STATE, tmpDir);
    const result = await loadState({ ticket_key: 'CHAN-27' }, tmpDir);
    expect(result).not.toBeNull();
  });
});
