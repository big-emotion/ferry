import { describe, it, expect, vi, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { runReviewLoop } from './review-loop.js';
import type { CIRunner } from '../../lib/dispatch/runner/types.js';
import { FerryError } from '../../lib/errors/index.js';

type FakeMessage = {
  stop_reason: string;
  content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
};

function makeAnthropicMock(responses: FakeMessage[]) {
  let idx = 0;
  const create = vi.fn().mockImplementation(async () => {
    const r = responses[idx++];
    return {
      stop_reason: r.stop_reason,
      content: r.content,
      usage: r.usage,
    };
  });
  return {
    messages: { create },
    create,
  };
}

const finishReviewResponse: FakeMessage = {
  stop_reason: 'tool_use',
  content: [
    {
      type: 'tool_use',
      id: 'tu_finish',
      name: 'finish_review',
      input: { approved: true, comment: 'LGTM' },
    },
  ],
  usage: { input_tokens: 100, output_tokens: 50 },
};

const baseOpts = {
  model: 'm',
  system: 'sys',
  initialPrompt: 'review this',
  fileMap: new Map<string, string | undefined>(),
  runner: {} as unknown as CIRunner,
  owner: 'org',
  repo: 'repo',
  headSha: 'abc123',
};

describe('runReviewLoop', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('completes when finish_review is called', async () => {
    const mock = makeAnthropicMock([finishReviewResponse]);
    const result = await runReviewLoop({
      ...baseOpts,
      anthropic: mock as unknown as Anthropic,
    });
    expect(result.result.approved).toBe(true);
    expect(result.result.comment).toBe('LGTM');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  it('throws FerryError on unexpected stop_reason', async () => {
    const mock = makeAnthropicMock([
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ]);
    await expect(
      runReviewLoop({ ...baseOpts, anthropic: mock as unknown as Anthropic }),
    ).rejects.toThrow(FerryError);
  });

  it('emits debug "turn" JSON event when LOG_VERBOSITY=debug', async () => {
    vi.stubEnv('LOG_VERBOSITY', 'debug');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mock = makeAnthropicMock([finishReviewResponse]);

    await runReviewLoop({ ...baseOpts, anthropic: mock as unknown as Anthropic });

    const jsonCalls = spy.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => typeof s === 'string' && s.startsWith('{'));
    const turnRaw = jsonCalls.find((s) => s.includes('"type":"turn"'));
    expect(turnRaw).toBeDefined();
    const turnEvent = JSON.parse(turnRaw!) as Record<string, unknown>;
    expect(turnEvent).toMatchObject({
      type: 'turn',
      iter: 1,
      depth: 0,
      stop_reason: 'tool_use',
    });
    expect(typeof turnEvent['elapsed_ms']).toBe('number');
  });

  it('emits debug "result" JSON event on success when LOG_VERBOSITY=debug', async () => {
    vi.stubEnv('LOG_VERBOSITY', 'debug');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mock = makeAnthropicMock([finishReviewResponse]);

    await runReviewLoop({ ...baseOpts, anthropic: mock as unknown as Anthropic });

    const jsonCalls = spy.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => typeof s === 'string' && s.startsWith('{'));
    const resultRaw = jsonCalls.find((s) => s.includes('"type":"result"'));
    expect(resultRaw).toBeDefined();
    const resultEvent = JSON.parse(resultRaw!) as Record<string, unknown>;
    expect(resultEvent).toMatchObject({
      type: 'result',
      subtype: 'success',
      iterations: 1,
    });
    expect(typeof resultEvent['elapsed_ms']).toBe('number');
  });

  it('does not emit JSON events when LOG_VERBOSITY is unset', async () => {
    vi.stubEnv('LOG_VERBOSITY', '');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mock = makeAnthropicMock([finishReviewResponse]);

    await runReviewLoop({ ...baseOpts, anthropic: mock as unknown as Anthropic });

    const jsonCalls = spy.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => typeof s === 'string' && s.startsWith('{'));
    expect(jsonCalls).toHaveLength(0);
  });

  it('still emits terse [ferry:review-loop] line when debug is on (additive)', async () => {
    vi.stubEnv('LOG_VERBOSITY', 'debug');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mock = makeAnthropicMock([finishReviewResponse]);

    await runReviewLoop({ ...baseOpts, anthropic: mock as unknown as Anthropic });

    const terseCalls = spy.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => typeof s === 'string' && s.includes('[ferry:review-loop]'));
    expect(terseCalls.length).toBeGreaterThanOrEqual(1);
  });
});
