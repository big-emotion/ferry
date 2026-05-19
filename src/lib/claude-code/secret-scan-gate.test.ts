import { describe, it, expect, vi } from 'vitest';
import { secretScanGate, gatedPush } from './secret-scan-gate.js';
import { FerryError } from '../errors/index.js';
import type { ScanResult } from '../safety/scan.js';

const CLEAN: ScanResult = { leaksFound: false, findings: [] };
const DIRTY: ScanResult = {
  leaksFound: true,
  findings: [{ ruleId: 'aws', description: 'AWS key', file: 'src/x.ts', startLine: 3, endLine: 3 }],
};

describe('secretScanGate', () => {
  it('resolves silently on a clean scan', async () => {
    const scan = vi.fn().mockResolvedValue(CLEAN);
    await expect(secretScanGate({ repoRoot: '/repo', scan })).resolves.toBeUndefined();
    expect(scan).toHaveBeenCalledWith({ path: '/repo', binaryPath: 'gitleaks' });
  });

  it('throws FerryError(state-invariant) on findings, without leaking content', async () => {
    const scan = vi.fn().mockResolvedValue(DIRTY);
    const err = await secretScanGate({ repoRoot: '/repo', scan }).catch((e) => e);
    expect(err).toBeInstanceOf(FerryError);
    expect((err as FerryError).code).toBe('state-invariant');
    expect((err as FerryError).context).toEqual({ reason: 'secret-scan-hit', findings: 1 });
    // never the finding body — only the count
    expect(JSON.stringify((err as FerryError).context)).not.toContain('AWS key');
  });

  it('honours an explicit gitleaks binary path', async () => {
    const scan = vi.fn().mockResolvedValue(CLEAN);
    await secretScanGate({ repoRoot: '/r', gitleaksPath: '/usr/local/bin/gitleaks', scan });
    expect(scan).toHaveBeenCalledWith({ path: '/r', binaryPath: '/usr/local/bin/gitleaks' });
  });
});

describe('gatedPush', () => {
  it('invokes push exactly once when the scan is clean', async () => {
    const scan = vi.fn().mockResolvedValue(CLEAN);
    const push = vi.fn().mockResolvedValue(undefined);
    await expect(gatedPush({ repoRoot: '/repo', scan, push })).resolves.toBe('pushed');
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('NEVER invokes push when the scan finds a secret', async () => {
    const scan = vi.fn().mockResolvedValue(DIRTY);
    const push = vi.fn();
    await expect(gatedPush({ repoRoot: '/repo', scan, push })).rejects.toBeInstanceOf(FerryError);
    expect(push).not.toHaveBeenCalled();
  });

  it('scans strictly before pushing (ordering is structural)', async () => {
    const calls: string[] = [];
    const scan = vi.fn().mockImplementation(async () => {
      calls.push('scan');
      return CLEAN;
    });
    const push = vi.fn().mockImplementation(async () => {
      calls.push('push');
    });
    await gatedPush({ repoRoot: '/repo', scan, push });
    expect(calls).toEqual(['scan', 'push']);
  });

  it('propagates a push failure unchanged (scan already passed)', async () => {
    const scan = vi.fn().mockResolvedValue(CLEAN);
    const push = vi.fn().mockRejectedValue(new Error('remote rejected'));
    await expect(gatedPush({ repoRoot: '/repo', scan, push })).rejects.toThrow('remote rejected');
  });
});
