/**
 * Deterministic post-step for the claude-code execution path (ADR-0006 §2).
 *
 * Reads the `.ferry/cc-output.json` artifact written by `claude-code-action`,
 * validates it fail-closed, then applies the Jira-side audit + transition writes
 * (same effects the bundled script path produces in-process today).
 *
 * Fail-closed contract (decisions/0002 §B/§C):
 *   - Any schema violation in cc-output.json throws FerryError('state-invariant')
 *     carrying only AJV instance paths — never raw field values (NFR-S1, mirrors
 *     src/lib/envelope/validate.ts).
 *
 * Inputs (env):
 *   FERRY_ENVELOPE_PAYLOAD      JSON envelope from repository_dispatch
 *   FERRY_AGENT_ROLE            refiner | developer | reviewer | iterator
 *   FERRY_IDEMPOTENCY_MARKER    Marker string produced by cc-prepare
 *   FERRY_JIRA_BASE_URL / EMAIL / API_TOKEN
 *   FERRY_REVIEW_TRANSITION_ID  Jira transition ID for developer/iterator FR18/FR28
 *   FERRY_ITER_TRANSITION_ID    Jira transition ID for reviewer FR24 changes
 *   FERRY_APPROVE_TRANSITION_ID Jira transition ID for reviewer FR24 approve
 *   FERRY_PR_NUMBER             (reviewer) PR number for the current cycle
 *   FERRY_SUBTASK_COUNT         (refiner) sub-task count for noop message
 *   GITHUB_REPO                 owner/repo (e.g. acme/my-repo)
 *   GITHUB_RUN_ID               Current workflow run ID
 *   GITHUB_OUTPUT               GitHub Actions output file
 *
 * Outputs (written to GITHUB_OUTPUT):
 *   outcome        success | skipped | blocked
 *   input_tokens   0 (subscription path — no direct LLM call)
 *   output_tokens  0
 *   cost_eur       0
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateEnvelope } from '../envelope/validate.js';
import {
  validateAgentOutput,
  type AgentOutputRole,
  type AgentOutputV1,
} from '../cc-wrappers/agent-output.js';
import { decideContract, type ContractContext } from '../cc-wrappers/contract.js';
import { applyContract, type ApplyContractResult } from '../cc-wrappers/apply.js';
import { JiraRestClient } from '../io/jira-rest.js';
import { JiraTracker } from '../io/tracker/jira/tracker.js';
import { loadFerryConfig } from '../config.js';
import { resolveTicketOverrides } from '../labels/overrides.js';
import { countPriorIterations } from '../../agents/reviewer/changes-guard.js';
import { requireEnv } from '../agent-runtime/env.js';
import { CC_OUTPUT_ARTIFACT_PATH } from '../claude-code/output-artifact.js';
import type { IssueTracker } from '../io/tracker/types.js';
import { FerryError } from '../errors/index.js';

const VALID_ROLES = ['refiner', 'developer', 'reviewer', 'iterator'] as const;

function parseRole(raw: string | undefined): AgentOutputRole {
  if (!raw || !(VALID_ROLES as readonly string[]).includes(raw)) {
    process.stderr.write(
      `ferry-cc-apply: FERRY_AGENT_ROLE is invalid (got: ${raw ?? '(unset)'})\n`,
    );
    process.exit(1);
  }
  return raw as AgentOutputRole;
}

function writeOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    process.stdout.write(`${name}=${value}\n`);
    return;
  }
  appendFileSync(outputFile, `${name}=${value}\n`);
}

export interface ApplyCcArtifactParams {
  rawArtifact: unknown;
  role: AgentOutputRole;
  marker: string;
  existingComments: string[];
  gates: ContractContext['gates'];
  prUrl?: string;
  prNumber?: number;
  priorIterations?: number;
  cap?: number;
  runLink?: string;
  subtaskCount?: number;
  tracker: Pick<IssueTracker, 'postComment' | 'postTransition' | 'addLabel'>;
  ticketKey: string;
  dryRun?: boolean;
  getEnv?: (key: string) => string;
}

/**
 * Core apply logic: validates the artifact, computes the contract decision, then
 * runs the idempotency-gated Jira-side writes. Exported for unit testing.
 */
export async function applyCcArtifact(params: ApplyCcArtifactParams): Promise<ApplyContractResult> {
  const {
    rawArtifact,
    marker,
    existingComments,
    gates,
    prUrl,
    prNumber,
    priorIterations,
    cap,
    runLink,
    subtaskCount,
    tracker,
    ticketKey,
    dryRun,
    getEnv,
  } = params;

  // Validate against the v1 schema — fail-closed with AJV paths only (NFR-S1).
  const output: AgentOutputV1 = validateAgentOutput(rawArtifact);

  const ctx: ContractContext = {
    marker,
    gates,
    ...(prUrl !== undefined ? { prUrl } : {}),
    ...(prNumber !== undefined ? { prNumber } : {}),
    ...(priorIterations !== undefined ? { priorIterations } : {}),
    ...(cap !== undefined ? { cap } : {}),
    ...(runLink !== undefined ? { runLink } : {}),
    ...(subtaskCount !== undefined ? { subtaskCount } : {}),
  };

  const decision = decideContract(output, ctx);

  return applyContract({ tracker, ticketKey, marker, existingComments, decision, dryRun, getEnv });
}

export async function runCcApplyAction(): Promise<void> {
  // ── parse required env vars ───────────────────────────────────────────────
  const rawPayload = process.env.FERRY_ENVELOPE_PAYLOAD;
  if (!rawPayload) {
    process.stderr.write('ferry-cc-apply: FERRY_ENVELOPE_PAYLOAD is not set\n');
    process.exit(1);
  }
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawPayload);
  } catch {
    process.stderr.write('ferry-cc-apply: FERRY_ENVELOPE_PAYLOAD is not valid JSON\n');
    process.exit(1);
  }
  const envelope = validateEnvelope(parsedPayload);
  const role = parseRole(process.env.FERRY_AGENT_ROLE);

  const marker = process.env.FERRY_IDEMPOTENCY_MARKER;
  if (!marker) {
    process.stderr.write('ferry-cc-apply: FERRY_IDEMPOTENCY_MARKER is not set\n');
    process.exit(1);
  }

  // ── Jira client + issue fetch (labels + existing comments) ───────────────
  const jiraBaseUrl = requireEnv('FERRY_JIRA_BASE_URL');
  const jiraEmail = requireEnv('FERRY_JIRA_EMAIL');
  const jiraApiToken = requireEnv('FERRY_JIRA_API_TOKEN');
  const jira = new JiraRestClient(jiraBaseUrl, jiraEmail, jiraApiToken);
  const tracker = new JiraTracker(jira);

  const trackerIssue = await tracker.getIssue(envelope.ticket_key);
  const existingComments = trackerIssue.comments;

  // ── ticket overrides (noAutoTransition, dryRun) ───────────────────────────
  const config = loadFerryConfig(process.cwd());
  const overrides = resolveTicketOverrides(trackerIssue.labels);
  const noAutoTransition = overrides.noAutoTransition === true;
  const dryRun = overrides.dryRun === true;

  // ── compute per-role gates ────────────────────────────────────────────────
  const devWorkflow = config.workflow.agents.developer;
  const revWorkflow = config.workflow.agents.reviewer;
  const iterWorkflow = config.workflow.agents.iterator;

  const configDevAutoTransition = devWorkflow.auto_transition !== null;
  const configIterAutoTransition = iterWorkflow.auto_transition !== null;
  const configTransitionApprove = revWorkflow.auto_transition_approve !== null;
  const configTransitionChanges = revWorkflow.auto_transition_changes !== null;

  const roleAutoTransition =
    role === 'developer' ? configDevAutoTransition : configIterAutoTransition;

  const gates: ContractContext['gates'] = {
    shouldAutoTransition:
      (role === 'developer' || role === 'iterator') &&
      roleAutoTransition &&
      !noAutoTransition &&
      !dryRun,
    noAutoTransition,
    shouldTransitionApprove:
      role === 'reviewer' && configTransitionApprove && !noAutoTransition && !dryRun,
    shouldTransitionChanges:
      role === 'reviewer' && configTransitionChanges && !noAutoTransition && !dryRun,
  };

  // ── role-specific context fields ──────────────────────────────────────────
  const priorIterations =
    role === 'reviewer' || role === 'iterator' ? countPriorIterations(existingComments) : undefined;

  const cap = role === 'reviewer' ? config.limits.max_iterations : undefined;

  const githubRepo = process.env.GITHUB_REPO ?? 'unknown';
  const githubRunId = process.env.GITHUB_RUN_ID ?? '0';
  const runLink =
    role === 'refiner' ? `https://github.com/${githubRepo}/actions/runs/${githubRunId}` : undefined;

  const subtaskCount =
    role === 'refiner' ? parseInt(process.env.FERRY_SUBTASK_COUNT ?? '0', 10) || 0 : undefined;

  const prNumber =
    role === 'reviewer' || role === 'iterator'
      ? parseInt(process.env.FERRY_PR_NUMBER ?? '', 10) || undefined
      : undefined;

  // ── read + validate the cc-output.json artifact ───────────────────────────
  const artifactPath = join(process.cwd(), CC_OUTPUT_ARTIFACT_PATH);
  let rawArtifact: unknown;
  try {
    rawArtifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`ferry-cc-apply: failed to read ${CC_OUTPUT_ARTIFACT_PATH}: ${msg}\n`);
    process.exit(1);
  }

  // ── apply ─────────────────────────────────────────────────────────────────
  let result: ApplyContractResult;
  try {
    result = await applyCcArtifact({
      rawArtifact,
      role,
      marker,
      existingComments,
      gates,
      prNumber,
      priorIterations,
      cap,
      runLink,
      subtaskCount,
      tracker,
      ticketKey: envelope.ticket_key,
      dryRun,
    });
  } catch (err) {
    if (err instanceof FerryError && err.context?.reason === 'agent-output-invalid') {
      const paths = Array.isArray(err.context.paths) ? (err.context.paths as string[]) : [];
      process.stderr.write(
        `ferry-cc-apply: invalid ${CC_OUTPUT_ARTIFACT_PATH} — ${paths.join(', ')}\n`,
      );
      process.exit(1);
    }
    throw err;
  }

  // ── write GITHUB_OUTPUT ───────────────────────────────────────────────────
  const outcome = result.skipped ? 'skipped' : result.exitCode === 1 ? 'blocked' : 'success';
  writeOutput('outcome', outcome);
  writeOutput('input_tokens', '0');
  writeOutput('output_tokens', '0');
  writeOutput('cost_eur', '0');

  process.exit(result.exitCode);
}

// Auto-invoke when this module is the process entrypoint.
const invokedDirectly =
  typeof process !== 'undefined' && process.argv[1]?.endsWith('cc-apply-action.js');
if (invokedDirectly) {
  void runCcApplyAction().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`ferry-cc-apply: ${msg}\n`);
    process.exit(1);
  });
}
