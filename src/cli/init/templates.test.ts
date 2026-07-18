import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { workflowTemplates, routerWorkflowTemplate } from './templates.js';

const AGENT_FILES = [
  'ferry-refine.yml',
  'ferry-dev.yml',
  'ferry-review.yml',
  'ferry-iterate.yml',
  'ferry-merge.yml',
];

// Validates that a rendered template is structurally sound YAML for GitHub Actions:
// - Uses only spaces, no tabs (YAML is space-sensitive)
// - At least one ${{ expression is present
// - No bare TypeScript-style ${...} interpolation escaped as single-brace
// - Top-level keys (name, on, jobs) are present and unindented
function assertValidWorkflowYaml(content: string, filename: string): void {
  // No tabs — YAML indentation must use spaces
  expect(content, `${filename}: tabs found (YAML must use spaces)`).not.toMatch(/\t/);

  // At least one GitHub Actions ${{ expression must be present. A brace-balance
  // count is intentionally NOT asserted: the claude-code path inlines a literal
  // JSON --mcp-config blob whose braces ({ } } } }) are not GitHub expressions, so
  // a global }}-vs-${{ tally is meaningless. The yaml.parse round-trip below is the
  // real structural check.
  const openCount = (content.match(/\$\{\{/g) ?? []).length;
  expect(openCount, `${filename}: no \${{ expressions found`).toBeGreaterThan(0);

  // No bare TypeScript-style ${...} (single-brace) that would indicate escaping mistakes
  // GitHub Actions uses ${{ }}, never ${ }. Negative lookahead reads as "dollar-brace not
  // followed by another brace" — same intent as the previous /\$\{[^{]/ but no false-positive
  // on a literal `${ }` that could appear inside a comment.
  expect(content, `${filename}: bare single-brace \${...} found — escaping error`).not.toMatch(
    /\$\{(?!\{)/,
  );

  // Required GitHub Actions YAML top-level keys must be unindented
  expect(content, `${filename}: missing top-level 'name:'`).toMatch(/^name:/m);
  expect(content, `${filename}: missing top-level 'on:'`).toMatch(/^on:/m);
  expect(content, `${filename}: missing top-level 'jobs:'`).toMatch(/^jobs:/m);

  // The string-shape checks above catch the common escaping bugs, but they miss
  // indentation mistakes that a regex can't see (e.g. a step block indented one level
  // too deep). A real YAML parse round-trip catches those for free.
  expect(() => parseYaml(content), `${filename}: yaml.parse threw`).not.toThrow();
}

describe('workflowTemplates — count and filenames', () => {
  it('returns exactly 5 workflow templates', () => {
    expect(workflowTemplates('v1')).toHaveLength(5);
  });

  it('includes all four agent workflow filenames', () => {
    const names = workflowTemplates('v1').map((t) => t.filename);
    for (const f of AGENT_FILES) {
      expect(names).toContain(f);
    }
  });
});

describe('workflowTemplates — YAML validity', () => {
  it('each template renders as structurally valid GitHub Actions YAML (script path)', () => {
    for (const tmpl of workflowTemplates('v1')) {
      assertValidWorkflowYaml(tmpl.content, tmpl.filename);
    }
  });

  it('each template renders as structurally valid GitHub Actions YAML (claude-code path)', () => {
    for (const tmpl of workflowTemplates('v1', 'claude-code')) {
      assertValidWorkflowYaml(tmpl.content, tmpl.filename);
    }
  });

  it('embeds the ferry version tag in each agent workflow', () => {
    for (const tmpl of workflowTemplates('v0.13.2')) {
      expect(tmpl.content).toContain('@v0.13.2');
    }
  });
});

describe('workflowTemplates — routing structure', () => {
  it('every template has a route job that resolves execution path', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: missing route job`).toContain('ferry-route@v1');
      expect(tmpl.content, `${tmpl.filename}: missing path output`).toContain(
        'path: ${{ steps.route.outputs.path }}',
      );
    }
  });

  it('run-agent (script path) is gated on route output', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: script path missing if gate`).toContain(
        "if: needs.route.outputs.path == 'script'",
      );
    }
  });

  it('run-agent-claude-code is gated on route output', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: cc path missing if gate`).toContain(
        "if: needs.route.outputs.path == 'claude-code'",
      );
    }
  });

  it('run-agent-codex-cli is gated on route output', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: codex path missing if gate`).toContain(
        "if: needs.route.outputs.path == 'codex-cli'",
      );
    }
  });

  it('emit-audit depends on both agent jobs (and ci-gate on the review template)', () => {
    for (const tmpl of workflowTemplates('v1')) {
      // The review template adds the deterministic ci-gate job to the cc path,
      // so its emit-audit must also depend on ci-gate to surface the ci-red case.
      const expectedNeeds =
        tmpl.filename === 'ferry-review.yml'
          ? 'needs: [run-agent, run-agent-claude-code, run-agent-codex-cli, ci-gate]'
          : 'needs: [run-agent, run-agent-claude-code, run-agent-codex-cli]';
      expect(tmpl.content, `${tmpl.filename}: emit-audit missing dependency`).toContain(
        expectedNeeds,
      );
      // emit-audit must run even when one path is skipped
      expect(tmpl.content, `${tmpl.filename}: emit-audit missing always() guard`).toContain(
        'if: always() &&',
      );
    }
  });
});

describe('workflowTemplates — claude-code path single-step shape', () => {
  // The claude-code path is now ONE direct anthropics/claude-code-action call —
  // the deleted ferry-cc-prepare/ferry-cc-apply wrapper chain must never reappear.
  it('run-agent-claude-code calls claude-code-action directly with no cc wrapper steps', () => {
    for (const tmpl of workflowTemplates('v1')) {
      const content = tmpl.content;
      expect(content, `${tmpl.filename}: missing anthropics/claude-code-action`).toContain(
        'anthropics/claude-code-action@',
      );
      expect(content, `${tmpl.filename}: still references deleted ferry-cc-prepare`).not.toContain(
        'ferry-cc-prepare',
      );
      expect(content, `${tmpl.filename}: still references deleted ferry-cc-apply`).not.toContain(
        'ferry-cc-apply',
      );
    }
  });

  it('claude-code-action receives the CLAUDE_CODE_OAUTH_TOKEN input', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: missing claude_code_oauth_token wiring`).toContain(
        'claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}',
      );
    }
  });

  it('claude-code-action resolves its prompt via ferry-cc-prompt, never inlined', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: prompt must not be inlined`).not.toContain(
        'prompt: |',
      );
      expect(tmpl.content, `${tmpl.filename}: missing ferry-cc-prompt resolve step`).toContain(
        'ferry-cc-prompt',
      );
      expect(
        tmpl.content,
        `${tmpl.filename}: claude-code-action must read the resolved prompt`,
      ).toContain('prompt: ${{ steps.prompt.outputs.prompt }}');
      expect(tmpl.content, `${tmpl.filename}: missing claude_args block`).toContain(
        'claude_args: >-',
      );
    }
  });

  it('claude_args wires the ferry-jira-mcp MCP server', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: missing ferry-jira-mcp`).toContain('ferry-jira-mcp');
      // bypassPermissions is required: in a non-interactive (SDK) run, acceptEdits
      // only auto-approves file edits — every Jira MCP tool call (and Bash/git/gh)
      // is otherwise denied with no human to grant permission. The
      // --disallowedTools list still blocks the dangerous `gh pr merge/close`.
      expect(tmpl.content, `${tmpl.filename}: missing --permission-mode`).toContain(
        '--permission-mode bypassPermissions',
      );
      expect(
        tmpl.content,
        `${tmpl.filename}: acceptEdits would deny Jira MCP tool calls in non-interactive runs`,
      ).not.toContain('--permission-mode acceptEdits');
    }
  });

  it('claude_args --mcp-config pins the ferry-jira-mcp package to the templated version', () => {
    // ferry-init/ferry-update must template the version so the MCP server the
    // agent launches matches the workflow's pinned Ferry release.
    for (const tmpl of workflowTemplates('v0.18.2')) {
      expect(tmpl.content, `${tmpl.filename}: --mcp-config missing`).toContain('--mcp-config');
      expect(tmpl.content, `${tmpl.filename}: ferry-jira-mcp package not version-pinned`).toContain(
        '"@big-emotion/ferry@v0.18.2"',
      );
      expect(tmpl.content, `${tmpl.filename}: ferry-jira-mcp package left unpinned`).not.toContain(
        '"@big-emotion/ferry"',
      );
    }
  });

  it('claude_args --model interpolates the per-agent model variable (not hardcoded)', () => {
    // A consumer who sets the per-agent FERRY_*_MODEL variable must be honoured
    // on the claude-code path too — the model must never be hardcoded.
    const modelVars: Record<string, string> = {
      'ferry-refine.yml': "--model ${{ vars.FERRY_REFINER_MODEL || 'claude-sonnet-4-6' }}",
      'ferry-dev.yml': "--model ${{ vars.FERRY_DEV_MODEL || 'claude-sonnet-4-6' }}",
      'ferry-review.yml': "--model ${{ vars.FERRY_REVIEW_MODEL || 'claude-sonnet-4-6' }}",
      'ferry-iterate.yml': "--model ${{ vars.FERRY_ITER_MODEL || 'claude-sonnet-4-6' }}",
      'ferry-merge.yml': "--model ${{ vars.FERRY_MERGER_MODEL || 'claude-sonnet-4-6' }}",
    };
    for (const tmpl of workflowTemplates('v1')) {
      const expected = modelVars[tmpl.filename];
      expect(expected, `${tmpl.filename}: no expected --model line`).toBeDefined();
      expect(
        tmpl.content,
        `${tmpl.filename}: --model not interpolated from the model var`,
      ).toContain(expected);
      expect(tmpl.content, `${tmpl.filename}: --model is still hardcoded`).not.toContain(
        '--model claude-sonnet-4-6\n',
      );
    }
  });

  it('emit-audit emits zeroed token/cost on the claude-code path (best-effort tracking)', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: missing best-effort cost-tracking comment`).toContain(
        'claude-code path does cost tracking best-effort',
      );
    }
  });
});

describe('workflowTemplates — codex-cli path single-step shape', () => {
  it('run-agent-codex-cli calls openai/codex-action directly', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: missing openai/codex-action`).toContain(
        'openai/codex-action@',
      );
    }
  });

  it('codex-action receives the OPENAI_API_KEY input and a shared codex-home', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: missing openai-api-key wiring`).toContain(
        'openai-api-key: ${{ secrets.OPENAI_API_KEY }}',
      );
      expect(tmpl.content, `${tmpl.filename}: missing codex-home input`).toContain(
        'codex-home: codex-home',
      );
    }
  });

  it('codex-action resolves prompts via ferry-action-prompt with --path codex-cli, never inline', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: codex prompt must not be inlined`).not.toContain(
        'prompt: |',
      );
      expect(tmpl.content, `${tmpl.filename}: missing ferry-action-prompt step`).toContain(
        'ferry-action-prompt',
      );
      expect(tmpl.content, `${tmpl.filename}: missing --path codex-cli`).toContain(
        '--path codex-cli',
      );
      expect(
        tmpl.content,
        `${tmpl.filename}: codex-action must read the resolved prompt`,
      ).toContain('prompt: ${{ steps.prompt.outputs.prompt }}');
    }
  });

  it('codex-action wires model, effort, sandbox, safety strategy, and optional version through vars', () => {
    const expectedModelLines: Record<string, string> = {
      'ferry-refine.yml': "model: ${{ vars.FERRY_REFINER_MODEL || 'gpt-5-codex' }}",
      'ferry-dev.yml': "model: ${{ vars.FERRY_DEV_MODEL || 'gpt-5-codex' }}",
      'ferry-review.yml': "model: ${{ vars.FERRY_REVIEW_MODEL || 'gpt-5-codex' }}",
      'ferry-iterate.yml': "model: ${{ vars.FERRY_ITER_MODEL || 'gpt-5-codex' }}",
      'ferry-merge.yml': "model: ${{ vars.FERRY_MERGER_MODEL || 'gpt-5-codex' }}",
    };
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: missing expected model line`).toContain(
        expectedModelLines[tmpl.filename],
      );
      expect(tmpl.content, `${tmpl.filename}: missing effort var`).toContain(
        "effort: ${{ vars.FERRY_CODEX_EFFORT || '' }}",
      );
      expect(tmpl.content, `${tmpl.filename}: missing sandbox var`).toContain(
        "sandbox: ${{ vars.FERRY_CODEX_SANDBOX || 'workspace-write' }}",
      );
      expect(tmpl.content, `${tmpl.filename}: missing safety strategy var`).toContain(
        "safety-strategy: ${{ vars.FERRY_CODEX_SAFETY_STRATEGY || 'drop-sudo' }}",
      );
      expect(tmpl.content, `${tmpl.filename}: missing optional codex version var`).toContain(
        "codex-version: ${{ vars.FERRY_CODEX_VERSION || '' }}",
      );
    }
  });

  it('codex job generates codex-home/config.toml with ferry-codex-config before the action step', () => {
    for (const tmpl of workflowTemplates('v0.18.2')) {
      expect(tmpl.content, `${tmpl.filename}: missing ferry-codex-config step`).toContain(
        'ferry-codex-config > codex-home/config.toml',
      );
      expect(
        tmpl.content,
        `${tmpl.filename}: ferry-codex-config package must be version-pinned`,
      ).toContain('@big-emotion/ferry@v0.18.2');
    }
  });
});

describe('workflowTemplates — role-specific wiring', () => {
  it('ferry-dev.yml wires FERRY_REVIEW_TRANSITION_ID into the script-path run-agent (FR18)', () => {
    const dev = workflowTemplates('v1').find((t) => t.filename === 'ferry-dev.yml');
    expect(dev?.content).toContain(
      'ferry_review_transition_id: ${{ secrets.FERRY_REVIEW_TRANSITION_ID }}',
    );
  });

  it('ferry-review.yml run-agent (script path) has contents: write — required for repository_dispatch (FR32)', () => {
    // The reviewer dispatches ferry-merge on approve; repos.createDispatchEvent requires
    // contents: write. contents: read silently 403s and crashes the job after approval.
    const review = workflowTemplates('v1').find((t) => t.filename === 'ferry-review.yml');
    expect(review, 'ferry-review.yml not found').toBeDefined();
    // Extract the run-agent job block (ends before the ci-gate job).
    const runAgentBlock = review!.content.split('  ci-gate:')[0].split('  run-agent:')[1];
    expect(
      runAgentBlock,
      'ferry-review.yml run-agent permissions block must have contents: write (not read)',
    ).toContain('contents: write');
    expect(
      runAgentBlock,
      'ferry-review.yml run-agent must not downgrade to contents: read',
    ).not.toMatch(/contents: read/);
  });

  it('ferry-review.yml wires FERRY_ITER_TRANSITION_ID into run-agent and ci-gate (FR24 changes)', () => {
    const review = workflowTemplates('v1').find((t) => t.filename === 'ferry-review.yml');
    expect(review?.content).toContain(
      'ferry_iter_transition_id: ${{ secrets.FERRY_ITER_TRANSITION_ID }}',
    );
  });

  it('ferry-review.yml surfaces FERRY_APPROVE_TRANSITION_ID in the reviewer cc prompt (FR24 approve)', () => {
    const review = workflowTemplates('v1').find((t) => t.filename === 'ferry-review.yml');
    expect(review?.content).toContain('${{ secrets.FERRY_APPROVE_TRANSITION_ID }}');
  });

  it('ferry-iterate.yml wires FERRY_REVIEW_TRANSITION_ID into the script-path run-agent (FR28)', () => {
    const iterate = workflowTemplates('v1').find((t) => t.filename === 'ferry-iterate.yml');
    expect(iterate?.content).toContain(
      'ferry_review_transition_id: ${{ secrets.FERRY_REVIEW_TRANSITION_ID }}',
    );
  });

  it('ferry-iterate.yml uses fetch-depth: 0 for both script-path and claude-code-path checkouts', () => {
    const iterate = workflowTemplates('v1').find((t) => t.filename === 'ferry-iterate.yml');
    const fetchDepthCount = (iterate?.content.match(/fetch-depth: 0/g) ?? []).length;
    expect(fetchDepthCount).toBe(2);
  });

  it('ferry-review.yml declares checks: read on run-agent and the ci-gate job', () => {
    const review = workflowTemplates('v1').find((t) => t.filename === 'ferry-review.yml');
    const checksCount = (review?.content.match(/checks: read/g) ?? []).length;
    expect(checksCount).toBe(3);
  });

  it('ferry-review.yml runs the deterministic ci-gate before the reviewer cc job', () => {
    const review = workflowTemplates('v1').find((t) => t.filename === 'ferry-review.yml');
    expect(review?.content).toContain('ferry-ci-gate@v1');
    expect(review?.content).toContain('needs: [route, ci-gate]');
    expect(review?.content).toContain(
      "if: needs.route.outputs.path == 'claude-code' && needs.ci-gate.outputs.proceed == 'true'",
    );
  });
});

describe('workflowTemplates — emit-audit outcome shape', () => {
  // Locks in the `!= 'skipped'` shape of the outcome ternary. The earlier shape
  // (`== 'success' && ...`) silently reported `skipped` for genuine script-path
  // failures once the audit gate was widened to `!= 'skipped'`. Regressing this
  // would poison cost-governance's view of failed runs.
  it("outcome ternary uses != 'skipped' (script path branch), not == 'success'", () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(
        tmpl.content,
        `${tmpl.filename}: outcome ternary still uses the regressed == 'success' shape`,
      ).not.toContain("needs.run-agent.result == 'success' && needs.run-agent.result");
      // The review template extends the ternary with a ci-gate ci-red branch, so
      // its shape is parenthesised; the other three keep the plain two-branch form.
      const expectedOutcome =
        tmpl.filename === 'ferry-review.yml'
          ? "outcome: ${{ (needs.run-agent.result != 'skipped' && needs.run-agent.result) || (needs.run-agent-claude-code.result != 'skipped' && needs.run-agent-claude-code.result) || (needs.run-agent-codex-cli.result != 'skipped' && needs.run-agent-codex-cli.result) || (needs.ci-gate.outputs.outcome == 'ci-red' && 'ci-red') || needs.run-agent-codex-cli.result || needs.run-agent-claude-code.result }}"
          : "outcome: ${{ (needs.run-agent.result != 'skipped' && needs.run-agent.result) || (needs.run-agent-claude-code.result != 'skipped' && needs.run-agent-claude-code.result) || needs.run-agent-codex-cli.result }}";
      expect(
        tmpl.content,
        `${tmpl.filename}: outcome ternary missing != 'skipped' shape`,
      ).toContain(expectedOutcome);
    }
  });
});

describe('workflowTemplates — review ci-gate emit-audit ci-red wiring', () => {
  // The review template's deterministic ci-gate can request changes on red CI
  // without the cc agent running; emit-audit must still fire for that ci-red case.
  it('ferry-review.yml emit-audit surfaces the ci-gate ci-red outcome', () => {
    const review = workflowTemplates('v1').find((t) => t.filename === 'ferry-review.yml');
    expect(review, 'ferry-review.yml not found').toBeDefined();
    expect(review!.content).toContain(
      'needs: [run-agent, run-agent-claude-code, run-agent-codex-cli, ci-gate]',
    );
    expect(review!.content).toContain("needs.ci-gate.outputs.outcome == 'ci-red'");
  });
});

describe('workflowTemplates — merge authority (FR32)', () => {
  // The Merger is the only role permitted to run `gh pr merge`.
  // All other roles must keep the ban. This test is the regression guard for
  // ADR-0005 §FR32: removing a role from the exception list re-bans it here.

  const NON_MERGER_FILES = [
    'ferry-refine.yml',
    'ferry-dev.yml',
    'ferry-review.yml',
    'ferry-iterate.yml',
  ];

  it('ferry-merge.yml Merger cc-path does NOT disallow gh pr merge (FR32 exception)', () => {
    const merge = workflowTemplates('v1').find((t) => t.filename === 'ferry-merge.yml');
    expect(merge, 'ferry-merge.yml not found').toBeDefined();
    // gh pr merge must NOT appear in --disallowedTools
    expect(
      merge!.content,
      'ferry-merge.yml: Merger must be allowed to run gh pr merge (FR32)',
    ).not.toContain('Bash(gh pr merge)');
  });

  it('ferry-merge.yml Merger cc-path still disallows gh pr close', () => {
    const merge = workflowTemplates('v1').find((t) => t.filename === 'ferry-merge.yml');
    expect(merge, 'ferry-merge.yml not found').toBeDefined();
    expect(
      merge!.content,
      'ferry-merge.yml: Merger must still be blocked from gh pr close',
    ).toContain('Bash(gh pr close)');
  });

  it('all non-Merger roles still disallow gh pr merge', () => {
    for (const tmpl of workflowTemplates('v1')) {
      if (!NON_MERGER_FILES.includes(tmpl.filename)) continue;
      expect(
        tmpl.content,
        `${tmpl.filename}: non-Merger role must not be allowed to run gh pr merge`,
      ).toContain('Bash(gh pr merge)');
    }
  });

  it('ferry-merge.yml Merger codex path still disallows gh pr close', () => {
    const merge = workflowTemplates('v1').find((t) => t.filename === 'ferry-merge.yml');
    expect(merge, 'ferry-merge.yml not found').toBeDefined();
    expect(
      merge!.content,
      'ferry-merge.yml: Merger codex path must still be blocked from gh pr close',
    ).toContain('gh pr close');
  });
});

describe('workflowTemplates — supply-chain action pinning', () => {
  // anthropics/claude-code-action is a token-scoped action — tag refs like @v1 are
  // mutable, so we require a 40-char commit SHA with a trailing version comment.
  it('claude-code-action is SHA-pinned (not tag-pinned)', () => {
    const SHA_PIN = /anthropics\/claude-code-action@[0-9a-f]{40}\s*#\s*v\d+/;
    const TAG_PIN = /anthropics\/claude-code-action@v\d+\s*$/m;
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: claude-code-action not SHA-pinned`).toMatch(SHA_PIN);
      expect(
        tmpl.content,
        `${tmpl.filename}: claude-code-action still uses a mutable tag`,
      ).not.toMatch(TAG_PIN);
    }
  });

  it('codex-action is SHA-pinned (not tag-pinned)', () => {
    const SHA_PIN = /openai\/codex-action@[0-9a-f]{40}\s*#\s*v\d+/;
    const TAG_PIN = /openai\/codex-action@v\d+\s*$/m;
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: codex-action not SHA-pinned`).toMatch(SHA_PIN);
      expect(tmpl.content, `${tmpl.filename}: codex-action still uses a mutable tag`).not.toMatch(
        TAG_PIN,
      );
    }
  });
});

describe('workflowTemplates — claude-code path CI permissions and checkout refs (#396)', () => {
  // dev/iterate/merge instruct the agent to drive CI to green via `gh pr checks`,
  // `gh run view`, and the GraphQL statusCheckRollup — all need checks: read and
  // actions: read. Without them every check-status endpoint returns HTTP 403 and
  // the agent resolves CI as unknown, never transitioning the ticket.
  it('dev/iterate/merge run-agent-claude-code grants checks: read and actions: read', () => {
    for (const filename of ['ferry-dev.yml', 'ferry-iterate.yml', 'ferry-merge.yml']) {
      const tmpl = workflowTemplates('v1').find((t) => t.filename === filename);
      expect(tmpl, `${filename} not found`).toBeDefined();
      const ccBlock = tmpl!.content
        .split('  run-agent-claude-code:')[1]
        .split('\n  emit-audit:')[0];
      expect(ccBlock, `${filename}: run-agent-claude-code missing checks: read`).toContain(
        'checks: read',
      );
      expect(ccBlock, `${filename}: run-agent-claude-code missing actions: read`).toContain(
        'actions: read',
      );
    }
  });

  // On repository_dispatch, a bare actions/checkout checks out the default branch.
  // refiner/dev must work against the integration branch; iterate/review/merge must
  // work against the PR branch ferry/<ticket_key>.
  it('refiner/dev claude-code path checks out the integration branch (FERRY_INTEGRATION_BRANCH)', () => {
    for (const filename of ['ferry-refine.yml', 'ferry-dev.yml']) {
      const tmpl = workflowTemplates('v1').find((t) => t.filename === filename);
      expect(tmpl, `${filename} not found`).toBeDefined();
      const ccBlock = tmpl!.content
        .split('  run-agent-claude-code:')[1]
        .split('\n  emit-audit:')[0];
      expect(
        ccBlock,
        `${filename}: claude-code checkout must target FERRY_INTEGRATION_BRANCH`,
      ).toContain("ref: ${{ vars.FERRY_INTEGRATION_BRANCH || 'main' }}");
    }
  });

  it('iterate/review/merge claude-code path checks out the PR branch (ferry/<ticket_key>)', () => {
    for (const filename of ['ferry-iterate.yml', 'ferry-review.yml', 'ferry-merge.yml']) {
      const tmpl = workflowTemplates('v1').find((t) => t.filename === filename);
      expect(tmpl, `${filename} not found`).toBeDefined();
      const ccBlock = tmpl!.content
        .split('  run-agent-claude-code:')[1]
        .split('\n  emit-audit:')[0];
      expect(ccBlock, `${filename}: claude-code checkout must target the PR branch`).toContain(
        'ref: ferry/${{ github.event.client_payload.ticket_key }}',
      );
    }
  });

  it('every run-agent-claude-code checkout uses fetch-depth: 0 (avoids shallow-clone on merge-base)', () => {
    for (const tmpl of workflowTemplates('v1')) {
      const ccBlock =
        tmpl.content.split('  run-agent-claude-code:')[1]?.split('\n  emit-audit:')[0] ?? '';
      expect(ccBlock, `${tmpl.filename}: claude-code checkout missing fetch-depth: 0`).toContain(
        'fetch-depth: 0',
      );
    }
  });
});

describe('workflowTemplates — FERRY_RUNNER runner label (#364)', () => {
  it('every template uses fromJSON(vars.FERRY_RUNNER) for runs-on (no hardcoded ubuntu-latest)', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(
        tmpl.content,
        `${tmpl.filename}: still contains hardcoded runs-on: ubuntu-latest`,
      ).not.toContain('runs-on: ubuntu-latest');
      expect(tmpl.content, `${tmpl.filename}: missing FERRY_RUNNER fromJSON expression`).toContain(
        'fromJSON(vars.FERRY_RUNNER || \'"ubuntu-latest"\')',
      );
    }
  });
});

describe('workflowTemplates — cc-path role coverage is complete', () => {
  // All four roles now run end-to-end on the claude-code path (#350), so no
  // template should carry a "not yet wired" guard step.
  it('no template contains the legacy "cc-path not yet wired" guard', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(
        tmpl.content,
        `${tmpl.filename} still contains a legacy "cc-path not yet wired" guard`,
      ).not.toContain('Guard — cc-path not yet wired');
    }
  });
});

describe('workflowTemplates — run-agent-claude-code permissions include id-token: write (#353)', () => {
  // anthropics/claude-code-action@v1 unconditionally calls core.getIDToken() during
  // setupGitHubToken. When a job has an explicit permissions: block that omits
  // id-token, GitHub Actions denies the OIDC fetch and every consumer dispatch fails
  // with "Could not fetch an OIDC token". This regression guard ensures the missing
  // scope cannot be reintroduced by a future template edit.
  const roles = [
    { filename: 'ferry-refine.yml', role: 'refiner' },
    { filename: 'ferry-dev.yml', role: 'developer' },
    { filename: 'ferry-review.yml', role: 'reviewer' },
    { filename: 'ferry-iterate.yml', role: 'iterator' },
    { filename: 'ferry-merge.yml', role: 'merger' },
  ] as const;

  for (const { filename, role } of roles) {
    it(`${filename} (${role}): run-agent-claude-code permissions block contains id-token: write`, () => {
      const tmpl = workflowTemplates('v1').find((t) => t.filename === filename);
      expect(tmpl, `${filename} not found`).toBeDefined();
      expect(
        tmpl!.content,
        `${filename}: run-agent-claude-code job is missing id-token: write (fixes #353)`,
      ).toContain('id-token: write');
    });
  }
});

describe('workflowTemplates — CI-driving roles include checks: read + actions: read (#395)', () => {
  // Developer, Iterator, and Merger agents call gh pr checks, gh run view, and the
  // GraphQL statusCheckRollup to drive CI before transitioning. Without checks: read
  // and actions: read, GitHub returns HTTP 403 and the agent treats CI as unknown,
  // never transitioning the ticket. This regression guard ensures the missing scopes
  // cannot be reintroduced by a future template edit.
  const ciRoles = [
    { filename: 'ferry-dev.yml', role: 'developer' },
    { filename: 'ferry-iterate.yml', role: 'iterator' },
    { filename: 'ferry-merge.yml', role: 'merger' },
  ] as const;

  for (const { filename, role } of ciRoles) {
    it(`${filename} (${role}): run-agent-claude-code permissions block contains checks: read`, () => {
      const tmpl = workflowTemplates('v1').find((t) => t.filename === filename);
      expect(tmpl, `${filename} not found`).toBeDefined();
      expect(
        tmpl!.content,
        `${filename}: run-agent-claude-code job is missing checks: read (fixes #395)`,
      ).toContain('checks: read');
    });

    it(`${filename} (${role}): run-agent-claude-code permissions block contains actions: read`, () => {
      const tmpl = workflowTemplates('v1').find((t) => t.filename === filename);
      expect(tmpl, `${filename} not found`).toBeDefined();
      expect(
        tmpl!.content,
        `${filename}: run-agent-claude-code job is missing actions: read (fixes #395)`,
      ).toContain('actions: read');
    });
  }

  it('ferry-refine.yml does not gain unnecessary checks: read (no CI interaction)', () => {
    const tmpl = workflowTemplates('v1').find((t) => t.filename === 'ferry-refine.yml');
    expect(tmpl, 'ferry-refine.yml not found').toBeDefined();
    expect(
      tmpl!.content,
      'ferry-refine.yml should not have checks: read — refiner has no CI interaction',
    ).not.toContain('checks: read');
  });
});

describe('workflowTemplates — execution path variants', () => {
  it('script path is byte-identical whether implicit or explicit', () => {
    expect(workflowTemplates('v1', 'script')).toEqual(workflowTemplates('v1'));
  });

  it('script path contains no claude-code activation header', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content).not.toContain('Execution path: claude-code');
    }
  });

  it('claude-code path adds the activation header to every template', () => {
    for (const tmpl of workflowTemplates('v1', 'claude-code')) {
      expect(tmpl.content).toContain('# Execution path: claude-code');
    }
  });
});

describe('routerWorkflowTemplate — thin router (claude-code path)', () => {
  const router = routerWorkflowTemplate('v0.18.2');

  it('is named ferry-router.yml (covered by the CODEOWNERS ferry-*.yml glob)', () => {
    expect(router.filename).toBe('ferry-router.yml');
  });

  it('is structurally valid workflow YAML', () => {
    assertValidWorkflowYaml(router.content, router.filename);
  });

  it('listens for ferry-transition plus every legacy event (migration compat)', () => {
    for (const event of [
      'ferry-transition',
      'ferry-refine',
      'ferry-dev',
      'ferry-review',
      'ferry-iterate',
      'ferry-merge',
    ]) {
      expect(router.content, `router must listen for ${event}`).toContain(`- ${event}`);
    }
  });

  it('routes via ferry-route with event_type and NO hardcoded role', () => {
    expect(router.content).toContain('uses: big-emotion/ferry/.github/actions/ferry-route@v0.18.2');
    expect(router.content).toContain('event_type: ${{ github.event.action }}');
    expect(router.content).not.toMatch(/^\s+role: (refiner|developer|reviewer|iterator|merger)$/m);
  });

  it('runs agents through the shared ferry-run-claude-agent composite', () => {
    expect(router.content).toContain(
      'uses: big-emotion/ferry/.github/actions/ferry-run-claude-agent@v0.18.2',
    );
    expect(router.content).toContain('role: ${{ needs.route.outputs.cc_agent }}');
    expect(router.content).toContain('ferry_version: v0.18.2');
  });

  it('resolves the model dynamically from the role model_var', () => {
    expect(router.content).toContain(
      "model: ${{ vars[needs.route.outputs.model_var] || 'claude-sonnet-4-6' }}",
    );
  });

  it('transition-id secrets are optional overrides, wired but not required', () => {
    expect(router.content).toContain(
      'review_transition_id: ${{ secrets.FERRY_REVIEW_TRANSITION_ID }}',
    );
    expect(router.content).toContain(
      'approve_transition_id: ${{ secrets.FERRY_APPROVE_TRANSITION_ID }}',
    );
    expect(router.content).toContain(
      'changes_transition_id: ${{ secrets.FERRY_ITER_TRANSITION_ID }}',
    );
    expect(router.content).toContain('Optional secrets: FERRY_REVIEW_TRANSITION_ID');
  });

  it('gates the reviewer behind ferry-ci-gate and skips run-agent when CI is red', () => {
    expect(router.content).toContain(
      'uses: big-emotion/ferry/.github/actions/ferry-ci-gate@v0.18.2',
    );
    expect(router.content).toContain(
      "needs.route.outputs.role != 'reviewer' || needs.ci-gate.outputs.proceed == 'true'",
    );
  });

  it('serializes per ticket AND per role at the job level', () => {
    expect(router.content).toContain(
      'group: ferry-agent-${{ needs.route.outputs.role }}-${{ github.event.client_payload.ticket_key }}',
    );
    // refine stays cancellable (latest human edit wins); write phases are not
    expect(router.content).toContain(
      "cancel-in-progress: ${{ needs.route.outputs.role == 'refiner' }}",
    );
  });

  it('fails loudly on script/codex-cli paths instead of dropping the dispatch', () => {
    expect(router.content).toContain('unsupported-path:');
    expect(router.content).toContain('exit 1');
  });

  it('emits the audit line with the routed phase and honors FERRY_AUDIT_ISSUE', () => {
    expect(router.content).toContain('phase: ${{ needs.route.outputs.phase }}');
    expect(router.content).toContain('audit_issue: ${{ vars.FERRY_AUDIT_ISSUE }}');
  });

  it('keeps the FERRY_RUNNER expression on every job (local-overrides compat)', () => {
    const jobCount = (router.content.match(/^  [a-z-]+:$/gm) ?? []).length;
    const runnerCount = (
      router.content.match(
        /runs-on: \$\{\{ fromJSON\(vars\.FERRY_RUNNER \|\| '"ubuntu-latest"'\) \}\}/g,
      ) ?? []
    ).length;
    expect(runnerCount, 'every job must use the FERRY_RUNNER expression').toBe(jobCount);
  });

  it('embeds the pinned version everywhere and never @main', () => {
    expect(router.content).not.toContain('@main');
    const ferryRefs =
      router.content.match(/big-emotion\/ferry\/\.github\/actions\/[a-z-]+@v0\.18\.2/g) ?? [];
    expect(ferryRefs.length).toBeGreaterThanOrEqual(4);
  });

  it('sets a run-name identifying the run by event, ticket, and target status (FER-27)', () => {
    // The role is unknown at start (resolved by the route job), but the event
    // type + ticket + to_status make each Actions-list entry distinguishable.
    expect(router.content).toMatch(/^run-name: /m);
    expect(router.content).toContain('${{ github.event.action }}');
    expect(router.content).toContain('${{ github.event.client_payload.ticket_key');
    expect(router.content).toContain('github.event.client_payload.to_status');
  });
});
