import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { scanWithGitleaks } from './scan.js';

interface FakeChild extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
}

function makeFakeChild(opts: { stdout?: string; stderr?: string; exitCode: number }): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = Readable.from([opts.stdout ?? '']);
  child.stderr = Readable.from([opts.stderr ?? '']);
  // Emit close async so listeners attach first
  setImmediate(() => child.emit('close', opts.exitCode));
  return child;
}

describe('secret-scan/scan', () => {
  it('returns leaksFound=false and empty findings on exit code 0 (clean)', async () => {
    const spawnFn = vi.fn(() => makeFakeChild({ stdout: '[]', exitCode: 0 }));

    const result = await scanWithGitleaks({
      path: '/tmp/repo',
      binaryPath: '/fake/gitleaks',
      spawnFn: spawnFn as never,
    });

    expect(result).toEqual({ leaksFound: false, findings: [] });
    expect(spawnFn).toHaveBeenCalledOnce();
  });

  it('returns leaksFound=true with parsed findings on exit code 1', async () => {
    const findings = [
      {
        RuleID: 'aws-access-token',
        Description: 'AWS Access Key',
        File: 'src/foo.ts',
        StartLine: 12,
        EndLine: 12,
      },
    ];
    const spawnFn = vi.fn(() => makeFakeChild({ stdout: JSON.stringify(findings), exitCode: 1 }));

    const result = await scanWithGitleaks({
      path: '/tmp/repo',
      binaryPath: '/fake/gitleaks',
      spawnFn: spawnFn as never,
    });

    expect(result.leaksFound).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].ruleId).toBe('aws-access-token');
    expect(result.findings[0].file).toBe('src/foo.ts');
    expect(result.findings[0].startLine).toBe(12);
  });

  it('passes --source, --report-format=json, --no-banner to gitleaks', async () => {
    const spawnFn = vi.fn((_cmd: string, args: readonly string[]) => {
      void args;
      return makeFakeChild({ stdout: '[]', exitCode: 0 });
    });

    await scanWithGitleaks({
      path: '/tmp/repo',
      binaryPath: '/fake/gitleaks',
      spawnFn: spawnFn as never,
    });

    const args = spawnFn.mock.calls[0][1];
    expect(args).toContain('detect');
    expect(args.some((a) => a.startsWith('--source='))).toBe(true);
    expect(args).toContain('--report-format=json');
    expect(args).toContain('--no-banner');
    // Also writes report to stdout (no --report-path needed when reading stdout)
    expect(args).toContain('--report-path=/dev/stdout');
  });

  it('passes --config when configPath is provided', async () => {
    const spawnFn = vi.fn((_cmd: string, args: readonly string[]) => {
      void args;
      return makeFakeChild({ stdout: '[]', exitCode: 0 });
    });

    await scanWithGitleaks({
      path: '/tmp/repo',
      configPath: '/tmp/repo/.gitleaks.toml',
      binaryPath: '/fake/gitleaks',
      spawnFn: spawnFn as never,
    });

    const args = spawnFn.mock.calls[0][1];
    expect(args).toContain('--config=/tmp/repo/.gitleaks.toml');
  });

  it('throws FerryError unknown on exit code 2 (gitleaks error)', async () => {
    const spawnFn = vi.fn(() =>
      makeFakeChild({
        stdout: '',
        stderr: 'unknown rule',
        exitCode: 2,
      }),
    );

    await expect(
      scanWithGitleaks({
        path: '/tmp/repo',
        binaryPath: '/fake/gitleaks',
        spawnFn: spawnFn as never,
      }),
    ).rejects.toMatchObject({
      name: 'FerryError',
      code: 'unknown',
    });
  });

  it('throws FerryError unknown when stdout is not valid JSON', async () => {
    const spawnFn = vi.fn(() => makeFakeChild({ stdout: 'not-json', exitCode: 1 }));

    await expect(
      scanWithGitleaks({
        path: '/tmp/repo',
        binaryPath: '/fake/gitleaks',
        spawnFn: spawnFn as never,
      }),
    ).rejects.toMatchObject({
      name: 'FerryError',
      code: 'unknown',
    });
  });

  it('does not include leaked secret content in thrown errors', async () => {
    const spawnFn = vi.fn(() =>
      makeFakeChild({
        stdout: 'AKIA-LEAKED-SECRET-IN-STDOUT',
        exitCode: 1,
      }),
    );

    try {
      await scanWithGitleaks({
        path: '/tmp/repo',
        binaryPath: '/fake/gitleaks',
        spawnFn: spawnFn as never,
      });
      expect.fail('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      const ctx = JSON.stringify((err as { context?: unknown }).context ?? {});
      expect(msg).not.toContain('AKIA-LEAKED-SECRET-IN-STDOUT');
      expect(ctx).not.toContain('AKIA-LEAKED-SECRET-IN-STDOUT');
    }
  });

  it('returns leaksFound=false when exit code 1 but findings array is empty', async () => {
    const spawnFn = vi.fn(() => makeFakeChild({ stdout: '[]', exitCode: 1 }));

    const result = await scanWithGitleaks({
      path: '/tmp/repo',
      binaryPath: '/fake/gitleaks',
      spawnFn: spawnFn as never,
    });

    expect(result).toEqual({ leaksFound: false, findings: [] });
  });

  it('handles empty stdout on clean exit gracefully', async () => {
    const spawnFn = vi.fn(() => makeFakeChild({ stdout: '', exitCode: 0 }));

    const result = await scanWithGitleaks({
      path: '/tmp/repo',
      binaryPath: '/fake/gitleaks',
      spawnFn: spawnFn as never,
    });

    expect(result).toEqual({ leaksFound: false, findings: [] });
  });
});
