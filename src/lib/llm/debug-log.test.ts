import { describe, it, expect, vi, afterEach } from 'vitest';
import { isDebugEnabled, emitDebug } from './debug-log.js';
import type { DebugEvent } from './debug-log.js';

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

describe('isDebugEnabled', () => {
  it('true when LOG_VERBOSITY is exactly "debug"', () => {
    expect(isDebugEnabled({ LOG_VERBOSITY: 'debug' })).toBe(true);
  });

  it('false when LOG_VERBOSITY is unset', () => {
    expect(isDebugEnabled({})).toBe(false);
  });

  it('false when LOG_VERBOSITY is "DEBUG" (case-sensitive)', () => {
    expect(isDebugEnabled({ LOG_VERBOSITY: 'DEBUG' })).toBe(false);
  });

  it('false when LOG_VERBOSITY is "verbose"', () => {
    expect(isDebugEnabled({ LOG_VERBOSITY: 'verbose' })).toBe(false);
  });

  it('false when LOG_VERBOSITY is empty string', () => {
    expect(isDebugEnabled({ LOG_VERBOSITY: '' })).toBe(false);
  });
});

describe('emitDebug', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes one JSON line to stderr when debug is enabled', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    emitDebug(turnEvent, { LOG_VERBOSITY: 'debug' });
    expect(spy).toHaveBeenCalledOnce();
    const arg = spy.mock.calls[0][0] as string;
    expect(() => JSON.parse(arg)).not.toThrow();
    expect(JSON.parse(arg)).toMatchObject(turnEvent);
  });

  it('writes nothing when debug is disabled', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    emitDebug(turnEvent, {});
    expect(spy).not.toHaveBeenCalled();
  });

  it('turn event has all expected keys', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    emitDebug(turnEvent, { LOG_VERBOSITY: 'debug' });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(parsed).toHaveProperty('type', 'turn');
    expect(parsed).toHaveProperty('iter', 1);
    expect(parsed).toHaveProperty('depth', 0);
    expect(parsed).toHaveProperty('stop_reason', 'tool_use');
    expect(parsed).toHaveProperty('tools', 2);
    expect(parsed).toHaveProperty('mcp_tools', 0);
    expect(parsed).toHaveProperty('in', 100);
    expect(parsed).toHaveProperty('cache_w', 0);
    expect(parsed).toHaveProperty('cache_r', 0);
    expect(parsed).toHaveProperty('out', 50);
    expect(parsed).toHaveProperty('elapsed_ms', 123);
  });

  it('result event has all expected keys', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    emitDebug(resultEvent, { LOG_VERBOSITY: 'debug' });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(parsed).toHaveProperty('type', 'result');
    expect(parsed).toHaveProperty('subtype', 'success');
    expect(parsed).toHaveProperty('iterations', 6);
    expect(parsed).toHaveProperty('total_in', 500);
    expect(parsed).toHaveProperty('total_out', 300);
    expect(parsed).toHaveProperty('elapsed_ms', 12345);
  });

  it('emitted JSON round-trips faithfully', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    emitDebug(resultEvent, { LOG_VERBOSITY: 'debug' });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as DebugEvent;
    expect(parsed).toEqual(resultEvent);
  });
});
