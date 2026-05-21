/**
 * The claude-code-action final structured-output artifact contract.
 *
 * `claude-code-action` runs an opaque agent loop — Ferry's own terminal tools
 * (`done`, `finish_review`) and the in-loop checkpoint tool (`commit_progress`)
 * do not exist inside it. Per ADR-0006 §2 / decisions/0002 §C, the LLM instead
 * writes its final result as JSON to a fixed repo-relative path; the
 * deterministic wrapper (#301) reads and parses it back into the *exact same
 * outcome objects the bundled script produces*, so the observable contract is
 * identical.
 *
 *   - developer / iterator  → `DonePayload` (the script's `done` outcome)
 *   - reviewer              → `ReviewerVerdict` (the script's `finish_review`)
 *   - refiner               → `RefinerArtifact` (the REFINER_OUTPUT_SCHEMA shape)
 *
 * `commit_progress` is an *in-loop* checkpoint (stage + scan + commit + push),
 * not a terminal result — on this path the LLM commits via native `git`
 * (bounded by the no-auto-merge allowlist, #303). It therefore has no terminal
 * artifact representation; the suffix instructs dev/iter accordingly.
 *
 * Parsing is fail-closed: any structural deviation throws (the wrapper treats
 * a throw as a hard `blocked`, mirroring the script's fail-closed schema
 * validation). Errors are tagged with the artifact path for operator triage.
 */

import type { DonePayload, DoneOutcome } from '../llm/agent-loop/types.js';
import type {
  RefinerAction,
  RefinerCostEstimate,
  RefinerOutput,
} from '../../agents/refiner/schema.js';
import type { FerryRole } from './tool-profiles.js';
import { ROLE_ACCESS } from './tool-profiles.js';

/** Repo-relative path the LLM must write its final structured result to. */
export const CC_OUTPUT_ARTIFACT_PATH = '.ferry/cc-output.json';

/** Reviewer terminal verdict — mirrors the `finish_review` tool input. */
export interface ReviewerVerdict {
  approved: boolean;
  comment: string;
}

/**
 * Refiner terminal output — alias of `RefinerOutput` from
 * `src/agents/refiner/schema.ts`, the single source of truth for the script
 * and claude-code paths. Re-exported so that any future schema change (new
 * action variant, additional required field, widened locale set, etc.)
 * propagates to both execution paths without silent drift.
 */
export type RefinerArtifact = RefinerOutput;

const DONE_OUTCOMES: readonly DoneOutcome[] = ['implemented', 'already_satisfied', 'blocked'];

function fail(detail: string): never {
  throw new Error(`Invalid ${CC_OUTPUT_ARTIFACT_PATH}: ${detail}`);
}

function asObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail('expected a JSON object');
  }
  return raw as Record<string, unknown>;
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((e) => typeof e === 'string');
}

/** developer / iterator — produces the same `DonePayload` the script's `done` tool yields. */
export function parseDevIterArtifact(raw: unknown): DonePayload {
  const o = asObject(raw);
  const outcome = o.outcome;
  if (typeof outcome !== 'string' || !DONE_OUTCOMES.includes(outcome as DoneOutcome)) {
    fail(`outcome must be one of ${DONE_OUTCOMES.join(', ')}`);
  }
  if (!nonEmptyString(o.summary)) fail('summary is required');
  if (o.validation !== undefined) {
    if (
      !Array.isArray(o.validation) ||
      !o.validation.every(
        (e) =>
          typeof e === 'object' &&
          e !== null &&
          nonEmptyString((e as Record<string, unknown>).command) &&
          typeof (e as Record<string, unknown>).outcome === 'string',
      )
    ) {
      fail('validation must be an array of { command, outcome }');
    }
  }
  if (o.notes !== undefined && !isStringArray(o.notes)) {
    fail('notes must be an array of strings');
  }
  const done: DoneOutcome = outcome as DoneOutcome;
  const payload: DonePayload = {
    actionable: done !== 'blocked',
    outcome: done,
    summary: (o.summary as string).trim(),
  };
  if (typeof o.commit_message === 'string') payload.commit_message = o.commit_message;
  if (typeof o.reason === 'string') payload.reason = o.reason;
  if (o.validation !== undefined) {
    payload.validation = o.validation as DonePayload['validation'];
  }
  if (o.notes !== undefined) payload.notes = o.notes as string[];
  return payload;
}

/** reviewer — produces the same verdict the script's `finish_review` tool yields. */
export function parseReviewerArtifact(raw: unknown): ReviewerVerdict {
  const o = asObject(raw);
  if (typeof o.approved !== 'boolean') fail('approved must be a boolean');
  if (!nonEmptyString(o.comment)) fail('comment is required');
  return { approved: o.approved, comment: o.comment };
}

function parseRefinerAction(a: unknown, idx: number): RefinerAction {
  const o = asObject(a);
  switch (o.type) {
    case 'create':
      if (!nonEmptyString(o.title) || !nonEmptyString(o.description)) {
        fail(`actions[${idx}] create requires title and description`);
      }
      return { type: 'create', title: o.title as string, description: o.description as string };
    case 'keep':
    case 'mark_stale':
      if (!nonEmptyString(o.existing_key) || !nonEmptyString(o.reason)) {
        fail(`actions[${idx}] ${o.type} requires existing_key and reason`);
      }
      return {
        type: o.type,
        existing_key: o.existing_key as string,
        reason: o.reason as string,
      };
    case 'noop':
      if (!nonEmptyString(o.reason)) fail(`actions[${idx}] noop requires reason`);
      return { type: 'noop', reason: o.reason as string };
    default:
      return fail(`actions[${idx}] has unknown type ${String(o.type)}`);
  }
}

function parseRefinerCostEstimate(raw: unknown): RefinerCostEstimate {
  const o = asObject(raw);
  if (typeof o.loUsd !== 'number' || !Number.isFinite(o.loUsd) || o.loUsd < 0) {
    fail('cost_estimate.loUsd must be a non-negative number');
  }
  if (typeof o.hiUsd !== 'number' || !Number.isFinite(o.hiUsd) || o.hiUsd < 0) {
    fail('cost_estimate.hiUsd must be a non-negative number');
  }
  if (o.confidence !== 'low' && o.confidence !== 'medium' && o.confidence !== 'high') {
    fail("cost_estimate.confidence must be 'low', 'medium', or 'high'");
  }
  if (
    typeof o.baselineRuns !== 'number' ||
    !Number.isInteger(o.baselineRuns) ||
    o.baselineRuns < 0
  ) {
    fail('cost_estimate.baselineRuns must be a non-negative integer');
  }
  return {
    loUsd: o.loUsd,
    hiUsd: o.hiUsd,
    confidence: o.confidence,
    baselineRuns: o.baselineRuns,
  };
}

/** refiner — produces the same `RefinerOutput`-shaped object the script yields. */
export function parseRefinerArtifact(raw: unknown): RefinerArtifact {
  const o = asObject(raw);
  if (!Array.isArray(o.actions) || o.actions.length === 0) {
    fail('actions must be a non-empty array');
  }
  if (!isStringArray(o.touch_paths)) fail('touch_paths must be an array of strings');
  if (o.output_locale !== 'en' && o.output_locale !== 'fr') {
    fail("output_locale must be 'en' or 'fr'");
  }
  if (!nonEmptyString(o.audit_summary)) fail('audit_summary is required');
  if (o.attachments !== undefined && !isStringArray(o.attachments)) {
    fail('attachments must be an array of strings');
  }
  const out: RefinerArtifact = {
    actions: (o.actions as unknown[]).map(parseRefinerAction),
    touch_paths: o.touch_paths,
    output_locale: o.output_locale,
    audit_summary: o.audit_summary,
  };
  if (o.attachments !== undefined) out.attachments = o.attachments;
  if (o.cost_estimate !== undefined) {
    out.cost_estimate = parseRefinerCostEstimate(o.cost_estimate);
  }
  return out;
}

export type ClaudeCodeArtifact = DonePayload | ReviewerVerdict | RefinerArtifact;

/** Dispatches the artifact to the role's parser. Fail-closed on an unknown role. */
export function parseClaudeCodeArtifact(role: FerryRole, raw: unknown): ClaudeCodeArtifact {
  switch (role) {
    case 'developer':
    case 'iterator':
      return parseDevIterArtifact(raw);
    case 'reviewer':
      return parseReviewerArtifact(raw);
    case 'refiner':
      return parseRefinerArtifact(raw);
    default:
      throw new Error(`unknown ferry role: ${String(role)}`);
  }
}

const DEV_ITER_SHAPE =
  '{ "outcome": "implemented" | "already_satisfied" | "blocked", "summary": string, ' +
  '"commit_message"?: string, "reason"?: string, ' +
  '"validation"?: [{ "command": string, "outcome": string }], "notes"?: string[] }';

const REVIEWER_SHAPE = '{ "approved": boolean, "comment": string }';

const REFINER_SHAPE =
  '{ "actions": [ ' +
  '{ "type": "create", "title": string, "description": string } | ' +
  '{ "type": "keep", "existing_key": string, "reason": string } | ' +
  '{ "type": "mark_stale", "existing_key": string, "reason": string } | ' +
  '{ "type": "noop", "reason": string } ' +
  '], "touch_paths": string[], "output_locale": "en" | "fr", "audit_summary": string }';

/**
 * The transport instruction appended to the (verbatim) initial prompt by the
 * wrapper. It does NOT rewrite `prompts/<agent>.md` — it tells the LLM how to
 * terminate on this path (write the artifact) since the `done`/`finish_review`
 * tools are absent here.
 */
export function outcomePromptSuffix(role: FerryRole): string {
  const header =
    `\n\n---\nFINAL OUTPUT (claude-code path): the \`done\`/\`finish_review\` tools are ` +
    `not available here. As your LAST action, write your result as a single JSON object ` +
    `to \`${CC_OUTPUT_ARTIFACT_PATH}\`, then stop.`;
  if (role === 'reviewer') {
    return `${header} Shape: ${REVIEWER_SHAPE}`;
  }
  if (role === 'refiner') {
    // The refiner system prompt (`prompts/refiner.md`) says "Reply with JSON
    // only. No prose before or after." twice — written for the script path,
    // where structured-output enforcement makes that instruction safe. On the
    // claude-code path there is no such enforcement: obeyed literally, the model
    // prints the JSON to chat and never calls `Write`, so the artifact is never
    // produced. This suffix therefore explicitly OVERRIDES that instruction.
    return (
      `\n\n---\nFINAL OUTPUT (claude-code path) — OVERRIDE.\n` +
      `Ignore any earlier instruction to "reply with JSON only" or to emit "no ` +
      `prose": those describe the script path. On THIS path there is no \`done\` ` +
      `tool and your chat reply is discarded. You MUST use the \`Write\` tool to ` +
      `create the file \`${CC_OUTPUT_ARTIFACT_PATH}\` as your LAST action — do not ` +
      `print the JSON to the chat. A run that ends without that file is a failure.\n` +
      `First explore the repository with the \`Read\`, \`Glob\` and \`Grep\` tools ` +
      `so the sub-task descriptions reference real file paths. Then write a single ` +
      `JSON object matching this exact schema (the bundled refiner contract): ` +
      `${REFINER_SHAPE}. Each action is one of: \`create\` a new sub-task, \`keep\` ` +
      `an existing one unchanged, \`mark_stale\` a superseded one, or \`noop\` when ` +
      `nothing has changed.`
    );
  }
  // developer / iterator
  const access = ROLE_ACCESS[role]; // referenced so the read-write contract is explicit
  return (
    `${header} Commit and push your work with \`git\` first (there is no ` +
    `\`commit_progress\` tool on this path; access=${access}). Then write: ${DEV_ITER_SHAPE}`
  );
}
