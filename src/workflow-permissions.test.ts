import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Returns all job IDs declared under the `jobs:` section of a GitHub Actions workflow.
function parseJobIds(content: string): string[] {
  const lines = content.split('\n');
  const ids: string[] = [];
  let inJobs = false;

  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (inJobs) {
      // Any non-indented, non-empty, non-comment line closes the jobs section.
      if (/^[^ #\n]/.test(line) && line.trim().length > 0) break;
      // A 2-space-indented identifier followed by `:` is a job ID.
      const m = line.match(/^  ([a-zA-Z_][a-zA-Z0-9_-]*):\s*$/);
      if (m) ids.push(m[1]);
    }
  }

  return ids;
}

// Returns true when the named job contains an explicit `permissions:` block.
function jobHasPermissions(content: string, jobId: string): boolean {
  const lines = content.split('\n');
  let inJobsSection = false;
  let inThisJob = false;

  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobsSection = true;
      continue;
    }
    if (!inJobsSection) continue;

    // Any non-indented, non-empty, non-comment line closes the jobs section.
    if (/^[^ #\n]/.test(line) && line.trim().length > 0) break;

    // 2-space-indented key = job boundary within the jobs section.
    if (/^  [a-zA-Z_]/.test(line)) {
      const isThisJob = line.startsWith(`  ${jobId}:`);
      if (inThisJob && !isThisJob) return false; // entered next job — permissions absent
      if (isThisJob) {
        inThisJob = true;
        continue;
      }
    }

    if (inThisJob && /^    permissions:/.test(line)) return true;
  }

  return false;
}

describe('workflow permissions — every job must declare an explicit permissions block', () => {
  const workflowDir = join(process.cwd(), '.github', 'workflows');
  const workflowFiles = readdirSync(workflowDir).filter(
    (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
  );

  for (const file of workflowFiles) {
    const content = readFileSync(join(workflowDir, file), 'utf-8');
    const jobIds = parseJobIds(content);

    if (jobIds.length === 0) continue;

    for (const jobId of jobIds) {
      it(`${file} / ${jobId}`, () => {
        expect(
          jobHasPermissions(content, jobId),
          `Job "${jobId}" in ${file} is missing a permissions: block`,
        ).toBe(true);
      });
    }
  }
});
