/**
 * Front-half loader for the claude-code execution path (ADR-0006 §2, issue #331).
 *
 * Runs BEFORE `anthropics/claude-code-action@v1` in the consumer workflow. Reads
 * the envelope + ferry config + Jira issue, runs the per-role prepare function
 * (issue #330), then calls `buildClaudeCodeJob` to produce the deterministic
 * inputs `claude-code-action` consumes (`prompt`, `claude_args`, …). The Jira
 * audit + transition writes happen AFTER the action, in `ferry-cc-apply` (#332).
 *
 * Structural invariants enforced here (defense-in-depth — the routing resolver
 * #329 already gates these, but cc-prepare refuses to run if those gates were
 * somehow bypassed):
 *
 *   1. ADR-0006 §6 — `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` are
 *      mutually exclusive. If both are present the composite throws.
 *   2. ADR-0006 §1 / #329 — every configured agent provider must be
 *      `anthropic`. A single non-anthropic provider blocks the path.
 *   3. `CLAUDE_CODE_OAUTH_TOKEN` is *passed through for downstream visibility*
 *      only; its value is NEVER written to stdout, stderr, or `$GITHUB_OUTPUT`.
 *      Tests assert this end-to-end.
 *
 * Outputs (written to `$GITHUB_OUTPUT`, all JSON-encoded except scalars):
 *   - `prompt`                 → action `prompt:` input (verbatim + transport suffix)
 *   - `claude_args`            → JSON array of CLI tokens for `claude_args:`
 *   - `allowed_native_tools`   → JSON array of role-permitted native tool names
 *   - `output_artifact_path`   → fixed `.ferry/cc-output.json`
 *   - `mcp_config`             → JSON-encoded `{ mcpServers: {...} }` for `--mcp-config`
 *   - `idempotency_marker`     → `[ferry:<role>:<key>]` for `ferry-cc-apply` to consume
 *
 * Inputs (env):
 *   FERRY_ENVELOPE_PAYLOAD      JSON envelope from repository_dispatch
 *   FERRY_AGENT_ROLE            refiner | developer | reviewer | iterator
 *   FERRY_JIRA_BASE_URL / EMAIL / API_TOKEN
 *   GITHUB_REPO                 owner/repo (e.g. acme/my-repo)
 *   GITHUB_RUN_ID               (refiner only) used for the run link
 *   GITHUB_OUTPUT               GitHub Actions output file
 *   ANTHROPIC_API_KEY           NOT permitted alongside CLAUDE_CODE_OAUTH_TOKEN
 *   CLAUDE_CODE_OAUTH_TOKEN     forwarded by the composite, never logged
 */
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import { validateEnvelope } from '../envelope/validate.js';
import { loadFerryConfig, type FerryConfig } from '../config.js';
import { resolveTicketOverrides, applyTicketOverrides } from '../labels/overrides.js';
import { isAnthropicOnlyConfig } from '../cc-wrappers/routing.js';
import { JiraRestClient } from '../io/jira-rest.js';
import { JiraTracker } from '../io/tracker/jira/tracker.js';
import {
  prepareDeveloper,
  type PrepareDeveloperInput,
  type DeveloperPreparedContext,
} from '../agent-runtime/developer-prepare.js';
import {
  prepareReviewer,
  type PrepareReviewerInput,
  type ReviewerPreparedContext,
} from '../agent-runtime/reviewer-prepare.js';
import {
  prepareIterator,
  type PrepareIteratorInput,
  type IteratorPreparedContext,
} from '../agent-runtime/iterator-prepare.js';
import { prepareRefiner, type RefinerPreparedContext } from '../agent-runtime/refiner-prepare.js';
import { InMemoryTracker } from '../io/tracker/in-memory.js';
import { buildSystem } from '../agent-runtime/prompt.js';
import { buildRefinerPrompt } from '../../agents/refiner/refine.js';
import {
  buildClaudeCodeJob,
  CLAUDE_CODE_AUTH_INPUT,
  FORBIDDEN_AUTH_INPUT,
} from '../claude-code/job.js';
import { toClaudeCodeMcpConfig, type ClaudeCodeMcpConfig } from '../claude-code/mcp-config.js';
import { byPrHeadSha, byEventId } from '../agent-runtime/idempotency.js';
import { createLogger, type Logger } from '../logger/index.js';
import type { EventEnvelopeV1 } from '../envelope/types.js';
import type { TrackerIssue, IssueTracker } from '../io/tracker/types.js';
import type { CIRunner } from './runner/types.js';
import type { FerryRole } from '../claude-code/tool-profiles.js';

const VALID_ROLES: readonly FerryRole[] = ['refiner', 'developer', 'reviewer', 'iterator'];

// ──────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────

/** Stable shape of the outputs the composite writes to `$GITHUB_OUTPUT`. */
export interface CcPrepareOutputs {
  prompt: string;
  claudeArgs: string[];
  allowedNativeTools: string[];
  outputArtifactPath: string;
  mcpConfig: ClaudeCodeMcpConfig;
  idempotencyMarker: string;
}

/**
 * Role-tagged discriminated union of the per-role pre-resolved inputs the
 * prepare functions need. The composite assembles these from env + Jira + git;
 * tests construct them directly to assert byte-stable outputs.
 *
 * Test seams (`_buildSystem`, `_checkoutOrCreateBranch`, `_runner`, …) mirror
 * the seams the underlying `prepareXxx` functions already accept, so the
 * composite is fully unit-testable without spinning up git/GitHub.
 */
export type RoleSpecificInput =
  | DeveloperRoleInput
  | ReviewerRoleInput
  | IteratorRoleInput
  | RefinerRoleInput;

export interface DeveloperRoleInput {
  role: 'developer';
  effectiveCfg: FerryConfig;
  subtasks: string[];
  testRunner: string;
  pkgManagerHint: string | null | undefined;
  tree: string;
  typeOverride: string | undefined;
  owner: string;
  repo: string;
  baseBranch: string;
  mcpPool: PrepareDeveloperInput['mcpPool'];
  dryRun: boolean;
  repoRoot?: string;
  _runner?: Pick<CIRunner, 'listPRsForBranch' | 'listPRFiles'>;
  _checkoutOrCreateBranch?: PrepareDeveloperInput['_checkoutOrCreateBranch'];
  _configureGitUser?: PrepareDeveloperInput['_configureGitUser'];
  _buildSystem?: PrepareDeveloperInput['_buildSystem'];
}

export interface ReviewerRoleInput {
  role: 'reviewer';
  effectiveCfg: FerryConfig;
  pr: PrepareReviewerInput['pr'];
  files: PrepareReviewerInput['files'];
  commits: PrepareReviewerInput['commits'];
  branchName: string;
  typeOverride: string | undefined;
  reviewRubric: PrepareReviewerInput['reviewRubric'];
  capabilities: PrepareReviewerInput['capabilities'];
  repoRoot: string;
  _buildSystem?: PrepareReviewerInput['_buildSystem'];
  _loadOptionalPrompt?: PrepareReviewerInput['_loadOptionalPrompt'];
}

export interface IteratorRoleInput {
  role: 'iterator';
  effectiveCfg: FerryConfig;
  headSha: string;
  reviewComment: string;
  mergeConflicts: string[];
  existingLog: string;
  mcpPool: PrepareIteratorInput['mcpPool'];
  configLabels: PrepareIteratorInput['configLabels'];
  capabilities: PrepareIteratorInput['capabilities'];
  typeOverride: string | undefined;
  repoRoot: string;
  _buildSystem?: PrepareIteratorInput['_buildSystem'];
}

export interface RefinerRoleInput {
  role: 'refiner';
  effectiveCfg: FerryConfig;
  existingSubtasks: RefinerPreparedContext['existingSubtasks'];
  priorRefinerRuns: RefinerPreparedContext['priorRefinerRuns'];
  runLink: string;
  repoRoot: string;
  _buildSystem?: typeof buildSystem;
}

export interface PrepareCcJobInput {
  envelope: EventEnvelopeV1;
  issue: TrackerIssue;
  role: FerryRole;
  input: RoleSpecificInput;
}

// ──────────────────────────────────────────────────────────────────────────
// Core (testable) — runs all four prepare functions and calls buildClaudeCodeJob
// ──────────────────────────────────────────────────────────────────────────

/**
 * Core: given a role + already-resolved upstream state, returns the byte-stable
 * outputs the composite writes. Pure aside from the prepare functions' git ops
 * (which accept test seams).
 *
 * Provider gate is re-checked here so library callers (not just the composite)
 * cannot accidentally invoke the path on a mixed-provider config.
 */
export async function prepareCcJob(input: PrepareCcJobInput): Promise<CcPrepareOutputs> {
  const { envelope, issue, role } = input;

  // Defense-in-depth: the routing resolver (#329) already enforces this, but
  // a library caller bypassing the route step would otherwise build a job for
  // a non-Anthropic provider with no LLM-routing — fail closed.
  if (!isAnthropicOnlyConfig(input.input.effectiveCfg)) {
    throw new Error(
      'cc-prepare: refusing to build a claude-code job — ferry.config is not anthropic-only ' +
        '(every agent provider must be `anthropic`; see ADR-0006 §1, issue #329).',
    );
  }

  // Build the per-role system + initialPrompt + mcpServers + idempotency marker.
  let system: string;
  let initialPrompt: string;
  let mcpServers: PrepareDeveloperInput['mcpPool'];
  let idempotencyMarker: string;
  let model: string | undefined;

  switch (role) {
    case 'developer': {
      assertRoleInput(input.input, 'developer');
      const ri = input.input;
      const ctx = await prepareDeveloper({
        envelope,
        issue,
        effectiveCfg: ri.effectiveCfg,
        subtasks: ri.subtasks,
        testRunner: ri.testRunner,
        pkgManagerHint: ri.pkgManagerHint,
        tree: ri.tree,
        typeOverride: ri.typeOverride,
        owner: ri.owner,
        repo: ri.repo,
        baseBranch: ri.baseBranch,
        runner: (ri._runner ?? throwMissing('developer._runner')) as CIRunner,
        mcpPool: ri.mcpPool,
        repoRoot: ri.repoRoot ?? process.cwd(),
        dryRun: ri.dryRun,
        logger: createLogger(envelope.event_id, 'ferry:cc-prepare'),
        ...(ri._buildSystem ? { _buildSystem: ri._buildSystem } : {}),
        ...(ri._checkoutOrCreateBranch
          ? { _checkoutOrCreateBranch: ri._checkoutOrCreateBranch }
          : {}),
        ...(ri._configureGitUser ? { _configureGitUser: ri._configureGitUser } : {}),
      });
      ({ system, initialPrompt, mcpServers, idempotencyMarker } = pickPrepared(ctx));
      model = ri.effectiveCfg.models.dev.model;
      break;
    }
    case 'reviewer': {
      assertRoleInput(input.input, 'reviewer');
      const ri = input.input;
      const marker = byPrHeadSha('reviewer', ri.pr.headSha);
      const ctx = prepareReviewer({
        ticketKey: envelope.ticket_key,
        issue,
        pr: ri.pr,
        files: ri.files,
        commits: ri.commits,
        branchName: ri.branchName,
        typeOverride: ri.typeOverride,
        reviewRubric: ri.reviewRubric,
        capabilities: ri.capabilities,
        idempotencyMarker: marker,
        repoRoot: ri.repoRoot,
        ...(ri._buildSystem ? { _buildSystem: ri._buildSystem } : {}),
        ...(ri._loadOptionalPrompt ? { _loadOptionalPrompt: ri._loadOptionalPrompt } : {}),
      });
      ({ system, initialPrompt, mcpServers, idempotencyMarker } = pickPrepared(ctx));
      model = ri.effectiveCfg.models.review.model;
      break;
    }
    case 'iterator': {
      assertRoleInput(input.input, 'iterator');
      const ri = input.input;
      const marker = byPrHeadSha('iterator', ri.headSha);
      const ctx = prepareIterator({
        ticketKey: envelope.ticket_key,
        issue,
        headSha: ri.headSha,
        reviewComment: ri.reviewComment,
        mergeConflicts: ri.mergeConflicts,
        existingLog: ri.existingLog,
        mcpPool: ri.mcpPool,
        configLabels: ri.configLabels,
        capabilities: ri.capabilities,
        idempotencyMarker: marker,
        typeOverride: ri.typeOverride,
        repoRoot: ri.repoRoot,
        ...(ri._buildSystem ? { _buildSystem: ri._buildSystem } : {}),
      });
      ({ system, initialPrompt, mcpServers, idempotencyMarker } = pickPrepared(ctx));
      model = ri.effectiveCfg.models.iterate.model;
      break;
    }
    case 'refiner': {
      assertRoleInput(input.input, 'refiner');
      const ri = input.input;
      // The refiner's script path runs in JSON mode (no agent loop), so its
      // prepare function does not produce system/initialPrompt. On the
      // claude-code path we synthesise them from the same primitives the
      // script uses: `buildSystem('refiner')` + `buildRefinerPrompt(...)`.
      const _buildSystem = ri._buildSystem ?? buildSystem;
      system = _buildSystem('refiner', ri.repoRoot);
      // Refiner ignores callLlm here — `buildRefinerPrompt` is pure on the
      // shape of `RefinerInput` and doesn't touch callLlm. We stub it to a
      // function that never runs (the prompt builder doesn't await it).
      initialPrompt = buildRefinerPrompt({
        ticket: {
          key: envelope.ticket_key,
          title: issue.summary,
          description: issue.description,
          comments: issue.comments,
          labels: issue.labels,
        },
        existingSubtasks: ri.existingSubtasks,
        priorRefinerRuns: ri.priorRefinerRuns,
        callLlm: () => Promise.reject(new Error('cc-prepare: refiner callLlm must not be invoked')),
        runLink: ri.runLink,
      });
      mcpServers = [];
      idempotencyMarker = byEventId('refiner', envelope.event_id);
      model = ri.effectiveCfg.models.refiner.model;
      break;
    }
    default:
      throw new Error(`unknown ferry role: ${String(role)}`);
  }

  const job = buildClaudeCodeJob({
    role,
    system,
    initialPrompt,
    mcpServers,
    ...(model ? { model } : {}),
  });

  return {
    prompt: job.prompt,
    claudeArgs: job.claudeArgs,
    allowedNativeTools: job.allowedNativeTools,
    outputArtifactPath: job.outputArtifactPath,
    // `--mcp-config` value is JSON-encoded inside claudeArgs; we ALSO expose the
    // structured object as a top-level output so workflow authors can read it
    // without re-parsing the args list.
    mcpConfig: toClaudeCodeMcpConfig(mcpServers ?? []),
    idempotencyMarker,
  };
}

function pickPrepared(
  ctx: DeveloperPreparedContext | ReviewerPreparedContext | IteratorPreparedContext,
): {
  system: string;
  initialPrompt: string;
  mcpServers: DeveloperPreparedContext['mcpServers'];
  idempotencyMarker: string;
} {
  return {
    system: ctx.system,
    initialPrompt: ctx.initialPrompt,
    mcpServers: ctx.mcpServers,
    idempotencyMarker: ctx.idempotencyMarker,
  };
}

function assertRoleInput<T extends RoleSpecificInput['role']>(
  ri: RoleSpecificInput,
  role: T,
): asserts ri is Extract<RoleSpecificInput, { role: T }> {
  if (ri.role !== role) {
    throw new Error(`cc-prepare: role mismatch — top-level role=${role} but input.role=${ri.role}`);
  }
}

function throwMissing(field: string): never {
  throw new Error(`cc-prepare: required field missing: ${field}`);
}

// ──────────────────────────────────────────────────────────────────────────
// Process entrypoint — auth + provider gates, env reads, output writes
// ──────────────────────────────────────────────────────────────────────────

function parseRole(raw: string | undefined): FerryRole {
  if (!raw || !VALID_ROLES.includes(raw as FerryRole)) {
    throw new Error(
      `cc-prepare: FERRY_AGENT_ROLE is invalid (got: ${raw ?? '(unset)'}; valid: ${VALID_ROLES.join(', ')})`,
    );
  }
  return raw as FerryRole;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`cc-prepare: ${name} is not set`);
  return v;
}

function writeOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  // Multi-line scalars MUST use the heredoc form so embedded newlines survive.
  const useHeredoc = value.includes('\n');
  if (useHeredoc) {
    // Generate a per-call random delimiter so a value that happens to contain
    // a fixed sentinel cannot smuggle out of the heredoc block and inject
    // additional `$GITHUB_OUTPUT` entries.
    const delimiter = `__FERRY_EOF_${randomBytes(6).toString('hex')}__`;
    if (value.split('\n').includes(delimiter)) {
      throw new Error(
        `cc-prepare: output value contains heredoc delimiter collision for '${name}' — refusing to write to $GITHUB_OUTPUT`,
      );
    }
    const line = `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
    if (!outputFile) {
      process.stdout.write(line);
      return;
    }
    appendFileSync(outputFile, line);
    return;
  }
  const line = `${name}=${value}\n`;
  if (!outputFile) {
    process.stdout.write(line);
    return;
  }
  appendFileSync(outputFile, line);
}

/**
 * Verifies ADR-0006 §6: `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` are
 * mutually exclusive on the claude-code path. The error message never includes
 * the secret values themselves — only their names.
 */
function enforceAuthInvariant(): void {
  const hasOauth = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (hasOauth && hasApiKey) {
    throw new Error(
      'cc-prepare: ANTHROPIC_API_KEY must NOT be set alongside CLAUDE_CODE_OAUTH_TOKEN ' +
        '(ADR-0006 §6 — the claude-code path authenticates exclusively via ' +
        `${CLAUDE_CODE_AUTH_INPUT}, never ${FORBIDDEN_AUTH_INPUT}).`,
    );
  }
}

function enforceProviderGate(cfg: FerryConfig): void {
  if (!isAnthropicOnlyConfig(cfg)) {
    throw new Error(
      'cc-prepare: refusing to run — ferry.config is not anthropic-only. The claude-code ' +
        'path requires every agent provider to be `anthropic` (ADR-0006 §1, issue #329).',
    );
  }
}

/**
 * Public entrypoint for the bundled action. Reads env, enforces invariants,
 * fetches the Jira issue, builds the upstream state per role, calls the core
 * `prepareCcJob`, then writes outputs to `$GITHUB_OUTPUT`.
 *
 * The function intentionally does NOT log the OAuth token: we read it only via
 * `Boolean(...)` truthiness checks for the auth-invariant gate, never via a
 * log statement. The composite forwards `CLAUDE_CODE_OAUTH_TOKEN` to downstream
 * steps via the action `env:` mapping, not via an output.
 */
export async function runCcPrepareAction(): Promise<CcPrepareOutputs> {
  enforceAuthInvariant();

  const raw = requireEnv('FERRY_ENVELOPE_PAYLOAD');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('cc-prepare: FERRY_ENVELOPE_PAYLOAD is not valid JSON');
  }
  const envelope = validateEnvelope(parsed);
  const role = parseRole(process.env.FERRY_AGENT_ROLE);

  const repoRoot = process.cwd();
  const ferryCfg = loadFerryConfig(repoRoot);
  enforceProviderGate(ferryCfg);

  const logger: Logger = createLogger(envelope.event_id, 'ferry:cc-prepare');

  // Jira issue fetch — same primitive `route-action` and `cc-apply-action` use.
  const jiraBaseUrl = requireEnv('FERRY_JIRA_BASE_URL');
  const jiraEmail = requireEnv('FERRY_JIRA_EMAIL');
  const jiraApiToken = requireEnv('FERRY_JIRA_API_TOKEN');
  const jira = new JiraRestClient(jiraBaseUrl, jiraEmail, jiraApiToken);
  const tracker: IssueTracker = new JiraTracker(jira);
  const issue = await tracker.getIssue(envelope.ticket_key);

  // Apply ticket-label overrides so the system/prompt/mcp pool reflects the
  // same effective config the script path uses.
  const overrides = resolveTicketOverrides(issue.labels, logger, {
    allowSkipReview: ferryCfg.safety?.allow_skip_review === true,
  });
  const effectiveCfg = applyTicketOverrides(ferryCfg, overrides);
  // Re-check the provider gate after overrides — a label could theoretically
  // change the model route. The gate must still hold.
  enforceProviderGate(effectiveCfg);

  // The composite is run from inside a GitHub Actions workflow. For the
  // developer/reviewer/iterator roles, the rest of the upstream state (PRs,
  // files, commits, branch ops) is fetched inside the runtime hookup workflow
  // (#333) and supplied via additional env vars. cc-prepare provides only the
  // role-invariant primitives here; the path stays inert until #333 wires the
  // remaining inputs.
  //
  // For now the entrypoint only supports the refiner role end-to-end — the
  // refiner is the simplest role (no PR/branch state) and exercises the full
  // pipeline (envelope → config → Jira → prepare → buildClaudeCodeJob →
  // outputs). The other three roles fail loudly with a precise hint pointing
  // the operator at #333. This preserves the "fail-loud placeholder" property
  // the routing PR (#327) established.
  let outputs: CcPrepareOutputs;
  switch (role) {
    case 'refiner': {
      // The refiner prepare function returns the runLink + idempotency marker
      // we'd otherwise have to recompute. We call it for its side-effect-free
      // outputs and pass them into prepareCcJob.
      const innerTracker = new InMemoryTracker();
      // We already fetched the issue; reuse it via a tiny adapter so we don't
      // hit Jira twice. (prepareRefiner.getIssue is the only call it makes.)
      innerTracker.seed(issue);
      // Strict proxy: only `seed` and `getIssue` invocations are permitted.
      // Any other tracker method called by prepareRefiner would silently
      // bypass the Jira-dedup contract — fail loud instead.
      const allowedRefinerTrackerMethods: ReadonlySet<string> = new Set(['seed', 'getIssue']);
      const trackerForRefiner: IssueTracker = new Proxy(innerTracker, {
        get(target, prop, receiver) {
          const value: unknown = Reflect.get(target, prop, receiver);
          if (typeof value !== 'function') {
            // Non-callable internals (e.g. seeded state) are returned as-is.
            return value;
          }
          const propName = typeof prop === 'string' ? prop : String(prop);
          if (allowedRefinerTrackerMethods.has(propName)) {
            return value.bind(target);
          }
          return (): never => {
            throw new Error(
              `cc-prepare: refiner tracker stub only permits 'getIssue' — '${propName}' was invoked. ` +
                'If prepareRefiner now calls additional tracker methods, the Jira-dedup adapter ' +
                'must be rebuilt to either hit Jira or stub the new method.',
            );
          };
        },
      }) as unknown as IssueTracker;
      const refinerPrepared = await prepareRefiner({
        envelope,
        tracker: trackerForRefiner,
      });
      outputs = await prepareCcJob({
        envelope,
        issue,
        role: 'refiner',
        input: {
          role: 'refiner',
          effectiveCfg,
          existingSubtasks: refinerPrepared.existingSubtasks,
          priorRefinerRuns: refinerPrepared.priorRefinerRuns,
          runLink: refinerPrepared.runLink,
          repoRoot,
        },
      });
      break;
    }
    default:
      throw new Error(
        `cc-prepare: role '${role}' not yet wired into the composite entrypoint. ` +
          'The remaining upstream state (PR / branch / files / commits) lands via #333.',
      );
  }

  // Write outputs. Multi-line `prompt` uses the heredoc form so embedded
  // newlines survive in `$GITHUB_OUTPUT`. JSON-encoded values stay single-line.
  writeOutput('prompt', outputs.prompt);
  writeOutput('claude_args', JSON.stringify(outputs.claudeArgs));
  writeOutput('allowed_native_tools', JSON.stringify(outputs.allowedNativeTools));
  writeOutput('output_artifact_path', outputs.outputArtifactPath);
  writeOutput('mcp_config', JSON.stringify(outputs.mcpConfig));
  writeOutput('idempotency_marker', outputs.idempotencyMarker);

  return outputs;
}

// Auto-invoke when this module is the process entrypoint.
const invokedDirectly =
  typeof process !== 'undefined' && process.argv[1]?.endsWith('cc-prepare-action.js');
if (invokedDirectly) {
  void runCcPrepareAction().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`ferry-cc-prepare: ${msg}\n`);
    process.exit(1);
  });
}
