import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { FerryError } from '../errors/index.js';

export interface GitleaksFinding {
  ruleId: string;
  description: string;
  file: string;
  startLine: number;
  endLine: number;
}

export interface ScanResult {
  leaksFound: boolean;
  findings: GitleaksFinding[];
}

export type SpawnFn = (command: string, args: readonly string[]) => ChildProcess;

export interface ScanOptions {
  path: string;
  configPath?: string;
  binaryPath: string;
  spawnFn?: SpawnFn;
}

interface RawFinding {
  RuleID?: string;
  Description?: string;
  File?: string;
  StartLine?: number;
  EndLine?: number;
}

function normalizeFinding(raw: RawFinding): GitleaksFinding {
  return {
    ruleId: raw.RuleID ?? '',
    description: raw.Description ?? '',
    file: raw.File ?? '',
    startLine: raw.StartLine ?? 0,
    endLine: raw.EndLine ?? 0,
  };
}

/**
 * Run gitleaks against `path` and return parsed findings.
 *
 * - exit 0: clean → `leaksFound: false`
 * - exit 1 + non-empty findings: `leaksFound: true`
 * - exit 1 + empty/unparseable JSON: treated as clean (`leaksFound: false`) — exit code alone is not fatal
 * - exit 2+ (or any other non-{0,1} code): throws `FerryError('unknown')`
 *
 * The function never includes the raw stdout/stderr (which may contain leaked
 * secret content) in thrown error messages or context.
 */
export async function scanWithGitleaks(opts: ScanOptions): Promise<ScanResult> {
  const spawnFn = opts.spawnFn ?? (spawn as unknown as SpawnFn);

  const args = [
    'detect',
    `--source=${opts.path}`,
    '--report-format=json',
    '--report-path=/dev/stdout',
    '--no-banner',
  ];
  if (opts.configPath) {
    args.push(`--config=${opts.configPath}`);
  }

  const child = spawnFn(opts.binaryPath, args);

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode: number = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code: number | null) => resolve(code ?? -1));
  });

  if (exitCode !== 0 && exitCode !== 1) {
    throw new FerryError('unknown', {
      stage: 'scan',
      reason: 'unexpected-exit-code',
      exitCode,
      // stderr length only — never the content (could contain leaked text).
      stderrLength: stderr.length,
    });
  }

  let findings: GitleaksFinding[] = [];
  const trimmed = stdout.trim();
  if (trimmed.length > 0) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        findings = (parsed as RawFinding[]).map(normalizeFinding);
      }
    } catch {
      throw new FerryError('unknown', {
        stage: 'parse',
        reason: 'invalid-json',
        // Length only — never the body (could contain leaked content).
        stdoutLength: stdout.length,
      });
    }
  }

  return {
    leaksFound: findings.length > 0,
    findings,
  };
}
