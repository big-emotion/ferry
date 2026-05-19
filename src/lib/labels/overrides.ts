import type { Logger } from '../logger/index.js';
import type { FerryConfig } from '../config.js';
import {
  resolveTypeOverrides,
  isBuiltinTypeLabel,
  AS_LABEL_PREFIX,
  AS_TYPE_LABELS,
} from './capabilities.js';
import type { TicketOverrides, AgentPhase, PhaseModelOverride } from './capabilities.js';

const AGENT_PHASES: ReadonlySet<string> = new Set(['refiner', 'dev', 'review', 'iterate']);
const PHASES_ORDERED: readonly AgentPhase[] = ['refiner', 'dev', 'review', 'iterate'];
const LLM_PROVIDERS: ReadonlySet<string> = new Set(['anthropic', 'openai', 'google']);

/**
 * Permitted character set for branch names supplied via ferry:base/* and
 * ferry:target/* labels. Intentionally narrow — matches the portable subset
 * of refnames used by GitHub branch protections.
 */
const BRANCH_NAME_REGEX = /^[a-zA-Z0-9._/-]+$/;

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

/** Map of accepted ferry:skip/<suffix> values to the AgentPhase they refer to. */
const SKIP_PHASE_ALIASES: Readonly<Record<string, AgentPhase>> = Object.freeze({
  refiner: 'refiner',
  dev: 'dev',
  review: 'review',
  iter: 'iterate', // alias from issue #239 — "iter" maps to the Iterator phase
  iterate: 'iterate',
});

function isKnownNonOverrideLabel(label: string): boolean {
  if (isBuiltinTypeLabel(label)) return true;
  if (KNOWN_STATUS_LABELS.has(label)) return true;
  if (label.startsWith('ferry:cost-estimate:')) return true;
  if (label.startsWith(MCP_LABEL_PREFIX)) return true;
  if (label.startsWith(PROFILE_LABEL_PREFIX)) return true;
  return false;
}

/** Options for resolveTicketOverrides — repo-level opt-ins that gate dangerous labels. */
export interface ResolveOverridesOptions {
  /**
   * When true, the `ferry:skip/review` label is honoured (auto-approves the PR).
   * Defaults to false — the label is treated as unknown and a warning is emitted.
   * Sourced from `ferry.config.yaml` § `safety.allow_skip_review`.
   */
  allowSkipReview?: boolean;
}

/**
 * Resolves all built-in ferry:* configuration labels into a `TicketOverrides` struct.
 *
 * Handles the following namespaces:
 * - ferry:type:*               — ticket-type overrides (via resolveTypeOverrides)
 * - ferry:model/phase/id       — per-phase model overrides
 * - ferry:provider/phase       — per-phase provider overrides
 * - ferry:budget/*             — cost / token budget overrides
 * - ferry:skip/phase           — phase skip (refiner | dev | review | iter | iterate)
 * - ferry:no-auto-transition   — disable FR18 / FR24 / FR28 auto-transitions
 * - ferry:thinking/on|off|extended — extended-thinking toggle (Anthropic-only at invoke time)
 * - ferry:strict-review|lenient-review — Reviewer rubric override
 * - ferry:git/no-pr            — skip PR creation
 * - ferry:paused               — safety pause flag
 *
 * Unknown ferry:* labels (that are not recognised by any layer) are logged and ignored.
 *
 * The `ferry:skip/review` label additionally requires `options.allowSkipReview` to be
 * true — without it, the label is logged as a warning and ignored.
 *
 * @throws {LabelConflictError} when two labels set the same field to different values.
 */
export function resolveTicketOverrides(
  labels: string[],
  logger?: Logger,
  options?: ResolveOverridesOptions,
): TicketOverrides {
  const typeOverrides = resolveTypeOverrides(labels);

  // ferry:as/<type> (alias namespace from issue #242).
  // Distinct from ferry:type:force-<type> in two ways:
  //   - multiple ferry:as/<x> with different suffixes throw LabelConflictError;
  //   - mixing ferry:as/<a> with ferry:type:force-<b> throws when they
  //     resolve to different typeOverride values.
  // The alias does NOT set bypassTaskSkip — a Task ticket with ferry:as/story
  // is still skipped by FR6.
  let asLabel: string | undefined;
  let asTypeValue: string | undefined;
  for (const label of labels) {
    if (!label.startsWith(AS_LABEL_PREFIX)) continue;
    const suffix = label.slice(AS_LABEL_PREFIX.length);
    const mapped = AS_TYPE_LABELS[suffix];
    if (mapped === undefined) {
      logger?.warn('unknown suffix in ferry:as label', { label, suffix });
      continue;
    }
    if (asTypeValue !== undefined && asTypeValue !== mapped) {
      throw new LabelConflictError(asLabel!, label, 'typeOverride');
    }
    if (asTypeValue === undefined) {
      asTypeValue = mapped;
      asLabel = label;
    }
  }
  if (asTypeValue !== undefined) {
    // Cross-namespace conflict: ferry:as/<a> vs ferry:type:force-<b> with different values.
    if (typeOverrides.typeOverride !== undefined && typeOverrides.typeOverride !== asTypeValue) {
      throw new LabelConflictError(typeOverrides.forceLabel!, asLabel!, 'typeOverride');
    }
    typeOverrides.typeOverride = asTypeValue;
    typeOverrides.forceLabel = asLabel;
  }

  const modelOverrides: Partial<Record<AgentPhase, PhaseModelOverride>> = {};
  const modelSources: Partial<Record<AgentPhase, string>> = {};
  const providerSources: Partial<Record<AgentPhase, string>> = {};

  let blanketModel: string | undefined;
  let blanketModelSource: string | undefined;
  let blanketProvider: 'anthropic' | 'openai' | 'google' | undefined;
  let blanketProviderSource: string | undefined;

  let budgetMaxCostLabel: string | undefined;
  let budgetMaxTokensLabel: string | undefined;
  let budgetMaxCostEur: number | undefined;
  let budgetMaxTokens: number | undefined;

  let budgetEurLabel: string | undefined;
  let budgetEur: number | undefined;
  let maxIterationsLabel: string | undefined;
  let maxIterations: number | undefined;
  let maxTokensLabel: string | undefined;
  let maxTokens: number | undefined;

  let thinkingLabel: string | undefined;
  let thinking: 'on' | 'off' | 'extended' | undefined;

  let reviewRubricLabel: string | undefined;
  let reviewRubric: 'strict' | 'lenient' | undefined;

  let noPr = false;
  let paused = false;
  let noAutoTransition = false;
  let dryRun = false;
  let readOnly = false;
  let hasClaudeCode = false;
  let hasNoClaudeCode = false;
  const skipPhases: AgentPhase[] = [];

  let baseBranchLabel: string | undefined;
  let baseBranch: string | undefined;
  let targetBranchLabel: string | undefined;
  let targetBranch: string | undefined;
  let prDraftLabel: string | undefined;
  let prDraft: boolean | undefined;

  for (const label of labels) {
    if (!label.startsWith('ferry:')) continue;
    if (isKnownNonOverrideLabel(label)) continue;

    // ferry:model/<name>              — blanket: override model for all agent phases
    // ferry:model/<phase>/<model-id>  — per-phase: override model for a specific phase only
    if (label.startsWith('ferry:model/')) {
      const rest = label.slice('ferry:model/'.length);
      if (!rest) {
        logger?.warn('malformed ferry:model label (empty model name)', { label });
        continue;
      }
      const slashIdx = rest.indexOf('/');
      if (slashIdx < 0) {
        // Blanket form: ferry:model/<name> — no slash, applies to all phases
        if (blanketModelSource !== undefined) {
          throw new LabelConflictError(blanketModelSource, label, 'model');
        }
        blanketModel = rest;
        blanketModelSource = label;
        continue;
      }
      const firstSegment = rest.slice(0, slashIdx);
      const remainder = rest.slice(slashIdx + 1);
      if (AGENT_PHASES.has(firstSegment)) {
        // Per-phase form: ferry:model/<phase>/<model-id>
        const p = firstSegment as AgentPhase;
        if (!remainder) {
          logger?.warn('empty model-id in ferry:model label', { label });
          continue;
        }
        if (modelSources[p] !== undefined) {
          throw new LabelConflictError(modelSources[p]!, label, `model.${firstSegment}`);
        }
        modelSources[p] = label;
        modelOverrides[p] = { ...modelOverrides[p], model: remainder };
      } else {
        // Non-phase first segment: blanket model with org/model slash in name
        // e.g. ferry:model/openai/gpt-4o → blanket model "openai/gpt-4o"
        if (blanketModelSource !== undefined) {
          throw new LabelConflictError(blanketModelSource, label, 'model');
        }
        blanketModel = rest;
        blanketModelSource = label;
      }
      continue;
    }

    // ferry:provider/<provider>              — blanket: switch provider for all agent phases
    // ferry:provider/<phase>/<provider>      — per-phase: switch provider for one phase only
    if (label.startsWith('ferry:provider/')) {
      const parts = label.slice('ferry:provider/'.length).split('/');
      if (parts.length === 1) {
        // Blanket form: ferry:provider/<provider>
        const provider = parts[0];
        if (!LLM_PROVIDERS.has(provider)) {
          logger?.warn('unknown provider in blanket ferry:provider label', { label, provider });
          continue;
        }
        if (blanketProviderSource !== undefined) {
          throw new LabelConflictError(blanketProviderSource, label, 'provider');
        }
        blanketProvider = provider as 'anthropic' | 'openai' | 'google';
        blanketProviderSource = label;
        continue;
      }
      if (parts.length !== 2) {
        logger?.warn(
          'malformed ferry:provider label (expected ferry:provider/<provider> or ferry:provider/<phase>/<provider>)',
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

    // ferry:budget/* — handles max-cost/<eur>, max-tokens/<n>, and short form <eur>
    if (label.startsWith('ferry:budget/')) {
      const rest = label.slice('ferry:budget/'.length);

      if (rest.startsWith('max-cost/')) {
        const raw = rest.slice('max-cost/'.length);
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

      if (rest.startsWith('max-tokens/')) {
        const raw = rest.slice('max-tokens/'.length);
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

      // Short form: ferry:budget/<eur> — positive integer EUR hard cap
      const val = parsePositiveInt(rest);
      if (val === undefined) {
        logger?.warn('invalid EUR value in ferry:budget label (expected positive integer)', {
          label,
        });
        continue;
      }
      if (budgetEurLabel !== undefined) {
        throw new LabelConflictError(budgetEurLabel, label, 'budgetEur');
      }
      budgetEurLabel = label;
      budgetEur = val;
      continue;
    }

    // ferry:max-iterations/<n>
    if (label.startsWith('ferry:max-iterations/')) {
      const raw = label.slice('ferry:max-iterations/'.length);
      const val = parsePositiveInt(raw);
      if (val === undefined) {
        logger?.warn('invalid count in ferry:max-iterations label', { label });
        continue;
      }
      if (maxIterationsLabel !== undefined) {
        throw new LabelConflictError(maxIterationsLabel, label, 'maxIterations');
      }
      maxIterationsLabel = label;
      maxIterations = val;
      continue;
    }

    // ferry:max-tokens/<n>
    if (label.startsWith('ferry:max-tokens/')) {
      const raw = label.slice('ferry:max-tokens/'.length);
      const val = parsePositiveInt(raw);
      if (val === undefined) {
        logger?.warn('invalid count in ferry:max-tokens label', { label });
        continue;
      }
      if (maxTokensLabel !== undefined) {
        throw new LabelConflictError(maxTokensLabel, label, 'maxTokens');
      }
      maxTokensLabel = label;
      maxTokens = val;
      continue;
    }

    // ferry:skip/<suffix> — accepts: refiner | dev | review | iter | iterate
    if (label.startsWith('ferry:skip/')) {
      const suffix = label.slice('ferry:skip/'.length);
      const phase = SKIP_PHASE_ALIASES[suffix];
      if (phase === undefined) {
        logger?.warn('unknown phase in ferry:skip label', { label, phase: suffix });
        continue;
      }
      // `ferry:skip/review` is dangerous (auto-approve) — gate behind opt-in.
      if (phase === 'review' && options?.allowSkipReview !== true) {
        logger?.warn(
          'ferry:skip/review ignored — requires safety.allow_skip_review opt-in in ferry.config.yaml',
          { label },
        );
        continue;
      }
      if (!skipPhases.includes(phase)) skipPhases.push(phase);
      continue;
    }

    // ferry:no-auto-transition — disable FR18/FR24/FR28 auto-transitions for this ticket
    if (label === 'ferry:no-auto-transition') {
      noAutoTransition = true;
      continue;
    }

    // ferry:thinking/on | ferry:thinking/off | ferry:thinking/extended
    if (label.startsWith('ferry:thinking/')) {
      const suffix = label.slice('ferry:thinking/'.length);
      let val: 'on' | 'off' | 'extended' | undefined;
      if (suffix === 'on') val = 'on';
      else if (suffix === 'off') val = 'off';
      else if (suffix === 'extended') val = 'extended';
      if (val === undefined) {
        logger?.warn('unknown suffix in ferry:thinking label', { label, suffix });
        continue;
      }
      if (thinking !== undefined && thinking !== val) {
        throw new LabelConflictError(thinkingLabel!, label, 'thinking');
      }
      if (thinking === undefined) {
        thinking = val;
        thinkingLabel = label;
      }
      continue;
    }

    // ferry:strict-review | ferry:lenient-review — reviewer rubric override
    if (label === 'ferry:strict-review' || label === 'ferry:lenient-review') {
      const val: 'strict' | 'lenient' = label === 'ferry:strict-review' ? 'strict' : 'lenient';
      if (reviewRubric !== undefined && reviewRubric !== val) {
        throw new LabelConflictError(reviewRubricLabel!, label, 'reviewRubric');
      }
      if (reviewRubric === undefined) {
        reviewRubric = val;
        reviewRubricLabel = label;
      }
      continue;
    }

    // ferry:git/no-pr
    if (label === 'ferry:git/no-pr') {
      noPr = true;
      continue;
    }

    // ferry:base/<branch> — override git.base_branch
    if (label.startsWith('ferry:base/')) {
      const branch = label.slice('ferry:base/'.length);
      if (!BRANCH_NAME_REGEX.test(branch)) {
        logger?.warn('invalid branch name in ferry:base label (expected ^[a-zA-Z0-9._/-]+$)', {
          label,
        });
        continue;
      }
      if (baseBranch !== undefined && baseBranch !== branch) {
        throw new LabelConflictError(baseBranchLabel!, label, 'git.baseBranch');
      }
      if (baseBranch === undefined) {
        baseBranch = branch;
        baseBranchLabel = label;
      }
      continue;
    }

    // ferry:target/<branch> — override git.target_branch
    if (label.startsWith('ferry:target/')) {
      const branch = label.slice('ferry:target/'.length);
      if (!BRANCH_NAME_REGEX.test(branch)) {
        logger?.warn('invalid branch name in ferry:target label (expected ^[a-zA-Z0-9._/-]+$)', {
          label,
        });
        continue;
      }
      if (targetBranch !== undefined && targetBranch !== branch) {
        throw new LabelConflictError(targetBranchLabel!, label, 'git.targetBranch');
      }
      if (targetBranch === undefined) {
        targetBranch = branch;
        targetBranchLabel = label;
      }
      continue;
    }

    // ferry:pr/draft — force PR draft state
    // ferry:pr/ready — force PR ready-for-review state
    if (label.startsWith('ferry:pr/')) {
      const suffix = label.slice('ferry:pr/'.length);
      let val: boolean | undefined;
      if (suffix === 'draft') val = true;
      else if (suffix === 'ready') val = false;
      if (val === undefined) {
        logger?.warn('unknown suffix in ferry:pr label (expected draft or ready)', {
          label,
          suffix,
        });
        continue;
      }
      if (prDraft !== undefined && prDraft !== val) {
        throw new LabelConflictError(prDraftLabel!, label, 'git.prDraft');
      }
      if (prDraft === undefined) {
        prDraft = val;
        prDraftLabel = label;
      }
      continue;
    }

    // ferry:paused
    if (label === 'ferry:paused') {
      paused = true;
      continue;
    }

    // ferry:dry-run — suppress external writes (commits, PRs, Jira mutations).
    if (label === 'ferry:dry-run') {
      dryRun = true;
      continue;
    }

    // ferry:read-only — Refiner runs only; Developer/Reviewer/Iterator short-circuit.
    if (label === 'ferry:read-only') {
      readOnly = true;
      continue;
    }

    // ferry:claude-code / ferry:no-claude-code — per-ticket execution-path override.
    // Conflicting labels are NOT a LabelConflictError: a routing ambiguity must
    // fail closed onto the safe script path (resolved after the loop).
    if (label === 'ferry:claude-code') {
      hasClaudeCode = true;
      continue;
    }
    if (label === 'ferry:no-claude-code') {
      hasNoClaudeCode = true;
      continue;
    }

    // Unrecognised ferry:* label in override namespace — log and ignore
    logger?.warn('unknown ferry override label ignored', { label });
  }

  // Resolve the execution-path override. Order-independent and fail-closed:
  // any conflict (both labels present) collapses to the safe script path.
  const claudeCodePath: 'claude-code' | 'script' | undefined =
    hasClaudeCode && !hasNoClaudeCode
      ? 'claude-code'
      : hasClaudeCode || hasNoClaudeCode
        ? 'script'
        : undefined;

  // Apply blanket model/provider to phases not already overridden per-phase.
  // Per-phase labels take precedence: blanket only fills phases with no explicit per-phase override.
  if (blanketModel !== undefined) {
    for (const phase of PHASES_ORDERED) {
      if (modelSources[phase] === undefined) {
        modelOverrides[phase] = { ...modelOverrides[phase], model: blanketModel };
      }
    }
  }
  if (blanketProvider !== undefined) {
    for (const phase of PHASES_ORDERED) {
      if (providerSources[phase] === undefined) {
        modelOverrides[phase] = { ...modelOverrides[phase], provider: blanketProvider };
      }
    }
  }

  const hasModelOverrides = Object.keys(modelOverrides).length > 0;
  const hasBudget = budgetMaxCostEur !== undefined || budgetMaxTokens !== undefined;

  const hasGit =
    noPr || baseBranch !== undefined || targetBranch !== undefined || prDraft !== undefined;
  const gitOverride = hasGit
    ? {
        ...(noPr ? { noPr: true } : {}),
        ...(baseBranch !== undefined ? { baseBranch } : {}),
        ...(targetBranch !== undefined ? { targetBranch } : {}),
        ...(prDraft !== undefined ? { prDraft } : {}),
      }
    : undefined;

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
    ...(budgetEur !== undefined ? { budgetEur } : {}),
    ...(maxIterations !== undefined ? { maxIterations } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(skipPhases.length > 0 ? { skipPhases } : {}),
    ...(noAutoTransition ? { noAutoTransition: true } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    ...(reviewRubric !== undefined ? { reviewRubric } : {}),
    ...(gitOverride ? { git: gitOverride } : {}),
    ...(paused ? { paused: true } : {}),
    ...(dryRun ? { dryRun: true } : {}),
    ...(readOnly ? { readOnly: true } : {}),
    ...(claudeCodePath !== undefined ? { claudeCodePath } : {}),
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
  if (
    !overrides.modelOverrides &&
    !overrides.budget &&
    overrides.budgetEur === undefined &&
    overrides.maxIterations === undefined &&
    overrides.maxTokens === undefined
  )
    return cfg;

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

  if (overrides.budgetEur !== undefined) {
    limits.max_cost_eur_per_run = overrides.budgetEur;
  }
  if (overrides.maxIterations !== undefined) {
    limits.max_agent_iterations = overrides.maxIterations;
  }
  if (overrides.maxTokens !== undefined) {
    limits.max_tokens_per_message = overrides.maxTokens;
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
    overrides.budgetEur !== undefined ||
    overrides.maxIterations !== undefined ||
    overrides.maxTokens !== undefined ||
    (overrides.skipPhases?.length ?? 0) > 0 ||
    overrides.noAutoTransition === true ||
    overrides.thinking !== undefined ||
    overrides.reviewRubric !== undefined ||
    overrides.git?.noPr === true ||
    overrides.git?.baseBranch !== undefined ||
    overrides.git?.targetBranch !== undefined ||
    overrides.git?.prDraft !== undefined ||
    overrides.paused === true ||
    overrides.dryRun === true ||
    overrides.readOnly === true ||
    overrides.claudeCodePath !== undefined
  );
}

/**
 * Formats a Jira comment body for the audit log that records all resolved overrides.
 *
 * The comment format follows the standard fingerprint convention:
 * `[ferry:<role>:<run-id>] overrides applied: <json>`
 *
 * When `overrides.dryRun` is true, the comment is prefixed with `[dry-run]`
 * immediately after the fingerprint (see `applyDryRunMarker`).
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
  if (overrides.budgetEur !== undefined) payload.budgetEur = overrides.budgetEur;
  if (overrides.maxIterations !== undefined) payload.maxIterations = overrides.maxIterations;
  if (overrides.maxTokens !== undefined) payload.maxTokens = overrides.maxTokens;
  if ((overrides.skipPhases?.length ?? 0) > 0) payload.skipPhases = overrides.skipPhases;
  if (overrides.noAutoTransition) payload.noAutoTransition = true;
  if (overrides.thinking !== undefined) payload.thinking = overrides.thinking;
  if (overrides.reviewRubric !== undefined) payload.reviewRubric = overrides.reviewRubric;
  if (
    overrides.git !== undefined &&
    (overrides.git.noPr === true ||
      overrides.git.baseBranch !== undefined ||
      overrides.git.targetBranch !== undefined ||
      overrides.git.prDraft !== undefined)
  ) {
    payload.git = overrides.git;
  }
  if (overrides.paused) payload.paused = true;
  if (overrides.dryRun) payload.dryRun = true;
  if (overrides.readOnly) payload.readOnly = true;
  if (overrides.claudeCodePath !== undefined) payload.claudeCodePath = overrides.claudeCodePath;

  const body = `[ferry:${role}:${runId}] overrides applied: ${JSON.stringify(payload)}`;
  return applyDryRunMarker(body, overrides.dryRun);
}

/**
 * Prepends a `[dry-run]` marker to a comment body so consumers can visually
 * distinguish audit comments emitted under a `ferry:dry-run` execution.
 *
 * The marker is inserted immediately after the `[ferry:<role>:<run-id>]`
 * fingerprint prefix. If the body has no such prefix (or `dryRun` is falsy),
 * the body is returned unchanged.
 *
 * Multiline bodies receive the marker on the first line only — subsequent
 * lines are preserved verbatim.
 */
export function applyDryRunMarker(body: string, dryRun: boolean | undefined): string {
  if (dryRun !== true) return body;
  const match = body.match(/^(\[ferry:[^\]]+\])\s+(.*)$/s);
  if (!match) return body;
  return `${match[1]} [dry-run] ${match[2]}`;
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
