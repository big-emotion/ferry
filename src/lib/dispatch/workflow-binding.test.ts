import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PHASE_TO_WORKFLOW } from './routing.js';

const WORKFLOWS_DIR = join(process.cwd(), '.github', 'workflows');

function readWorkflow(name: string): string {
  return readFileSync(join(WORKFLOWS_DIR, name), 'utf-8');
}

/**
 * Story 2-1 AC2: every phase listed in PHASE_TO_WORKFLOW must point to a workflow file
 * whose `on.repository_dispatch.types: [<dispatchType>]` matches the routing entry.
 *
 * This guards against the failure mode "operator updates routing table but forgets to
 * re-pin the workflow's repository_dispatch type" (or vice-versa).
 */
describe('workflow ↔ phase binding (Story 2-1)', () => {
  it.each(Object.entries(PHASE_TO_WORKFLOW))(
    'phase %s → workflow %s must declare matching repository_dispatch type',
    (_phase, route) => {
      const content = readWorkflow(route.workflow);
      // Match: on:\n  repository_dispatch:\n    types: [<type>]
      const match = content.match(/repository_dispatch:\s*\n\s*types:\s*\[([^\]]+)\]/);
      expect(match, `${route.workflow}: no repository_dispatch.types found`).not.toBeNull();
      const declared = (match![1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      expect(declared, `${route.workflow}: types should include ${route.dispatchType}`).toContain(
        route.dispatchType,
      );
    },
  );
});
