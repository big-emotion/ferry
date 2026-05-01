import { describe, it, expect, vi, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { runReviewLoop } from './review-loop.js';
import { createTestLogger } from '../../lib/logger/index.js';
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

  it('emits debug "turn" record when LOG_VERBOSITY=debug', async () => {
    vi.stubEnv('LOG_VERBOSITY', 'debug');
    const { logger, records } = createTestLogger('evt-review', 'ferry:review-loop');
    const mock = makeAnthropicMock([finishReviewResponse]);

    await runReviewLoop({ ...baseOpts, anthropic: mock as unknown as Anthropic, logger });

    const turnRecord = records.find((r) => r.level === 'debug' && r.message === 'turn');
    expect(turnRecord).toBeDefined();
    expect(turnRecord).toMatchObject({
      type: 'turn',
      iter: 1,
      depth: 0,
      stop_reason: 'tool_use',
    });
    expect(typeof turnRecord?.['elapsed_ms']).toBe('number');
  });

  it('emits debug "result" record on success when LOG_VERBOSITY=debug', async () => {
    vi.stubEnv('LOG_VERBOSITY', 'debug');
    const { logger, records } = createTestLogger('evt-review', 'ferry:review-loop');
    const mock = makeAnthropicMock([finishReviewResponse]);

    await runReviewLoop({ ...baseOpts, anthropic: mock as unknown as Anthropic, logger });

    const resultRecord = records.find((r) => r.level === 'debug' && r.message === 'result');
    expect(resultRecord).toBeDefined();
    expect(resultRecord).toMatchObject({
      type: 'result',
      subtype: 'success',
      iterations: 1,
    });
    expect(typeof resultRecord?.['elapsed_ms']).toBe('number');
  });

  it('does not emit debug records when LOG_VERBOSITY is unset', async () => {
    vi.stubEnv('LOG_VERBOSITY', '');
    const { logger, records } = createTestLogger('evt-review', 'ferry:review-loop');
    const mock = makeAnthropicMock([finishReviewResponse]);

    await runReviewLoop({ ...baseOpts, anthropic: mock as unknown as Anthropic, logger });

    expect(records.filter((r) => r.level === 'debug')).toHaveLength(0);
  });

  it('emits structured "turn" info records per iteration', async () => {
    const { logger, records } = createTestLogger('evt-review', 'ferry:review-loop');
    const mock = makeAnthropicMock([finishReviewResponse]);

    await runReviewLoop({ ...baseOpts, anthropic: mock as unknown as Anthropic, logger });

    const turnInfoRecords = records.filter((r) => r.level === 'info' && r.message === 'turn');
    expect(turnInfoRecords.length).toBeGreaterThanOrEqual(1);
    expect(turnInfoRecords[0]).toMatchObject({
      level: 'info',
      correlation_id: 'evt-review',
      iter: 1,
    });
  });
});
