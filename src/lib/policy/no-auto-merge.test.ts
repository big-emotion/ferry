import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { scanForMergeCalls } from './no-auto-merge.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

describe('no-auto-merge guard', () => {
  it('finds zero octokit.pulls.merge calls under src/', async () => {
    const offenders = await scanForMergeCalls(path.join(repoRoot, 'src'));
    expect(offenders).toEqual([]);
  });

  it('detects octokit.pulls.merge in synthetic snippets', () => {
    const snippet = 'await octokit.pulls.merge({ pull_number: 1 });';
    const offenders = scanForMergeCalls.detectInString(snippet);
    expect(offenders.length).toBeGreaterThan(0);
  });

  it('does not detect harmless mentions of the word "merge"', () => {
    const snippet = '// Ferry never merges. See FR39.';
    const offenders = scanForMergeCalls.detectInString(snippet);
    expect(offenders).toEqual([]);
  });

  it('README documents Ferry never merges and the three auto-transitions', async () => {
    const readme = await fs.readFile(path.join(repoRoot, 'README.md'), 'utf8');
    expect(readme).toMatch(/Ferry\s+(?:\*\*)?never\s+merges/i);
    expect(readme).toMatch(/FR18/);
    expect(readme).toMatch(/FR24/);
    expect(readme).toMatch(/FR28/);
  });
});
