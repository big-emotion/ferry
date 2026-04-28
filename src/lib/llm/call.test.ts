import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mock functions so they're accessible inside vi.mock factories and in tests
const { anthropicMockCreate, openaiMockCreate, googleMockGenerateContent } = vi.hoisted(() => ({
  anthropicMockCreate: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'anthropic response' }],
    usage: { input_tokens: 100, output_tokens: 50 },
  }),
  openaiMockCreate: vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'openai response' } }],
    usage: { prompt_tokens: 200, completion_tokens: 80 },
  }),
  googleMockGenerateContent: vi.fn().mockResolvedValue({
    text: 'google response',
    usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 120 },
  }),
}));

vi.mock('@anthropic-ai/sdk', () => {
  class RateLimitError extends Error {}
  class APIError extends Error { status = 0; }

  const fn = vi.fn().mockImplementation(function (this: unknown) {
    (this as { messages: { create: unknown } }).messages = { create: anthropicMockCreate };
  } as unknown as () => void);
  Object.assign(fn, { RateLimitError, APIError });
  return { default: fn };
});

vi.mock('openai', () => {
  class RateLimitError extends Error {}
  class APIConnectionError extends Error {
    constructor(opts: { message: string }) { super(opts.message); }
  }
  class APIError extends Error { status = 0; }

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

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createLlmCall } from './call.js';
import type { LlmRoute } from './config.js';

type ZeroArgClass = new () => Error;

describe('createLlmCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  describe('Anthropic provider', () => {
    const route: LlmRoute = { provider: 'anthropic', model: 'claude-sonnet-4-6' };

    it('throws FerryError("state-invariant") when FERRY_ANTHROPIC_KEY is missing', () => {
      vi.stubEnv('FERRY_ANTHROPIC_KEY', '');
      expect(() => createLlmCall(route)).toThrow(
        expect.objectContaining({ code: 'state-invariant', context: { reason: 'missing-env', key: 'FERRY_ANTHROPIC_KEY' } }),
      );
    });

    it('calls messages.create with correct args and returns LlmResult', async () => {
      vi.stubEnv('FERRY_ANTHROPIC_KEY', 'test-key');
      const llmCall = createLlmCall(route);
      const result = await llmCall('hello');

      expect(result.text).toBe('anthropic response');
      expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 50 });
      expect(result.usage!.costEur).toBeGreaterThan(0);
      expect(anthropicMockCreate).toHaveBeenCalledOnce();
      expect(anthropicMockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          messages: [{ role: 'user', content: 'hello' }],
        }),
      );
    });

    it('maps RateLimitError to FerryError("spend-cap") immediately (no retry)', async () => {
      vi.stubEnv('FERRY_ANTHROPIC_KEY', 'test-key');
      const RLE = Anthropic.RateLimitError as unknown as ZeroArgClass;
      anthropicMockCreate.mockRejectedValueOnce(new RLE());
      const llmCall = createLlmCall(route);
      await expect(llmCall('hi')).rejects.toMatchObject({ code: 'spend-cap' });
    });

    it('maps 5xx APIError through retry → FerryError("unknown") after exhaustion', async () => {
      vi.useFakeTimers();
      vi.stubEnv('FERRY_ANTHROPIC_KEY', 'test-key');
      const AE = Anthropic.APIError as unknown as ZeroArgClass;
      const serverErr = Object.assign(new AE(), { status: 500 });
      anthropicMockCreate
        .mockRejectedValueOnce(serverErr)
        .mockRejectedValueOnce(serverErr)
        .mockRejectedValueOnce(serverErr);
      const llmCall = createLlmCall(route);
      const check = expect(llmCall('hi')).rejects.toMatchObject({ code: 'unknown' });
      await vi.runAllTimersAsync();
      await check;
    });
  });

  describe('OpenAI provider', () => {
    const route: LlmRoute = { provider: 'openai', model: 'gpt-4.1-mini' };

    it('throws FerryError("state-invariant") when FERRY_OPENAI_KEY is missing', () => {
      vi.stubEnv('FERRY_OPENAI_KEY', '');
      expect(() => createLlmCall(route)).toThrow(
        expect.objectContaining({ code: 'state-invariant', context: { reason: 'missing-env', key: 'FERRY_OPENAI_KEY' } }),
      );
    });

    it('calls chat.completions.create with correct args and returns LlmResult', async () => {
      vi.stubEnv('FERRY_OPENAI_KEY', 'test-key');
      const llmCall = createLlmCall(route);
      const result = await llmCall('hello');

      expect(result.text).toBe('openai response');
      expect(result.usage).toMatchObject({ inputTokens: 200, outputTokens: 80 });
      expect(openaiMockCreate).toHaveBeenCalledOnce();
      expect(openaiMockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4.1-mini',
          max_tokens: 4096,
          messages: [{ role: 'user', content: 'hello' }],
        }),
      );
    });

    it('maps RateLimitError to FerryError("spend-cap") immediately (no retry)', async () => {
      vi.stubEnv('FERRY_OPENAI_KEY', 'test-key');
      const RLE = OpenAI.RateLimitError as unknown as ZeroArgClass;
      openaiMockCreate.mockRejectedValueOnce(new RLE());
      const llmCall = createLlmCall(route);
      await expect(llmCall('hi')).rejects.toMatchObject({ code: 'spend-cap' });
    });

    it('maps APIConnectionError through retry → FerryError("unknown") after exhaustion', async () => {
      vi.useFakeTimers();
      vi.stubEnv('FERRY_OPENAI_KEY', 'test-key');
      const ACE = OpenAI.APIConnectionError as unknown as new (opts: { message: string }) => Error;
      const netErr = new ACE({ message: 'ECONNREFUSED' });
      openaiMockCreate
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr);
      const llmCall = createLlmCall(route);
      const check = expect(llmCall('hi')).rejects.toMatchObject({ code: 'unknown' });
      await vi.runAllTimersAsync();
      await check;
    });
  });

  describe('Google provider', () => {
    const route: LlmRoute = { provider: 'google', model: 'gemini-2.5-flash' };

    it('throws FerryError("state-invariant") when FERRY_GOOGLE_AI_KEY is missing', () => {
      vi.stubEnv('FERRY_GOOGLE_AI_KEY', '');
      expect(() => createLlmCall(route)).toThrow(
        expect.objectContaining({ code: 'state-invariant', context: { reason: 'missing-env', key: 'FERRY_GOOGLE_AI_KEY' } }),
      );
    });

    it('calls models.generateContent with correct args and returns LlmResult', async () => {
      vi.stubEnv('FERRY_GOOGLE_AI_KEY', 'test-key');
      const llmCall = createLlmCall(route);
      const result = await llmCall('hello');

      expect(result.text).toBe('google response');
      expect(result.usage).toMatchObject({ inputTokens: 300, outputTokens: 120 });
      expect(googleMockGenerateContent).toHaveBeenCalledOnce();
      expect(googleMockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-2.5-flash', contents: 'hello' }),
      );
    });

    it('maps generic network error through retry → FerryError("unknown") after exhaustion', async () => {
      vi.useFakeTimers();
      vi.stubEnv('FERRY_GOOGLE_AI_KEY', 'test-key');
      const netErr = new Error('fetch failed');
      googleMockGenerateContent
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr);
      const llmCall = createLlmCall(route);
      const check = expect(llmCall('hi')).rejects.toMatchObject({ code: 'unknown' });
      await vi.runAllTimersAsync();
      await check;
    });
  });

  describe('LlmResult shape', () => {
    it('LlmResult has text, usage with inputTokens/outputTokens/costEur', async () => {
      vi.stubEnv('FERRY_ANTHROPIC_KEY', 'test-key');
      const route: LlmRoute = { provider: 'anthropic', model: 'claude-sonnet-4-6' };
      const llmCall = createLlmCall(route);
      const result = await llmCall('prompt');

      expect(typeof result.text).toBe('string');
      expect(result.usage).not.toBeNull();
      expect(typeof result.usage!.inputTokens).toBe('number');
      expect(typeof result.usage!.outputTokens).toBe('number');
      expect(typeof result.usage!.costEur).toBe('number');
    });
  });
});
