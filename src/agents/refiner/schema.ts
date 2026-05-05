/**
 * RefinerOutput JSON schema + types (v2 — content-aware reconciliation).
 *
 * The LLM must return a JSON object with an `actions` array. Each action is one of:
 *   - create: produce a new sub-task
 *   - keep: existing sub-task is still valid, no change
 *   - mark_stale: flag an existing sub-task as superseded (never delete it)
 *   - noop: nothing has changed, no writes needed
 */

export interface RefinerActionCreate {
  type: 'create';
  title: string;
  description: string;
}

export interface RefinerActionKeep {
  type: 'keep';
  existing_key: string;
  reason: string;
}

export interface RefinerActionMarkStale {
  type: 'mark_stale';
  existing_key: string;
  reason: string;
}

export interface RefinerActionNoop {
  type: 'noop';
  reason: string;
}

export type RefinerAction =
  | RefinerActionCreate
  | RefinerActionKeep
  | RefinerActionMarkStale
  | RefinerActionNoop;

export interface RefinerOutput {
  actions: RefinerAction[];
  touch_paths: string[];
  output_locale: 'en' | 'fr';
  audit_summary: string;
  attachments?: string[];
}

export const REFINER_OUTPUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ferry.dev/schemas/refiner-output.v2.json',
  type: 'object',
  required: ['actions', 'touch_paths', 'output_locale', 'audit_summary'],
  additionalProperties: false,
  properties: {
    actions: {
      type: 'array',
      minItems: 1,
      items: {
        anyOf: [
          {
            type: 'object',
            required: ['type', 'title', 'description'],
            additionalProperties: false,
            properties: {
              type: { const: 'create' },
              title: { type: 'string', minLength: 1, maxLength: 200 },
              description: { type: 'string', minLength: 1, maxLength: 4000 },
            },
          },
          {
            type: 'object',
            required: ['type', 'existing_key', 'reason'],
            additionalProperties: false,
            properties: {
              type: { const: 'keep' },
              existing_key: { type: 'string', minLength: 1 },
              reason: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            required: ['type', 'existing_key', 'reason'],
            additionalProperties: false,
            properties: {
              type: { const: 'mark_stale' },
              existing_key: { type: 'string', minLength: 1 },
              reason: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            required: ['type', 'reason'],
            additionalProperties: false,
            properties: {
              type: { const: 'noop' },
              reason: { type: 'string', minLength: 1 },
            },
          },
        ],
      },
    },
    touch_paths: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 400 },
    },
    output_locale: { enum: ['en', 'fr'] },
    audit_summary: { type: 'string', minLength: 1, maxLength: 2000 },
    attachments: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 400 },
    },
  },
} as const;

export const REFINER_TOUCH_PATHS_CAP = 20;

export function getRefinerTouchPathsCap(): number {
  return parseInt(process.env.FERRY_REFINER_TOUCH_PATHS_CAP ?? '', 10) || REFINER_TOUCH_PATHS_CAP;
}
