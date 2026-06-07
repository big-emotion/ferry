/**
 * MCP Phase 3 regression tests for the Refiner agent (issue #323).
 *
 * Step 3: Verify the loop receives MCP servers after capability-label filtering.
 * Step 6: Output-shape parity — loop path and filtered-empty path produce valid RefinerOutput.
 */
import { describe, it, expect, vi } from 'vitest';
import { filterMcpServers } from '../../lib/agent-runtime/index.js';
import { runRefinerLoop } from './refine.js';
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

const validPlan = {
  actions: [
    {
      type: 'create' as const,
      title: 'Add login button',
      description: 'Implement it in src/button.ts',
    },
  ],
  touch_paths: ['src/button.ts'],
  output_locale: 'en' as const,
  audit_summary: 'one subtask planned',
};

function makeAgentLoop(plan: unknown = validPlan): AgentLoop {
  const result: AgentLoopResult = {
    done: plan as AgentLoopResult['done'],
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

const baseTicket = {
  key: 'PROJ-1',
  title: 'Add login button',
  description: 'Users want a login button.',
  comments: [],
  labels: ['feature'],
};

// ── Step 3: loop receives filtered MCP servers ────────────────────────────

describe('Refiner MCP plumbing — loop receives filtered servers (Step 3)', () => {
  it('passes atlassian server to loop.run when capability label enables it', async () => {
    const atlassianServer = { name: 'atlassian', url: 'https://mcp.atlassian.com' };
    const mcpPool = [atlassianServer, { name: 'other', url: 'https://other.mcp.com' }];
    const capabilities = makeCapabilities(['atlassian']);

    const mcpServers = filterMcpServers(mcpPool, capabilities, /* hasLabelsConfig */ true);
    expect(mcpServers).toHaveLength(1);
    expect(mcpServers[0].name).toBe('atlassian');

    const loop = makeAgentLoop();
    await runRefinerLoop({ ticket: baseTicket, loop, runLink: '', mcpServers });

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

    const mcpServers = filterMcpServers(mcpPool, capabilities, /* hasLabelsConfig */ false);
    expect(mcpServers).toHaveLength(2);
  });

  it('passes empty mcpServers when capabilities match nothing', async () => {
    const mcpPool = [{ name: 'atlassian', url: 'https://mcp.atlassian.com' }];
    const capabilities = makeCapabilities([]);

    const mcpServers = filterMcpServers(mcpPool, capabilities, true);
    expect(mcpServers).toHaveLength(0);

    const loop = makeAgentLoop();
    await runRefinerLoop({ ticket: baseTicket, loop, runLink: '', mcpServers });

    const runOpts = (loop.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(runOpts.mcpServers).toEqual([]);
  });
});

// ── Step 6: output-shape parity ────────────────────────────────────────────

describe('Refiner output-shape parity — same schema regardless of MCP (Step 6)', () => {
  it('loop path produces valid RefinerOutput shape when MCP is disabled', async () => {
    const loop = makeAgentLoop();
    const result = await runRefinerLoop({
      ticket: baseTicket,
      loop,
      runLink: 'https://example.com/run/1',
      mcpServers: [],
    });

    expect(result.plan.actions).toHaveLength(1);
    expect(result.plan.actions[0].type).toBe('create');
    expect(result.plan.touch_paths).toEqual(['src/button.ts']);
    expect(result.plan.output_locale).toBe('en');
    expect(typeof result.plan.audit_summary).toBe('string');
    expect(result.auditSummary.subtaskCount).toBe(1);
    expect(result.auditSummary.runLink).toBe('https://example.com/run/1');
  });

  it('loop path produces valid RefinerOutput shape when MCP server is provided', async () => {
    const atlassianServer = { name: 'atlassian', url: 'https://mcp.atlassian.com' };
    const loop = makeAgentLoop();
    const result = await runRefinerLoop({
      ticket: baseTicket,
      loop,
      runLink: 'https://example.com/run/2',
      mcpServers: [atlassianServer],
    });

    expect(result.plan.actions).toHaveLength(1);
    expect(result.plan.touch_paths).toEqual(['src/button.ts']);
    expect(result.auditSummary.subtaskCount).toBe(1);
  });

  it('noop action produces valid output with zero subtasks', async () => {
    const noopPlan = {
      actions: [{ type: 'noop' as const, reason: 'ticket unchanged' }],
      touch_paths: [],
      output_locale: 'en' as const,
      audit_summary: 'no changes needed',
    };
    const loop = makeAgentLoop(noopPlan);
    const result = await runRefinerLoop({
      ticket: baseTicket,
      loop,
      runLink: '',
      mcpServers: [],
    });

    expect(result.plan.actions[0].type).toBe('noop');
    expect(result.auditSummary.subtaskCount).toBe(0);
  });
});

// ── Skip/rollback — no matching capabilities ────────────────────────────────

describe('Skip/rollback — no matching capabilities disables MCP for Refiner', () => {
  it('filterMcpServers returns empty list when no capability labels match any server', () => {
    const mcpPool = [{ name: 'atlassian', url: 'https://mcp.atlassian.com' }];
    const capabilities = makeCapabilities([]);

    const mcpServers = filterMcpServers(mcpPool, capabilities, /* hasLabelsConfig */ true);
    expect(mcpServers).toHaveLength(0);
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
