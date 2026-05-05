/**
 * Acceptance-criteria tests for the Ferry install guide (README.md quick-install block).
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
    it(`${stub}.yml references @v0.8.2 (not @main)`, async () => {
      const content = await readFile(`examples/consumer-setup/workflows/${stub}.yml`);
      expect(content, `${stub}.yml must pin to @v0.8.2 — @main is mutable and insecure`).toMatch(
        /@v0\.8\.2\b/,
      );
      expect(content, `${stub}.yml must not use @main (use a release tag or a SHA)`).not.toMatch(
        /@main/,
      );
    });
  }

  for (const stub of coreStubs) {
    it(`${stub}.yml calls composite actions directly (no secrets: inherit)`, async () => {
      const content = await readFile(`examples/consumer-setup/workflows/${stub}.yml`);
      expect(
        content,
        `${stub}.yml must call composite actions directly — secrets: inherit does not work cross-org`,
      ).toContain('big-emotion/ferry/.github/actions/');
      expect(content, `${stub}.yml must not use secrets: inherit`).not.toContain(
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
// 2. Workflow stubs call the correct composite actions — Phase 3
// ---------------------------------------------------------------------------

describe('Phase 3 — composite action references in stubs', () => {
  const mapping: Record<string, string> = {
    'ferry-refine': 'big-emotion/ferry/.github/actions/ferry-run-refiner',
    'ferry-dev': 'big-emotion/ferry/.github/actions/ferry-run-developer',
    'ferry-review': 'big-emotion/ferry/.github/actions/ferry-run-reviewer',
    'ferry-iterate': 'big-emotion/ferry/.github/actions/ferry-run-iterator',
  };

  for (const [stub, target] of Object.entries(mapping)) {
    it(`${stub}.yml references ${target}`, async () => {
      const content = await readFile(`examples/consumer-setup/workflows/${stub}.yml`);
      expect(content, `${stub}.yml must call the correct composite action at ${target}`).toContain(
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
// 4. Required secrets and variable documented in README quick-install block
// ---------------------------------------------------------------------------

describe('Quick install — secret and variable names (README §Step 2)', () => {
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

  it('README documents all 6 required secrets', async () => {
    const doc = await readFile('README.md');
    for (const secret of requiredSecrets) {
      expect(doc, `README must document secret ${secret}`).toContain(secret);
    }
  });

  it('README documents the FERRY_AUDIT_ISSUE variable', async () => {
    const doc = await readFile('README.md');
    expect(doc).toContain('FERRY_AUDIT_ISSUE');
  });

  it('README mentions the 6 secrets set by ferry-init', async () => {
    const doc = await readFile('README.md');
    expect(doc, 'README checklist must call out the 6 secrets set by ferry-init').toMatch(
      /6 secrets/,
    );
  });

  it('README checklist surfaces the 2 transition-ID secrets the wizard does NOT set', async () => {
    const doc = await readFile('README.md');
    expect(doc).toMatch(/FERRY_REVIEW_TRANSITION_ID/);
    expect(doc).toMatch(/FERRY_ITER_TRANSITION_ID/);
    expect(
      doc,
      'README checklist must explicitly note that 2 transition-ID secrets are set manually (the wizard does not set them)',
    ).toMatch(/2 transition-ID secrets set manually/);
  });
});

// ---------------------------------------------------------------------------
// 5. Secret names in the doc match what agent code actually requires
// ---------------------------------------------------------------------------

describe('Quick install — secret names match agent code (README §Step 2)', () => {
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

describe('Phase 6 — FERRY_AUDIT_ISSUE wired through consumer workflow templates (install-guide §6)', () => {
  const stubs = ['ferry-refine', 'ferry-dev', 'ferry-review', 'ferry-iterate'];

  for (const stub of stubs) {
    it(`examples/consumer-setup/workflows/${stub}.yml passes FERRY_AUDIT_ISSUE to emit-audit`, async () => {
      const content = await readFile(`examples/consumer-setup/workflows/${stub}.yml`);
      expect(
        content,
        `${stub}.yml must reference FERRY_AUDIT_ISSUE (needed for 4-line audit accumulation)`,
      ).toContain('FERRY_AUDIT_ISSUE');
    });
  }
});

// ---------------------------------------------------------------------------
// 7. Jira column defaults documented in README quick-install block
// ---------------------------------------------------------------------------

describe('Quick install — Jira column defaults (README quick-install)', () => {
  const defaultColumnNames = [
    'Refinement',
    'In Development',
    'In Review',
    'Changes Requested',
    'Ready to Merge',
  ];

  it('README documents all default Jira column names', async () => {
    const doc = await readFile('README.md');
    for (const col of defaultColumnNames) {
      expect(doc, `README must list default Jira column "${col}"`).toContain(col);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. FR18 / FR24 / FR28 transitions documented in README — Phase 5
// ---------------------------------------------------------------------------

describe('Phase 5 — FR transitions documented (README smoke test section)', () => {
  it('README documents FR18 (Developer → In Review auto-transition)', async () => {
    const doc = await readFile('README.md');
    expect(doc, 'README must reference FR18').toMatch(/FR18/);
  });

  it('README documents FR24 (Reviewer → Changes Requested auto-transition)', async () => {
    const doc = await readFile('README.md');
    expect(doc, 'README must reference FR24').toMatch(/FR24/);
  });

  it('README documents FR28 (Iterator → In Review auto-transition)', async () => {
    const doc = await readFile('README.md');
    expect(doc, 'README must reference FR28').toMatch(/FR28/);
  });
});

// ---------------------------------------------------------------------------
// 9. event_id format — Phase 4
// ---------------------------------------------------------------------------

describe('Phase 4 — event_id format (README §Step 4)', () => {
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

  it('README documents the correct event_id format', async () => {
    const doc = await readFile('README.md');
    expect(doc).toContain('{{issue.key}}-{{issue.id}}');
  });
});

// ---------------------------------------------------------------------------
// 10. Audit issue creation documented — Phase 2
// ---------------------------------------------------------------------------

describe('Quick install — audit issue creation (README §Step 1)', () => {
  it('README includes audit issue creation command', async () => {
    const doc = await readFile('README.md');
    expect(doc, 'README must show gh issue create command for audit log').toContain(
      'gh issue create',
    );
  });

  it('README includes gh variable set for FERRY_AUDIT_ISSUE', async () => {
    const doc = await readFile('README.md');
    expect(doc).toContain('gh variable set FERRY_AUDIT_ISSUE');
  });
});

// ---------------------------------------------------------------------------
// 11. Consumer-facing docs must not reference @main in workflow stubs
// ---------------------------------------------------------------------------

describe('Quick install — no @main in workflow refs (README)', () => {
  it('README does not tell users to use @main workflow refs', async () => {
    const doc = await readFile('README.md');
    // The doc must not say stubs use @main (they use @v0.8.2)
    expect(doc).not.toMatch(/uses.*@main/);
    expect(doc).not.toContain('always use the latest version automatically');
  });
});

// ---------------------------------------------------------------------------
// 12. SHA-pinning instructions are present — Phase 3
// ---------------------------------------------------------------------------

describe('Quick install — SHA pinning instructions (README §SHA pinning)', () => {
  it('README includes SHA pinning instructions using gh api', async () => {
    const doc = await readFile('README.md');
    expect(doc, 'README must show SHA pinning via gh api').toContain(
      'gh api repos/big-emotion/ferry/git/refs/tags/',
    );
  });
});

// ---------------------------------------------------------------------------
// 13. Smoke test scenario documented
// ---------------------------------------------------------------------------

describe('Quick install — smoke test documented (README §Smoke test)', () => {
  it('README includes smoke test guidance', async () => {
    const doc = await readFile('README.md');
    expect(doc).toMatch(/smoke test/i);
  });
});

// ---------------------------------------------------------------------------
// 14. No-auto-merge invariant cross-check
// ---------------------------------------------------------------------------

describe('Quick install — Ferry never merges (README)', () => {
  it('README states Ferry never merges', async () => {
    const doc = await readFile('README.md');
    expect(doc).toMatch(/Ferry never merges/i);
  });
});

// ---------------------------------------------------------------------------
// 15. Internal workflows must not pin ferry-* composite actions to @main
//     CI gate for supply-chain security (issue #77)
// ---------------------------------------------------------------------------

describe('Supply-chain — no @main refs in consumer workflow templates (issue #77)', () => {
  const agentStubs = ['ferry-refine', 'ferry-dev', 'ferry-review', 'ferry-iterate'];

  for (const stub of agentStubs) {
    it(`examples/consumer-setup/workflows/${stub}.yml has no ferry-*@main composite action references`, async () => {
      const content = await readFile(`examples/consumer-setup/workflows/${stub}.yml`);
      const mainRefs = [...content.matchAll(/uses:\s+big-emotion\/ferry\/.+@main/g)].map(
        (m) => m[0],
      );
      expect(
        mainRefs,
        `${stub}.yml must not reference ferry-* composite actions at @main — pin to a release tag instead`,
      ).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// 16. Phase 7 — Ops workflow stubs (reconciler and cost daily-check)
// ---------------------------------------------------------------------------

describe('Operations — ops workflow stubs (README §Operations setup)', () => {
  const opsStubs = ['ferry-reconcile', 'ferry-cost-daily'];

  for (const stub of opsStubs) {
    it(`examples/consumer-setup/workflows/${stub}.yml exists`, async () => {
      const exists = await fileExists(`examples/consumer-setup/workflows/${stub}.yml`);
      expect(exists, `${stub}.yml must exist for consumers to copy`).toBe(true);
    });
  }

  it('ferry-reconcile.yml has a scheduled cron trigger', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-reconcile.yml');
    expect(content).toContain('schedule:');
    expect(content).toContain('cron:');
  });

  it('ferry-cost-daily.yml has a scheduled cron trigger', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-cost-daily.yml');
    expect(content).toContain('schedule:');
    expect(content).toContain('cron:');
  });

  it('ferry-reconcile.yml has explicit permissions block with issues: write', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-reconcile.yml');
    expect(content).toContain('permissions:');
    expect(content).toContain('issues: write');
  });

  it('ferry-cost-daily.yml has explicit permissions block with issues: write', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-cost-daily.yml');
    expect(content).toContain('permissions:');
    expect(content).toContain('issues: write');
  });

  it('ferry-reconcile.yml passes FERRY_AUDIT_ISSUE', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-reconcile.yml');
    expect(content).toContain('FERRY_AUDIT_ISSUE');
  });

  it('ferry-cost-daily.yml passes FERRY_AUDIT_ISSUE and FERRY_SPEND_CAP_EUR', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-cost-daily.yml');
    expect(content).toContain('FERRY_AUDIT_ISSUE');
    expect(content).toContain('FERRY_SPEND_CAP_EUR');
  });

  it('ferry-reconcile.yml runs src/reconciler/run.ts directly', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-reconcile.yml');
    expect(content, 'reconcile stub must invoke the reconciler entrypoint').toContain(
      'src/reconciler/run.ts',
    );
  });

  it('ferry-cost-daily.yml runs src/cost-governance/run.ts directly', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-cost-daily.yml');
    expect(content, 'cost-daily stub must invoke the cost-governance entrypoint').toContain(
      'src/cost-governance/run.ts',
    );
  });

  it('README marks reconciler as required', async () => {
    const doc = await readFile('README.md');
    expect(doc).toMatch(/reconcile.*required|required.*reconcile/i);
  });

  it('README marks cost daily-check as required', async () => {
    const doc = await readFile('README.md');
    expect(doc).toMatch(/cost.*required|required.*cost/i);
  });

  it('README checklist includes ferry-reconcile.yml as required', async () => {
    const doc = await readFile('README.md');
    expect(doc).toMatch(/ferry-reconcile\.yml.*required/i);
  });

  it('README checklist includes ferry-cost-daily.yml as required', async () => {
    const doc = await readFile('README.md');
    expect(doc).toMatch(/ferry-cost-daily\.yml.*required/i);
  });
});

// ---------------------------------------------------------------------------
// 17. Bundle drift CI gate — ferry-ci.yml must run check:bundle
// ---------------------------------------------------------------------------

describe('CI gate — bundle drift check (ferry-ci.yml)', () => {
  it('ferry-ci.yml contains a check-bundle job', async () => {
    const ci = await readFile('.github/workflows/ferry-ci.yml');
    expect(ci, 'ferry-ci.yml must define a check-bundle job').toContain('check-bundle:');
  });

  it('ferry-ci.yml check-bundle job runs npm run check:bundle', async () => {
    const ci = await readFile('.github/workflows/ferry-ci.yml');
    expect(ci, 'check-bundle job must call npm run check:bundle').toContain('npm run check:bundle');
  });
});

// ---------------------------------------------------------------------------
// 18. npm audit (audit:ci) is wired into ferry-ci.yml — issue #105
// ---------------------------------------------------------------------------

describe('supply-chain — npm audit step in ferry-ci.yml (issue #105)', () => {
  it('ferry-ci.yml runs npm run audit:ci', async () => {
    const content = await readFile('.github/workflows/ferry-ci.yml');
    expect(content, 'ferry-ci.yml must call "npm run audit:ci"').toContain('npm run audit:ci');
  });

  it('ferry-ci.yml declares an audit job', async () => {
    const content = await readFile('.github/workflows/ferry-ci.yml');
    expect(content, 'ferry-ci.yml must have an "audit:" job').toMatch(/^  audit:\s*$/m);
  });
});
