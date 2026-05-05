import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { executeTool } from './tools.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ferry-tools-test-'));
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

describe('read_file', () => {
  it('reads an existing file', async () => {
    await fsp.writeFile(path.join(tmpDir, 'hello.txt'), 'hello world');
    const result = await executeTool(tmpDir, 'read_file', { path: 'hello.txt' });
    expect(result).toBe('hello world');
  });

  it('throws on missing file', async () => {
    await expect(executeTool(tmpDir, 'read_file', { path: 'missing.txt' })).rejects.toThrow(
      'read_file failed',
    );
  });

  it('throws on path traversal', async () => {
    await expect(executeTool(tmpDir, 'read_file', { path: '../etc/passwd' })).rejects.toThrow(
      'Path traversal denied',
    );
  });

  it('returns small files unchanged', async () => {
    const content = 'a'.repeat(100);
    await fsp.writeFile(path.join(tmpDir, 'small.txt'), content);
    const result = await executeTool(tmpDir, 'read_file', { path: 'small.txt' });
    expect(result).toBe(content);
  });

  it('returns full content when file is exactly at cap', async () => {
    const cap = 1024;
    const content = 'x'.repeat(cap);
    await fsp.writeFile(path.join(tmpDir, 'exact.txt'), content);
    const prev = process.env.FERRY_READ_FILE_MAX_BYTES;
    process.env.FERRY_READ_FILE_MAX_BYTES = String(cap);
    try {
      const result = await executeTool(tmpDir, 'read_file', { path: 'exact.txt' });
      expect(result).toBe(content);
      expect(result).not.toContain('[truncated:');
    } finally {
      if (prev === undefined) delete process.env.FERRY_READ_FILE_MAX_BYTES;
      else process.env.FERRY_READ_FILE_MAX_BYTES = prev;
    }
  });

  it('truncates large files with head+tail and elision marker', async () => {
    const big = 'a'.repeat(40_000) + 'b'.repeat(40_000);
    await fsp.writeFile(path.join(tmpDir, 'big.txt'), big);
    const result = await executeTool(tmpDir, 'read_file', { path: 'big.txt' });
    expect(result).toContain('[truncated:');
    expect(result).toContain('bytes elided]');
    expect(result.length).toBeLessThan(big.length);
    expect(result.startsWith('a')).toBe(true);
    expect(result.endsWith('b')).toBe(true);
  });

  it('respects FERRY_READ_FILE_MAX_BYTES env override', async () => {
    const original = process.env.FERRY_READ_FILE_MAX_BYTES;
    try {
      process.env.FERRY_READ_FILE_MAX_BYTES = '10';
      const content = 'hello world, this is longer than ten bytes';
      await fsp.writeFile(path.join(tmpDir, 'capped.txt'), content);
      const result = await executeTool(tmpDir, 'read_file', { path: 'capped.txt' });
      expect(result).toContain('[truncated:');
      expect(result.length).toBeLessThan(content.length);
    } finally {
      if (original === undefined) {
        delete process.env.FERRY_READ_FILE_MAX_BYTES;
      } else {
        process.env.FERRY_READ_FILE_MAX_BYTES = original;
      }
    }
  });
});

describe('write_file', () => {
  it('creates a new file', async () => {
    await executeTool(tmpDir, 'write_file', { path: 'new.txt', content: 'content' });
    expect(await fsp.readFile(path.join(tmpDir, 'new.txt'), 'utf8')).toBe('content');
  });

  it('creates nested directories', async () => {
    await executeTool(tmpDir, 'write_file', { path: 'a/b/c.txt', content: 'nested' });
    expect(await fsp.readFile(path.join(tmpDir, 'a/b/c.txt'), 'utf8')).toBe('nested');
  });

  it('throws on denied path (.github/)', async () => {
    await fsp.mkdir(path.join(tmpDir, '.github'), { recursive: true });
    await expect(
      executeTool(tmpDir, 'write_file', { path: '.github/ci.yml', content: 'x' }),
    ).rejects.toThrow('protected path');
  });

  it('throws on path traversal', async () => {
    await expect(
      executeTool(tmpDir, 'write_file', { path: '../outside.txt', content: 'x' }),
    ).rejects.toThrow('Path traversal denied');
  });
});

describe('str_replace', () => {
  it('replaces a unique string', async () => {
    await fsp.writeFile(path.join(tmpDir, 'file.ts'), 'const a = 1;\nconst b = 2;\n');
    await executeTool(tmpDir, 'str_replace', {
      path: 'file.ts',
      old_str: 'const a = 1;',
      new_str: 'const a = 99;',
    });
    const content = await fsp.readFile(path.join(tmpDir, 'file.ts'), 'utf8');
    expect(content).toBe('const a = 99;\nconst b = 2;\n');
  });

  it('throws when old_str not found', async () => {
    await fsp.writeFile(path.join(tmpDir, 'file.ts'), 'hello');
    await expect(
      executeTool(tmpDir, 'str_replace', { path: 'file.ts', old_str: 'world', new_str: 'x' }),
    ).rejects.toThrow('not found');
  });

  it('throws when old_str is not unique', async () => {
    await fsp.writeFile(path.join(tmpDir, 'file.ts'), 'dup dup');
    await expect(
      executeTool(tmpDir, 'str_replace', { path: 'file.ts', old_str: 'dup', new_str: 'x' }),
    ).rejects.toThrow('not unique');
  });

  it('throws on denied path', async () => {
    await fsp.mkdir(path.join(tmpDir, '.ferry'), { recursive: true });
    await fsp.writeFile(path.join(tmpDir, '.ferry/state.json'), '{}');
    await expect(
      executeTool(tmpDir, 'str_replace', {
        path: '.ferry/state.json',
        old_str: '{}',
        new_str: '{"a":1}',
      }),
    ).rejects.toThrow('protected path');
  });
});

describe('delete_file', () => {
  it('deletes an existing file', async () => {
    const filePath = path.join(tmpDir, 'todelete.txt');
    await fsp.writeFile(filePath, 'bye');
    await executeTool(tmpDir, 'delete_file', { path: 'todelete.txt' });
    await expect(fsp.access(filePath)).rejects.toThrow();
  });

  it('throws on denied path', async () => {
    await expect(executeTool(tmpDir, 'delete_file', { path: 'package-lock.json' })).rejects.toThrow(
      'protected file',
    );
  });

  it('throws on path traversal', async () => {
    await expect(executeTool(tmpDir, 'delete_file', { path: '../sibling.txt' })).rejects.toThrow(
      'Path traversal denied',
    );
  });
});

describe('move_file', () => {
  it('moves a file', async () => {
    await fsp.writeFile(path.join(tmpDir, 'src.txt'), 'data');
    await executeTool(tmpDir, 'move_file', { source: 'src.txt', destination: 'dst.txt' });
    expect(await fsp.readFile(path.join(tmpDir, 'dst.txt'), 'utf8')).toBe('data');
    await expect(fsp.access(path.join(tmpDir, 'src.txt'))).rejects.toThrow();
  });

  it('throws on denied destination', async () => {
    await fsp.writeFile(path.join(tmpDir, 'src.txt'), 'data');
    await expect(
      executeTool(tmpDir, 'move_file', { source: 'src.txt', destination: 'package-lock.json' }),
    ).rejects.toThrow('protected file');
  });
});

describe('list_dir', () => {
  it('lists directory contents', async () => {
    await fsp.writeFile(path.join(tmpDir, 'a.ts'), '');
    await fsp.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    const result = await executeTool(tmpDir, 'list_dir', {});
    expect(result).toContain('a.ts');
    expect(result).toContain('src');
  });

  it('caps depth at 3', async () => {
    const result = await executeTool(tmpDir, 'list_dir', { max_depth: 99 });
    expect(result).toBeDefined();
  });

  it('throws on path traversal', async () => {
    await expect(executeTool(tmpDir, 'list_dir', { path: '../' })).rejects.toThrow(
      'Path traversal denied',
    );
  });
});

describe('bash', () => {
  it('runs a simple command', async () => {
    const result = await executeTool(tmpDir, 'bash', { command: 'echo hello' });
    expect(result).toContain('hello');
    expect(result).toContain('exit_code: 0');
  });

  it('captures non-zero exit codes', async () => {
    const result = await executeTool(tmpDir, 'bash', { command: 'exit 1' });
    expect(result).toContain('exit_code: 1');
  });

  it('throws on denied command (curl)', async () => {
    await expect(
      executeTool(tmpDir, 'bash', { command: 'curl https://example.com' }),
    ).rejects.toThrow('deny-list');
  });

  it('throws on denied command (rm -rf)', async () => {
    await expect(executeTool(tmpDir, 'bash', { command: 'rm -rf /tmp/test' })).rejects.toThrow(
      'deny-list',
    );
  });

  it('appends truncation marker when bash output exceeds cap', async () => {
    const prev = process.env.FERRY_BASH_OUTPUT_MAX_BYTES;
    process.env.FERRY_BASH_OUTPUT_MAX_BYTES = '50';
    try {
      // Generate output longer than 50 bytes
      const result = await executeTool(tmpDir, 'bash', {
        command: 'printf "%0.s12345678901234567890" {1..10}',
      });
      expect(result).toContain('[truncated:');
      expect(result).toContain('more bytes');
    } finally {
      if (prev === undefined) delete process.env.FERRY_BASH_OUTPUT_MAX_BYTES;
      else process.env.FERRY_BASH_OUTPUT_MAX_BYTES = prev;
    }
  });

  it('does not append truncation marker when bash output is within cap', async () => {
    const result = await executeTool(tmpDir, 'bash', { command: 'echo hi' });
    expect(result).not.toContain('[truncated:');
  });
});
