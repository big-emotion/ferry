/**
 * Structured agent-output schema validation for the claude-code execution path.
 *
 * The claude-code-action reasoning core writes a single terminal JSON artifact
 * instead of calling the bundled `done` / `finish_review` tools. This module
 * validates that artifact fail-closed (ADR-0006 §2, decisions/0002 §B/§C):
 * an invalid or missing artifact throws `FerryError('state-invariant')` with
 * AJV instance paths only — never raw field values (mirrors
 * `src/lib/envelope/validate.ts`, NFR-S1).
 */
import { createRequire } from 'module';
import type { ValidateFunction } from 'ajv';
import { FerryError } from '../errors/index.js';

const _require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const outputSchema: Record<string, any> = _require('../../schemas/agent-output.v1.schema.json');

/* eslint-disable @typescript-eslint/no-explicit-any */
const ajvModule = _require('ajv/dist/2020') as {
  Ajv2020: new (opts?: any) => { compile: (s: any) => ValidateFunction };
};
const ajvInstance = new ajvModule.Ajv2020({ strict: true });
(_require('ajv-formats') as any).default(ajvInstance);
/* eslint-enable @typescript-eslint/no-explicit-any */

const validateFn: ValidateFunction = ajvInstance.compile(outputSchema);

export type AgentOutputRole = 'developer' | 'iterator' | 'reviewer' | 'refiner';
export type DeveloperOutcome = 'implemented' | 'already_satisfied' | 'blocked';
export type ReviewerVerdict = 'approved' | 'changes_requested';
export type RefinerResult = 'refined' | 'noop';

export interface DeveloperAgentOutput {
  version: 'v1';
  role: 'developer';
  outcome: DeveloperOutcome;
  summary: string;
  reason?: string;
  pr_url?: string;
}

export interface IteratorAgentOutput {
  version: 'v1';
  role: 'iterator';
  outcome: DeveloperOutcome;
  summary: string;
  reason?: string;
  pr_number?: number;
}

export interface ReviewerAgentOutput {
  version: 'v1';
  role: 'reviewer';
  verdict: ReviewerVerdict;
  review_comment: string;
  summary: string;
}

export interface RefinerAgentOutput {
  version: 'v1';
  role: 'refiner';
  result: RefinerResult;
  summary: string;
  created?: number;
  kept?: number;
  staled?: number;
  noop_reason?: string;
}

export type AgentOutputV1 =
  | DeveloperAgentOutput
  | IteratorAgentOutput
  | ReviewerAgentOutput
  | RefinerAgentOutput;

/**
 * Parses + validates the terminal agent artifact. `raw` may be a JSON string
 * (as written to a file by the action) or an already-parsed object.
 *
 * Fail-closed: malformed JSON or any schema violation throws
 * `FerryError('state-invariant')` carrying only AJV instance paths.
 */
export function validateAgentOutput(raw: unknown): AgentOutputV1 {
  let candidate: unknown = raw;
  if (typeof raw === 'string') {
    try {
      candidate = JSON.parse(raw);
    } catch {
      throw new FerryError('state-invariant', {
        reason: 'agent-output-invalid',
        paths: ['/ not-json'],
      });
    }
  }

  if (!validateFn(candidate)) {
    const safePaths = (validateFn.errors ?? []).map((e) => `${e.instancePath} ${e.keyword}`);
    throw new FerryError('state-invariant', {
      reason: 'agent-output-invalid',
      paths: safePaths,
    });
  }

  return candidate as AgentOutputV1;
}
