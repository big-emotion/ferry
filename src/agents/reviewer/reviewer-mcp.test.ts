/**
 * MCP Phase 2 regression tests for the Reviewer agent (issue #322).
 *
 * Step 2: Verify the loop receives MCP servers after capability-label filtering.
 * Step 5: CI gate still blocks the review even when MCP servers are enabled.
 * Step 6: Empty/unmatched capabilities disable all filtered MCP servers.
 */
import { describe, it, expect, vi } from 'vitest';
import { filterMcpServers } from '../../lib/agent-runtime/index.js';
import { gateCi } from './ci-gate.js';
import { runReviewLoop } from './review-loop.js';
import type { AgentLoop, AgentLoopResult } from '../../lib/llm/agent-loop/index.js';
import type { ResolvedCapabilities } from '../../lib/agent-runtime/index.js';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeCapabilities(mcpServerNames: string[]): ResolvedCapabilities {
  return {
    mcpServerNames,
    serverAllowedTools: {},
    triggeredLabels: [],
    unknownFerryLabels: [],
  };
}

function makeAgentLoop(approved = true): AgentLoop {
  const result: AgentLoopResult = {
    done: {
      actionable: approved,
      approved,
      summary: 'review complete',
      comment: 'LGTM',
    } as unknown as AgentLoopResult['done'],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    iterations: 1,
    toolCounts: {},
    toolCallRecords: [],
  };
  return { run: vi.fn().mockResolvedValue(result) };
}

const baseLoopOpts = {
  system: 'sys',
  initialPrompt: 'review this',
  repoRoot: '/repo',
  branchName: 'ferry/PROJ-1',
};

// ── Step 2: loop receives filtered MCP servers ────────────────────────────

describe('Reviewer MCP plumbing — loop receives filtered servers (Step 2)', () => {
  it('passes atlassian server to loop when capability label enables it', async () => {
    const atlassianServer = { name: 'atlassian', url: 'https://mcp.atlassian.com' };
    const mcpPool = [atlassianServer, { name: 'other', url: 'https://other.mcp.com' }];
    const capabilities = makeCapabilities(['atlassian']);

    const mcpServers = filterMcpServers(mcpPool, capabilities, /* hasLabelsConfig */ true);
    expect(mcpServers).toHaveLength(1);
    expect(mcpServers[0].name).toBe('atlassian');

    const loop = makeAgentLoop();
    await runReviewLoop({ ...baseLoopOpts, loop, mcpServers });

    const runOpts = (loop.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(runOpts.mcpServers).toHaveLength(1);
    expect(runOpts.mcpServers[0].name).toBe('atlassian');
  });

  it('passes all pool servers when hasLabelsConfig is false (no labels section)', () => {
    const mcpPool = [
      { name: 'atlassian', url: 'https://mcp.atlassian.com' },
      { name: 'context7', url: 'https://mcp.context7.com/mcp' },
    ];
    const capabilities = makeCapabilities([]);

    // When hasLabelsConfig=false (no labels in ferry.config), the full pool is returned
    const mcpServers = filterMcpServers(mcpPool, capabilities, /* hasLabelsConfig */ false);
    expect(mcpServers).toHaveLength(2);
  });
});

// ── Step 5: CI gate regression — still blocks with MCP enabled ────────────

describe('CI gate regression — blocks review even with MCP enabled (Step 5)', () => {
  it('gateCi returns proceed=false when CI is red regardless of MCP config', () => {
    const mcpPool = [{ name: 'atlassian', url: 'https://mcp.atlassian.com' }];
    const capabilities = makeCapabilities(['atlassian']);

    // Simulate MCP being enabled
    const mcpServers = filterMcpServers(mcpPool, capabilities, true);
    expect(mcpServers).toHaveLength(1);

    // CI gate is purely a function of CI status — MCP plays no part
    const outcome = gateCi({ status: 'red', failure_summary: 'tests failed' });
    expect(outcome.proceed).toBe(false);
    expect(outcome.outcome).toBe('ci-red');
  });

  it('gateCi allows proceeding (green) even when MCP servers are configured', () => {
    const mcpPool = [{ name: 'atlassian', url: 'https://mcp.atlassian.com' }];
    const capabilities = makeCapabilities(['atlassian']);
    filterMcpServers(mcpPool, capabilities, true);

    const outcome = gateCi({ status: 'green' });
    expect(outcome.proceed).toBe(true);
  });

  it('gateCi blocks on pending CI even with MCP servers configured', () => {
    const mcpPool = [{ name: 'atlassian', url: 'https://mcp.atlassian.com' }];
    const capabilities = makeCapabilities(['atlassian']);
    filterMcpServers(mcpPool, capabilities, true);

    const outcome = gateCi({ status: 'pending' });
    expect(outcome.proceed).toBe(false);
    expect(outcome.outcome).toBe('pending-ci');
  });
});

// ── Step 6: skip label (no matching capabilities) disables MCP ────────────

describe('Skip/rollback — no matching capabilities disables MCP for Reviewer (Step 6)', () => {
  it('filterMcpServers returns empty list when no capability labels match any server', () => {
    const mcpPool = [{ name: 'atlassian', url: 'https://mcp.atlassian.com' }];
    // Capabilities with no mcp server names (e.g. ferry:skip/mcp or unmatched labels)
    const capabilities = makeCapabilities([]);

    const mcpServers = filterMcpServers(mcpPool, capabilities, /* hasLabelsConfig */ true);
    expect(mcpServers).toHaveLength(0);
  });

  it('loop receives empty mcpServers when capabilities do not enable any server', async () => {
    const mcpPool = [{ name: 'atlassian', url: 'https://mcp.atlassian.com' }];
    const capabilities = makeCapabilities([]);

    const mcpServers = filterMcpServers(mcpPool, capabilities, true);
    expect(mcpServers).toHaveLength(0);

    const loop = makeAgentLoop();
    await runReviewLoop({ ...baseLoopOpts, loop, mcpServers });

    const runOpts = (loop.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(runOpts.mcpServers).toEqual([]);
  });

  it('filterMcpServers returns only servers matching capability labels', () => {
    const mcpPool = [
      { name: 'atlassian', url: 'https://mcp.atlassian.com' },
      { name: 'context7', url: 'https://mcp.context7.com/mcp' },
      { name: 'github', url: 'https://mcp.github.com' },
    ];
    const capabilities = makeCapabilities(['atlassian']);

    const mcpServers = filterMcpServers(mcpPool, capabilities, true);
    expect(mcpServers).toHaveLength(1);
    expect(mcpServers[0].name).toBe('atlassian');
  });
});
