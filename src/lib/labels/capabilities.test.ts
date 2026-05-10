import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveCapabilities, filterMcpServers, resolveTypeOverrides } from './capabilities.js';
import { createTestLogger } from '../logger/index.js';
import type { LabelCapability } from '../config.js';
import type { McpServerConfig } from '../llm/agent-loop/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const CONFIG: Record<string, LabelCapability> = {
  'ferry:mcp/context7': { mcp_servers: ['context7'] },
  'ferry:mcp/sentry': { mcp_servers: ['sentry'], tools: ['fetch_runtime_logs'] },
  'ferry:profile/frontend': { mcp_servers: ['context7', 'playwright'] },
};

describe('resolveCapabilities', () => {
  it('returns empty result for empty ticket labels', () => {
    const result = resolveCapabilities([], CONFIG);
    expect(result.mcpServerNames).toEqual([]);
    expect(result.triggeredLabels).toEqual([]);
    expect(result.unknownFerryLabels).toEqual([]);
  });

  it('returns empty result for ticket labels with no ferry: prefix', () => {
    const result = resolveCapabilities(['bug', 'priority:high', 'frontend'], CONFIG);
    expect(result.mcpServerNames).toEqual([]);
    expect(result.triggeredLabels).toEqual([]);
    expect(result.unknownFerryLabels).toEqual([]);
  });

  it('resolves a single matching label', () => {
    const result = resolveCapabilities(['ferry:mcp/context7'], CONFIG);
    expect(result.triggeredLabels).toEqual(['ferry:mcp/context7']);
    expect(result.mcpServerNames).toEqual(['context7']);
    expect(result.serverAllowedTools['context7']).toEqual([]);
  });

  it('resolves a single label with tool restriction', () => {
    const result = resolveCapabilities(['ferry:mcp/sentry'], CONFIG);
    expect(result.triggeredLabels).toEqual(['ferry:mcp/sentry']);
    expect(result.mcpServerNames).toEqual(['sentry']);
    expect(result.serverAllowedTools['sentry']).toEqual(['fetch_runtime_logs']);
  });

  it('resolves a profile label that expands to multiple servers', () => {
    const result = resolveCapabilities(['ferry:profile/frontend'], CONFIG);
    expect(result.triggeredLabels).toEqual(['ferry:profile/frontend']);
    expect(result.mcpServerNames).toContain('context7');
    expect(result.mcpServerNames).toContain('playwright');
    expect(result.mcpServerNames).toHaveLength(2);
  });

  it('unions server names across multiple matching labels', () => {
    const result = resolveCapabilities(['ferry:mcp/context7', 'ferry:mcp/sentry'], CONFIG);
    expect(result.triggeredLabels).toHaveLength(2);
    expect(result.mcpServerNames).toContain('context7');
    expect(result.mcpServerNames).toContain('sentry');
  });

  it('logs and ignores unknown ferry: labels', () => {
    const { logger, records } = createTestLogger('c', 'ferry:capabilities');
    const result = resolveCapabilities(['ferry:mcp/evil-server'], CONFIG, logger);
    expect(result.unknownFerryLabels).toEqual(['ferry:mcp/evil-server']);
    expect(result.mcpServerNames).toEqual([]);
    expect(result.triggeredLabels).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ level: 'warn', label: 'ferry:mcp/evil-server' });
  });

  it('handles mix of known labels, unknown ferry labels, and non-ferry labels', () => {
    const { logger, records } = createTestLogger('c', 'ferry:capabilities');
    const result = resolveCapabilities(
      ['bug', 'ferry:mcp/context7', 'ferry:mcp/unknown', 'critical'],
      CONFIG,
      logger,
    );
    expect(result.triggeredLabels).toEqual(['ferry:mcp/context7']);
    expect(result.unknownFerryLabels).toEqual(['ferry:mcp/unknown']);
    expect(result.mcpServerNames).toEqual(['context7']);
    expect(records).toHaveLength(1);
  });

  it('unions tools when two labels enable the same server with different tool lists', () => {
    const cfg: Record<string, LabelCapability> = {
      'ferry:mcp/a': { mcp_servers: ['svc'], tools: ['tool1'] },
      'ferry:mcp/b': { mcp_servers: ['svc'], tools: ['tool2'] },
    };
    const result = resolveCapabilities(['ferry:mcp/a', 'ferry:mcp/b'], cfg);
    expect(result.mcpServerNames).toEqual(['svc']);
    expect(result.serverAllowedTools['svc']).toContain('tool1');
    expect(result.serverAllowedTools['svc']).toContain('tool2');
  });

  it('all tools allowed when one label enables server without restriction', () => {
    const cfg: Record<string, LabelCapability> = {
      'ferry:mcp/a': { mcp_servers: ['svc'], tools: ['tool1'] },
      'ferry:mcp/b': { mcp_servers: ['svc'] },
    };
    const result = resolveCapabilities(['ferry:mcp/a', 'ferry:mcp/b'], cfg);
    expect(result.serverAllowedTools['svc']).toEqual([]);
  });

  it('returns empty result when configLabels is undefined', () => {
    const result = resolveCapabilities(['ferry:mcp/context7'], undefined);
    expect(result.mcpServerNames).toEqual([]);
    expect(result.triggeredLabels).toEqual([]);
    expect(result.unknownFerryLabels).toEqual([]);
  });
});

describe('filterMcpServers', () => {
  const POOL: McpServerConfig[] = [
    { name: 'context7', url: 'https://context7.example.com' },
    { name: 'sentry', url: 'https://sentry.example.com' },
    { name: 'playwright', url: 'https://playwright.example.com' },
  ];

  it('returns full pool when hasLabelsConfig is false (backward compat)', () => {
    const caps = resolveCapabilities([], CONFIG);
    const result = filterMcpServers(POOL, caps, false);
    expect(result).toEqual(POOL);
  });

  it('returns empty list when labels config exists but no matching labels', () => {
    const caps = resolveCapabilities([], CONFIG);
    const result = filterMcpServers(POOL, caps, true);
    expect(result).toHaveLength(0);
  });

  it('returns only enabled servers', () => {
    const caps = resolveCapabilities(['ferry:mcp/context7'], CONFIG);
    const result = filterMcpServers(POOL, caps, true);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('context7');
  });

  it('applies allowed_tools when capability restricts tools', () => {
    const caps = resolveCapabilities(['ferry:mcp/sentry'], CONFIG);
    const result = filterMcpServers(POOL, caps, true);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('sentry');
    expect(result[0].allowed_tools).toEqual(['fetch_runtime_logs']);
  });

  it('does not set allowed_tools when capability allows all tools', () => {
    const caps = resolveCapabilities(['ferry:mcp/context7'], CONFIG);
    const result = filterMcpServers(POOL, caps, true);
    expect(result[0].allowed_tools).toBeUndefined();
  });

  it('skips servers in capabilities that are not in the pool', () => {
    const caps = resolveCapabilities(['ferry:profile/frontend'], CONFIG);
    const poolWithoutPlaywright = POOL.filter((s) => s.name !== 'playwright');
    const result = filterMcpServers(poolWithoutPlaywright, caps, true);
    expect(result.map((s) => s.name)).toEqual(['context7']);
  });
});

describe('resolveTypeOverrides', () => {
  it('returns defaults when no ferry:type:* labels are present', () => {
    const result = resolveTypeOverrides(['bug', 'priority:high']);
    expect(result.bypassTaskSkip).toBe(false);
    expect(result.typeOverride).toBeUndefined();
    expect(result.forceLabel).toBeUndefined();
  });

  it('sets bypassTaskSkip when ferry:type:enable-task is present', () => {
    const result = resolveTypeOverrides(['ferry:type:enable-task']);
    expect(result.bypassTaskSkip).toBe(true);
    expect(result.typeOverride).toBeUndefined();
  });

  it('sets typeOverride to Bug for ferry:type:force-bug', () => {
    const result = resolveTypeOverrides(['ferry:type:force-bug']);
    expect(result.bypassTaskSkip).toBe(false);
    expect(result.typeOverride).toBe('Bug');
    expect(result.forceLabel).toBe('ferry:type:force-bug');
  });

  it('sets typeOverride to Spike for ferry:type:force-spike', () => {
    const result = resolveTypeOverrides(['ferry:type:force-spike']);
    expect(result.typeOverride).toBe('Spike');
    expect(result.forceLabel).toBe('ferry:type:force-spike');
  });

  it('sets typeOverride to Story for ferry:type:force-story', () => {
    const result = resolveTypeOverrides(['ferry:type:force-story']);
    expect(result.typeOverride).toBe('Story');
    expect(result.forceLabel).toBe('ferry:type:force-story');
  });

  it('combines bypassTaskSkip and typeOverride from separate labels', () => {
    const result = resolveTypeOverrides(['ferry:type:enable-task', 'ferry:type:force-bug']);
    expect(result.bypassTaskSkip).toBe(true);
    expect(result.typeOverride).toBe('Bug');
  });

  it('last force-* label wins when multiple are present', () => {
    // force-story comes after force-bug in the label list
    const result = resolveTypeOverrides(['ferry:type:force-bug', 'ferry:type:force-story']);
    expect(result.typeOverride).toBe('Story');
    expect(result.forceLabel).toBe('ferry:type:force-story');
  });

  it('built-in type labels do not appear in unknownFerryLabels when mixed with config labels', () => {
    const { logger, records } = createTestLogger('c', 'ferry:capabilities');
    const result = resolveCapabilities(
      ['ferry:type:enable-task', 'ferry:type:force-bug'],
      CONFIG,
      logger,
    );
    // Built-in type labels should not trigger a warning
    expect(records).toHaveLength(0);
    expect(result.unknownFerryLabels).toEqual([]);
  });
});
