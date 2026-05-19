import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Minimal, format-preserving reader/writer for the `execution_path` key in a
 * consumer's `ferry.config.json`.
 *
 * Scope is intentionally narrow (KISS): only `ferry.config.json` is touched.
 * `ferry-init` generates `ferry.config.yaml`; rewriting YAML in place is out
 * of scope here — when no JSON config exists the credential gate prints an
 * actionable follow-up instead of guessing a YAML edit. The `execution_path`
 * value space (`'script' | 'claude-code'`) is owned by the config schema
 * (sibling #304); this writer stays inert until that resolver reads it.
 */

const CONFIG_FILE = 'ferry.config.json';

function readJson(repoRoot: string): { raw: string; data: Record<string, unknown> } | undefined {
  try {
    const raw = readFileSync(join(repoRoot, CONFIG_FILE), 'utf8');
    const data = JSON.parse(raw) as unknown;
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined;
    return { raw, data: data as Record<string, unknown> };
  } catch {
    return undefined;
  }
}

/** Read `execution_path` from `ferry.config.json`. Fail-soft → undefined. */
export function readExecutionPath(repoRoot: string): string | undefined {
  const parsed = readJson(repoRoot);
  const value = parsed?.data['execution_path'];
  return typeof value === 'string' ? value : undefined;
}

/** Detect the file's indentation (spaces or a tab) from its first indented line. */
function detectIndent(raw: string): string | number {
  const m = raw.match(/\n(\t+|[ ]+)\S/);
  if (!m) return 2;
  const ws = m[1]!;
  return ws.startsWith('\t') ? '\t' : ws.length;
}

export type ApplyExecutionPathResult = 'written' | 'already-claude-code' | 'no-json-config';

/**
 * Merge `execution_path: "claude-code"` into `ferry.config.json`, preserving
 * the original field order (the key is updated in place if present, appended
 * last otherwise), the original indentation, and a trailing newline.
 */
export function applyClaudeCodeExecutionPath(repoRoot: string): ApplyExecutionPathResult {
  const parsed = readJson(repoRoot);
  if (!parsed) return 'no-json-config';

  if (parsed.data['execution_path'] === 'claude-code') return 'already-claude-code';

  // Assigning an existing key keeps its position; a new key is appended last.
  parsed.data['execution_path'] = 'claude-code';

  const indent = detectIndent(parsed.raw);
  const trailingNewline = parsed.raw.endsWith('\n') ? '\n' : '';
  writeFileSync(
    join(repoRoot, CONFIG_FILE),
    JSON.stringify(parsed.data, null, indent) + trailingNewline,
    'utf8',
  );
  return 'written';
}
