import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const WORKFLOWS_DIR = join(process.cwd(), '.github', 'workflows');

function readWorkflow(name: string): string {
  return readFileSync(join(WORKFLOWS_DIR, name), 'utf-8');
}

const WRITE_PHASE_WORKFLOWS = ['dev.yml', 'review.yml', 'iterate.yml'] as const;
const READ_PHASE_WORKFLOWS = ['refine.yml', 'reconciler.yml'] as const;
const DISPATCH_WORKFLOWS = ['refine.yml', 'dev.yml', 'review.yml', 'iterate.yml'] as const;

const SINKHOLE_GROUP = 'ferry-invalid-payload-sinkhole';

describe('cancel-in-progress policy', () => {
  it.each(WRITE_PHASE_WORKFLOWS)(
    '%s must have cancel-in-progress: false (write-phase — protects state.json integrity)',
    (name) => {
      const content = readWorkflow(name);
      expect(content, `${name}: cancel-in-progress must be false`).toContain(
        'cancel-in-progress: false',
      );
    },
  );

  it.each(READ_PHASE_WORKFLOWS)(
    '%s must have cancel-in-progress: true (read-phase — latest event wins)',
    (name) => {
      const content = readWorkflow(name);
      expect(content, `${name}: cancel-in-progress must be true`).toContain(
        'cancel-in-progress: true',
      );
    },
  );
});

describe('concurrency group-key expression', () => {
  it.each(DISPATCH_WORKFLOWS)(
    '%s must route missing/null ticket_key payloads to the sinkhole group',
    (name) => {
      const content = readWorkflow(name);
      // Sinkhole must be present so payloads without a ticket_key don't collide.
      expect(content, `${name}: missing sinkhole group name`).toContain(SINKHOLE_GROUP);
      // ticket_key must feed the group expression with an || fallback to the sinkhole.
      // Pattern may vary for workflows supporting both repository_dispatch and workflow_call:
      // - Simple: inputs.ticket_key || github.event.client_payload.ticket_key || 'sinkhole'
      // - With validation: inputs.ticket_key || (validation && client_payload.ticket_key) || 'sinkhole'
      expect(content, `${name}: missing sinkhole fallback`).toContain(
        `|| '${SINKHOLE_GROUP}'`,
      );
    },
  );
});
