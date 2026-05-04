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
import { extractFirstJsonObject } from './parse.js';
import { REFINER_OUTPUT_SCHEMA, getRefinerTouchPathsCap, type RefinerOutput } from './schema.js';

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

const SCHEMA_EXAMPLE = `{
  "subtasks": [
    {
      "title": "imperative verb, specific, max 200 chars",
      "description": "concrete acceptance criteria, file paths, done criteria; max 4000 chars"
    }
  ],
  "touch_paths": ["src/path/to/file.ts"],
  "output_locale": "en",
  "audit_summary": "one sentence summarising the plan"
}`;

function buildPrompt(input: RefinerInput): string {
  const block = [
    `TICKET ${input.ticket.key}`,
    `TITLE: ${input.ticket.title}`,
    `LABELS: ${input.ticket.labels.join(', ')}`,
    `DESCRIPTION:\n${input.ticket.description}`,
    `COMMENTS:\n${input.ticket.comments.join('\n---\n')}`,
  ].join('\n\n');
  return [
    'You are the Ferry Refiner. Decompose the ticket into concrete sub-tasks.',
    'Reply with JSON only — no prose, no code fences — matching this exact schema:',
    SCHEMA_EXAMPLE,
    'Rules: max 12 subtasks (prefer 3–7). output_locale must be "en" or "fr" matching the ticket language. touch_paths lists every file the subtasks will touch (max 20).',
    delimitUntrusted(block),
  ].join('\n\n');
}

const SAMPLE_MAX = 512;

function sampleOf(text: string): string {
  return text.length <= SAMPLE_MAX ? text : text.slice(0, SAMPLE_MAX);
}

function parseJsonOrThrow(text: string): unknown {
  const candidate = extractFirstJsonObject(text);
  if (candidate !== null) {
    try {
      return JSON.parse(candidate);
    } catch {
      // fall through to throw below
    }
  }
  throw new FerryError('state-invariant', {
    reason: 'refiner-output-invalid',
    stage: 'parse',
    sample: sampleOf(text),
    text_length: text.length,
  });
}

function ensureSchemaValid(plan: unknown, rawText: string): asserts plan is RefinerOutput {
  if (!validatePlan(plan)) {
    throw new FerryError('state-invariant', {
      reason: 'refiner-output-invalid',
      stage: 'schema',
      paths: (validatePlan.errors ?? []).map((e) => `${e.instancePath} ${e.keyword}`),
      sample: sampleOf(rawText),
      text_length: rawText.length,
    });
  }
}

export async function runRefiner(input: RefinerInput): Promise<RefinerResult> {
  const prompt = buildPrompt(input);
  const llm = await input.callLlm(prompt);
  const parsed = parseJsonOrThrow(llm.text);
  ensureSchemaValid(parsed, llm.text);
  const touchPathsCap = getRefinerTouchPathsCap();
  if (parsed.touch_paths.length > touchPathsCap) {
    throw new FerryError('oscillation', {
      reason: 'spec-too-broad',
      touchPaths: parsed.touch_paths.length,
      cap: touchPathsCap,
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
