import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('ferry-ci.yml — FR drift gate', () => {
  const ciPath = join(process.cwd(), '.github', 'workflows', 'ferry-ci.yml');
  const content = readFileSync(ciPath, 'utf-8');

  it('lint job contains a step that runs npm run check:fr-drift', () => {
    expect(content).toContain('npm run check:fr-drift');
  });
});
