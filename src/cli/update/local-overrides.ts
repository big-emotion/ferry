import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowEntry } from '../init/types.js';

const _require = createRequire(import.meta.url);

export interface LocalOverridesReview {
  /**
   * When set to `"disabled"`, the `ci-gate` pre-gate job is omitted — from
   * `ferry-review.yml` on legacy installs and from `ferry-router.yml` on the
   * router model — and all references to its outputs are removed. This makes
   * the Reviewer agent run unconditionally on the claude-code path, without
   * waiting for CI to go green or a PR to exist — useful when the review
   * event can fire before CI has reported.
   */
  ciGate?: 'disabled';
}

export interface LocalOverridesGlobal {
  /**
   * Pin the GitHub Actions runner across all Ferry workflow files.
   * Accepts a plain string (e.g. `ubuntu-latest`) or an array of runner
   * labels (e.g. `["self-hosted", "X64"]`).
   *
   * When set, this replaces the `${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}`
   * expression so the runner is explicit in the generated file rather than
   * driven by a repo variable.
   */
  runner?: string | string[];
}

export interface LocalOverrides {
  version?: number;
  review?: LocalOverridesReview;
  global?: LocalOverridesGlobal;
}

const LOCAL_OVERRIDES_FILE = 'ferry.local.yml';

export function loadLocalOverrides(repoRoot: string): LocalOverrides | null {
  const filePath = join(repoRoot, LOCAL_OVERRIDES_FILE);
  if (!existsSync(filePath)) return null;

  const raw = readFileSync(filePath, 'utf8');

  let parsed: unknown;
  try {
    const yaml = _require('yaml') as { parse: (s: string) => unknown };
    parsed = yaml.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${LOCAL_OVERRIDES_FILE}: failed to parse YAML — ${msg}`);
  }

  const result = validateLocalOverrides(parsed);
  if (!result.valid) {
    throw new Error(`${LOCAL_OVERRIDES_FILE}: ${result.errors.join('; ')}`);
  }

  return result.value;
}

type ValidationResult = { valid: true; value: LocalOverrides } | { valid: false; errors: string[] };

export function validateLocalOverrides(raw: unknown): ValidationResult {
  if (raw === null || raw === undefined) {
    return { valid: true, value: {} };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['must be a YAML mapping'] };
  }

  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];

  if (obj.version !== undefined && obj.version !== 1) {
    errors.push(`version: must be 1 (got ${String(obj.version)})`);
  }

  if (obj.review !== undefined) {
    if (!obj.review || typeof obj.review !== 'object' || Array.isArray(obj.review)) {
      errors.push('review: must be a mapping');
    } else {
      const review = obj.review as Record<string, unknown>;
      if (review.ciGate !== undefined && review.ciGate !== 'disabled') {
        errors.push(`review.ciGate: must be "disabled" (got ${String(review.ciGate)})`);
      }
    }
  }

  if (obj.global !== undefined) {
    if (!obj.global || typeof obj.global !== 'object' || Array.isArray(obj.global)) {
      errors.push('global: must be a mapping');
    } else {
      const global = obj.global as Record<string, unknown>;
      if (global.runner !== undefined) {
        if (typeof global.runner === 'string') {
          if (global.runner.trim() === '') {
            errors.push('global.runner: must be a non-empty string');
          }
        } else if (Array.isArray(global.runner)) {
          if (global.runner.length === 0) {
            errors.push('global.runner: array must not be empty');
          } else if (global.runner.some((r) => typeof r !== 'string' || r.trim() === '')) {
            errors.push('global.runner: array elements must be non-empty strings');
          }
        } else {
          errors.push('global.runner: must be a string or array of strings');
        }
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  const value: LocalOverrides = {};

  if (typeof obj.version === 'number') value.version = obj.version;

  if (obj.review && typeof obj.review === 'object' && !Array.isArray(obj.review)) {
    const review = obj.review as Record<string, unknown>;
    const r: LocalOverridesReview = {};
    if (review.ciGate === 'disabled') r.ciGate = 'disabled';
    if (Object.keys(r).length > 0) value.review = r;
  }

  if (obj.global && typeof obj.global === 'object' && !Array.isArray(obj.global)) {
    const global = obj.global as Record<string, unknown>;
    const g: LocalOverridesGlobal = {};
    if (global.runner !== undefined) {
      g.runner = global.runner as string | string[];
    }
    if (Object.keys(g).length > 0) value.global = g;
  }

  return { valid: true, value };
}

export function applyLocalOverrides(
  templates: WorkflowEntry[],
  overrides: LocalOverrides,
): WorkflowEntry[] {
  return templates.map((tmpl) => {
    let content = tmpl.content;

    if (overrides.global?.runner !== undefined) {
      content = applyGlobalRunner(content, overrides.global.runner);
    }

    if (overrides.review?.ciGate === 'disabled') {
      if (tmpl.filename === 'ferry-review.yml') content = applyReviewCiGateDisabled(content);
      if (tmpl.filename === 'ferry-router.yml') content = applyRouterCiGateDisabled(content);
    }

    return { filename: tmpl.filename, content };
  });
}

// The expression used in every template for the runner.
const RUNNER_EXPR = `\${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}`;

function formatRunner(runner: string | string[]): string {
  if (typeof runner === 'string') return runner;
  return `\${{ fromJSON('${JSON.stringify(runner)}') }}`;
}

function applyGlobalRunner(content: string, runner: string | string[]): string {
  return content.replaceAll(
    `    runs-on: ${RUNNER_EXPR}\n`,
    `    runs-on: ${formatRunner(runner)}\n`,
  );
}

/**
 * Remove the `ci-gate` job from `ferry-review.yml` and rewrite all
 * downstream `needs:`/`if:`/`outcome:` expressions that referenced it.
 *
 * The regex targets the stable structural markers in the template; the
 * `ferry-ci-gate@<version>` reference inside the job body is version-variable
 * but is entirely removed as part of the block, so no version-aware logic is
 * needed here.
 */
function applyReviewCiGateDisabled(content: string): string {
  // 1. Remove the ci-gate job block.
  //    Match from the blank-line separator before "  ci-gate:" up to (but
  //    not including) the blank-line separator before "  run-agent-claude-code:".
  let result = content.replace(/\n\n  ci-gate:\n[\s\S]*?(?=\n\n  run-agent-claude-code:)/, '');

  // 2. direct-action jobs: remove ci-gate from needs
  result = result.replaceAll('    needs: [route, ci-gate]\n', '    needs: [route]\n');

  // 3. direct-action jobs: drop the ci-gate proceed guard from if
  result = result.replace(
    "    if: needs.route.outputs.path == 'claude-code' && needs.ci-gate.outputs.proceed == 'true'\n",
    "    if: needs.route.outputs.path == 'claude-code'\n",
  );
  result = result.replace(
    "    if: needs.route.outputs.path == 'codex-cli' && needs.ci-gate.outputs.proceed == 'true'\n",
    "    if: needs.route.outputs.path == 'codex-cli'\n",
  );

  // 4. emit-audit: remove ci-gate from needs
  result = result.replace(
    '    needs: [run-agent, run-agent-claude-code, run-agent-codex-cli, ci-gate]\n',
    '    needs: [run-agent, run-agent-claude-code, run-agent-codex-cli]\n',
  );

  // 5. emit-audit: simplify the if expression
  result = result.replace(
    "    if: always() && (needs.run-agent.result != 'skipped' || needs.run-agent-claude-code.result != 'skipped' || needs.run-agent-codex-cli.result != 'skipped' || (needs.ci-gate.result != 'skipped' && needs.ci-gate.outputs.outcome == 'ci-red'))\n",
    "    if: always() && (needs.run-agent.result != 'skipped' || needs.run-agent-claude-code.result != 'skipped' || needs.run-agent-codex-cli.result != 'skipped')\n",
  );

  // 6. emit-audit outcome: remove ci-gate references from the outcome expression
  result = result.replace(
    "          outcome: ${{ (needs.run-agent.result != 'skipped' && needs.run-agent.result) || (needs.run-agent-claude-code.result != 'skipped' && needs.run-agent-claude-code.result) || (needs.run-agent-codex-cli.result != 'skipped' && needs.run-agent-codex-cli.result) || (needs.ci-gate.outputs.outcome == 'ci-red' && 'ci-red') || needs.run-agent-codex-cli.result || needs.run-agent-claude-code.result }}\n",
    "          outcome: ${{ (needs.run-agent.result != 'skipped' && needs.run-agent.result) || (needs.run-agent-claude-code.result != 'skipped' && needs.run-agent-claude-code.result) || needs.run-agent-codex-cli.result }}\n",
  );

  return result;
}

/**
 * Router variant of the ci-gate removal for `ferry-router.yml`. Unlike the
 * legacy review stub, the router hosts a single `run-agent` job for every
 * role, so disabling the gate rewrites the role-conditional guard on that one
 * job (and the audit job's ci-red short-circuit) instead of per-path jobs.
 * Every replacement targets exact template text, so a second application is a
 * no-op (idempotent).
 */
function applyRouterCiGateDisabled(content: string): string {
  // 1. Remove the ci-gate job block, including its leading explainer comment.
  let result = content.replace(/\n\n  # Reviewer CI pre-gate:[\s\S]*?(?=\n\n  run-agent:)/, '');

  // 2. run-agent: drop ci-gate from needs and the reviewer proceed guard from
  //    if. Without ci-gate in needs, the !cancelled() skip-eligibility escape
  //    (and its comment) is no longer needed.
  result = result.replace(
    '    needs: [route, ci-gate]\n' +
      '    # !cancelled() keeps this job eligible when ci-gate is skipped (non-reviewer roles).\n' +
      '    if: >-\n' +
      "      !cancelled() && needs.route.outputs.path == 'claude-code' &&\n" +
      "      needs.route.outputs.role != 'none' &&\n" +
      "      (needs.route.outputs.role != 'reviewer' || needs.ci-gate.outputs.proceed == 'true')\n",
    '    needs: [route]\n' +
      '    if: >-\n' +
      "      needs.route.outputs.path == 'claude-code' &&\n" +
      "      needs.route.outputs.role != 'none'\n",
  );

  // 3. emit-audit: drop ci-gate from needs and the ci-red short-circuit from if.
  result = result.replace(
    '    needs: [route, ci-gate, run-agent]\n' +
      '    if: >-\n' +
      "      !cancelled() && needs.route.outputs.role != 'none' &&\n" +
      "      (needs.run-agent.result != 'skipped' || (needs.ci-gate.result != 'skipped' && needs.ci-gate.outputs.outcome == 'ci-red'))\n",
    '    needs: [route, run-agent]\n' +
      '    if: >-\n' +
      "      !cancelled() && needs.route.outputs.role != 'none' &&\n" +
      "      needs.run-agent.result != 'skipped'\n",
  );

  // 4. emit-audit outcome: without the gate, the agent result is the only source.
  result = result.replace(
    "          outcome: ${{ (needs.ci-gate.result != 'skipped' && needs.ci-gate.outputs.outcome == 'ci-red' && 'ci-red') || needs.run-agent.result }}\n",
    '          outcome: ${{ needs.run-agent.result }}\n',
  );

  return result;
}
