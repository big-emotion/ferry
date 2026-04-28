/**
 * Story 3-1: RefinerOutput JSON schema + types.
 *
 * The Refiner LLM must return JSON of this shape; downstream code (the
 * batch sub-task creator in 3-2) consumes the validated output.
 */

export interface RefinerSubtask {
  title: string;
  description: string;
}

export interface RefinerOutput {
  subtasks: RefinerSubtask[];
  touch_paths: string[];
  output_locale: 'en' | 'fr';
  audit_summary: string;
  attachments?: string[];
}

export const REFINER_OUTPUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ferry.dev/schemas/refiner-output.v1.json',
  type: 'object',
  required: ['subtasks', 'touch_paths', 'output_locale', 'audit_summary'],
  additionalProperties: false,
  properties: {
    subtasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'description'],
        additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', minLength: 1, maxLength: 4000 },
        },
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
