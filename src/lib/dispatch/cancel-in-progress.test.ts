import { describe, it, expect } from 'vitest';
import { workflowTemplates } from '../../cli/init/templates.js';

const TEMPLATES_BY_NAME = Object.fromEntries(
  workflowTemplates('v-test').map((t) => [t.filename, t.content]),
);

const WRITE_PHASE_WORKFLOWS = ['ferry-dev.yml', 'ferry-review.yml', 'ferry-iterate.yml'] as const;
const READ_PHASE_WORKFLOWS = ['ferry-refine.yml'] as const;
const ALL_AGENT_WORKFLOWS = [
  'ferry-refine.yml',
  'ferry-dev.yml',
  'ferry-review.yml',
  'ferry-iterate.yml',
] as const;

const SINKHOLE_GROUP = 'ferry-invalid-payload-sinkhole';

describe('cancel-in-progress policy', () => {
  it.each(WRITE_PHASE_WORKFLOWS)(
    '%s must have cancel-in-progress: false (write-phase — protects state.json integrity)',
    (name) => {
      expect(TEMPLATES_BY_NAME[name], `${name}: cancel-in-progress must be false`).toContain(
        'cancel-in-progress: false',
      );
    },
  );

  it.each(READ_PHASE_WORKFLOWS)(
    '%s must have cancel-in-progress: true (read-phase — latest event wins)',
    (name) => {
      expect(TEMPLATES_BY_NAME[name], `${name}: cancel-in-progress must be true`).toContain(
        'cancel-in-progress: true',
      );
    },
  );
});

describe('concurrency group-key expression', () => {
  it.each(ALL_AGENT_WORKFLOWS)(
    '%s must route missing/null ticket_key payloads to the sinkhole group',
    (name) => {
      const content = TEMPLATES_BY_NAME[name];
      expect(content, `${name}: missing sinkhole group name`).toContain(SINKHOLE_GROUP);
      expect(content, `${name}: missing sinkhole fallback`).toContain(`|| '${SINKHOLE_GROUP}'`);
    },
  );
});
