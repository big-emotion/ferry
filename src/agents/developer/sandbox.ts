import * as path from 'node:path';

const DENIED_WRITE_PREFIXES = [
  '.github/',
  '.ferry/',
  'node_modules/',
  '.git/',
];

const DENIED_WRITE_FILES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

const DENIED_BASH_PATTERNS: RegExp[] = [
  /\bgit\s+push\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+branch\s+-D\b/,
  /\bgit\s+checkout\s+[^\s]/,
  /\bgit\s+rebase\b/,
  /\bgh\s+pr\s+merge\b/,
  /\bgh\s+pr\s+close\b/,
  /\brm\s+-rf\b/,
  /\bsudo\b/,
  /\bchmod\s+777\b/,
  /\bcurl\b/,
  /\bwget\b/,
  /\.github\//,
  /\.ferry\//,
  /node_modules\//,
];

export function assertPathUnderRoot(repoRoot: string, input: string): string {
  const resolved = path.resolve(repoRoot, input);
  if (!resolved.startsWith(repoRoot + path.sep) && resolved !== repoRoot) {
    throw new Error(`Path traversal denied: ${input}`);
  }
  return resolved;
}

export function assertWriteAllowed(repoRoot: string, resolved: string): void {
  const rel = path.relative(repoRoot, resolved);
  for (const prefix of DENIED_WRITE_PREFIXES) {
    if (rel === prefix.replace(/\/$/, '') || rel.startsWith(prefix)) {
      throw new Error(`Write denied: ${rel} is a protected path`);
    }
  }
  for (const file of DENIED_WRITE_FILES) {
    if (rel === file) {
      throw new Error(`Write denied: ${rel} is a protected file`);
    }
  }
}

export function assertBashAllowed(command: string): void {
  for (const pattern of DENIED_BASH_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`Bash command denied: matches deny-list pattern ${pattern}`);
    }
  }
}
