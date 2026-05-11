import type { Logger } from '../logger/index.js';
import type { FerryConfig } from '../config.js';
import { resolveTypeOverrides, isBuiltinTypeLabel } from './capabilities.js';
import type { TicketOverrides, AgentPhase, PhaseModelOverride } from './capabilities.js';

const AGENT_PHASES: ReadonlySet<string> = new Set(['refiner', 'dev', 'review', 'iterate']);
const LLM_PROVIDERS: ReadonlySet<string> = new Set(['anthropic', 'openai', 'google']);

/**
 * Thrown when two ferry labels on the same ticket set the same override field
 * to contradictory values. Callers should catch this, post a Jira comment explaining
 * the conflict, and exit non-zero.
 */
export class LabelConflictError extends Error {
  readonly label1: string;
  readonly label2: string;
  readonly field: string;

  constructor(label1: string, label2: string, field: string) {
    super(`Conflicting ferry labels for "${field}": "${label1}" and "${label2}"`);
    this.name = 'LabelConflictError';
    this.label1 = label1;
    this.label2 = label2;
    this.field = field;
  }
}

function parsePositiveFloat(s: string): number | undefined {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parsePositiveInt(s: string): number | undefined {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// Prefixes for labels handled by resolveCapabilities (config-dependent MCP/profile labels).
// resolveTicketOverrides silently passes labels with these prefixes to avoid double-warning.
const MCP_LABEL_PREFIX = 'ferry:mcp/';
const PROFILE_LABEL_PREFIX = 'ferry:profile/';

// Known exact-match ferry:* labels that are not override labels.
const KNOWN_STATUS_LABELS: ReadonlySet<string> = new Set([
  'ferry:refining',
  'ferry:developing',
  'ferry:reviewing',
  'ferry:iterating',
  'ferry:ready',
  'ferry:approved',
  'ferry:cancelled',
  'ferry:blocked',
  'ferry:spend-cap',
  'ferry:audit-log:active',
]);

function isKnownNonOverrideLabel(label: string): boolean {
  if (isBuiltinTypeLabel(label)) return true;
  if (KNOWN_STATUS_LABELS.has(label)) return true;
  if (label.startsWith('ferry:cost-estimate:')) return true;
  if (label.startsWith(MCP_LABEL_PREFIX)) return true;
  if (label.startsWith(PROFILE_LABEL_PREFIX)) return true;
  return false;
}

/**
 * Resolves all built-in ferry:* configuration labels into a `TicketOverrides` struct.
 *
 * Handles the following namespaces:
 * - ferry:type:*          — ticket-type overrides (via resolveTypeOverrides)
 * - ferry:model/phase/id  — per-phase model overrides
 * - ferry:provider/phase  — per-phase provider overrides
 * - ferry:budget/*        — cost / token budget overrides
 * - ferry:skip/phase      — phase skip
 * - ferry:thinking/on|off — extended-thinking toggle
 * - ferry:git/no-pr       — skip PR creation
 * - ferry:paused          — safety pause flag
 *
 * Unknown ferry:* labels (that are not recognised by any layer) are logged and ignored.
 *
 * @throws {LabelConflictError} when two labels set the same field to different values.
 */
export function resolveTicketOverrides(labels: string[], logger?: Logger): TicketOverrides {
  const typeOverrides = resolveTypeOverrides(labels);

  const modelOverrides: Partial<Record<AgentPhase, PhaseModelOverride>> = {};
  const modelSources: Partial<Record<AgentPhase, string>> = {};
  const providerSources: Partial<Record<AgentPhase, string>> = {};

  let budgetMaxCostLabel: string | undefined;
  let budgetMaxTokensLabel: string | undefined;
  let budgetMaxCostEur: number | undefined;
  let budgetMaxTokens: number | undefined;

  let thinkingLabel: string | undefined;
  let thinking: 'on' | 'off' | undefined;

  let noPr = false;
  let paused = false;
  const skipPhases: AgentPhase[] = [];

  for (const label of labels) {
    if (!label.startsWith('ferry:')) continue;
    if (isKnownNonOverrideLabel(label)) continue;

    // ferry:model/<phase>/<model-id>
    if (label.startsWith('ferry:model/')) {
      const rest = label.slice('ferry:model/'.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx < 1) {
        logger?.warn('malformed ferry:model label (expected ferry:model/<phase>/<model-id>)', {
          label,
        });
        continue;
      }
      const phase = rest.slice(0, slashIdx);
      const modelId = rest.slice(slashIdx + 1);
      if (!AGENT_PHASES.has(phase)) {
        logger?.warn('unknown phase in ferry:model label', { label, phase });
        continue;
      }
      if (!modelId) {
        logger?.warn('empty model-id in ferry:model label', { label });
        continue;
      }
      const p = phase as AgentPhase;
      if (modelSources[p] !== undefined) {
        throw new LabelConflictError(modelSources[p]!, label, `model.${phase}`);
      }
      modelSources[p] = label;
      modelOverrides[p] = { ...modelOverrides[p], model: modelId };
      continue;
    }

    // ferry:provider/<phase>/<provider>
    if (label.startsWith('ferry:provider/')) {
      const parts = label.slice('ferry:provider/'.length).split('/');
      if (parts.length !== 2) {
        logger?.warn(
          'malformed ferry:provider label (expected ferry:provider/<phase>/<provider>)',
          { label },
        );
        continue;
      }
      const [phase, provider] = parts;
      if (!AGENT_PHASES.has(phase)) {
        logger?.warn('unknown phase in ferry:provider label', { label, phase });
        continue;
      }
      if (!LLM_PROVIDERS.has(provider)) {
        logger?.warn('unknown provider in ferry:provider label', { label, provider });
        continue;
      }
      const p = phase as AgentPhase;
      if (providerSources[p] !== undefined) {
        throw new LabelConflictError(providerSources[p]!, label, `provider.${phase}`);
      }
      providerSources[p] = label;
      modelOverrides[p] = {
        ...modelOverrides[p],
        provider: provider as 'anthropic' | 'openai' | 'google',
      };
      continue;
    }

    // ferry:budget/max-cost/<eur>
    if (label.startsWith('ferry:budget/max-cost/')) {
      const raw = label.slice('ferry:budget/max-cost/'.length);
      const val = parsePositiveFloat(raw);
      if (val === undefined) {
        logger?.warn('invalid cost value in ferry:budget/max-cost label', { label });
        continue;
      }
      if (budgetMaxCostLabel !== undefined) {
        throw new LabelConflictError(budgetMaxCostLabel, label, 'budget.maxCostEurPerRun');
      }
      budgetMaxCostLabel = label;
      budgetMaxCostEur = val;
      continue;
    }

    // ferry:budget/max-tokens/<n>
    if (label.startsWith('ferry:budget/max-tokens/')) {
      const raw = label.slice('ferry:budget/max-tokens/'.length);
      const val = parsePositiveInt(raw);
      if (val === undefined) {
        logger?.warn('invalid token count in ferry:budget/max-tokens label', { label });
        continue;
      }
      if (budgetMaxTokensLabel !== undefined) {
        throw new LabelConflictError(budgetMaxTokensLabel, label, 'budget.maxTokensPerRun');
      }
      budgetMaxTokensLabel = label;
      budgetMaxTokens = val;
      continue;
    }

    // ferry:skip/<phase>
    if (label.startsWith('ferry:skip/')) {
      const phase = label.slice('ferry:skip/'.length);
      if (!AGENT_PHASES.has(phase)) {
        logger?.warn('unknown phase in ferry:skip label', { label, phase });
        continue;
      }
      const p = phase as AgentPhase;
      if (!skipPhases.includes(p)) skipPhases.push(p);
      continue;
    }

    // ferry:thinking/on | ferry:thinking/off
    if (label === 'ferry:thinking/on' || label === 'ferry:thinking/off') {
      const val: 'on' | 'off' = label === 'ferry:thinking/on' ? 'on' : 'off';
      if (thinking !== undefined && thinking !== val) {
        throw new LabelConflictError(thinkingLabel!, label, 'thinking');
      }
      if (thinking === undefined) {
        thinking = val;
        thinkingLabel = label;
      }
      continue;
    }

    // ferry:git/no-pr
    if (label === 'ferry:git/no-pr') {
      noPr = true;
      continue;
    }

    // ferry:paused
    if (label === 'ferry:paused') {
      paused = true;
      continue;
    }

    // Unrecognised ferry:* label in override namespace — log and ignore
    logger?.warn('unknown ferry override label ignored', { label });
  }

  const hasModelOverrides = Object.keys(modelOverrides).length > 0;
  const hasBudget = budgetMaxCostEur !== undefined || budgetMaxTokens !== undefined;

  return {
    ...typeOverrides,
    ...(hasModelOverrides ? { modelOverrides } : {}),
    ...(hasBudget
      ? {
          budget: {
            ...(budgetMaxCostEur !== undefined ? { maxCostEurPerRun: budgetMaxCostEur } : {}),
            ...(budgetMaxTokens !== undefined ? { maxTokensPerRun: budgetMaxTokens } : {}),
          },
        }
      : {}),
    ...(skipPhases.length > 0 ? { skipPhases } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    ...(noPr ? { git: { noPr: true } } : {}),
    ...(paused ? { paused: true } : {}),
  };
}

/**
 * Applies `TicketOverrides` to a `FerryConfig`, returning a new config with Jira-label
 * overrides in effect. Jira labels take the highest precedence — they override
 * ferry.config.yaml, env vars, and defaults.
 *
 * Only model/provider and budget fields are applied; other overrides (phase skips, thinking,
 * git, paused) are handled at the agent level and do not change the config struct.
 */
export function applyTicketOverrides(cfg: FerryConfig, overrides: TicketOverrides): FerryConfig {
  if (!overrides.modelOverrides && !overrides.budget) return cfg;

  const models = { ...cfg.models };
  const limits = { ...cfg.limits };

  const mo = overrides.modelOverrides;
  if (mo) {
    if (mo.refiner) {
      models.refiner = {
        provider: mo.refiner.provider ?? models.refiner.provider,
        model: mo.refiner.model ?? models.refiner.model,
      };
    }
    if (mo.dev) {
      models.dev = {
        provider: mo.dev.provider ?? models.dev.provider,
        model: mo.dev.model ?? models.dev.model,
      };
    }
    if (mo.review) {
      models.review = {
        provider: mo.review.provider ?? models.review.provider,
        model: mo.review.model ?? models.review.model,
      };
    }
    if (mo.iterate) {
      models.iterate = {
        provider: mo.iterate.provider ?? models.iterate.provider,
        model: mo.iterate.model ?? models.iterate.model,
      };
    }
  }

  if (overrides.budget) {
    if (overrides.budget.maxCostEurPerRun !== undefined) {
      limits.max_cost_eur_per_run = overrides.budget.maxCostEurPerRun;
    }
    if (overrides.budget.maxTokensPerRun !== undefined) {
      limits.max_tokens_per_run = overrides.budget.maxTokensPerRun;
    }
  }

  return { ...cfg, models, limits };
}

/**
 * Returns true when the overrides struct contains any non-default (label-sourced) values.
 * Used to decide whether to emit an audit comment.
 */
export function hasNonDefaultOverrides(overrides: TicketOverrides): boolean {
  return (
    overrides.bypassTaskSkip ||
    overrides.typeOverride !== undefined ||
    overrides.modelOverrides !== undefined ||
    overrides.budget !== undefined ||
    (overrides.skipPhases?.length ?? 0) > 0 ||
    overrides.thinking !== undefined ||
    overrides.git?.noPr === true ||
    overrides.paused === true
  );
}

/**
 * Formats a Jira comment body for the audit log that records all resolved overrides.
 *
 * The comment format follows the standard fingerprint convention:
 * `[ferry:<role>:<run-id>] overrides applied: <json>`
 */
export function buildOverridesAuditComment(
  role: string,
  runId: string,
  overrides: TicketOverrides,
): string {
  const payload: Record<string, unknown> = {};

  if (overrides.bypassTaskSkip) payload.bypassTaskSkip = true;
  if (overrides.typeOverride !== undefined) payload.typeOverride = overrides.typeOverride;
  if (overrides.modelOverrides !== undefined) payload.modelOverrides = overrides.modelOverrides;
  if (overrides.budget !== undefined) payload.budget = overrides.budget;
  if ((overrides.skipPhases?.length ?? 0) > 0) payload.skipPhases = overrides.skipPhases;
  if (overrides.thinking !== undefined) payload.thinking = overrides.thinking;
  if (overrides.git?.noPr) payload.git = overrides.git;
  if (overrides.paused) payload.paused = true;

  return `[ferry:${role}:${runId}] overrides applied: ${JSON.stringify(payload)}`;
}

/**
 * Formats a Jira comment body explaining a label conflict.
 *
 * The comment format follows the standard fingerprint convention:
 * `[ferry:<role>:<run-id>] label conflict: ...`
 */
export function buildConflictComment(role: string, runId: string, err: LabelConflictError): string {
  return [
    `[ferry:${role}:${runId}] label conflict — remove one of the contradicting labels and re-trigger:`,
    `  field: ${err.field}`,
    `  label 1: ${err.label1}`,
    `  label 2: ${err.label2}`,
  ].join('\n');
}
