import { describe, it, expect, vi, afterEach } from 'vitest';
import { emitDebug } from './debug-log.js';
import type { DebugEvent } from './debug-log.js';
import { createTestLogger } from '../logger/index.js';

const turnEvent: DebugEvent = {
  type: 'turn',
  iter: 1,
  depth: 0,
  stop_reason: 'tool_use',
  tools: 2,
  mcp_tools: 0,
  in: 100,
  cache_w: 0,
  cache_r: 0,
  out: 50,
  elapsed_ms: 123,
};

const resultEvent: DebugEvent = {
  type: 'result',
  subtype: 'success',
  iterations: 6,
  total_in: 500,
  total_out: 300,
  elapsed_ms: 12345,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('emitDebug', () => {
  it('writes nothing when LOG_VERBOSITY is unset', () => {
    const { logger, records } = createTestLogger('c', 'ferry:test');
    emitDebug(turnEvent, logger, {});
    expect(records).toHaveLength(0);
  });

  it('writes nothing when LOG_VERBOSITY is "DEBUG" (case-sensitive)', () => {
    const { logger, records } = createTestLogger('c', 'ferry:test');
    emitDebug(turnEvent, logger, { LOG_VERBOSITY: 'DEBUG' });
    expect(records).toHaveLength(0);
  });

  it('emits a debug record when LOG_VERBOSITY=debug', () => {
    vi.stubEnv('LOG_VERBOSITY', 'debug');
    const { logger, records } = createTestLogger('c', 'ferry:test');
    emitDebug(turnEvent, logger, { LOG_VERBOSITY: 'debug' });
    expect(records).toHaveLength(1);
    expect(records[0].level).toBe('debug');
    expect(records[0].message).toBe('turn');
  });

  it('writes nothing when debug is disabled', () => {
    const { logger, records } = createTestLogger('c', 'ferry:test');
    emitDebug(turnEvent, logger, {});
    expect(records).toHaveLength(0);
  });

  it('turn event fields are present in debug record', () => {
    vi.stubEnv('LOG_VERBOSITY', 'debug');
    const { logger, records } = createTestLogger('c', 'ferry:test');
    emitDebug(turnEvent, logger, { LOG_VERBOSITY: 'debug' });
    expect(records[0]).toMatchObject({
      type: 'turn',
      iter: 1,
      depth: 0,
      stop_reason: 'tool_use',
      tools: 2,
      mcp_tools: 0,
      in: 100,
      cache_w: 0,
      cache_r: 0,
      out: 50,
      elapsed_ms: 123,
    });
  });

  it('result event fields are present in debug record', () => {
    vi.stubEnv('LOG_VERBOSITY', 'debug');
    const { logger, records } = createTestLogger('c', 'ferry:test');
    emitDebug(resultEvent, logger, { LOG_VERBOSITY: 'debug' });
    expect(records[0]).toMatchObject({
      type: 'result',
      subtype: 'success',
      iterations: 6,
      total_in: 500,
      total_out: 300,
      elapsed_ms: 12345,
    });
  });
});
