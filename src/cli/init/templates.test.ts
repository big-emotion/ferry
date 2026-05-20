import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { workflowTemplates } from './templates.js';

const AGENT_FILES = ['ferry-refine.yml', 'ferry-dev.yml', 'ferry-review.yml', 'ferry-iterate.yml'];

// Validates that a rendered template is structurally sound YAML for GitHub Actions:
// - Uses only spaces, no tabs (YAML is space-sensitive)
// - All ${{ expressions are closed with }}
// - No bare TypeScript-style ${...} interpolation escaped as single-brace
// - Top-level keys (name, on, jobs) are present and unindented
function assertValidWorkflowYaml(content: string, filename: string): void {
  // No tabs — YAML indentation must use spaces
  expect(content, `${filename}: tabs found (YAML must use spaces)`).not.toMatch(/\t/);

  // All GitHub Actions ${{ expressions must be closed
  const openCount = (content.match(/\$\{\{/g) ?? []).length;
  const closeCount = (content.match(/\}\}/g) ?? []).length;
  expect(openCount, `${filename}: unmatched \${{ expressions`).toBeGreaterThan(0);
  expect(closeCount, `${filename}: unmatched }} closers`).toBeGreaterThan(0);
  // Allow for }} used in jinja-style contexts; just ensure we have at least as many closes
  expect(closeCount, `${filename}: more opens than closes`).toBeGreaterThanOrEqual(openCount);

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
    for (const tmpl of workflowTemplates('v0.12.0')) {
      expect(tmpl.content).toContain('@v0.12.0');
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

  it('emit-audit depends on both run-agent and run-agent-claude-code', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: emit-audit missing dual dependency`).toContain(
        'needs: [run-agent, run-agent-claude-code]',
      );
      // emit-audit must run even when one path is skipped
      expect(tmpl.content, `${tmpl.filename}: emit-audit missing always() guard`).toContain(
        'if: always() &&',
      );
    }
  });
});

describe('workflowTemplates — claude-code path four-step chain', () => {
  it('run-agent-claude-code contains all four steps in order', () => {
    for (const tmpl of workflowTemplates('v1')) {
      const content = tmpl.content;
      const prepareIdx = content.indexOf('ferry-cc-prepare');
      // Match by action ref (not the version pin) so SHA-pinning the action doesn't
      // require touching this ordering test.
      const actionIdx = content.indexOf('anthropics/claude-code-action@');
      const applyIdx = content.indexOf('ferry-cc-apply');

      expect(prepareIdx, `${tmpl.filename}: missing ferry-cc-prepare`).toBeGreaterThan(-1);
      expect(actionIdx, `${tmpl.filename}: missing anthropics/claude-code-action`).toBeGreaterThan(
        -1,
      );
      expect(applyIdx, `${tmpl.filename}: missing ferry-cc-apply`).toBeGreaterThan(-1);
      expect(
        prepareIdx,
        `${tmpl.filename}: cc-prepare must precede claude-code-action`,
      ).toBeLessThan(actionIdx);
      expect(actionIdx, `${tmpl.filename}: claude-code-action must precede cc-apply`).toBeLessThan(
        applyIdx,
      );
    }
  });

  it('cc-prepare receives the CLAUDE_CODE_OAUTH_TOKEN input', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(
        tmpl.content,
        `${tmpl.filename}: missing claude_code_oauth_token in cc-prepare`,
      ).toContain('claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}');
    }
  });

  it('claude-code-action receives prompt and claude_args from cc-prepare outputs', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: missing prompt wiring`).toContain(
        'prompt: ${{ steps.cc-prepare.outputs.prompt }}',
      );
      expect(tmpl.content, `${tmpl.filename}: missing claude_args wiring`).toContain(
        'claude_args: ${{ steps.cc-prepare.outputs.claude_args }}',
      );
    }
  });

  it('cc-apply receives idempotency_marker from cc-prepare output', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: missing idempotency_marker wiring`).toContain(
        'idempotency_marker: ${{ steps.cc-prepare.outputs.idempotency_marker }}',
      );
    }
  });

  it('run-agent-claude-code exposes cost outputs for emit-audit', () => {
    for (const tmpl of workflowTemplates('v1')) {
      expect(tmpl.content, `${tmpl.filename}: missing input_tokens output`).toContain(
        'input_tokens: ${{ steps.cc-apply.outputs.input_tokens }}',
      );
      expect(tmpl.content, `${tmpl.filename}: missing output_tokens output`).toContain(
        'output_tokens: ${{ steps.cc-apply.outputs.output_tokens }}',
      );
      expect(tmpl.content, `${tmpl.filename}: missing cost_eur output`).toContain(
        'cost_eur: ${{ steps.cc-apply.outputs.cost_eur }}',
      );
    }
  });
});

describe('workflowTemplates — role-specific wiring', () => {
  it('ferry-dev.yml wires FERRY_REVIEW_TRANSITION_ID into cc-apply (FR18)', () => {
    const dev = workflowTemplates('v1').find((t) => t.filename === 'ferry-dev.yml');
    expect(dev?.content).toContain(
      'ferry_review_transition_id: ${{ secrets.FERRY_REVIEW_TRANSITION_ID }}',
    );
  });

  it('ferry-review.yml wires FERRY_ITER_TRANSITION_ID into cc-apply (FR24 changes)', () => {
    const review = workflowTemplates('v1').find((t) => t.filename === 'ferry-review.yml');
    expect(review?.content).toContain(
      'ferry_iter_transition_id: ${{ secrets.FERRY_ITER_TRANSITION_ID }}',
    );
  });

  it('ferry-review.yml wires FERRY_APPROVE_TRANSITION_ID into cc-apply (FR24 approve)', () => {
    const review = workflowTemplates('v1').find((t) => t.filename === 'ferry-review.yml');
    expect(review?.content).toContain(
      'ferry_approve_transition_id: ${{ secrets.FERRY_APPROVE_TRANSITION_ID }}',
    );
  });

  it('ferry-iterate.yml wires FERRY_REVIEW_TRANSITION_ID into cc-apply (FR28)', () => {
    const iterate = workflowTemplates('v1').find((t) => t.filename === 'ferry-iterate.yml');
    expect(iterate?.content).toContain(
      'ferry_review_transition_id: ${{ secrets.FERRY_REVIEW_TRANSITION_ID }}',
    );
  });

  it('ferry-iterate.yml uses fetch-depth: 0 for both script and cc path checkouts', () => {
    const iterate = workflowTemplates('v1').find((t) => t.filename === 'ferry-iterate.yml');
    const fetchDepthCount = (iterate?.content.match(/fetch-depth: 0/g) ?? []).length;
    expect(fetchDepthCount).toBe(2);
  });

  it('ferry-review.yml declares checks: read permission on both run-agent jobs', () => {
    const review = workflowTemplates('v1').find((t) => t.filename === 'ferry-review.yml');
    const checksCount = (review?.content.match(/checks: read/g) ?? []).length;
    expect(checksCount).toBe(2);
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
      expect(
        tmpl.content,
        `${tmpl.filename}: outcome ternary missing != 'skipped' shape`,
      ).toContain(
        "outcome: ${{ needs.run-agent.result != 'skipped' && needs.run-agent.result || needs.run-agent-claude-code.result }}",
      );
    }
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
