/**
 * Execution-path routing bundled action (ADR-0006 §3, issue #300).
 *
 * Pre-dispatch step that decides whether the agent run takes the bundled-script
 * path or the `claude-code-action` path, then exposes the decision to the
 * wrapping workflow via `$GITHUB_OUTPUT`. The decision is computed by the pure
 * `resolveExecutionPath` resolver — this file is the env/IO shell around it.
 *
 * Inputs (env):
 *   - FERRY_ENVELOPE_PAYLOAD   JSON envelope from repository_dispatch
 *   - FERRY_AGENT_ROLE         refiner | developer | reviewer | iterator
 *   - FERRY_JIRA_BASE_URL      Jira base URL
 *   - FERRY_JIRA_EMAIL         Jira account email
 *   - FERRY_JIRA_API_TOKEN     Jira API token
 *   - GITHUB_OUTPUT            GitHub Actions output file (set by the runner)
 *
 * Outputs (written to GITHUB_OUTPUT):
 *   - path     'script' | 'claude-code' | 'codex-cli'
 *   - reason   'default' | 'label' | 'heuristic' | 'provider-gate'
 *
 * Heuristic-driven escalation is intentionally **disabled in this version**
 * (`priorRoundTrips` is stubbed to 0): label + config-driven routing land first
 * so the architecture can be reviewed independently of the audit-log loader.
 * The heuristic plug-in point is documented inline; #FOLLOW-UP wires it.
 */
import { appendFileSync } from 'node:fs';

import { validateEnvelope } from '../envelope/validate.js';
import { JiraRestClient } from '../io/jira-rest.js';
import { loadFerryConfig } from '../config.js';
import { resolveTicketOverrides } from '../labels/overrides.js';
import {
  resolveExecutionPath,
  isAnthropicOnlyConfig,
  formatExecutionPathAudit,
  providerForRole,
  type ExecutionPathDecision,
} from '../cc-wrappers/routing.js';
import { createLogger } from '../logger/index.js';
import type { AgentOutputRole } from '../cc-wrappers/routing.js';

const VALID_ROLES = ['refiner', 'developer', 'reviewer', 'iterator'] as const;

const logger = createLogger('', 'ferry:route');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    logger.error(`${name} is not set`);
    process.exit(1);
  }
  return v;
}

function parseRole(raw: string | undefined): AgentOutputRole {
  if (!raw || !(VALID_ROLES as readonly string[]).includes(raw)) {
    logger.error('FERRY_AGENT_ROLE is invalid', {
      valid: VALID_ROLES.join(', '),
      got: raw ?? '(unset)',
    });
    process.exit(1);
  }
  return raw as AgentOutputRole;
}

function writeOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    // Local invocation (tests, manual): fall through to stdout for visibility.
    process.stdout.write(`${name}=${value}\n`);
    return;
  }
  // GitHub Actions output file format: one `name=value` per line. Single-line
  // values only — `path` and `reason` are always single tokens, so no need for
  // the heredoc form.
  appendFileSync(outputFile, `${name}=${value}\n`);
}

export async function runRouteAction(): Promise<ExecutionPathDecision> {
  const raw = requireEnv('FERRY_ENVELOPE_PAYLOAD');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error('FERRY_ENVELOPE_PAYLOAD is not valid JSON');
    process.exit(1);
  }
  const envelope = validateEnvelope(parsed);
  const role = parseRole(process.env.FERRY_AGENT_ROLE);

  // Ferry config from the consumer repo workspace. The composite action
  // requires the consumer to actions/checkout@v4 before invoking us, same as
  // every other ferry-run-* composite.
  const config = loadFerryConfig(process.cwd());

  // Per-ticket label override. Jira fetch is the only network IO this action
  // performs; the GitHub side (audit comments → priorRoundTrips) is the
  // documented follow-up.
  const jiraBaseUrl = requireEnv('FERRY_JIRA_BASE_URL');
  const jiraEmail = requireEnv('FERRY_JIRA_EMAIL');
  const jiraApiToken = requireEnv('FERRY_JIRA_API_TOKEN');
  const jira = new JiraRestClient(jiraBaseUrl, jiraEmail, jiraApiToken);
  const issue = await jira.getIssue(envelope.ticket_key);
  const overrides = resolveTicketOverrides(issue.fields.labels ?? [], logger, {
    allowSkipReview: config.safety?.allow_skip_review === true,
  });

  const decision = resolveExecutionPath({
    configuredPath: config.execution_path,
    anthropicOnly: isAnthropicOnlyConfig(config),
    roleProvider: providerForRole(config, role),
    labelOverride: overrides.executionPath ?? overrides.claudeCodePath,
    role,
    // #FOLLOW-UP: derive priorRoundTrips from the audit issue's `[ferry:iterator:*]
    // complete. Pushed fixes to PR#…` markers (same source `countPriorIterations`
    // uses in src/agents/reviewer/changes-guard.ts). Stubbed to 0 here so the
    // heuristic-escalation branch never fires until that loader lands.
    priorRoundTrips: 0,
    roundTripThreshold: config.routing.claude_code_round_trip_threshold,
  });

  writeOutput('path', decision.path);
  writeOutput('reason', decision.reason);

  // Audit-comment line for the Reconciler (ADR-0004). Written to stdout; the
  // consumer workflow may pipe this into the audit issue via ferry-emit-audit.
  process.stdout.write(`${formatExecutionPathAudit(role, envelope.event_id, decision)}\n`);

  return decision;
}

// Auto-invoke when this module is the process entrypoint.
const invokedDirectly =
  typeof process !== 'undefined' && process.argv[1]?.endsWith('route-action.js');
if (invokedDirectly) {
  void runRouteAction().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`ferry-route: ${msg}\n`);
    process.exit(1);
  });
}
