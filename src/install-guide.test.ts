/**
 * Acceptance-criteria tests for the Ferry install guide (docs/INSTALL.md).
 *
 * These are structural / static tests — they read files on disk and assert that the
 * codebase remains consistent with the published install guide.  Every test here
 * corresponds to a checkable claim in the guide: if a future code change would
 * break a step in the guide, one of these tests must catch it.
 *
 * Tests are intentionally side-effect-free: no network calls, no GitHub/Jira API,
 * no LLM calls.  They run as part of `npm test` on every push.
 *
 * Install guide content lives in docs/INSTALL.md (moved from README.md in issue #328).
 * README.md now contains only the hero, Get started command, and links to docs.
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
    it(`${stub}.yml references @v1.1.2 (not @main)`, async () => {
      const content = await readFile(`examples/consumer-setup/workflows/${stub}.yml`);
      expect(content, `${stub}.yml must pin to @v1.1.2 — @main is mutable and insecure`).toMatch(
        /@v1\.1\.2\b/,
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
// 1b. Router model — consumer router workflow stub (claude-code path)
// ---------------------------------------------------------------------------

describe('Router model — consumer router workflow stub (INSTALL.md §Router model)', () => {
  it('examples/consumer-setup/workflows/ferry-router.yml exists', async () => {
    const exists = await fileExists('examples/consumer-setup/workflows/ferry-router.yml');
    expect(exists, 'ferry-router.yml must exist for consumers to copy').toBe(true);
  });

  it('ferry-router.yml pins v0.18.0+ (the release that ships the composite), never @main', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-router.yml');
    // The router model does not exist at v0.17.0 — pinning it there would give
    // consumers a workflow whose run-agent action cannot resolve.
    expect(
      content,
      'ferry-router.yml must pin to v0.18.0 or later — earlier tags lack ferry-run-claude-agent',
    ).toMatch(/@v1\.1\.2\b/);
    expect(content, 'ferry-router.yml must not pin a pre-router tag').not.toMatch(/@v0\.17\.0\b/);
    expect(content, 'ferry-router.yml must not use @main (use a release tag or a SHA)').not.toMatch(
      /@main/,
    );
  });

  it('ferry-router.yml calls composite actions directly (no secrets: inherit)', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-router.yml');
    expect(
      content,
      'ferry-router.yml must call composite actions directly — secrets: inherit does not work cross-org',
    ).toContain('big-emotion/ferry/.github/actions/');
    expect(content, 'ferry-router.yml must not use secrets: inherit').not.toContain(
      'secrets: inherit',
    );
  });

  it('ferry-router.yml triggers on ferry-transition plus the legacy per-agent events', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-router.yml');
    for (const eventType of [
      'ferry-transition',
      'ferry-refine',
      'ferry-dev',
      'ferry-review',
      'ferry-iterate',
      'ferry-merge',
    ]) {
      expect(content, `ferry-router.yml must listen for ${eventType}`).toContain(`- ${eventType}`);
    }
  });

  it('ferry-router.yml runs agents through the shared ferry-run-claude-agent composite', async () => {
    const content = await readFile('examples/consumer-setup/workflows/ferry-router.yml');
    expect(content).toContain('big-emotion/ferry/.github/actions/ferry-run-claude-agent');
  });

  it('INSTALL.md documents the single any-column ferry-transition Jira rule', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc, 'INSTALL.md must show the ferry-transition dispatch body').toContain(
      '"event_type": "ferry-transition"',
    );
    expect(
      doc,
      'INSTALL.md must instruct to leave the From/To status filters empty (any-column rule)',
    ).toMatch(/leave \*\*From status\*\* and \*\*To status\*\* \*\*empty\*\*/);
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

describe('Quick install — secret and variable names (INSTALL.md §Step 2)', () => {
  // These are the exact env var names read by requireEnv() in the agent code.
  // If any name changes in the code, the doc test will fail, prompting a doc update.
  const requiredSecrets = [
    'FERRY_JIRA_BASE_URL',
    'FERRY_JIRA_EMAIL',
    'FERRY_JIRA_API_TOKEN',
    'ANTHROPIC_API_KEY',
  ];

  // Auto-resolved from ferry.config status names since the router model shipped;
  // they must stay documented because setting one still overrides the resolver.
  const transitionOverrideSecrets = ['FERRY_REVIEW_TRANSITION_ID', 'FERRY_ITER_TRANSITION_ID'];

  it('INSTALL.md documents the 4 required secrets and the 2 optional transition-id overrides', async () => {
    const doc = await readFile('docs/INSTALL.md');
    for (const secret of [...requiredSecrets, ...transitionOverrideSecrets]) {
      expect(doc, `INSTALL.md must document secret ${secret}`).toContain(secret);
    }
  });

  it('INSTALL.md documents the FERRY_AUDIT_ISSUE variable', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc).toContain('FERRY_AUDIT_ISSUE');
  });

  it('INSTALL.md mentions the 6 secrets set by ferry-init', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc, 'INSTALL.md checklist must call out the 6 secrets set by ferry-init').toMatch(
      /6 secrets/,
    );
  });

  it('INSTALL.md checklist presents transition-ID secrets as optional overrides (auto-resolved)', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc).toMatch(/FERRY_REVIEW_TRANSITION_ID/);
    expect(doc).toMatch(/FERRY_ITER_TRANSITION_ID/);
    expect(
      doc,
      'INSTALL.md checklist must say transition-ID secrets are optional overrides, auto-resolved from ferry.config status names',
    ).toMatch(/Transition-ID secrets: optional overrides — auto-resolved from ferry\.config/);
  });
});

// ---------------------------------------------------------------------------
// 5. Secret names in the doc match what agent code actually requires
// ---------------------------------------------------------------------------

describe('Quick install — secret names match agent code (README §Step 2)', () => {
  // Transition ids are auto-resolved from the config status name via
  // resolveConfiguredTransitionId; the FERRY_*_TRANSITION_ID env var remains an
  // optional explicit override, so its exact name must still appear in the code.
  it('developer agent auto-resolves the FR18 transition (FERRY_REVIEW_TRANSITION_ID override)', async () => {
    const code = await readFile('src/agents/developer/dev-action.ts');
    expect(code, 'dev-action.ts must auto-resolve via resolveConfiguredTransitionId').toContain(
      'resolveConfiguredTransitionId(',
    );
    expect(code, 'dev-action.ts must resolve from the developer auto_transition status').toContain(
      'targetStatusName: devWorkflow.auto_transition',
    );
    expect(code, 'dev-action.ts must still honor FERRY_REVIEW_TRANSITION_ID as override').toContain(
      'process.env.FERRY_REVIEW_TRANSITION_ID',
    );
  });

  it('reviewer agent auto-resolves the FR24 transitions (FERRY_ITER/APPROVE_TRANSITION_ID overrides)', async () => {
    const code = await readFile('src/agents/reviewer/review-action.ts');
    expect(code, 'review-action.ts must auto-resolve via resolveConfiguredTransitionId').toContain(
      'resolveConfiguredTransitionId(',
    );
    expect(
      code,
      'review-action.ts must still honor FERRY_ITER_TRANSITION_ID as override',
    ).toContain('process.env.FERRY_ITER_TRANSITION_ID');
    expect(
      code,
      'review-action.ts must still honor FERRY_APPROVE_TRANSITION_ID as override',
    ).toContain('process.env.FERRY_APPROVE_TRANSITION_ID');
  });

  it('iterator agent auto-resolves the FR28 transition (FERRY_REVIEW_TRANSITION_ID override)', async () => {
    const code = await readFile('src/agents/iterator/iterate-action.ts');
    expect(code, 'iterate-action.ts must auto-resolve via resolveConfiguredTransitionId').toContain(
      'resolveConfiguredTransitionId(',
    );
    expect(
      code,
      'iterate-action.ts must resolve from the iterator auto_transition status',
    ).toContain('targetStatusName: iteratorWorkflow.auto_transition');
    expect(
      code,
      'iterate-action.ts must still honor FERRY_REVIEW_TRANSITION_ID as override',
    ).toContain('process.env.FERRY_REVIEW_TRANSITION_ID');
  });

  it('merger agent auto-resolves the FR32 done-transition (FERRY_MERGE_DONE_TRANSITION_ID override)', async () => {
    const code = await readFile('src/agents/merger/merge-action.ts');
    expect(code, 'merge-action.ts must auto-resolve via resolveConfiguredTransitionId').toContain(
      'resolveConfiguredTransitionId(',
    );
    expect(
      code,
      'merge-action.ts must resolve from the merger auto_transition_done status',
    ).toContain('targetStatusName: ferryCfg.workflow.agents.merger.auto_transition_done');
    expect(
      code,
      'merge-action.ts must still honor FERRY_MERGE_DONE_TRANSITION_ID as override',
    ).toContain('process.env.FERRY_MERGE_DONE_TRANSITION_ID');
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

describe('Quick install — Jira column defaults (INSTALL.md quick-install)', () => {
  const defaultColumnNames = [
    'Refinement',
    'In Development',
    'In Review',
    'Changes Requested',
    'Ready to Merge',
  ];

  it('INSTALL.md documents all default Jira column names', async () => {
    const doc = await readFile('docs/INSTALL.md');
    for (const col of defaultColumnNames) {
      expect(doc, `INSTALL.md must list default Jira column "${col}"`).toContain(col);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. FR18 / FR24 / FR28 transitions documented in README — Phase 5
// ---------------------------------------------------------------------------

describe('Phase 5 — FR transitions documented (INSTALL.md smoke test section)', () => {
  it('INSTALL.md documents FR18 (Developer → In Review auto-transition)', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc, 'INSTALL.md must reference FR18').toMatch(/FR18/);
  });

  it('INSTALL.md documents FR24 (Reviewer → Changes Requested auto-transition)', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc, 'INSTALL.md must reference FR24').toMatch(/FR24/);
  });

  it('INSTALL.md documents FR28 (Iterator → In Review auto-transition)', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc, 'INSTALL.md must reference FR28').toMatch(/FR28/);
  });
});

// ---------------------------------------------------------------------------
// 9. event_id format — Phase 4
// ---------------------------------------------------------------------------

describe('Phase 4 — event_id format (INSTALL.md §Step 4)', () => {
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

    // The 4 phases triggered by the legacy per-column Jira automation rules
    const jiraPhases = ['refine', 'dev', 'review', 'iterate'];
    for (const phase of jiraPhases) {
      expect(phaseEnum, `phase "${phase}" must be in event schema`).toContain(phase);
    }

    // The router model's single any-column rule sends phase "transition"
    expect(phaseEnum, 'phase "transition" must be in event schema (router model)').toContain(
      'transition',
    );
  });

  it('INSTALL.md documents the correct event_id format', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc).toContain('{{issue.key}}-{{issue.id}}');
  });
});

// ---------------------------------------------------------------------------
// 10. Audit issue creation documented — Phase 2
// ---------------------------------------------------------------------------

describe('Quick install — audit issue creation (INSTALL.md §Step 1)', () => {
  it('INSTALL.md includes audit issue creation command', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc, 'INSTALL.md must show gh issue create command for audit log').toContain(
      'gh issue create',
    );
  });

  it('INSTALL.md includes gh variable set for FERRY_AUDIT_ISSUE', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc).toContain('gh variable set FERRY_AUDIT_ISSUE');
  });
});

// ---------------------------------------------------------------------------
// 11. Consumer-facing docs must not reference @main in workflow stubs
// ---------------------------------------------------------------------------

describe('Quick install — no @main in workflow refs (INSTALL.md)', () => {
  it('INSTALL.md does not tell users to use @main workflow refs', async () => {
    const doc = await readFile('docs/INSTALL.md');
    // The doc must not say stubs use @main (they use @v1.1.2)
    expect(doc).not.toMatch(/uses.*@main/);
    expect(doc).not.toContain('always use the latest version automatically');
  });
});

// ---------------------------------------------------------------------------
// 12. SHA-pinning instructions are present — Phase 3
// ---------------------------------------------------------------------------

describe('Quick install — SHA pinning instructions (INSTALL.md §SHA pinning)', () => {
  it('INSTALL.md includes SHA pinning instructions using gh api', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc, 'INSTALL.md must show SHA pinning via gh api').toContain(
      'gh api repos/big-emotion/ferry/git/refs/tags/',
    );
  });
});

// ---------------------------------------------------------------------------
// 13. Smoke test scenario documented
// ---------------------------------------------------------------------------

describe('Quick install — smoke test documented (INSTALL.md §Smoke test)', () => {
  it('INSTALL.md includes smoke test guidance', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc).toMatch(/smoke test/i);
  });
});

// ---------------------------------------------------------------------------
// 14.5 GitLab install path documented end-to-end
// ---------------------------------------------------------------------------

describe('GitLab install path — end-to-end docs (issue #406)', () => {
  it('INSTALL.md documents the GitLab init command', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc).toContain('npx -p @big-emotion/ferry ferry-init --forge gitlab');
  });

  it('INSTALL.md documents including ci/ferry templates from .gitlab-ci.yml', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc).toContain('ci/ferry/');
    expect(doc).toContain('.gitlab-ci.yml');
    expect(doc).toContain('include:');
  });

  it('INSTALL.md documents the Jira Automation trigger fields used by GitLab', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc).toContain('trigger/pipeline');
    expect(doc).toContain('FERRY_DISPATCH_TYPE');
    expect(doc).toContain('FERRY_ENVELOPE_PAYLOAD');
  });

  it('INSTALL.md documents GitLab validation, update, and uninstall commands', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc).toContain('ferry-doctor --forge gitlab');
    expect(doc).toContain('ferry-update --forge gitlab');
    expect(doc).toContain('ferry-uninstall --forge gitlab');
  });
});

// ---------------------------------------------------------------------------
// 14. No-auto-merge invariant cross-check
// ---------------------------------------------------------------------------

describe('Quick install — gated merge boundary (INSTALL.md)', () => {
  it('INSTALL.md documents that merging is gated (Merger / FR32), not unconditional', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc).toMatch(/Merging is gated/i);
    expect(doc).toMatch(/Merger/);
  });
});

// ---------------------------------------------------------------------------
// 15. Internal workflows must not pin ferry-* composite actions to @main
//     CI gate for supply-chain security (issue #77)
// ---------------------------------------------------------------------------

describe('Supply-chain — no @main refs in consumer workflow templates (issue #77)', () => {
  const agentStubs = ['ferry-refine', 'ferry-dev', 'ferry-review', 'ferry-iterate', 'ferry-router'];

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

describe('Operations — ops workflow stubs (INSTALL.md §Operations setup)', () => {
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

  it('INSTALL.md marks reconciler as required', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc).toMatch(/reconcile.*required|required.*reconcile/i);
  });

  it('INSTALL.md marks cost daily-check as required', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc).toMatch(/cost.*required|required.*cost/i);
  });

  it('INSTALL.md checklist includes ferry-reconcile.yml as required', async () => {
    const doc = await readFile('docs/INSTALL.md');
    expect(doc).toMatch(/ferry-reconcile\.yml.*required/i);
  });

  it('INSTALL.md checklist includes ferry-cost-daily.yml as required', async () => {
    const doc = await readFile('docs/INSTALL.md');
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

// ---------------------------------------------------------------------------
// 19. CLI docs include forge-aware lifecycle commands
// ---------------------------------------------------------------------------

describe('CLI docs — GitLab forge variants (issue #406)', () => {
  it('docs/CLI.md mentions --forge gitlab for every lifecycle command', async () => {
    const doc = await readFile('docs/CLI.md');
    expect(doc).toContain('ferry-init --forge gitlab');
    expect(doc).toContain('ferry-doctor --forge gitlab');
    expect(doc).toContain('ferry-update --forge gitlab');
    expect(doc).toContain('ferry-uninstall --forge gitlab');
  });
});

// ---------------------------------------------------------------------------
// 20. GitLab example docs must not describe shipped commands as pending
// ---------------------------------------------------------------------------

describe('GitLab example docs — shipped command status (issue #406)', () => {
  it('examples/consumer-setup-gitlab/README.md does not say ferry-doctor is planned', async () => {
    const doc = await readFile('examples/consumer-setup-gitlab/README.md');
    expect(doc).not.toContain('not yet shipped');
    expect(doc).not.toContain('planned in [#214]');
  });

  it('examples/consumer-setup-gitlab/README.md includes a validation path with ferry-doctor --forge gitlab', async () => {
    const doc = await readFile('examples/consumer-setup-gitlab/README.md');
    expect(doc).toContain('ferry-doctor --forge gitlab');
  });
});

// ---------------------------------------------------------------------------
// FER-26 — the shared composite must isolate npx from the checked-out repo, or
// dogfooding (repo name == @big-emotion/ferry) resolves the local unbuilt
// package and every agent tool (prompt, transition resolver, Jira MCP) fails.
// ---------------------------------------------------------------------------

describe('FER-26 — ferry-run-claude-agent isolates npx via --prefix', () => {
  const ACTION = '.github/actions/ferry-run-claude-agent/action.yml';

  it('has no bare `npx -y -p` call — every npx must pass --prefix first', async () => {
    const action = await readFile(ACTION);
    // A bare shell npx (not preceded by --prefix) resolves the local package.
    expect(action, 'shell npx must use --prefix (FER-26)').not.toMatch(/npx -y -p/);
  });

  it('launches ferry-jira-mcp through npx --prefix in the --mcp-config', async () => {
    const action = await readFile(ACTION);
    expect(
      action,
      'the Jira MCP npx must isolate via --prefix, else dogfood agents lose Jira tools',
    ).toContain('"command":"npx","args":["--prefix"');
  });

  it('isolates all three npx sites (prompt, transition resolver, Jira MCP)', async () => {
    const action = await readFile(ACTION);
    expect((action.match(/--prefix/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
