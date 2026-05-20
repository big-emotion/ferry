import { describe, it, expect } from 'vitest';
import {
  resolveExecutionPath,
  isAnthropicOnlyConfig,
  formatExecutionPathAudit,
  type ExecutionPathInput,
} from './routing.js';
import { DEFAULT_FERRY_CONFIG } from '../config.js';
import type { FerryConfig } from '../config.js';

function input(over: Partial<ExecutionPathInput> = {}): ExecutionPathInput {
  return {
    configuredPath: undefined,
    anthropicOnly: true,
    labelOverride: undefined,
    role: 'developer',
    priorRoundTrips: 0,
    roundTripThreshold: 2,
    ...over,
  };
}

describe('resolveExecutionPath — explicit script lock (acceptance: never overridden)', () => {
  it('explicit script wins over a claude-code label', () => {
    expect(
      resolveExecutionPath(input({ configuredPath: 'script', labelOverride: 'claude-code' })),
    ).toEqual({ path: 'script', reason: 'default' });
  });

  it('explicit script wins over the heuristic', () => {
    expect(
      resolveExecutionPath(
        input({ configuredPath: 'script', role: 'iterator', priorRoundTrips: 99 }),
      ),
    ).toEqual({ path: 'script', reason: 'default' });
  });

  it('explicit script wins even for an Anthropic-only consumer', () => {
    expect(resolveExecutionPath(input({ configuredPath: 'script', anthropicOnly: true }))).toEqual({
      path: 'script',
      reason: 'default',
    });
  });
});

describe('resolveExecutionPath — Jira label override (precedence over heuristic + default)', () => {
  it('ferry:claude-code label → claude-code (reason label) for Anthropic-only consumer', () => {
    expect(
      resolveExecutionPath(input({ labelOverride: 'claude-code', anthropicOnly: true })),
    ).toEqual({ path: 'claude-code', reason: 'label' });
  });

  it('ferry:no-claude-code label → script (reason label), even Anthropic-only', () => {
    expect(resolveExecutionPath(input({ labelOverride: 'script', anthropicOnly: true }))).toEqual({
      path: 'script',
      reason: 'label',
    });
  });

  it('label overrides an explicit claude-code config', () => {
    expect(
      resolveExecutionPath(input({ configuredPath: 'claude-code', labelOverride: 'script' })),
    ).toEqual({ path: 'script', reason: 'label' });
  });

  it('label beats the heuristic', () => {
    expect(
      resolveExecutionPath(
        input({ labelOverride: 'script', role: 'developer', priorRoundTrips: 50 }),
      ),
    ).toEqual({ path: 'script', reason: 'label' });
  });

  it('conflicting labels arrive pre-collapsed to script (safe path)', () => {
    // resolveTicketOverrides collapses ferry:claude-code + ferry:no-claude-code
    // to claudeCodePath === 'script'; the resolver simply honours it.
    expect(resolveExecutionPath(input({ labelOverride: 'script' }))).toEqual({
      path: 'script',
      reason: 'label',
    });
  });
});

describe('resolveExecutionPath — provider gate (anthropicOnly === false, issue #329)', () => {
  it('mixed-provider config + ferry:claude-code label → script (reason provider-gate)', () => {
    // Acceptance criterion: label override is a no-op when anthropicOnly is false.
    expect(
      resolveExecutionPath(input({ anthropicOnly: false, labelOverride: 'claude-code' })),
    ).toEqual({ path: 'script', reason: 'provider-gate' });
  });

  it('explicit claude-code config + non-Anthropic provider → script (reason provider-gate)', () => {
    expect(
      resolveExecutionPath(input({ anthropicOnly: false, configuredPath: 'claude-code' })),
    ).toEqual({ path: 'script', reason: 'provider-gate' });
  });

  it('provider gate fires before the label override (label is a no-op)', () => {
    // Both ferry:claude-code and ferry:no-claude-code: gate wins either way.
    expect(resolveExecutionPath(input({ anthropicOnly: false, labelOverride: 'script' }))).toEqual({
      path: 'script',
      reason: 'provider-gate',
    });
  });

  it('provider gate does NOT fire for Anthropic-only consumers', () => {
    // Anthropic-only: label override is honoured normally.
    expect(
      resolveExecutionPath(input({ anthropicOnly: true, labelOverride: 'claude-code' })),
    ).toEqual({ path: 'claude-code', reason: 'label' });
  });
});

describe('resolveExecutionPath — automatic heuristic (role + round-trips ≥ N)', () => {
  // NOTE: the provider gate (step 2) intercepts all non-Anthropic consumers before
  // reaching the heuristic. The heuristic is currently dead code for anthropicOnly:false
  // inputs (provider-gate fires first). These tests verify the gate takes precedence.

  it('non-Anthropic developer at threshold → provider-gate (not heuristic)', () => {
    expect(
      resolveExecutionPath(
        input({
          anthropicOnly: false,
          role: 'developer',
          priorRoundTrips: 2,
          roundTripThreshold: 2,
        }),
      ),
    ).toEqual({ path: 'script', reason: 'provider-gate' });
  });

  it('non-Anthropic iterator above threshold → provider-gate (not heuristic)', () => {
    expect(
      resolveExecutionPath(
        input({
          anthropicOnly: false,
          role: 'iterator',
          priorRoundTrips: 5,
          roundTripThreshold: 2,
        }),
      ),
    ).toEqual({ path: 'script', reason: 'provider-gate' });
  });

  it('non-Anthropic developer below threshold → provider-gate', () => {
    expect(
      resolveExecutionPath(
        input({
          anthropicOnly: false,
          role: 'developer',
          priorRoundTrips: 1,
          roundTripThreshold: 2,
        }),
      ),
    ).toEqual({ path: 'script', reason: 'provider-gate' });
  });

  it('non-Anthropic refiner → provider-gate', () => {
    expect(
      resolveExecutionPath(
        input({
          anthropicOnly: false,
          role: 'refiner',
          priorRoundTrips: 99,
          roundTripThreshold: 2,
        }),
      ),
    ).toEqual({ path: 'script', reason: 'provider-gate' });
  });

  it('non-Anthropic reviewer → provider-gate', () => {
    expect(
      resolveExecutionPath(
        input({
          anthropicOnly: false,
          role: 'reviewer',
          priorRoundTrips: 99,
          roundTripThreshold: 2,
        }),
      ),
    ).toEqual({ path: 'script', reason: 'provider-gate' });
  });

  it('non-Anthropic non-positive threshold → provider-gate', () => {
    expect(
      resolveExecutionPath(
        input({
          anthropicOnly: false,
          role: 'developer',
          priorRoundTrips: 99,
          roundTripThreshold: 0,
        }),
      ),
    ).toEqual({ path: 'script', reason: 'provider-gate' });
  });

  it('the heuristic never downgrades an already-claude-code default', () => {
    // configured claude-code, developer below threshold → still claude-code, reason default
    expect(
      resolveExecutionPath(
        input({ configuredPath: 'claude-code', role: 'developer', priorRoundTrips: 0 }),
      ),
    ).toEqual({ path: 'claude-code', reason: 'default' });
  });
});

describe('resolveExecutionPath — conditional default', () => {
  it('Anthropic-only consumer (unset config) → claude-code', () => {
    expect(resolveExecutionPath(input({ anthropicOnly: true, role: 'refiner' }))).toEqual({
      path: 'claude-code',
      reason: 'default',
    });
  });

  it('non-Anthropic consumer (unset config) → script (reason provider-gate)', () => {
    expect(resolveExecutionPath(input({ anthropicOnly: false, role: 'reviewer' }))).toEqual({
      path: 'script',
      reason: 'provider-gate',
    });
  });

  it('explicit claude-code config with non-Anthropic provider → script (reason provider-gate)', () => {
    expect(
      resolveExecutionPath(input({ configuredPath: 'claude-code', anthropicOnly: false })),
    ).toEqual({ path: 'script', reason: 'provider-gate' });
  });
});

describe('isAnthropicOnlyConfig', () => {
  it('true for the all-Anthropic default config', () => {
    expect(isAnthropicOnlyConfig(DEFAULT_FERRY_CONFIG)).toBe(true);
  });

  it('false when any agent uses a non-Anthropic provider', () => {
    const cfg: FerryConfig = {
      ...DEFAULT_FERRY_CONFIG,
      models: {
        ...DEFAULT_FERRY_CONFIG.models,
        dev: { provider: 'openai', model: 'gpt-5' },
      },
    };
    expect(isAnthropicOnlyConfig(cfg)).toBe(false);
  });

  it('false when an agent uses Google', () => {
    const cfg: FerryConfig = {
      ...DEFAULT_FERRY_CONFIG,
      models: {
        ...DEFAULT_FERRY_CONFIG.models,
        review: { provider: 'google', model: 'gemini-2.5-pro' },
      },
    };
    expect(isAnthropicOnlyConfig(cfg)).toBe(false);
  });
});

describe('formatExecutionPathAudit', () => {
  it('emits the fingerprinted marker with path and reason', () => {
    expect(
      formatExecutionPathAudit('reviewer', 'run-abc', { path: 'claude-code', reason: 'label' }),
    ).toBe('[ferry:reviewer:run-abc] execution-path: claude-code (reason: label)');
  });

  it('uses the dev marker token for the developer role (script parity)', () => {
    expect(
      formatExecutionPathAudit('developer', 'r1', { path: 'script', reason: 'heuristic' }),
    ).toBe('[ferry:dev:r1] execution-path: script (reason: heuristic)');
  });
});
