#!/usr/bin/env tsx
/**
 * ferry-grade — interactive reviewer-grading CLI.
 *
 * Usage: tsx scripts/ferry-grade.ts <pr-number>
 *
 * Prompts for four rubric scores (Substantive, Specific, Correct, Actionable;
 * each 0–2), computes the verdict via `computeReviewerVerdict`, and prints a
 * single ferry-audit JSON line with `phase=reviewer_grade` to stdout.
 *
 * Pipe stdout to your audit issue or paste the line as a comment.
 *
 * The pure verdict logic lives in `src/lib/grade/index.ts` and is unit-tested
 * separately. This file is a thin readline wrapper — keep it that way.
 */
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

import {
  computeReviewerVerdict,
  type ReviewerVerdict,
  type RubricScores,
} from '../src/lib/grade/index.js';

interface AuditLine {
  ticket: string;
  phase: 'reviewer_grade';
  run_id: string;
  pr_number: number;
  rubric: RubricScores;
  total: number;
  verdict: ReviewerVerdict;
  emitted_at: string;
}

interface LineReader {
  next(): Promise<string | null>;
  close(): void;
}

function createLineReader(): LineReader {
  const rl = createInterface({ input: stdin, terminal: false });
  const buffer: string[] = [];
  const waiters: Array<(line: string | null) => void> = [];
  let ended = false;

  rl.on('line', (line) => {
    const w = waiters.shift();
    if (w) w(line);
    else buffer.push(line);
  });
  rl.on('close', () => {
    ended = true;
    while (waiters.length) {
      const w = waiters.shift();
      if (w) w(null);
    }
  });

  return {
    async next(): Promise<string | null> {
      if (buffer.length > 0) return buffer.shift() ?? null;
      if (ended) return null;
      return new Promise<string | null>((resolve) => {
        waiters.push(resolve);
      });
    },
    close(): void {
      rl.close();
    },
  };
}

async function promptScore(reader: LineReader, label: string): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    process.stdout.write(`${label} (0–2): `);
    const raw = (await reader.next())?.trim() ?? '';
    const n = Number(raw);
    if (Number.isInteger(n) && (n === 0 || n === 1 || n === 2)) return n;
    process.stderr.write(`  → must be 0, 1, or 2 (got "${raw}")\n`);
  }
  throw new Error(`Failed to obtain valid score for "${label}" after 3 attempts`);
}

function generateRunId(): string {
  // Match the audit run-id shape used elsewhere: lowercase 12-hex.
  return Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

async function main(): Promise<void> {
  const prArg = process.argv[2];
  if (!prArg) {
    process.stderr.write('usage: tsx scripts/ferry-grade.ts <pr-number>\n');
    process.exit(2);
  }
  const prNumber = Number(prArg);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    process.stderr.write(`error: pr-number must be a positive integer (got "${prArg}")\n`);
    process.exit(2);
  }

  const reader = createLineReader();
  try {
    process.stdout.write(`Grading review on PR #${prNumber}\n`);
    process.stdout.write('Enter integer scores 0–2 for each dimension:\n\n');

    const rubric: RubricScores = {
      substantive: await promptScore(reader, 'Substantive'),
      specific: await promptScore(reader, 'Specific'),
      correct: await promptScore(reader, 'Correct'),
      actionable: await promptScore(reader, 'Actionable'),
    };
    const total = rubric.substantive + rubric.specific + rubric.correct + rubric.actionable;
    const verdict = computeReviewerVerdict(rubric);

    const auditLine: AuditLine = {
      ticket: process.env.FERRY_TICKET ?? `pr-${prNumber}`,
      phase: 'reviewer_grade',
      run_id: generateRunId(),
      pr_number: prNumber,
      rubric,
      total,
      verdict,
      emitted_at: new Date().toISOString(),
    };

    process.stdout.write('\n');
    process.stdout.write(JSON.stringify(auditLine) + '\n');
  } finally {
    reader.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`ferry-grade failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
