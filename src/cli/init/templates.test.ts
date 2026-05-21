import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { workflowTemplates } from './templates.js';

const AGENT_FILES = ['ferry-refine.yml', 'ferry-dev.yml', 'ferry-review.yml', 'ferry-iterate.yml'];

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
  it('returns exactly 4 workflow templates', () => {
    expect(workflowTemplates('v1')).toHaveLength(4);
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

  it('emit-audit depends on both agent jobs (and ci-gate on the review template)', () => {
    for (const tmpl of workflowTemplates('v1')) {
      // The review template adds the deterministic ci-gate job to the cc path,
      // so its emit-audit must also depend on ci-gate to surface the ci-red case.
      const expectedNeeds =
        tmpl.filename === 'ferry-review.yml'
          ? 'needs: [run-agent, run-agent-claude-code, ci-gate]'
          : 'needs: [run-agent, run-agent-claude-code]';
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

  it('claude-code-action receives an inlined prompt and claude_args', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: missing inlined prompt`).toContain('prompt: |');
      expect(tmpl.content, `${tmpl.filename}: missing claude_args block`).toContain(
        'claude_args: >-',
      );
    }
  });

  it('claude_args wires the ferry-jira-mcp MCP server', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: missing ferry-jira-mcp`).toContain('ferry-jira-mcp');
      expect(tmpl.content, `${tmpl.filename}: missing --permission-mode`).toContain(
        '--permission-mode acceptEdits',
      );
    }
  });

  it('claude_args --mcp-config pins the ferry-jira-mcp package to the templated version', () => {
    // ferry-init/ferry-update must template the version so the MCP server the
    // agent launches matches the workflow's pinned Ferry release.
    for (const tmpl of workflowTemplates('v0.14.0')) {
      expect(tmpl.content, `${tmpl.filename}: --mcp-config missing`).toContain('--mcp-config');
      expect(tmpl.content, `${tmpl.filename}: ferry-jira-mcp package not version-pinned`).toContain(
        '"@big-emotion/ferry@v0.14.0"',
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

describe('workflowTemplates — role-specific wiring', () => {
  it('ferry-dev.yml wires FERRY_REVIEW_TRANSITION_ID into the script-path run-agent (FR18)', () => {
    const dev = workflowTemplates('v1').find((t) => t.filename === 'ferry-dev.yml');
    expect(dev?.content).toContain(
      'ferry_review_transition_id: ${{ secrets.FERRY_REVIEW_TRANSITION_ID }}',
    );
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

  it('ferry-iterate.yml uses fetch-depth: 0 for the script-path checkout', () => {
    const iterate = workflowTemplates('v1').find((t) => t.filename === 'ferry-iterate.yml');
    const fetchDepthCount = (iterate?.content.match(/fetch-depth: 0/g) ?? []).length;
    expect(fetchDepthCount).toBe(1);
  });

  it('ferry-review.yml declares checks: read on run-agent and the ci-gate job', () => {
    const review = workflowTemplates('v1').find((t) => t.filename === 'ferry-review.yml');
    const checksCount = (review?.content.match(/checks: read/g) ?? []).length;
    expect(checksCount).toBe(2);
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
          ? "outcome: ${{ (needs.run-agent.result != 'skipped' && needs.run-agent.result) || (needs.run-agent-claude-code.result != 'skipped' && needs.run-agent-claude-code.result) || (needs.ci-gate.outputs.outcome == 'ci-red' && 'ci-red') || needs.run-agent-claude-code.result }}"
          : "outcome: ${{ needs.run-agent.result != 'skipped' && needs.run-agent.result || needs.run-agent-claude-code.result }}";
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
    expect(review!.content).toContain('needs: [run-agent, run-agent-claude-code, ci-gate]');
    expect(review!.content).toContain("needs.ci-gate.outputs.outcome == 'ci-red'");
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
