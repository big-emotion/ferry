/**
 * Story 3-1: Refiner core.
 *
 * Pure logic: receives a ticket payload + an injected LLM-call function and
 * returns a validated plan plus an audit summary. No Jira IO, no provider
 * SDK calls. The production agent shim wires the real LLM in `index.ts`.
 */

import { createRequire } from 'module';
import type { ValidateFunction } from 'ajv';
import { FerryError } from '../../lib/errors/index.js';
import { delimitUntrusted } from '../../lib/llm/delimit-untrusted.js';
import { REFINER_OUTPUT_SCHEMA, REFINER_TOUCH_PATHS_CAP, type RefinerOutput } from './schema.js';

const _require = createRequire(import.meta.url);

/* eslint-disable @typescript-eslint/no-explicit-any */
const ajvModule = _require('ajv/dist/2020') as {
  Ajv2020: new (opts?: any) => { compile: (s: any) => ValidateFunction };
};
const ajvInstance = new ajvModule.Ajv2020({ strict: true });
/* eslint-enable @typescript-eslint/no-explicit-any */

const validatePlan: ValidateFunction = ajvInstance.compile(REFINER_OUTPUT_SCHEMA);

export interface RefinerInput {
  ticket: {
    key: string;
    title: string;
    description: string;
    comments: string[];
    labels: string[];
    attachments?: string[];
  };
  callLlm: LlmCall;
  runLink: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  costEur: number;
}

export interface LlmResult {
  text: string;
  promptIncluded?: string;
  usage: LlmUsage | null;
}

export type LlmCall = (prompt: string) => Promise<LlmResult>;

export interface RefinerAuditSummary {
  subtaskCount: number;
  costEur: number;
  runLink: string;
  attachmentNames: string[];
}

export interface RefinerResult {
  plan: RefinerOutput;
  auditSummary: RefinerAuditSummary;
}

function buildPrompt(input: RefinerInput): string {
  const block = [
    `TICKET ${input.ticket.key}`,
    `TITLE: ${input.ticket.title}`,
    `LABELS: ${input.ticket.labels.join(', ')}`,
    `DESCRIPTION:\n${input.ticket.description}`,
    `COMMENTS:\n${input.ticket.comments.join('\n---\n')}`,
  ].join('\n\n');
  return [
    'You are the Ferry Refiner. Plan the work as JSON matching the RefinerOutput schema.',
    delimitUntrusted(block),
    'Reply with JSON only.',
  ].join('\n\n');
}

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
}

function parseJsonOrThrow(text: string): unknown {
  try {
    return JSON.parse(stripMarkdownFences(text));
  } catch {
    throw new FerryError('state-invariant', { reason: 'refiner-output-invalid' });
  }
}

function ensureSchemaValid(plan: unknown): asserts plan is RefinerOutput {
  if (!validatePlan(plan)) {
    throw new FerryError('state-invariant', {
      reason: 'refiner-output-invalid',
      paths: (validatePlan.errors ?? []).map((e) => `${e.instancePath} ${e.keyword}`),
    });
  }
}

export async function runRefiner(input: RefinerInput): Promise<RefinerResult> {
  const prompt = buildPrompt(input);
  const llm = await input.callLlm(prompt);
  const parsed = parseJsonOrThrow(llm.text);
  ensureSchemaValid(parsed);
  if (parsed.touch_paths.length > REFINER_TOUCH_PATHS_CAP) {
    throw new FerryError('oscillation', {
      reason: 'spec-too-broad',
      touchPaths: parsed.touch_paths.length,
      cap: REFINER_TOUCH_PATHS_CAP,
    });
  }
  return {
    plan: parsed,
    auditSummary: {
      subtaskCount: parsed.subtasks.length,
      costEur: llm.usage?.costEur ?? 0,
      runLink: input.runLink,
      attachmentNames: input.ticket.attachments ?? [],
    },
  };
}
