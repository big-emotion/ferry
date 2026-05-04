import { describe, it, expect } from 'vitest';
import { PHASE_TO_WORKFLOW } from './routing.js';
import { workflowTemplates } from '../../cli/init/templates.js';

const TEMPLATES_BY_NAME = Object.fromEntries(
  workflowTemplates('v-test').map((t) => [t.filename, t.content]),
);

/**
 * Story 2-1 AC2: every phase listed in PHASE_TO_WORKFLOW must point to a workflow whose
 * `on.repository_dispatch.types: [<dispatchType>]` matches the routing entry.
 *
 * Templates are validated instead of repo workflow files because Ferry no longer ships
 * reusable workflows — consumers receive the expanded form via ferry-init.
 */
describe('workflow ↔ phase binding (Story 2-1)', () => {
  it.each(Object.entries(PHASE_TO_WORKFLOW))(
    'phase %s → workflow %s must declare matching repository_dispatch type',
    (_phase, route) => {
      const content = TEMPLATES_BY_NAME[route.workflow];
      expect(content, `${route.workflow}: template not found`).toBeDefined();
      // Match: on:\n  repository_dispatch:\n    types: [<type>]
      const match = content!.match(/repository_dispatch:\s*\n\s*types:\s*\[([^\]]+)\]/);
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
