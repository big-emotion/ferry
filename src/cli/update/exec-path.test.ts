import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readExecutionPath, applyClaudeCodeExecutionPath } from './exec-path.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ferry-exec-path-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true, retryDelay: 50 });
});

function writeJson(content: string): void {
  writeFileSync(join(dir, 'ferry.config.json'), content, 'utf8');
}

describe('readExecutionPath', () => {
  it('returns undefined when no ferry.config.json exists', () => {
    expect(readExecutionPath(dir)).toBeUndefined();
  });

  it('returns undefined when the key is absent', () => {
    writeJson('{\n  "audit_issue": 42\n}\n');
    expect(readExecutionPath(dir)).toBeUndefined();
  });

  it('returns the configured execution_path value', () => {
    writeJson('{\n  "execution_path": "script"\n}\n');
    expect(readExecutionPath(dir)).toBe('script');
  });

  it('returns undefined on malformed JSON (fail-soft)', () => {
    writeJson('{ not json');
    expect(readExecutionPath(dir)).toBeUndefined();
  });
});

describe('applyClaudeCodeExecutionPath', () => {
  it('returns no-json-config when ferry.config.json is absent', () => {
    expect(applyClaudeCodeExecutionPath(dir)).toBe('no-json-config');
  });

  it('writes execution_path: claude-code, preserving 2-space indent + field order', () => {
    writeJson('{\n  "audit_issue": 42,\n  "limits": {\n    "max_iterations": 3\n  }\n}\n');
    expect(applyClaudeCodeExecutionPath(dir)).toBe('written');
    const out = readFileSync(join(dir, 'ferry.config.json'), 'utf8');
    const parsed = JSON.parse(out);
    expect(parsed.execution_path).toBe('claude-code');
    // Original keys preserved and in original order; new key appended last.
    expect(Object.keys(parsed)).toEqual(['audit_issue', 'limits', 'execution_path']);
    expect(out).toContain('  "audit_issue": 42');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('preserves 4-space indentation when that is what the file uses', () => {
    writeJson('{\n    "audit_issue": 7\n}\n');
    applyClaudeCodeExecutionPath(dir);
    const out = readFileSync(join(dir, 'ferry.config.json'), 'utf8');
    expect(out).toContain('\n    "audit_issue": 7');
    expect(out).toContain('\n    "execution_path": "claude-code"');
  });

  it('is idempotent — already-claude-code when already set', () => {
    writeJson('{\n  "execution_path": "claude-code"\n}\n');
    expect(applyClaudeCodeExecutionPath(dir)).toBe('already-claude-code');
  });

  it('overwrites a non-script, non-cc value in place (keeps position)', () => {
    writeJson('{\n  "execution_path": "other",\n  "audit_issue": 1\n}\n');
    expect(applyClaudeCodeExecutionPath(dir)).toBe('written');
    const parsed = JSON.parse(readFileSync(join(dir, 'ferry.config.json'), 'utf8'));
    expect(parsed.execution_path).toBe('claude-code');
    expect(Object.keys(parsed)).toEqual(['execution_path', 'audit_issue']);
  });
});
