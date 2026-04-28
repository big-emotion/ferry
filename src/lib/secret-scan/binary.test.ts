import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FerryError } from '../error.js';
import {
  ensureGitleaksBinary,
  verifyChecksum,
  GITLEAKS_VERSION,
  GITLEAKS_SHA256_LINUX_X64,
} from './binary.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ferry-binary-test-'));
}

describe('secret-scan/binary', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    process.env.FERRY_CACHE_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.FERRY_CACHE_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('verifyChecksum', () => {
    it('returns true when SHA256 of buffer matches expected hex', () => {
      const buf = Buffer.from('hello');
      // sha256 of 'hello' = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
      const expected = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
      expect(verifyChecksum(buf, expected)).toBe(true);
    });

    it('returns false when SHA256 does not match', () => {
      const buf = Buffer.from('hello');
      const wrong = '0'.repeat(64);
      expect(verifyChecksum(buf, wrong)).toBe(false);
    });

    it('is case-insensitive on the expected hex', () => {
      const buf = Buffer.from('hello');
      const expected = '2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824';
      expect(verifyChecksum(buf, expected)).toBe(true);
    });
  });

  describe('ensureGitleaksBinary (cache hit)', () => {
    it('returns the cached path without invoking fetch when binary exists', async () => {
      const binDir = path.join(tmpDir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const binPath = path.join(binDir, 'gitleaks');
      fs.writeFileSync(binPath, 'fake binary contents');
      fs.chmodSync(binPath, 0o755);

      const fetchMock = vi.fn();
      const result = await ensureGitleaksBinary({ fetchFn: fetchMock });

      expect(result).toBe(binPath);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('ensureGitleaksBinary (download)', () => {
    it('downloads, verifies checksum, extracts, and caches', async () => {
      const fakeArchive = Buffer.from('fake-tar-bytes');
      const fakeHash = '0000000000000000000000000000000000000000000000000000000000000000';

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(fakeArchive.buffer),
      });

      const verifyFn = vi.fn().mockReturnValue(true);

      const extractFn = vi.fn(async (_archive: Buffer, destDir: string) => {
        // Simulate tar extracting a 'gitleaks' executable
        fs.mkdirSync(destDir, { recursive: true });
        const out = path.join(destDir, 'gitleaks');
        fs.writeFileSync(out, 'extracted-binary');
        fs.chmodSync(out, 0o755);
      });

      const result = await ensureGitleaksBinary({
        fetchFn,
        verifyFn,
        extractFn,
        expectedSha256: fakeHash,
      });

      expect(fetchFn).toHaveBeenCalledTimes(1);
      const url = fetchFn.mock.calls[0][0] as string;
      expect(url).toContain(`v${GITLEAKS_VERSION}`);
      expect(url).toContain('linux_x64.tar.gz');
      expect(verifyFn).toHaveBeenCalledWith(expect.any(Buffer), fakeHash);
      expect(extractFn).toHaveBeenCalledOnce();
      expect(result).toBe(path.join(tmpDir, 'bin', 'gitleaks'));
      expect(fs.existsSync(result)).toBe(true);
    });

    it('uses pinned constants when called with no overrides', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(Buffer.from('x').buffer),
      });
      const verifyFn = vi.fn().mockReturnValue(true);
      const extractFn = vi.fn(async (_archive: Buffer, destDir: string) => {
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, 'gitleaks'), 'bin');
        fs.chmodSync(path.join(destDir, 'gitleaks'), 0o755);
      });

      await ensureGitleaksBinary({ fetchFn, verifyFn, extractFn });

      expect(verifyFn).toHaveBeenCalledWith(expect.any(Buffer), GITLEAKS_SHA256_LINUX_X64);
    });
  });

  describe('ensureGitleaksBinary (errors)', () => {
    it('throws FerryError unknown on checksum mismatch and removes partial cache', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(Buffer.from('bad').buffer),
      });
      const verifyFn = vi.fn().mockReturnValue(false);
      const extractFn = vi.fn();

      await expect(ensureGitleaksBinary({ fetchFn, verifyFn, extractFn })).rejects.toMatchObject({
        name: 'FerryError',
        code: 'unknown',
      });

      expect(extractFn).not.toHaveBeenCalled();
      const binPath = path.join(tmpDir, 'bin', 'gitleaks');
      expect(fs.existsSync(binPath)).toBe(false);
    });

    it('throws FerryError transient on network/fetch failure', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

      await expect(ensureGitleaksBinary({ fetchFn })).rejects.toMatchObject({
        name: 'FerryError',
        code: 'transient',
      });
    });

    it('throws FerryError transient on non-2xx HTTP response', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        arrayBuffer: () => Promise.resolve(Buffer.from('').buffer),
      });

      await expect(ensureGitleaksBinary({ fetchFn })).rejects.toMatchObject({
        name: 'FerryError',
        code: 'transient',
      });
    });

    it('does not include the response body in the thrown error context (no leakage)', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(Buffer.from('SECRET-PAYLOAD').buffer),
      });
      const verifyFn = vi.fn().mockReturnValue(false);

      try {
        await ensureGitleaksBinary({ fetchFn, verifyFn });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(FerryError);
        const msg = (err as FerryError).message;
        const ctx = JSON.stringify((err as FerryError).context ?? {});
        expect(msg).not.toContain('SECRET-PAYLOAD');
        expect(ctx).not.toContain('SECRET-PAYLOAD');
      }
    });
  });
});
