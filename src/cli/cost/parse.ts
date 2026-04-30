import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { AuditLine } from './types.js';

function isAuditLine(obj: unknown): obj is AuditLine {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.ticket === 'string' &&
    typeof o.phase === 'string' &&
    typeof o.run_id === 'string' &&
    typeof o.model === 'string' &&
    typeof o.input_tokens === 'number' &&
    typeof o.output_tokens === 'number' &&
    typeof o.cost_eur === 'number' &&
    typeof o.outcome === 'string' &&
    typeof o.duration_ms === 'number' &&
    typeof o.timestamp === 'string'
  );
}

export function parseAuditLines(rawLines: string[]): AuditLine[] {
  const result: AuditLine[] = [];
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('[ferry:audit:')) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isAuditLine(parsed)) result.push(parsed);
    } catch {
      // skip malformed lines
    }
  }
  return result;
}

export async function readAuditFile(filePath: string): Promise<AuditLine[]> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const rawLines: string[] = [];
  for await (const line of rl) {
    rawLines.push(line);
  }
  return parseAuditLines(rawLines);
}
