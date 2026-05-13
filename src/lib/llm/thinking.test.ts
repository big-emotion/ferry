import { describe, it, expect } from 'vitest';
import {
  thinkingParamFromOverride,
  resolveThinkingForProvider,
  THINKING_BUDGET_ON,
  THINKING_BUDGET_EXTENDED,
} from './thinking.js';
import { createTestLogger } from '../logger/index.js';

describe('thinkingParamFromOverride', () => {
  it('returns undefined when override is undefined', () => {
    expect(thinkingParamFromOverride(undefined)).toBeUndefined();
  });

  it('maps "on" to enabled with default budget', () => {
    expect(thinkingParamFromOverride('on')).toEqual({
      type: 'enabled',
      budget_tokens: THINKING_BUDGET_ON,
    });
  });

  it('maps "extended" to enabled with the larger budget', () => {
    expect(thinkingParamFromOverride('extended')).toEqual({
      type: 'enabled',
      budget_tokens: THINKING_BUDGET_EXTENDED,
    });
  });

  it('maps "off" to disabled', () => {
    expect(thinkingParamFromOverride('off')).toEqual({ type: 'disabled' });
  });

  it('extended budget is greater than on budget', () => {
    expect(THINKING_BUDGET_EXTENDED).toBeGreaterThan(THINKING_BUDGET_ON);
  });

  it('SDK minimum: budget_tokens >= 1024 for enabled', () => {
    expect(THINKING_BUDGET_ON).toBeGreaterThanOrEqual(1024);
    expect(THINKING_BUDGET_EXTENDED).toBeGreaterThanOrEqual(1024);
  });
});

describe('resolveThinkingForProvider', () => {
  it('returns undefined when no thinking override is set, regardless of provider', () => {
    expect(resolveThinkingForProvider(undefined, 'anthropic')).toBeUndefined();
    expect(resolveThinkingForProvider(undefined, 'openai')).toBeUndefined();
    expect(resolveThinkingForProvider(undefined, 'google')).toBeUndefined();
  });

  it('returns the SDK param for anthropic provider when override is "on"', () => {
    expect(resolveThinkingForProvider('on', 'anthropic')).toEqual({
      type: 'enabled',
      budget_tokens: THINKING_BUDGET_ON,
    });
  });

  it('returns the SDK param for anthropic provider when override is "extended"', () => {
    expect(resolveThinkingForProvider('extended', 'anthropic')).toEqual({
      type: 'enabled',
      budget_tokens: THINKING_BUDGET_EXTENDED,
    });
  });

  it('returns the SDK param for anthropic provider when override is "off"', () => {
    expect(resolveThinkingForProvider('off', 'anthropic')).toEqual({ type: 'disabled' });
  });

  it('returns undefined and warns when provider is openai (non-Anthropic)', () => {
    const { logger, records } = createTestLogger('t', 'test');
    expect(resolveThinkingForProvider('extended', 'openai', logger)).toBeUndefined();
    expect(records.some((r) => r.level === 'warn')).toBe(true);
  });

  it('returns undefined and warns when provider is google (non-Anthropic)', () => {
    const { logger, records } = createTestLogger('t', 'test');
    expect(resolveThinkingForProvider('on', 'google', logger)).toBeUndefined();
    expect(records.some((r) => r.level === 'warn')).toBe(true);
  });

  it('does not warn when there is no override (even for non-Anthropic providers)', () => {
    const { logger, records } = createTestLogger('t', 'test');
    resolveThinkingForProvider(undefined, 'openai', logger);
    expect(records.filter((r) => r.level === 'warn')).toHaveLength(0);
  });
});
