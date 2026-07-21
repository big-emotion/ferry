import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { CC_AGENTS, DIRECT_ACTION_PROMPT_PATHS, type CcAgent } from './cc-prompt.js';

/**
 * The behavior contract a consumer gets out of the box, asserted against the
 * bundled prompts themselves. These behaviors were each field-proven as a
 * per-repo `.local.md` overlay before being promoted to the default; the tests
 * exist so a prompt edit cannot silently drop one back to opt-in.
 */

const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../prompts');

function promptText(agent: CcAgent, actionPath: string): string {
  return readFileSync(path.join(PROMPTS_DIR, `${agent}.${actionPath}.md`), 'utf8');
}

const EVERY_DIRECT_ACTION_PROMPT = DIRECT_ACTION_PROMPT_PATHS.flatMap((actionPath) =>
  CC_AGENTS.map((agent) => [agent, actionPath] as const),
);

describe('bundled agent defaults', () => {
  it.each(EVERY_DIRECT_ACTION_PROMPT)(
    '%s.%s.md requires a confidence self-critique line',
    (agent, actionPath) => {
      expect(promptText(agent, actionPath)).toContain('**Confidence (self-critique):**');
    },
  );

  it.each(EVERY_DIRECT_ACTION_PROMPT)(
    '%s.%s.md resolves the PR from the checked-out branch, never a hardcoded ferry/ branch',
    (agent, actionPath) => {
      // The Developer may be told to *create* branch ferry/TICKET_KEY; no agent
      // may assume a PR lives on it — tickets get manual branches too.
      expect(promptText(agent, actionPath)).not.toMatch(/(?:PR for|pr merge) .*ferry\/TICKET_KEY/);
    },
  );

  const PR_LABELLING_AGENTS: readonly CcAgent[] = ['dev', 'review', 'iterate'];

  it.each(
    PR_LABELLING_AGENTS.flatMap((a) => DIRECT_ACTION_PROMPT_PATHS.map((p) => [a, p] as const)),
  )('%s.%s.md drives the ci-green / ci-failing label pair', (agent, actionPath) => {
    const text = promptText(agent, actionPath);
    expect(text).toContain('ci-green');
    expect(text).toContain('ci-failing');
  });

  it.each(DIRECT_ACTION_PROMPT_PATHS)('review.%s.md applies exactly one verdict label', (p) => {
    const text = promptText('review', p);
    expect(text).toContain('approved');
    expect(text).toContain('changes-requested');
  });

  it.each(DIRECT_ACTION_PROMPT_PATHS)('dev.%s.md closes the planning sub-tasks', (p) => {
    expect(promptText('dev', p)).toContain('list_subtasks');
  });

  it.each(DIRECT_ACTION_PROMPT_PATHS)('merge.%s.md owns the CI gate and conflict repair', (p) => {
    const text = promptText('merge', p);
    expect(text).toMatch(/git merge origin\//);
    expect(text).toMatch(/never rebase|never .*force-push/i);
    expect(text).toContain('approved');
  });

  it.each(DIRECT_ACTION_PROMPT_PATHS)('review.%s.md does not claim a CI pre-gate ran', (p) => {
    expect(promptText('review', p)).not.toMatch(/pre-gate runs \*\*before\*\* this job/);
  });
});
