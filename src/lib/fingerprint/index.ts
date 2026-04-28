/**
 * Reviewer finding fingerprint helper.
 *
 * SHA-256 over `{file, line_start, line_end, rule_id}` with POSIX-normalized
 * paths. Stored in `state.iteration_history[N].fingerprints` with the current
 * `pr_sha` so the Iterator can detect persistent issues across iterations.
 */

import { createHash } from 'node:crypto';

export interface FingerprintInput {
  file: string;
  line_start: number;
  line_end: number;
  rule_id: string;
}

function normalizePosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export function fingerprint(input: FingerprintInput): string {
  const payload = JSON.stringify({
    file: normalizePosix(input.file),
    line_start: input.line_start,
    line_end: input.line_end,
    rule_id: input.rule_id,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export interface FindingLike {
  rule_id: string;
  file?: string;
  line_start?: number;
  line_end?: number;
  /** Other reviewer-finding fields are tolerated and ignored. */
  [key: string]: unknown;
}

/** Convenience wrapper for the reviewer-finding shape with optional fields. */
export function fingerprintFinding(f: FindingLike): string {
  return fingerprint({
    file: f.file ?? '',
    line_start: f.line_start ?? 0,
    line_end: f.line_end ?? 0,
    rule_id: f.rule_id,
  });
}
