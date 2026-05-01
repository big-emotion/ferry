/**
 * Acceptance-criteria tests for the Ferry install guide (docs/CONSUMER-SETUP.md).
 *
 * These are structural / static tests — they read files on disk and assert that the
 * codebase remains consistent with the published install guide.  Every test here
 * corresponds to a checkable claim in the guide: if a future code change would
 * break a step in the guide, one of these tests must catch it.
 *
 * Tests are intentionally side-effect-free: no network calls, no GitHub/Jira API,
 * no LLM calls.  They run as part of `npm test` on every push.
 */

import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

async function readFile(rel: string): Promise<string> {
  return fs.readFile(path.join(repoRoot, rel), 'utf8');
}

async function fileExists(rel: string): Promise<boolean> {
  try {
    await fs.access(path.join(repoRoot, rel));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 1. Consumer workflow stubs — Phase 3 of the install guide
// ---------------------------------------------------------------------------

describe('Phase 3 — consumer workflow stubs (install-guide §3.1)', () => {
  const coreStubs = ['ferry-refine', 'ferry-dev', 'ferry-review', 'ferry-iterate'];

  for (const stub of coreStubs) {
    it(`examples/consumer-setup/workflows/${stub}.yml exists`, async () => {
      const exists = await fileExists(`examples/consumer-setup/workflows/${stub}.yml`);
      expect(exists, `${stub}.yml must exist for consumers to copy`).toBe(true);
    });
  }

  for (const stub of coreStubs) {
    it(`${stub}.yml references @v1 (not @main)`, async () => {
      const content = await readFile(`examples/consumer-setup/workflows/${stub}.yml`);
      expect(content, `${stub}.yml must pin to @v1 — @main is mutable and insecure`).toMatch(/@v1/);
      expect(content, `${stub}.yml must not use @main (use @v1 or a SHA)`).not.toMatch(/@main/);
    });
  }

  for (const stub of coreStubs) {
    it(`${stub}.yml uses secrets: inherit`, async () => {
      const content = await readFile(`examples/consumer-setup/workflows/${stub}.yml`);
      expect(content, `${stub}.yml must pass secrets: inherit to the reusable workflow`).toContain(
        'secrets: inherit',
      );
    });
  }

  it('ferry-refine.yml triggers on ferry-refine event', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-refine.yml');
    expect(content).toContain('[ferry-refine]');
  });

  it('ferry-dev.yml triggers on ferry-dev event', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-dev.yml');
    expect(content).toContain('[ferry-dev]');
  });

  it('ferry-review.yml triggers on ferry-review event', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-review.yml');
    expect(content).toContain('[ferry-review]');
  });

  it('ferry-iterate.yml triggers on ferry-iterate event', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-iterate.yml');
    expect(content).toContain('[ferry-iterate]');
  });
});

// ---------------------------------------------------------------------------
// 2. Workflow stubs call the correct reusable workflows — Phase 3
// ---------------------------------------------------------------------------

describe('Phase 3 — reusable workflow references in stubs', () => {
  const mapping: Record<string, string> = {
    'ferry-refine': 'big-emotion/ferry/.github/workflows/refine.yml',
    'ferry-dev': 'big-emotion/ferry/.github/workflows/dev.yml',
    'ferry-review': 'big-emotion/ferry/.github/workflows/review.yml',
    'ferry-iterate': 'big-emotion/ferry/.github/workflows/iterate.yml',
  };

  for (const [stub, target] of Object.entries(mapping)) {
    it(`${stub}.yml references ${target}`, async () => {
      const content = await readFile(`examples/consumer-setup/workflows/${stub}.yml`);
      expect(content, `${stub}.yml must call the correct reusable workflow at ${target}`).toContain(
        target,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Workflow stubs pass the required inputs — Phase 3
// ---------------------------------------------------------------------------

describe('Phase 3 — workflow stub inputs alignment', () => {
  const coreStubs = ['ferry-refine', 'ferry-dev', 'ferry-review', 'ferry-iterate'];

  for (const stub of coreStubs) {
    it(`${stub}.yml passes ticket_key, event_id, and payload inputs`, async () => {
      const content = await readFile(`examples/consumer-setup/workflows/${stub}.yml`);
      expect(content, `${stub}.yml must pass ticket_key`).toContain('ticket_key');
      expect(content, `${stub}.yml must pass event_id`).toContain('event_id');
      expect(content, `${stub}.yml must pass payload`).toContain('payload');
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Required secrets and variable documented in CONSUMER-SETUP.md — Phase 2
// ---------------------------------------------------------------------------

describe('Phase 2 — secret and variable names (install-guide §2.3)', () => {
  // These are the exact env var names read by requireEnv() in the agent code.
  // If any name changes in the code, the doc test will fail, prompting a doc update.
  const requiredSecrets = [
    'FERRY_JIRA_BASE_URL',
    'FERRY_JIRA_EMAIL',
    'FERRY_JIRA_API_TOKEN',
    'ANTHROPIC_API_KEY',
    'FERRY_REVIEW_TRANSITION_ID',
    'FERRY_ITER_TRANSITION_ID',
  ];

  it('CONSUMER-SETUP.md documents all 6 required secrets', async () => {
    const doc = await readFile('docs/CONSUMER-SETUP.md');
    for (const secret of requiredSecrets) {
      expect(doc, `CONSUMER-SETUP.md must document secret ${secret}`).toContain(secret);
    }
  });

  it('CONSUMER-SETUP.md documents the FERRY_AUDIT_ISSUE variable', async () => {
    const doc = await readFile('docs/CONSUMER-SETUP.md');
    expect(doc).toContain('FERRY_AUDIT_ISSUE');
  });

  it('CONSUMER-SETUP.md mentions 6 secrets (not 4)', async () => {
    const doc = await readFile('docs/CONSUMER-SETUP.md');
    expect(doc, 'Guide must say "6 secrets" — there are 6 required secrets').toMatch(/6 secrets/);
  });
});

// ---------------------------------------------------------------------------
// 5. Secret names in the doc match what agent code actually requires
// ---------------------------------------------------------------------------

describe('Phase 2 — secret names match agent code (install-guide §2.3)', () => {
  it('developer agent requires FERRY_REVIEW_TRANSITION_ID (FR18)', async () => {
    const code = await readFile('src/agents/developer/dev-action.ts');
    expect(code, 'dev-action.ts must call requireEnv("FERRY_REVIEW_TRANSITION_ID")').toContain(
      "requireEnv('FERRY_REVIEW_TRANSITION_ID')",
    );
  });

  it('reviewer agent requires FERRY_ITER_TRANSITION_ID (FR24)', async () => {
    const code = await readFile('src/agents/reviewer/review-action.ts');
    expect(code, 'review-action.ts must call requireEnv("FERRY_ITER_TRANSITION_ID")').toContain(
      "requireEnv('FERRY_ITER_TRANSITION_ID')",
    );
  });

  it('iterator agent requires FERRY_REVIEW_TRANSITION_ID (FR28)', async () => {
    const code = await readFile('src/agents/iterator/iterate-action.ts');
    expect(code, 'iterate-action.ts must call requireEnv("FERRY_REVIEW_TRANSITION_ID")').toContain(
      "requireEnv('FERRY_REVIEW_TRANSITION_ID')",
    );
  });

  it('shared agent runtime reads FERRY_ENVELOPE_PAYLOAD', async () => {
    // Since the runAgent() helper extraction, all agent entrypoints route
    // through src/lib/agent-runtime/run-agent.ts — that's where the env var
    // is read. The four agent action files no longer reference it directly.
    const code = await readFile('src/lib/agent-runtime/run-agent.ts');
    expect(code, 'run-agent.ts must read FERRY_ENVELOPE_PAYLOAD').toContain(
      'FERRY_ENVELOPE_PAYLOAD',
    );
  });
});

// ---------------------------------------------------------------------------
// 6. FERRY_AUDIT_ISSUE is wired through all 4 reusable workflows — Phase 6
// ---------------------------------------------------------------------------

describe('Phase 6 — FERRY_AUDIT_ISSUE wired through reusable workflows (install-guide §6)', () => {
  const workflows = ['refine', 'dev', 'review', 'iterate'];

  for (const wf of workflows) {
    it(`.github/workflows/${wf}.yml passes FERRY_AUDIT_ISSUE to emit-audit`, async () => {
      const content = await readFile(`.github/workflows/${wf}.yml`);
      expect(
        content,
        `${wf}.yml must reference FERRY_AUDIT_ISSUE (needed for 4-line audit accumulation)`,
      ).toContain('FERRY_AUDIT_ISSUE');
    });
  }
});

// ---------------------------------------------------------------------------
// 7. Jira column names in CONSUMER-SETUP.md match PHASE_TO_JIRA_COLUMN — Phase 1
// ---------------------------------------------------------------------------

describe('Phase 1 — Jira column names (install-guide §1.2)', () => {
  const requiredColumnNames = [
    'Refinement',
    'In Development',
    'In Review',
    'Changes Requested',
    'Ready to Merge',
  ];

  it('CONSUMER-SETUP.md documents all required Jira column names', async () => {
    const doc = await readFile('docs/CONSUMER-SETUP.md');
    for (const col of requiredColumnNames) {
      expect(doc, `CONSUMER-SETUP.md must list Jira column "${col}"`).toContain(col);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. FR18 / FR24 / FR28 transitions documented in CONSUMER-SETUP.md — Phase 5
// ---------------------------------------------------------------------------

describe('Phase 5 — FR transitions documented (install-guide §5.3–5.5)', () => {
  it('CONSUMER-SETUP.md documents FR18 (Developer → In Review auto-transition)', async () => {
    const doc = await readFile('docs/CONSUMER-SETUP.md');
    expect(doc, 'CONSUMER-SETUP.md must reference FR18').toMatch(/FR18/);
  });

  it('CONSUMER-SETUP.md documents FR24 (Reviewer → Changes Requested auto-transition)', async () => {
    const doc = await readFile('docs/CONSUMER-SETUP.md');
    expect(doc, 'CONSUMER-SETUP.md must reference FR24').toMatch(/FR24/);
  });

  it('CONSUMER-SETUP.md documents FR28 (Iterator → In Review auto-transition)', async () => {
    const doc = await readFile('docs/CONSUMER-SETUP.md');
    expect(doc, 'CONSUMER-SETUP.md must reference FR28').toMatch(/FR28/);
  });
});

// ---------------------------------------------------------------------------
// 9. event_id format — Phase 4
// ---------------------------------------------------------------------------

describe('Phase 4 — event_id format (install-guide §4.2)', () => {
  it('documented event_id format passes schema validation', async () => {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventSchema = req(path.join(repoRoot, 'src/schemas/event.v1.schema.json')) as any;
    const pattern = new RegExp(eventSchema.properties.event_id.pattern as string);

    // The format documented: {{now.toMillis}}-{{issue.key}}-{{issue.id}}
    // Example: 1746047810000-CHAN-27-10042
    expect(
      pattern.test('1746047810000-CHAN-27-10042'),
      'Jira millis-key-id format must match event_id schema pattern',
    ).toBe(true);
  });

  it('event phases in Jira automation rules match event schema enum', async () => {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventSchema = req(path.join(repoRoot, 'src/schemas/event.v1.schema.json')) as any;
    const phaseEnum = eventSchema.properties.phase.enum as string[];

    // The 4 phases triggered by Jira automation rules
    const jiraPhases = ['refine', 'dev', 'review', 'iterate'];
    for (const phase of jiraPhases) {
      expect(phaseEnum, `phase "${phase}" must be in event schema`).toContain(phase);
    }
  });

  it('CONSUMER-SETUP.md documents the correct event_id format', async () => {
    const doc = await readFile('docs/CONSUMER-SETUP.md');
    expect(doc).toContain('{{now.toMillis}}-{{issue.key}}-{{issue.id}}');
  });
});

// ---------------------------------------------------------------------------
// 10. Audit issue creation documented — Phase 2
// ---------------------------------------------------------------------------

describe('Phase 2 — audit issue creation (install-guide §2.1)', () => {
  it('CONSUMER-SETUP.md includes audit issue creation command', async () => {
    const doc = await readFile('docs/CONSUMER-SETUP.md');
    expect(doc, 'CONSUMER-SETUP.md must show gh issue create command for audit log').toContain(
      'gh issue create',
    );
  });

  it('CONSUMER-SETUP.md includes gh variable set for FERRY_AUDIT_ISSUE', async () => {
    const doc = await readFile('docs/CONSUMER-SETUP.md');
    expect(doc).toContain('gh variable set FERRY_AUDIT_ISSUE');
  });
});

// ---------------------------------------------------------------------------
// 11. Consumer-facing docs must not reference @main in workflow stubs — Phase 3
// ---------------------------------------------------------------------------

describe('Phase 3 — no @main in consumer stubs (install-guide §3.2)', () => {
  it('CONSUMER-SETUP.md does not tell users to use @main workflow refs', async () => {
    const doc = await readFile('docs/CONSUMER-SETUP.md');
    // The doc must not say stubs use @main (they use @v1)
    expect(doc).not.toMatch(/uses.*@main/);
    expect(doc).not.toContain('always use the latest version automatically');
  });
});

// ---------------------------------------------------------------------------
// 12. Phase 3 SHA-pinning instructions are present — Phase 3
// ---------------------------------------------------------------------------

describe('Phase 3 — SHA pinning instructions (install-guide §3.2)', () => {
  it('CONSUMER-SETUP.md includes SHA pinning instructions using gh api', async () => {
    const doc = await readFile('docs/CONSUMER-SETUP.md');
    expect(doc, 'CONSUMER-SETUP.md must show SHA pinning via gh api').toContain(
      'gh api repos/big-emotion/ferry/git/refs/tags/v1',
    );
  });
});

// ---------------------------------------------------------------------------
// 13. Smoke test scenario documented — Phase 5
// ---------------------------------------------------------------------------

describe('Phase 5 — smoke test documented (install-guide §5.1)', () => {
  it('CONSUMER-SETUP.md includes smoke test ticket creation step', async () => {
    const doc = await readFile('docs/CONSUMER-SETUP.md');
    expect(doc).toMatch(/smoke test/i);
  });
});

// ---------------------------------------------------------------------------
// 14. No-auto-merge invariant cross-check — Phase 5
// ---------------------------------------------------------------------------

describe('Phase 5 — Ferry never merges (install-guide §5.6)', () => {
  it('CONSUMER-SETUP.md states Ferry never merges', async () => {
    const doc = await readFile('docs/CONSUMER-SETUP.md');
    expect(doc).toMatch(/Ferry never merges/i);
  });
});

// ---------------------------------------------------------------------------
// 15. Bundle drift CI gate — ferry-ci.yml must run check:bundle
// ---------------------------------------------------------------------------

describe('CI gate — bundle drift check (ferry-ci.yml)', () => {
  it('ferry-ci.yml contains a check-bundle job', async () => {
    const ci = await readFile('.github/workflows/ferry-ci.yml');
    expect(ci, 'ferry-ci.yml must define a check-bundle job').toContain('check-bundle:');
  });

  it('ferry-ci.yml check-bundle job runs npm run check:bundle', async () => {
    const ci = await readFile('.github/workflows/ferry-ci.yml');
    expect(ci, 'check-bundle job must call npm run check:bundle').toContain(
      'npm run check:bundle',
    );
  });
});
