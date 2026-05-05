/**
 * Refiner × multi-provider end-to-end tests.
 *
 * Verifies that the Refiner produces a valid plan when `createLlmCall` is
 * wired with OpenAI or Google routes, using mocked SDKs so no real API keys
 * are needed. This exercises the full chain: route config → SDK mock →
 * LLM response → plan parsing/validation.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// vi.hoisted runs before all imports and const declarations.
// The plan JSON must be a literal inside the factory.
const { openaiMockCreate, googleMockGenerateContent, PLAN_JSON } = vi.hoisted(() => {
  const planJson =
    '{"actions":[{"type":"create","title":"Add feature X","description":"Implement X"}],"touch_paths":["src/feature-x.ts"],"output_locale":"en","audit_summary":"1 sub-task planned"}';
  return {
    PLAN_JSON: planJson,
    openaiMockCreate: vi.fn().mockResolvedValue({
      choices: [{ message: { content: planJson } }],
      usage: { prompt_tokens: 500, completion_tokens: 120 },
    }),
    googleMockGenerateContent: vi.fn().mockResolvedValue({
      text: planJson,
      usageMetadata: { promptTokenCount: 600, candidatesTokenCount: 150 },
    }),
  };
});

vi.mock('openai', () => {
  class RateLimitError extends Error {}
  class APIConnectionError extends Error {
    constructor(opts: { message: string }) {
      super(opts.message);
    }
  }
  class APIError extends Error {
    status = 0;
  }
  const fn = vi.fn().mockImplementation(function (this: unknown) {
    (this as { chat: unknown }).chat = { completions: { create: openaiMockCreate } };
  } as unknown as () => void);
  Object.assign(fn, { RateLimitError, APIConnectionError, APIError });
  return { default: fn };
});

vi.mock('@google/genai', () => {
  const fn = vi.fn().mockImplementation(function (this: unknown) {
    (this as { models: unknown }).models = { generateContent: googleMockGenerateContent };
  } as unknown as () => void);
  return { GoogleGenAI: fn };
});

import { createLlmCall } from '../../lib/llm/call.js';
import { runRefiner } from './refine.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validPlan = JSON.parse(PLAN_JSON) as any;

const ticket: Parameters<typeof runRefiner>[0]['ticket'] = {
  key: 'PROJ-1',
  title: 'Add feature X',
  description: 'We need feature X implemented.',
  comments: [],
  labels: ['feature'],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Refiner with OpenAI provider', () => {
  it('returns a valid plan when configured with gpt-4.1-mini', async () => {
    vi.stubEnv('FERRY_OPENAI_KEY', 'test-openai-key');
    const callLlm = createLlmCall({ provider: 'openai', model: 'gpt-4.1-mini' });
    const result = await runRefiner({ ticket, callLlm, runLink: 'https://example.com/run/1' });

    expect(result.plan).toEqual(validPlan);
    expect(result.auditSummary.subtaskCount).toBe(1);
    expect(result.auditSummary.costEur).toBeGreaterThan(0);
    expect(openaiMockCreate).toHaveBeenCalledOnce();
  });

  it('returns a valid plan when configured with gpt-4.1-nano', async () => {
    vi.stubEnv('FERRY_OPENAI_KEY', 'test-openai-key');
    const callLlm = createLlmCall({ provider: 'openai', model: 'gpt-4.1-nano' });
    const result = await runRefiner({ ticket, callLlm, runLink: 'r' });

    expect(result.plan.actions).toHaveLength(1);
    expect(result.plan.actions[0].type).toBe('create');
  });
});

describe('Refiner with Google provider', () => {
  it('returns a valid plan when configured with gemini-2.5-flash', async () => {
    vi.stubEnv('FERRY_GOOGLE_AI_KEY', 'test-google-key');
    const callLlm = createLlmCall({ provider: 'google', model: 'gemini-2.5-flash' });
    const result = await runRefiner({ ticket, callLlm, runLink: 'https://example.com/run/2' });

    expect(result.plan).toEqual(validPlan);
    expect(result.auditSummary.subtaskCount).toBe(1);
    expect(result.auditSummary.costEur).toBeGreaterThan(0);
    expect(googleMockGenerateContent).toHaveBeenCalledOnce();
  });

  it('returns a valid plan when configured with gemini-2.5-pro', async () => {
    vi.stubEnv('FERRY_GOOGLE_AI_KEY', 'test-google-key');
    const callLlm = createLlmCall({ provider: 'google', model: 'gemini-2.5-pro' });
    const result = await runRefiner({ ticket, callLlm, runLink: 'r' });

    expect(result.plan.actions).toHaveLength(1);
    expect(result.plan.touch_paths).toEqual(['src/feature-x.ts']);
  });
});
