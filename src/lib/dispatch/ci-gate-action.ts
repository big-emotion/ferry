/**
 * Reviewer CI pre-gate bundled action (Phase 2).
 *
 * Runs before the reviewer's `claude-code-action` job. It resolves the PR for
 * the ticket branch, reads its CI check-runs via the GitHub API, maps them into
 * a deterministic `CiStatus`, and feeds that into the pure `gateCi()` resolver
 * shared with the script-path reviewer. The decision is exposed to the wrapping
 * workflow via `$GITHUB_OUTPUT`.
 *
 * Inputs (env):
 *   - GITHUB_TOKEN / FERRY_GITHUB_TOKEN   GitHub token (Octokit auth)
 *   - FERRY_GITHUB_REPO                   owner/repo slug
 *   - FERRY_TICKET_KEY                    Jira ticket key (drives the branch name)
 *   - FERRY_PR_BRANCH                     PR head branch (optional; defaults to ferry/<ticket>)
 *   - FERRY_PR_NUMBER                     PR number (optional; resolved from the branch when absent)
 *   - GITHUB_OUTPUT                       GitHub Actions output file (set by the runner)
 *
 * Outputs (written to GITHUB_OUTPUT):
 *   - proceed          'true' | 'false'  — whether the reviewer job should run
 *   - outcome          'pending-ci' | 'ci-red' | 'ci-green'
 *   - failure_summary  short human summary when CI is red; '' otherwise
 */
import { appendFileSync } from 'node:fs';

import { Octokit } from '@octokit/rest';

import { gateCi, type CiStatus } from '../../agents/reviewer/ci-gate.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('', 'ferry:ci-gate');

/** A single GitHub check-run, reduced to the two fields the mapping needs. */
export interface CheckRun {
  status: string | null;
  conclusion: string | null;
}

/**
 * Pure mapping from a PR's check-runs to a deterministic `CiStatus`.
 *
 * - No check-runs at all → 'pending' (CI has not reported yet; do not review).
 * - Any run not `completed` → 'pending'.
 * - Any completed run with a failing conclusion → 'red'.
 * - Otherwise → 'green'.
 *
 * `failure` / `timed_out` / `cancelled` / `action_required` / `stale` are all
 * treated as red — a reviewer must not approve over an unresolved check.
 */
export function mapCheckRunsToStatus(runs: CheckRun[]): CiStatus {
  if (runs.length === 0) return 'pending';
  if (runs.some((r) => r.status !== 'completed')) return 'pending';
  const failing = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'stale']);
  if (runs.some((r) => r.conclusion !== null && failing.has(r.conclusion))) return 'red';
  return 'green';
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    logger.error(`${name} is not set`);
    process.exit(1);
  }
  return v;
}

function writeOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    process.stdout.write(`${name}=${value}\n`);
    return;
  }
  // Multi-line-safe heredoc form: failure_summary may contain newlines.
  const delimiter = `__ferry_ci_gate_${name}__`;
  appendFileSync(outputFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

function parseRepo(slug: string): { owner: string; repo: string } {
  const [owner, repo] = slug.split('/');
  if (!owner || !repo) {
    logger.error('FERRY_GITHUB_REPO must be in owner/repo form', { got: slug });
    process.exit(1);
  }
  return { owner, repo };
}

export interface CiGateActionResult {
  proceed: boolean;
  outcome: 'pending-ci' | 'ci-red' | 'ci-green';
  failureSummary: string;
}

export async function runCiGateAction(): Promise<CiGateActionResult> {
  const token = process.env.GITHUB_TOKEN || requireEnv('FERRY_GITHUB_TOKEN');
  const { owner, repo } = parseRepo(requireEnv('FERRY_GITHUB_REPO'));
  const ticketKey = requireEnv('FERRY_TICKET_KEY');
  const branch = process.env.FERRY_PR_BRANCH || `ferry/${ticketKey}`;

  const octokit = new Octokit({ auth: token });

  // Resolve the PR head SHA — either from the explicit PR number or by listing
  // open PRs for the ticket branch.
  let headSha: string;
  const explicitPrNumber = process.env.FERRY_PR_NUMBER;
  if (explicitPrNumber && explicitPrNumber.trim() !== '') {
    const { data } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: Number(explicitPrNumber),
    });
    headSha = data.head.sha;
  } else {
    const { data } = await octokit.pulls.list({
      owner,
      repo,
      state: 'open',
      head: `${owner}:${branch}`,
      per_page: 1,
    });
    if (data.length === 0) {
      // No PR yet — CI has nothing to report. Treat as pending: do not review.
      logger.warn('no open PR found for branch; treating CI as pending', { branch });
      const outcome = gateCi({ status: 'pending' });
      writeOutput('proceed', String(outcome.proceed));
      writeOutput('outcome', outcome.outcome);
      writeOutput('failure_summary', '');
      return { proceed: outcome.proceed, outcome: outcome.outcome, failureSummary: '' };
    }
    headSha = data[0].head.sha;
  }

  const { data: checks } = await octokit.checks.listForRef({
    owner,
    repo,
    ref: headSha,
    per_page: 100,
  });
  const runs: CheckRun[] = checks.check_runs.map((r) => ({
    status: r.status,
    conclusion: r.conclusion,
  }));
  const status = mapCheckRunsToStatus(runs);

  let failureSummary = '';
  if (status === 'red') {
    const failed = checks.check_runs
      .filter(
        (r) =>
          r.conclusion !== null &&
          r.conclusion !== 'success' &&
          r.conclusion !== 'neutral' &&
          r.conclusion !== 'skipped',
      )
      .map((r) => `- ${r.name}: ${r.conclusion}`);
    failureSummary = `CI checks failed for this PR:\n${failed.join('\n')}`;
  }

  const decision = gateCi({ status, failure_summary: failureSummary });

  writeOutput('proceed', String(decision.proceed));
  writeOutput('outcome', decision.outcome);
  writeOutput('failure_summary', decision.outcome === 'ci-red' ? failureSummary : '');

  process.stdout.write(
    `ferry-ci-gate: ticket=${ticketKey} branch=${branch} status=${status} outcome=${decision.outcome} proceed=${decision.proceed}\n`,
  );

  return {
    proceed: decision.proceed,
    outcome: decision.outcome,
    failureSummary: decision.outcome === 'ci-red' ? failureSummary : '',
  };
}

// Auto-invoke when this module is the process entrypoint.
const invokedDirectly =
  typeof process !== 'undefined' && process.argv[1]?.endsWith('ci-gate-action.js');
if (invokedDirectly) {
  void runCiGateAction().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`ferry-ci-gate: ${msg}\n`);
    process.exit(1);
  });
}
