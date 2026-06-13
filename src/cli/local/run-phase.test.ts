import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FerryError } from '../../lib/errors/index.js';
import { runLocalPhase } from './run-phase.js';

const { spawnSync } = vi.hoisted(() => ({
  spawnSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawnSync,
}));

describe('runLocalPhase', () => {
  beforeEach(() => {
    spawnSync.mockReset();
    spawnSync.mockReturnValue({ status: 0 });
  });

  it('maps dev to the developer role and passes the envelope through env', () => {
    runLocalPhase({
      repoRoot: '/repo',
      worktreePath: '/repo/.ferry-local/worktrees/CHAN-1',
      envelope: {
        version: 'v1',
        event_id: '1749805811000-CHAN-1',
        ticket_key: 'CHAN-1',
        phase: 'dev',
        source: 'jira-column',
        ts: '2026-06-13T09:10:11.000Z',
      },
    });

    expect(spawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['run', '--role', 'developer']),
      expect.objectContaining({
        cwd: '/repo/.ferry-local/worktrees/CHAN-1',
        env: expect.objectContaining({
          FERRY_ENVELOPE_PAYLOAD: expect.stringContaining('"ticket_key":"CHAN-1"'),
        }),
        stdio: 'inherit',
      }),
    );
  });

  it('refuses the merge phase to preserve ADR-0005 locally', () => {
    expect(() =>
      runLocalPhase({
        repoRoot: '/repo',
        worktreePath: '/repo/.ferry-local/worktrees/CHAN-1',
        envelope: {
          version: 'v1',
          event_id: '1749805811000-CHAN-1',
          ticket_key: 'CHAN-1',
          phase: 'merge',
          source: 'jira-column',
          ts: '2026-06-13T09:10:11.000Z',
        },
      }),
    ).toThrow(FerryError);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('prints the planned command in dry-run mode without spawning', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    runLocalPhase({
      repoRoot: '/repo',
      worktreePath: '/repo/.ferry-local/worktrees/CHAN-1',
      dryRun: true,
      envelope: {
        version: 'v1',
        event_id: '1749805811000-CHAN-1',
        ticket_key: 'CHAN-1',
        phase: 'review',
        source: 'jira-column',
        ts: '2026-06-13T09:10:11.000Z',
      },
    });

    expect(spawnSync).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('run --role reviewer'));
  });
});
