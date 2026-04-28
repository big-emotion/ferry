import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FerryError } from '../error.js';

/**
 * Pinned gitleaks release used by Ferry's harness-runtime secret scanner.
 *
 * Bumping these constants is the only step required to upgrade gitleaks: update
 * VERSION and SHA256 (linux x64), keep CI gate (1-6b) in sync.
 */
export const GITLEAKS_VERSION = '8.30.1';
export const GITLEAKS_SHA256_LINUX_X64 =
  '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb';

/** Build the pinned download URL for the given version/platform. */
export function gitleaksReleaseUrl(version: string): string {
  return `https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_x64.tar.gz`;
}

/**
 * Cache directory used to store the downloaded gitleaks binary.
 *
 * Override via `FERRY_CACHE_DIR` for tests or hermetic environments. Defaults
 * to `~/.ferry/`.
 */
export function ferryCacheDir(): string {
  return process.env.FERRY_CACHE_DIR ?? path.join(os.homedir(), '.ferry');
}

/** Path where the cached gitleaks binary lives. */
export function gitleaksBinaryPath(): string {
  return path.join(ferryCacheDir(), 'bin', 'gitleaks');
}

/**
 * Verify that `buf`'s SHA256 matches `expectedHex` (case-insensitive).
 *
 * Pure helper exported for testability.
 */
export function verifyChecksum(buf: Buffer, expectedHex: string): boolean {
  const actual = createHash('sha256').update(buf).digest('hex');
  return actual.toLowerCase() === expectedHex.toLowerCase();
}

/** Minimal fetch shape we depend on. Lets us inject a mock in tests. */
export type FetchFn = (url: string) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

export type ExtractFn = (archive: Buffer, destDir: string) => Promise<void>;

export interface EnsureGitleaksOptions {
  fetchFn?: FetchFn;
  verifyFn?: (buf: Buffer, expectedHex: string) => boolean;
  extractFn?: ExtractFn;
  expectedSha256?: string;
}

/**
 * Default extractor: pipes the tar.gz buffer into `tar -xzf -` and writes the
 * `gitleaks` binary into `destDir`.
 */
async function defaultExtract(archive: Buffer, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-xzf', '-', '-C', destDir, 'gitleaks'], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new FerryError('unknown', {
            stage: 'tar-extract',
            exitCode: code,
            stderrTail: stderr.slice(-200),
          }),
        );
    });
    child.stdin?.end(archive);
  });
}

/**
 * Ensure the pinned gitleaks binary is available on disk and return its path.
 *
 * Cache hit: returns cached path immediately.
 *
 * Cache miss: downloads the pinned release, verifies SHA256, extracts the
 * binary, makes it executable, and returns the path.
 */
export async function ensureGitleaksBinary(opts: EnsureGitleaksOptions = {}): Promise<string> {
  const binPath = gitleaksBinaryPath();

  if (fs.existsSync(binPath)) {
    return binPath;
  }

  const fetchFn: FetchFn = opts.fetchFn ?? ((url) => fetch(url));
  const verifyFn = opts.verifyFn ?? verifyChecksum;
  const extractFn = opts.extractFn ?? defaultExtract;
  const expectedSha = opts.expectedSha256 ?? GITLEAKS_SHA256_LINUX_X64;
  const url = gitleaksReleaseUrl(GITLEAKS_VERSION);

  let response;
  try {
    response = await fetchFn(url);
  } catch (err) {
    throw new FerryError('transient', {
      stage: 'download',
      reason: 'fetch-failed',
      message: (err as Error).message,
    });
  }

  if (!response.ok) {
    throw new FerryError('transient', {
      stage: 'download',
      reason: 'non-2xx',
      status: response.status,
    });
  }

  const arrayBuf = await response.arrayBuffer();
  const archive = Buffer.from(arrayBuf);

  if (!verifyFn(archive, expectedSha)) {
    // Do NOT include archive bytes in error context (could contain secrets in
    // a malicious-substitute scenario). Just record the version we expected.
    throw new FerryError('unknown', {
      stage: 'verify',
      reason: 'sha256-mismatch',
      version: GITLEAKS_VERSION,
    });
  }

  const binDir = path.dirname(binPath);
  await extractFn(archive, binDir);

  if (!fs.existsSync(binPath)) {
    throw new FerryError('unknown', {
      stage: 'extract',
      reason: 'binary-missing-after-extract',
    });
  }

  fs.chmodSync(binPath, 0o755);
  return binPath;
}
