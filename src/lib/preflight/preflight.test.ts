import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { preflight, PHASE_TO_JIRA_COLUMN } from './index.js';
import type { FerryStateV1 } from '../state/types.js';
import type { PreflightDeps } from './index.js';

const VALID_RUN_ID = '01JFBK9Q4BVCJAGTYQ6S3XTDMN';
const VALID_PR_SHA = 'a'.repeat(40);

const VALID_STATE: FerryStateV1 = {
  version: 'v1',
  ticket_key: 'CHAN-27',
  phase: 'refining',
  run_id: VALID_RUN_ID,
  prompt_version: '0.0.1',
  iteration: 0,
  iteration_history: [],
  updated_at: '2026-04-27T00:00:00.000Z',
};

function makeDeps(overrides?: Partial<PreflightDeps>): PreflightDeps {
  return {
    branchExists: async () => true,
    getPrState: async () => 'open',
    getHeadSha: async () => VALID_PR_SHA,
    getJiraColumn: async () => PHASE_TO_JIRA_COLUMN['refining'],
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'ferry-preflight-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('preflight', () => {
  it('resolves when all invariants pass (no state file)', async () => {
    const deps = makeDeps();
    await expect(
      preflight({ ticket_key: 'CHAN-27', phase: 'refining' }, deps, tmpDir),
    ).resolves.toBeUndefined();
  });

  it('resolves when all invariants pass (with state file, no pr_number)', async () => {
    mkdirSync(join(tmpDir, '.ferry'));
    writeFileSync(join(tmpDir, '.ferry', 'state.json'), JSON.stringify(VALID_STATE));
    const deps = makeDeps();
    await expect(
      preflight({ ticket_key: 'CHAN-27', phase: 'refining' }, deps, tmpDir),
    ).resolves.toBeUndefined();
  });

  it('throws FerryError("state-invariant") when branch does not exist', async () => {
    const deps = makeDeps({ branchExists: async () => false });
    await expect(
      preflight({ ticket_key: 'CHAN-27', phase: 'refining' }, deps, tmpDir),
    ).rejects.toMatchObject({ code: 'state-invariant' });
  });

  it('throws FerryError("state-invariant") when PR is not open', async () => {
    const state: FerryStateV1 = { ...VALID_STATE, pr_number: 42 };
    mkdirSync(join(tmpDir, '.ferry'));
    writeFileSync(join(tmpDir, '.ferry', 'state.json'), JSON.stringify(state));
    const deps = makeDeps({ getPrState: async () => 'closed' });
    await expect(
      preflight({ ticket_key: 'CHAN-27', phase: 'refining' }, deps, tmpDir),
    ).rejects.toMatchObject({ code: 'state-invariant' });
  });

  it('throws FerryError("state-invariant") on HEAD SHA mismatch', async () => {
    const state: FerryStateV1 = { ...VALID_STATE, pr_sha: VALID_PR_SHA };
    mkdirSync(join(tmpDir, '.ferry'));
    writeFileSync(join(tmpDir, '.ferry', 'state.json'), JSON.stringify(state));
    const deps = makeDeps({ getHeadSha: async () => 'b'.repeat(40) });
    await expect(
      preflight({ ticket_key: 'CHAN-27', phase: 'refining' }, deps, tmpDir),
    ).rejects.toMatchObject({ code: 'state-invariant' });
  });

  it('throws FerryError("state-invariant") when Jira column mismatches phase', async () => {
    const deps = makeDeps({ getJiraColumn: async () => 'In Development' });
    await expect(
      preflight({ ticket_key: 'CHAN-27', phase: 'refining' }, deps, tmpDir),
    ).rejects.toMatchObject({ code: 'state-invariant' });
  });

  it('skips PR and SHA checks when state is null', async () => {
    // No state file — getPrState and getHeadSha should never be called
    let prChecked = false;
    let shaChecked = false;
    const deps = makeDeps({
      getPrState: async () => {
        prChecked = true;
        return 'open';
      },
      getHeadSha: async () => {
        shaChecked = true;
        return VALID_PR_SHA;
      },
    });
    await preflight({ ticket_key: 'CHAN-27', phase: 'refining' }, deps, tmpDir);
    expect(prChecked).toBe(false);
    expect(shaChecked).toBe(false);
  });
});

describe('PHASE_TO_JIRA_COLUMN', () => {
  it('maps all 8 phases to column names', () => {
    expect(PHASE_TO_JIRA_COLUMN['refining']).toBe('Refinement');
    expect(PHASE_TO_JIRA_COLUMN['developing']).toBe('In Development');
    expect(PHASE_TO_JIRA_COLUMN['reviewing']).toBe('In Review');
    expect(PHASE_TO_JIRA_COLUMN['iterating']).toBe('Changes Requested');
    expect(PHASE_TO_JIRA_COLUMN['ready']).toBe('Ready to Merge');
    expect(PHASE_TO_JIRA_COLUMN['paused']).toBe('Paused');
    expect(PHASE_TO_JIRA_COLUMN['cancelled']).toBe('Cancelled');
    expect(PHASE_TO_JIRA_COLUMN['needs-human']).toBe('Needs Human');
  });
});
