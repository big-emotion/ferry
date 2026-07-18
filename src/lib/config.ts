import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { FerryError } from './errors/index.js';

const _require = createRequire(import.meta.url);

export interface LlmRoute {
  provider: 'anthropic' | 'openai' | 'google';
  model: string;
}

/**
 * Which execution path the four agents run on (ADR-0006).
 * - `script`: the bundled multi-provider deterministic agent loop.
 * - `claude-code`: the `anthropics/claude-code-action` reasoning core,
 *   bracketed by deterministic Ferry contract steps. Anthropic-only.
 * - `codex-cli`: the `openai/codex-action` reasoning core, bracketed
 *   by deterministic Ferry contract steps. OpenAI-only for the selected role.
 *
 * When `FerryConfig.execution_path` is left unset, the resolver applies the
 * *conditional default* (claude-code for Anthropic-only consumers, script
 * otherwise — see `resolveExecutionPath`). An explicit `script` is a hard
 * lock that the per-ticket label / heuristic never override.
 */
export type ExecutionPath = 'script' | 'claude-code' | 'codex-cli';

/** Deterministic execution-path routing knobs (ADR-0006 §3, #300). */
export interface RoutingConfig {
  /**
   * Round-trip threshold N for the automatic claude-code escalation
   * heuristic: a developer/iterator run with `priorRoundTrips >= N`
   * escalates to the claude-code path (unless a label or an explicit
   * `execution_path: script` takes precedence). Positive integer.
   */
  claude_code_round_trip_threshold: number;
}

export interface LabelCapability {
  mcp_servers?: string[];
  tools?: string[];
}

export interface GitConfig {
  /** Branch to check out from and open PRs against. null = resolve repo default branch at runtime. */
  base_branch: string | null;
  /** Branch the PR targets. null = same as base_branch. */
  target_branch: string | null;
  /**
   * Prefix for working branches created by the Developer.
   * String → static prefix (e.g. "ferry/").
   * Mapping → resolved per Jira issue type (requires a "default" key).
   */
  working_branch_prefix: string | Record<string, string>;
}

export interface RefinerWorkflowAgentConfig {
  trigger_column: string;
  auto_transition: null;
}

export interface DeveloperWorkflowAgentConfig {
  trigger_column: string;
  /** Column name to transition into after implementation. null = no auto-transition. */
  auto_transition: string | null;
}

export interface ReviewerWorkflowAgentConfig {
  trigger_column: string;
  /** Column name to transition into on approval. null = no auto-transition (default). */
  auto_transition_approve: string | null;
  /** Column name to transition into when changes are requested. null = no auto-transition. */
  auto_transition_changes: string | null;
}

export interface IteratorWorkflowAgentConfig {
  trigger_column: string;
  /** Column name to transition into after iteration. null = no auto-transition. */
  auto_transition: string | null;
}

export interface MergerWorkflowAgentConfig {
  /**
   * Moving a ticket into this column is an explicit human merge order — it
   * triggers the Merger like any other agent's trigger_column (ADR-0005 rev. 2).
   */
  trigger_column: string;
  /** Status name to transition into after a successful merge (FR32). null = no transition. */
  auto_transition_done: string | null;
}

export interface WorkflowConfig {
  agents: {
    refiner: RefinerWorkflowAgentConfig;
    developer: DeveloperWorkflowAgentConfig;
    reviewer: ReviewerWorkflowAgentConfig;
    iterator: IteratorWorkflowAgentConfig;
    merger: MergerWorkflowAgentConfig;
  };
}

export interface FerryConfig {
  models: {
    refiner: LlmRoute;
    dev: LlmRoute;
    review: LlmRoute;
    iterate: LlmRoute;
  };
  limits: {
    /** Iterator oscillation cap — throws after this many review→iterate cycles */
    max_iterations: number;
    /** Internal LLM agent loop iteration cap per single agent run */
    max_agent_iterations: number;
    /** Input token budget per agent run */
    max_tokens_per_run: number;
    /** Maximum output tokens per LLM API call */
    max_tokens_per_message: number;
    /** Cost budget in EUR per run */
    max_cost_eur_per_run: number;
    /** Default bash command timeout in ms (developer agent) */
    bash_timeout_ms: number;
    /** Maximum bash command timeout in ms (developer agent) */
    bash_timeout_max_ms: number;
    /** Grep tool timeout in ms (developer agent) */
    grep_timeout_ms: number;
    /** Anthropic API key verification timeout in ms (ferry-init) */
    anthropic_verify_timeout_ms: number;
    /** Base delay for Jira API retries in ms */
    jira_retry_base_delay_ms: number;
    /** Maximum Jira API retry attempts */
    jira_retry_max_attempts: number;
    /** Maximum characters for envelope instructions field */
    envelope_instructions_chars: number;
    /** Maximum bytes for _project.md snippet */
    project_snippet_bytes: number;
    /** Maximum bytes for agent .extra.md extension file */
    agent_extension_bytes: number;
    /** Maximum characters for TL;DR block total */
    tldr_total_chars: number;
    /** Maximum characters for TL;DR reviewer verdict field */
    tldr_verdict_chars: number;
    /** Maximum characters for file content display (GitHub runner) */
    file_display_chars: number;
    /** Maximum subtasks per refiner batch */
    refiner_subtask_cap: number;
    /** Maximum touch_paths entries in refiner output */
    refiner_touch_paths_cap: number;
    /** Maximum tool-use iterations in the reviewer loop */
    reviewer_max_iterations: number;
    /** Maximum output tokens per reviewer LLM call */
    reviewer_max_tokens: number;
    /** Minutes after which a ticket without a recent audit is considered stale */
    reconciler_stale_window_minutes: number;
  };
  ticket_types: {
    refine_allowlist: string[];
    dev_allowlist: string[];
  };
  git: GitConfig;
  labels?: Record<string, LabelCapability>;
  workflow: WorkflowConfig;
  /**
   * Safety opt-ins. Currently:
   * - `allow_skip_review`: when true, the `ferry:skip/review` label auto-approves
   *   the PR at the Reviewer phase. Default false — the label is ignored without
   *   this repo-level opt-in. Prevents a single Jira user from bypassing review
   *   without the repo owner's consent.
   */
  safety?: SafetyConfig;
  /**
   * Explicit install-time execution-path choice (ADR-0006 point 6). When
   * unset, the resolver applies the conditional default. An explicit
   * `script` is a hard lock — never overridden by the per-ticket label or
   * the round-trip heuristic.
   */
  execution_path?: ExecutionPath;
  /** Deterministic execution-path routing knobs (#300). Always present (defaulted). */
  routing: RoutingConfig;
}

export interface SafetyConfig {
  allow_skip_review?: boolean;
}

export const DEFAULT_FERRY_CONFIG: FerryConfig = {
  models: {
    refiner: { provider: 'anthropic', model: 'claude-opus-4-8' },
    dev: { provider: 'anthropic', model: 'claude-sonnet-5' },
    review: { provider: 'anthropic', model: 'claude-opus-4-8' },
    iterate: { provider: 'anthropic', model: 'claude-sonnet-5' },
  },
  limits: {
    max_iterations: 3,
    max_agent_iterations: 200,
    max_tokens_per_run: 500_000,
    max_tokens_per_message: 16_384,
    max_cost_eur_per_run: 10,
    bash_timeout_ms: 60_000,
    bash_timeout_max_ms: 300_000,
    grep_timeout_ms: 30_000,
    anthropic_verify_timeout_ms: 10_000,
    jira_retry_base_delay_ms: 2_000,
    jira_retry_max_attempts: 3,
    envelope_instructions_chars: 2_000,
    project_snippet_bytes: 2_048,
    agent_extension_bytes: 4_096,
    tldr_total_chars: 500,
    tldr_verdict_chars: 40,
    file_display_chars: 40_000,
    refiner_subtask_cap: 12,
    refiner_touch_paths_cap: 20,
    reviewer_max_iterations: 40,
    reviewer_max_tokens: 16_384,
    reconciler_stale_window_minutes: 20,
  },
  ticket_types: {
    refine_allowlist: ['Story', 'Bug', 'Spike'],
    dev_allowlist: ['Story', 'Bug', 'Spike'],
  },
  git: {
    base_branch: null,
    target_branch: null,
    working_branch_prefix: 'ferry/',
  },
  workflow: {
    agents: {
      refiner: { trigger_column: 'Refinement', auto_transition: null },
      developer: { trigger_column: 'In Development', auto_transition: 'In Review' },
      reviewer: {
        trigger_column: 'In Review',
        auto_transition_approve: null,
        auto_transition_changes: 'Changes Requested',
      },
      iterator: { trigger_column: 'Changes Requested', auto_transition: 'In Review' },
      merger: { trigger_column: 'Ready to Merge', auto_transition_done: null },
    },
  },
  routing: {
    claude_code_round_trip_threshold: 2,
  },
};

// --- Validation helpers ---

type ValidationError = string;

function validateProvider(val: unknown, fieldPath: string): ValidationError[] {
  if (val !== 'anthropic' && val !== 'openai' && val !== 'google') {
    return [`${fieldPath}: must be "anthropic", "openai", or "google"`];
  }
  return [];
}

function validateLlmRoute(val: unknown, fieldPath: string): ValidationError[] {
  if (!val || typeof val !== 'object') return [`${fieldPath}: must be an object`];
  const r = val as Record<string, unknown>;
  return [
    ...validateProvider(r.provider, `${fieldPath}.provider`),
    ...(typeof r.model !== 'string' || r.model.length === 0
      ? [`${fieldPath}.model: must be a non-empty string`]
      : []),
  ];
}

function validatePosInt(val: unknown, fieldPath: string): ValidationError[] {
  if (typeof val !== 'number' || !Number.isInteger(val) || val <= 0) {
    return [`${fieldPath}: must be a positive integer`];
  }
  return [];
}

function validatePosNumber(val: unknown, fieldPath: string): ValidationError[] {
  if (typeof val !== 'number' || val <= 0) {
    return [`${fieldPath}: must be a positive number`];
  }
  return [];
}

function validateStringArray(val: unknown, fieldPath: string): ValidationError[] {
  if (!Array.isArray(val) || val.some((v) => typeof v !== 'string')) {
    return [`${fieldPath}: must be an array of strings`];
  }
  return [];
}

function validateStringOrNull(val: unknown, fieldPath: string): ValidationError[] {
  if (val !== null && typeof val !== 'string') {
    return [`${fieldPath}: must be a string or null`];
  }
  return [];
}

function validateWorkflowAgentBase(val: unknown, fieldPath: string): ValidationError[] {
  if (!val || typeof val !== 'object') return [`${fieldPath}: must be an object`];
  const v = val as Record<string, unknown>;
  if (v.trigger_column !== undefined && typeof v.trigger_column !== 'string') {
    return [`${fieldPath}.trigger_column: must be a string`];
  }
  return [];
}

function validateWorkflow(val: unknown): ValidationError[] {
  if (!val || typeof val !== 'object') return ['workflow: must be an object'];
  const w = val as Record<string, unknown>;
  const errs: ValidationError[] = [];

  if (w.agents === undefined) return errs;
  if (!w.agents || typeof w.agents !== 'object') {
    errs.push('workflow.agents: must be an object');
    return errs;
  }
  const agents = w.agents as Record<string, unknown>;

  if (agents.refiner !== undefined) {
    errs.push(...validateWorkflowAgentBase(agents.refiner, 'workflow.agents.refiner'));
  }
  if (agents.developer !== undefined) {
    errs.push(...validateWorkflowAgentBase(agents.developer, 'workflow.agents.developer'));
    const dev = agents.developer as Record<string, unknown>;
    if ('auto_transition' in dev && dev.auto_transition !== undefined) {
      errs.push(
        ...validateStringOrNull(dev.auto_transition, 'workflow.agents.developer.auto_transition'),
      );
    }
  }
  if (agents.reviewer !== undefined) {
    errs.push(...validateWorkflowAgentBase(agents.reviewer, 'workflow.agents.reviewer'));
    const rev = agents.reviewer as Record<string, unknown>;
    if ('auto_transition_approve' in rev && rev.auto_transition_approve !== undefined) {
      errs.push(
        ...validateStringOrNull(
          rev.auto_transition_approve,
          'workflow.agents.reviewer.auto_transition_approve',
        ),
      );
    }
    if ('auto_transition_changes' in rev && rev.auto_transition_changes !== undefined) {
      errs.push(
        ...validateStringOrNull(
          rev.auto_transition_changes,
          'workflow.agents.reviewer.auto_transition_changes',
        ),
      );
    }
  }
  if (agents.iterator !== undefined) {
    errs.push(...validateWorkflowAgentBase(agents.iterator, 'workflow.agents.iterator'));
    const iter = agents.iterator as Record<string, unknown>;
    if ('auto_transition' in iter && iter.auto_transition !== undefined) {
      errs.push(
        ...validateStringOrNull(iter.auto_transition, 'workflow.agents.iterator.auto_transition'),
      );
    }
  }
  if (agents.merger !== undefined) {
    errs.push(...validateWorkflowAgentBase(agents.merger, 'workflow.agents.merger'));
    if (agents.merger && typeof agents.merger === 'object') {
      const merger = agents.merger as Record<string, unknown>;
      if ('auto_transition_done' in merger && merger.auto_transition_done !== undefined) {
        errs.push(
          ...validateStringOrNull(
            merger.auto_transition_done,
            'workflow.agents.merger.auto_transition_done',
          ),
        );
      }
    }
  }

  return errs;
}

function validateConfigShape(raw: unknown): ValidationError[] {
  if (!raw || typeof raw !== 'object') return ['config: must be an object'];
  const c = raw as Record<string, unknown>;
  const errs: ValidationError[] = [];

  if (c.models !== undefined) {
    if (!c.models || typeof c.models !== 'object') {
      errs.push('models: must be an object');
    } else {
      const m = c.models as Record<string, unknown>;
      for (const key of ['refiner', 'dev', 'review', 'iterate'] as const) {
        if (m[key] !== undefined) {
          errs.push(...validateLlmRoute(m[key], `models.${String(key)}`));
        }
      }
    }
  }

  if (c.limits !== undefined) {
    if (!c.limits || typeof c.limits !== 'object') {
      errs.push('limits: must be an object');
    } else {
      const l = c.limits as Record<string, unknown>;
      if (l.max_iterations !== undefined)
        errs.push(...validatePosInt(l.max_iterations, 'limits.max_iterations'));
      if (l.max_agent_iterations !== undefined)
        errs.push(...validatePosInt(l.max_agent_iterations, 'limits.max_agent_iterations'));
      if (l.max_tokens_per_run !== undefined)
        errs.push(...validatePosInt(l.max_tokens_per_run, 'limits.max_tokens_per_run'));
      if (l.max_tokens_per_message !== undefined)
        errs.push(...validatePosInt(l.max_tokens_per_message, 'limits.max_tokens_per_message'));
      if (l.max_cost_eur_per_run !== undefined)
        errs.push(...validatePosNumber(l.max_cost_eur_per_run, 'limits.max_cost_eur_per_run'));
      if (l.bash_timeout_ms !== undefined)
        errs.push(...validatePosInt(l.bash_timeout_ms, 'limits.bash_timeout_ms'));
      if (l.bash_timeout_max_ms !== undefined)
        errs.push(...validatePosInt(l.bash_timeout_max_ms, 'limits.bash_timeout_max_ms'));
      if (l.grep_timeout_ms !== undefined)
        errs.push(...validatePosInt(l.grep_timeout_ms, 'limits.grep_timeout_ms'));
      if (l.anthropic_verify_timeout_ms !== undefined)
        errs.push(
          ...validatePosInt(l.anthropic_verify_timeout_ms, 'limits.anthropic_verify_timeout_ms'),
        );
      if (l.jira_retry_base_delay_ms !== undefined)
        errs.push(...validatePosInt(l.jira_retry_base_delay_ms, 'limits.jira_retry_base_delay_ms'));
      if (l.jira_retry_max_attempts !== undefined)
        errs.push(...validatePosInt(l.jira_retry_max_attempts, 'limits.jira_retry_max_attempts'));
      if (l.envelope_instructions_chars !== undefined)
        errs.push(
          ...validatePosInt(l.envelope_instructions_chars, 'limits.envelope_instructions_chars'),
        );
      if (l.project_snippet_bytes !== undefined)
        errs.push(...validatePosInt(l.project_snippet_bytes, 'limits.project_snippet_bytes'));
      if (l.agent_extension_bytes !== undefined)
        errs.push(...validatePosInt(l.agent_extension_bytes, 'limits.agent_extension_bytes'));
      if (l.tldr_total_chars !== undefined)
        errs.push(...validatePosInt(l.tldr_total_chars, 'limits.tldr_total_chars'));
      if (l.tldr_verdict_chars !== undefined)
        errs.push(...validatePosInt(l.tldr_verdict_chars, 'limits.tldr_verdict_chars'));
      if (l.file_display_chars !== undefined)
        errs.push(...validatePosInt(l.file_display_chars, 'limits.file_display_chars'));
      if (l.refiner_subtask_cap !== undefined)
        errs.push(...validatePosInt(l.refiner_subtask_cap, 'limits.refiner_subtask_cap'));
      if (l.refiner_touch_paths_cap !== undefined)
        errs.push(...validatePosInt(l.refiner_touch_paths_cap, 'limits.refiner_touch_paths_cap'));
      if (l.reviewer_max_iterations !== undefined)
        errs.push(...validatePosInt(l.reviewer_max_iterations, 'limits.reviewer_max_iterations'));
      if (l.reviewer_max_tokens !== undefined)
        errs.push(...validatePosInt(l.reviewer_max_tokens, 'limits.reviewer_max_tokens'));
      if (l.reconciler_stale_window_minutes !== undefined)
        errs.push(
          ...validatePosInt(
            l.reconciler_stale_window_minutes,
            'limits.reconciler_stale_window_minutes',
          ),
        );
    }
  }

  if (c.ticket_types !== undefined) {
    if (!c.ticket_types || typeof c.ticket_types !== 'object') {
      errs.push('ticket_types: must be an object');
    } else {
      const t = c.ticket_types as Record<string, unknown>;
      if (t.refine_allowlist !== undefined)
        errs.push(...validateStringArray(t.refine_allowlist, 'ticket_types.refine_allowlist'));
      if (t.dev_allowlist !== undefined)
        errs.push(...validateStringArray(t.dev_allowlist, 'ticket_types.dev_allowlist'));
    }
  }

  if (c.git !== undefined) {
    if (!c.git || typeof c.git !== 'object' || Array.isArray(c.git)) {
      errs.push('git: must be an object');
    } else {
      const g = c.git as Record<string, unknown>;
      if (
        g.base_branch !== undefined &&
        g.base_branch !== null &&
        typeof g.base_branch !== 'string'
      ) {
        errs.push('git.base_branch: must be a string or null');
      }
      if (
        g.base_branch !== undefined &&
        typeof g.base_branch === 'string' &&
        g.base_branch.trim() === ''
      ) {
        errs.push('git.base_branch: must be a non-empty string or null');
      }
      if (
        g.target_branch !== undefined &&
        g.target_branch !== null &&
        typeof g.target_branch !== 'string'
      ) {
        errs.push('git.target_branch: must be a string or null');
      }
      if (
        g.target_branch !== undefined &&
        typeof g.target_branch === 'string' &&
        g.target_branch.trim() === ''
      ) {
        errs.push('git.target_branch: must be a non-empty string or null');
      }
      if (g.working_branch_prefix !== undefined) {
        if (typeof g.working_branch_prefix === 'string') {
          if (g.working_branch_prefix.length === 0) {
            errs.push('git.working_branch_prefix: must be a non-empty string');
          }
        } else if (
          g.working_branch_prefix !== null &&
          typeof g.working_branch_prefix === 'object' &&
          !Array.isArray(g.working_branch_prefix)
        ) {
          const mapping = g.working_branch_prefix as Record<string, unknown>;
          if (!('default' in mapping)) {
            errs.push('git.working_branch_prefix: mapping must include a "default" key');
          }
          for (const [k, v] of Object.entries(mapping)) {
            if (typeof v !== 'string' || v.length === 0) {
              errs.push(`git.working_branch_prefix.${k}: must be a non-empty string`);
            }
          }
        } else {
          errs.push(
            'git.working_branch_prefix: must be a non-empty string or a mapping object with a "default" key',
          );
        }
      }
    }
  }

  if (c.labels !== undefined) {
    if (!c.labels || typeof c.labels !== 'object' || Array.isArray(c.labels)) {
      errs.push('labels: must be an object mapping label names to capability entries');
    } else {
      for (const [labelName, entry] of Object.entries(c.labels as Record<string, unknown>)) {
        const fieldPath = `labels.${labelName}`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          errs.push(`${fieldPath}: must be an object`);
          continue;
        }
        const e = entry as Record<string, unknown>;
        if (e.mcp_servers !== undefined)
          errs.push(...validateStringArray(e.mcp_servers, `${fieldPath}.mcp_servers`));
        if (e.tools !== undefined) errs.push(...validateStringArray(e.tools, `${fieldPath}.tools`));
      }
    }
  }

  if (c.workflow !== undefined) {
    errs.push(...validateWorkflow(c.workflow));
  }

  if (c.safety !== undefined) {
    if (!c.safety || typeof c.safety !== 'object' || Array.isArray(c.safety)) {
      errs.push('safety: must be an object');
    } else {
      const s = c.safety as Record<string, unknown>;
      if (s.allow_skip_review !== undefined && typeof s.allow_skip_review !== 'boolean') {
        errs.push('safety.allow_skip_review: must be a boolean');
      }
    }
  }

  if (
    c.execution_path !== undefined &&
    c.execution_path !== 'script' &&
    c.execution_path !== 'claude-code' &&
    c.execution_path !== 'codex-cli'
  ) {
    errs.push('execution_path: must be "script", "claude-code", or "codex-cli"');
  }

  if (c.routing !== undefined) {
    if (!c.routing || typeof c.routing !== 'object' || Array.isArray(c.routing)) {
      errs.push('routing: must be an object');
    } else {
      const r = c.routing as Record<string, unknown>;
      if (r.claude_code_round_trip_threshold !== undefined) {
        errs.push(
          ...validatePosInt(
            r.claude_code_round_trip_threshold,
            'routing.claude_code_round_trip_threshold',
          ),
        );
      }
    }
  }

  return errs;
}

// --- File reading ---

type RawConfig = Record<string, unknown>;

function readJsonConfig(filePath: string): RawConfig {
  const raw = readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw) as RawConfig;
  } catch (e) {
    throw new FerryError('state-invariant', {
      reason: 'invalid-ferry-config',
      file: path.basename(filePath),
      error: (e as Error).message,
    });
  }
}

function readYamlConfig(filePath: string): RawConfig {
  // Requires the `yaml` npm package: npm install yaml
  let parseYaml: (s: string) => unknown;
  try {
    const mod = _require('yaml') as { parse: (s: string) => unknown };
    parseYaml = mod.parse;
  } catch {
    throw new FerryError('state-invariant', {
      reason: 'invalid-ferry-config',
      file: path.basename(filePath),
      error: 'YAML config requires the "yaml" package: npm install yaml',
    });
  }
  const raw = readFileSync(filePath, 'utf8');
  try {
    return parseYaml(raw) as RawConfig;
  } catch (e) {
    throw new FerryError('state-invariant', {
      reason: 'invalid-ferry-config',
      file: path.basename(filePath),
      error: (e as Error).message,
    });
  }
}

function findAndReadConfigFile(repoRoot: string): RawConfig | null {
  const candidates: Array<{ file: string; reader: (p: string) => RawConfig }> = [
    { file: 'ferry.config.json', reader: readJsonConfig },
    { file: 'ferry.config.yaml', reader: readYamlConfig },
    { file: 'ferry.config.yml', reader: readYamlConfig },
  ];

  for (const { file, reader } of candidates) {
    const filePath = path.join(repoRoot, file);
    if (!existsSync(filePath)) continue;
    return reader(filePath);
  }
  return null;
}

// --- Merging ---

function mergeWithDefaults(raw: RawConfig): FerryConfig {
  const m = (raw.models ?? {}) as Record<string, unknown>;
  const l = (raw.limits ?? {}) as Record<string, unknown>;
  const t = (raw.ticket_types ?? {}) as Record<string, unknown>;
  const g = (raw.git ?? {}) as Record<string, unknown>;

  const route = (val: unknown, def: LlmRoute): LlmRoute => {
    if (!val || typeof val !== 'object') return def;
    const r = val as Record<string, unknown>;
    return {
      provider: (r.provider as LlmRoute['provider']) ?? def.provider,
      model: (r.model as string) ?? def.model,
    };
  };

  const num = (val: unknown, def: number): number => (typeof val === 'number' ? val : def);
  const strArr = (val: unknown, def: string[]): string[] =>
    Array.isArray(val) ? (val as string[]) : def;
  const nullableStr = (val: unknown, def: string | null): string | null => {
    if (val === null) return null;
    if (typeof val === 'string') return val;
    return def;
  };

  const labelsRaw = raw.labels;
  let labels: Record<string, LabelCapability> | undefined;
  if (labelsRaw && typeof labelsRaw === 'object' && !Array.isArray(labelsRaw)) {
    labels = {};
    for (const [name, entry] of Object.entries(labelsRaw as Record<string, unknown>)) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const e = entry as Record<string, unknown>;
        labels[name] = {
          ...(Array.isArray(e.mcp_servers) ? { mcp_servers: e.mcp_servers as string[] } : {}),
          ...(Array.isArray(e.tools) ? { tools: e.tools as string[] } : {}),
        };
      }
    }
  }

  return {
    models: {
      refiner: route(m.refiner, DEFAULT_FERRY_CONFIG.models.refiner),
      dev: route(m.dev, DEFAULT_FERRY_CONFIG.models.dev),
      review: route(m.review, DEFAULT_FERRY_CONFIG.models.review),
      iterate: route(m.iterate, DEFAULT_FERRY_CONFIG.models.iterate),
    },
    limits: {
      max_iterations: num(l.max_iterations, DEFAULT_FERRY_CONFIG.limits.max_iterations),
      max_agent_iterations: num(
        l.max_agent_iterations,
        DEFAULT_FERRY_CONFIG.limits.max_agent_iterations,
      ),
      max_tokens_per_run: num(l.max_tokens_per_run, DEFAULT_FERRY_CONFIG.limits.max_tokens_per_run),
      max_tokens_per_message: num(
        l.max_tokens_per_message,
        DEFAULT_FERRY_CONFIG.limits.max_tokens_per_message,
      ),
      max_cost_eur_per_run: num(
        l.max_cost_eur_per_run,
        DEFAULT_FERRY_CONFIG.limits.max_cost_eur_per_run,
      ),
      bash_timeout_ms: num(l.bash_timeout_ms, DEFAULT_FERRY_CONFIG.limits.bash_timeout_ms),
      bash_timeout_max_ms: num(
        l.bash_timeout_max_ms,
        DEFAULT_FERRY_CONFIG.limits.bash_timeout_max_ms,
      ),
      grep_timeout_ms: num(l.grep_timeout_ms, DEFAULT_FERRY_CONFIG.limits.grep_timeout_ms),
      anthropic_verify_timeout_ms: num(
        l.anthropic_verify_timeout_ms,
        DEFAULT_FERRY_CONFIG.limits.anthropic_verify_timeout_ms,
      ),
      jira_retry_base_delay_ms: num(
        l.jira_retry_base_delay_ms,
        DEFAULT_FERRY_CONFIG.limits.jira_retry_base_delay_ms,
      ),
      jira_retry_max_attempts: num(
        l.jira_retry_max_attempts,
        DEFAULT_FERRY_CONFIG.limits.jira_retry_max_attempts,
      ),
      envelope_instructions_chars: num(
        l.envelope_instructions_chars,
        DEFAULT_FERRY_CONFIG.limits.envelope_instructions_chars,
      ),
      project_snippet_bytes: num(
        l.project_snippet_bytes,
        DEFAULT_FERRY_CONFIG.limits.project_snippet_bytes,
      ),
      agent_extension_bytes: num(
        l.agent_extension_bytes,
        DEFAULT_FERRY_CONFIG.limits.agent_extension_bytes,
      ),
      tldr_total_chars: num(l.tldr_total_chars, DEFAULT_FERRY_CONFIG.limits.tldr_total_chars),
      tldr_verdict_chars: num(l.tldr_verdict_chars, DEFAULT_FERRY_CONFIG.limits.tldr_verdict_chars),
      file_display_chars: num(l.file_display_chars, DEFAULT_FERRY_CONFIG.limits.file_display_chars),
      refiner_subtask_cap: num(
        l.refiner_subtask_cap,
        DEFAULT_FERRY_CONFIG.limits.refiner_subtask_cap,
      ),
      refiner_touch_paths_cap: num(
        l.refiner_touch_paths_cap,
        DEFAULT_FERRY_CONFIG.limits.refiner_touch_paths_cap,
      ),
      reviewer_max_iterations: num(
        l.reviewer_max_iterations,
        DEFAULT_FERRY_CONFIG.limits.reviewer_max_iterations,
      ),
      reviewer_max_tokens: num(
        l.reviewer_max_tokens,
        DEFAULT_FERRY_CONFIG.limits.reviewer_max_tokens,
      ),
      reconciler_stale_window_minutes: num(
        l.reconciler_stale_window_minutes,
        DEFAULT_FERRY_CONFIG.limits.reconciler_stale_window_minutes,
      ),
    },
    ticket_types: {
      refine_allowlist: strArr(
        t.refine_allowlist,
        DEFAULT_FERRY_CONFIG.ticket_types.refine_allowlist,
      ),
      dev_allowlist: strArr(t.dev_allowlist, DEFAULT_FERRY_CONFIG.ticket_types.dev_allowlist),
    },
    git: {
      base_branch:
        'base_branch' in g
          ? nullableStr(g.base_branch, null)
          : DEFAULT_FERRY_CONFIG.git.base_branch,
      target_branch:
        'target_branch' in g
          ? nullableStr(g.target_branch, null)
          : DEFAULT_FERRY_CONFIG.git.target_branch,
      working_branch_prefix:
        typeof g.working_branch_prefix === 'string'
          ? g.working_branch_prefix
          : g.working_branch_prefix !== null &&
              typeof g.working_branch_prefix === 'object' &&
              !Array.isArray(g.working_branch_prefix)
            ? (g.working_branch_prefix as Record<string, string>)
            : DEFAULT_FERRY_CONFIG.git.working_branch_prefix,
    },
    ...(labels !== undefined ? { labels } : {}),
    workflow: mergeWorkflow(raw.workflow),
    ...(['script', 'claude-code', 'codex-cli'].includes(raw.execution_path as string)
      ? { execution_path: raw.execution_path as ExecutionPath }
      : {}),
    routing: {
      claude_code_round_trip_threshold: num(
        (raw.routing as Record<string, unknown> | undefined)?.claude_code_round_trip_threshold,
        DEFAULT_FERRY_CONFIG.routing.claude_code_round_trip_threshold,
      ),
    },
    ...(raw.safety && typeof raw.safety === 'object' && !Array.isArray(raw.safety)
      ? {
          safety: {
            ...(typeof (raw.safety as Record<string, unknown>).allow_skip_review === 'boolean'
              ? {
                  allow_skip_review: (raw.safety as Record<string, unknown>)
                    .allow_skip_review as boolean,
                }
              : {}),
          },
        }
      : {}),
  };
}

function mergeWorkflow(rawWorkflow: unknown): WorkflowConfig {
  const def = DEFAULT_FERRY_CONFIG.workflow;
  if (!rawWorkflow || typeof rawWorkflow !== 'object') return def;
  const w = rawWorkflow as Record<string, unknown>;
  if (!w.agents || typeof w.agents !== 'object') return def;
  const agents = w.agents as Record<string, unknown>;

  const str = (val: unknown, def: string): string => (typeof val === 'string' ? val : def);
  const strOrNull = (
    obj: Record<string, unknown>,
    key: string,
    def: string | null,
  ): string | null =>
    key in obj
      ? obj[key] === null
        ? null
        : typeof obj[key] === 'string'
          ? (obj[key] as string)
          : def
      : def;

  const refinerRaw =
    agents.refiner && typeof agents.refiner === 'object'
      ? (agents.refiner as Record<string, unknown>)
      : {};
  const devRaw =
    agents.developer && typeof agents.developer === 'object'
      ? (agents.developer as Record<string, unknown>)
      : {};
  const revRaw =
    agents.reviewer && typeof agents.reviewer === 'object'
      ? (agents.reviewer as Record<string, unknown>)
      : {};
  const iterRaw =
    agents.iterator && typeof agents.iterator === 'object'
      ? (agents.iterator as Record<string, unknown>)
      : {};
  const mergerRaw =
    agents.merger && typeof agents.merger === 'object'
      ? (agents.merger as Record<string, unknown>)
      : {};

  return {
    agents: {
      refiner: {
        trigger_column: str(refinerRaw.trigger_column, def.agents.refiner.trigger_column),
        auto_transition: null,
      },
      developer: {
        trigger_column: str(devRaw.trigger_column, def.agents.developer.trigger_column),
        auto_transition: strOrNull(devRaw, 'auto_transition', def.agents.developer.auto_transition),
      },
      reviewer: {
        trigger_column: str(revRaw.trigger_column, def.agents.reviewer.trigger_column),
        auto_transition_approve: strOrNull(
          revRaw,
          'auto_transition_approve',
          def.agents.reviewer.auto_transition_approve,
        ),
        auto_transition_changes: strOrNull(
          revRaw,
          'auto_transition_changes',
          def.agents.reviewer.auto_transition_changes,
        ),
      },
      iterator: {
        trigger_column: str(iterRaw.trigger_column, def.agents.iterator.trigger_column),
        auto_transition: strOrNull(iterRaw, 'auto_transition', def.agents.iterator.auto_transition),
      },
      merger: {
        trigger_column: str(mergerRaw.trigger_column, def.agents.merger.trigger_column),
        auto_transition_done: strOrNull(
          mergerRaw,
          'auto_transition_done',
          def.agents.merger.auto_transition_done,
        ),
      },
    },
  };
}

// --- Env var overrides ---

function applyEnvOverrides(cfg: FerryConfig): FerryConfig {
  const models = { ...cfg.models };
  const limits = { ...cfg.limits };

  const providerFromEnv = (val: string | undefined): LlmRoute['provider'] | undefined => {
    if (val === 'anthropic' || val === 'openai' || val === 'google') return val;
    return undefined;
  };

  const refinerProvider = providerFromEnv(process.env.FERRY_REFINER_PROVIDER);
  if (refinerProvider) models.refiner = { ...models.refiner, provider: refinerProvider };
  if (process.env.FERRY_REFINER_MODEL) {
    models.refiner = { ...models.refiner, model: process.env.FERRY_REFINER_MODEL };
  }

  const devProvider = providerFromEnv(process.env.FERRY_DEV_PROVIDER);
  if (devProvider) models.dev = { ...models.dev, provider: devProvider };
  if (process.env.FERRY_DEV_MODEL) {
    models.dev = { ...models.dev, model: process.env.FERRY_DEV_MODEL };
  }

  const reviewProvider = providerFromEnv(process.env.FERRY_REVIEW_PROVIDER);
  if (reviewProvider) models.review = { ...models.review, provider: reviewProvider };
  if (process.env.FERRY_REVIEW_MODEL) {
    models.review = { ...models.review, model: process.env.FERRY_REVIEW_MODEL };
  }

  const iterProvider = providerFromEnv(process.env.FERRY_ITER_PROVIDER);
  if (iterProvider) models.iterate = { ...models.iterate, provider: iterProvider };
  if (process.env.FERRY_ITER_MODEL) {
    models.iterate = { ...models.iterate, model: process.env.FERRY_ITER_MODEL };
  }

  const maxAgentIter = parseInt(process.env.FERRY_DEV_MAX_ITERATIONS ?? '', 10);
  if (Number.isFinite(maxAgentIter)) limits.max_agent_iterations = maxAgentIter;

  const maxInputTok = parseInt(process.env.FERRY_DEV_MAX_INPUT_TOKENS ?? '', 10);
  if (Number.isFinite(maxInputTok)) limits.max_tokens_per_run = maxInputTok;

  const maxTok = parseInt(process.env.FERRY_DEV_MAX_TOKENS ?? '', 10);
  if (Number.isFinite(maxTok)) limits.max_tokens_per_message = maxTok;

  const maxCost = parseFloat(process.env.FERRY_MAX_COST_EUR_PER_RUN ?? '');
  if (Number.isFinite(maxCost)) limits.max_cost_eur_per_run = maxCost;

  // P1 env var overrides for new limit fields
  const envInt = (key: string): number | undefined => {
    const v = parseInt(process.env[key] ?? '', 10);
    return Number.isFinite(v) ? v : undefined;
  };

  const bashTimeoutMs = envInt('FERRY_BASH_TIMEOUT_MS');
  if (bashTimeoutMs !== undefined) limits.bash_timeout_ms = bashTimeoutMs;
  const bashTimeoutMaxMs = envInt('FERRY_BASH_TIMEOUT_MAX_MS');
  if (bashTimeoutMaxMs !== undefined) limits.bash_timeout_max_ms = bashTimeoutMaxMs;
  const grepTimeoutMs = envInt('FERRY_GREP_TIMEOUT_MS');
  if (grepTimeoutMs !== undefined) limits.grep_timeout_ms = grepTimeoutMs;
  const anthropicVerifyTimeoutMs = envInt('FERRY_ANTHROPIC_VERIFY_TIMEOUT_MS');
  if (anthropicVerifyTimeoutMs !== undefined)
    limits.anthropic_verify_timeout_ms = anthropicVerifyTimeoutMs;
  const jiraRetryBaseDelayMs = envInt('FERRY_JIRA_RETRY_BASE_DELAY_MS');
  if (jiraRetryBaseDelayMs !== undefined) limits.jira_retry_base_delay_ms = jiraRetryBaseDelayMs;
  const jiraRetryMaxAttempts = envInt('FERRY_JIRA_RETRY_MAX_ATTEMPTS');
  if (jiraRetryMaxAttempts !== undefined) limits.jira_retry_max_attempts = jiraRetryMaxAttempts;
  const envelopeInstructionsChars = envInt('FERRY_ENVELOPE_INSTRUCTIONS_CHARS');
  if (envelopeInstructionsChars !== undefined)
    limits.envelope_instructions_chars = envelopeInstructionsChars;
  const projectSnippetBytes = envInt('FERRY_PROJECT_SNIPPET_BYTES');
  if (projectSnippetBytes !== undefined) limits.project_snippet_bytes = projectSnippetBytes;
  const agentExtensionBytes = envInt('FERRY_AGENT_EXTENSION_BYTES');
  if (agentExtensionBytes !== undefined) limits.agent_extension_bytes = agentExtensionBytes;
  const tldrTotalChars = envInt('FERRY_TLDR_TOTAL_CHARS');
  if (tldrTotalChars !== undefined) limits.tldr_total_chars = tldrTotalChars;
  const tldrVerdictChars = envInt('FERRY_TLDR_VERDICT_CHARS');
  if (tldrVerdictChars !== undefined) limits.tldr_verdict_chars = tldrVerdictChars;
  const fileDisplayChars = envInt('FERRY_FILE_DISPLAY_CHARS');
  if (fileDisplayChars !== undefined) limits.file_display_chars = fileDisplayChars;
  const refinerSubtaskCap = envInt('FERRY_REFINER_SUBTASK_CAP');
  if (refinerSubtaskCap !== undefined) limits.refiner_subtask_cap = refinerSubtaskCap;
  const refinerTouchPathsCap = envInt('FERRY_REFINER_TOUCH_PATHS_CAP');
  if (refinerTouchPathsCap !== undefined) limits.refiner_touch_paths_cap = refinerTouchPathsCap;
  const reviewerMaxIterations = envInt('FERRY_REVIEWER_MAX_ITERATIONS');
  if (reviewerMaxIterations !== undefined) limits.reviewer_max_iterations = reviewerMaxIterations;
  const reviewerMaxTokens = envInt('FERRY_REVIEWER_MAX_TOKENS');
  if (reviewerMaxTokens !== undefined) limits.reviewer_max_tokens = reviewerMaxTokens;
  const reconcilerStaleWindowMinutes = envInt('FERRY_RECONCILER_STALE_WINDOW_MINUTES');
  if (reconcilerStaleWindowMinutes !== undefined)
    limits.reconciler_stale_window_minutes = reconcilerStaleWindowMinutes;

  // Propagate resolved P1 limits as env vars so standalone modules can read them at call time.
  // This allows ferry.config.json values to reach modules that don't receive config directly.
  // Always overwrite so subsequent loadFerryConfig calls propagate updated config values.
  process.env.FERRY_BASH_TIMEOUT_MS = String(limits.bash_timeout_ms);
  process.env.FERRY_BASH_TIMEOUT_MAX_MS = String(limits.bash_timeout_max_ms);
  process.env.FERRY_GREP_TIMEOUT_MS = String(limits.grep_timeout_ms);
  process.env.FERRY_ANTHROPIC_VERIFY_TIMEOUT_MS = String(limits.anthropic_verify_timeout_ms);
  process.env.FERRY_JIRA_RETRY_BASE_DELAY_MS = String(limits.jira_retry_base_delay_ms);
  process.env.FERRY_JIRA_RETRY_MAX_ATTEMPTS = String(limits.jira_retry_max_attempts);
  process.env.FERRY_ENVELOPE_INSTRUCTIONS_CHARS = String(limits.envelope_instructions_chars);
  process.env.FERRY_PROJECT_SNIPPET_BYTES = String(limits.project_snippet_bytes);
  process.env.FERRY_AGENT_EXTENSION_BYTES = String(limits.agent_extension_bytes);
  process.env.FERRY_TLDR_TOTAL_CHARS = String(limits.tldr_total_chars);
  process.env.FERRY_TLDR_VERDICT_CHARS = String(limits.tldr_verdict_chars);
  process.env.FERRY_FILE_DISPLAY_CHARS = String(limits.file_display_chars);
  process.env.FERRY_REFINER_SUBTASK_CAP = String(limits.refiner_subtask_cap);
  process.env.FERRY_REFINER_TOUCH_PATHS_CAP = String(limits.refiner_touch_paths_cap);
  process.env.FERRY_REVIEWER_MAX_ITERATIONS = String(limits.reviewer_max_iterations);
  process.env.FERRY_REVIEWER_MAX_TOKENS = String(limits.reviewer_max_tokens);
  process.env.FERRY_RECONCILER_STALE_WINDOW_MINUTES = String(
    limits.reconciler_stale_window_minutes,
  );

  return { ...cfg, models, limits };
}

// --- Public API ---

export function parseFerryConfigJson(jsonContent: string): FerryConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonContent);
  } catch (e) {
    throw new FerryError('state-invariant', {
      reason: 'invalid-ferry-config',
      error: (e as Error).message,
    });
  }
  const errors = validateConfigShape(raw);
  if (errors.length > 0) {
    throw new FerryError('state-invariant', { reason: 'invalid-ferry-config', errors });
  }
  return applyEnvOverrides(mergeWithDefaults(raw as RawConfig));
}

export function loadFerryConfig(repoRoot?: string): FerryConfig {
  const root = repoRoot ?? process.env.GITHUB_WORKSPACE ?? process.cwd();
  const raw = findAndReadConfigFile(root);

  if (raw === null) {
    return applyEnvOverrides(DEFAULT_FERRY_CONFIG);
  }

  const errors = validateConfigShape(raw);
  if (errors.length > 0) {
    throw new FerryError('state-invariant', {
      reason: 'invalid-ferry-config',
      errors,
    });
  }

  return applyEnvOverrides(mergeWithDefaults(raw));
}
