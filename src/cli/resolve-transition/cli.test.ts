import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_FERRY_CONFIG, type FerryConfig } from '../../lib/config.js';
import type { TrackerTransition } from '../../lib/io/tracker/types.js';
import {
  parseArgs,
  targetStatusFor,
  resolveTransition,
  UsageError,
  type ResolveTransitionArgs,
} from './cli.js';

function cfgWith(overrides: Partial<FerryConfig['workflow']['agents']>): FerryConfig {
  return {
    ...DEFAULT_FERRY_CONFIG,
    workflow: {
      agents: { ...DEFAULT_FERRY_CONFIG.workflow.agents, ...overrides },
    },
  };
}

const FER_TRANSITIONS: TrackerTransition[] = [
  { id: '3', toStatus: 'In Review' },
  { id: '5', toStatus: 'Changes Requested' },
  { id: '4', toStatus: 'To Merge' },
];

describe('targetStatusFor', () => {
  it('maps each (agent, kind) to the matching config auto_transition field', () => {
    const cfg = cfgWith({
      developer: { trigger_column: 'In Development', auto_transition: 'In Review' },
      iterator: { trigger_column: 'Changes Requested', auto_transition: 'Back to review' },
      reviewer: {
        trigger_column: 'In Review',
        auto_transition_approve: 'To Merge',
        auto_transition_changes: 'Changes Requested',
      },
    });
    expect(targetStatusFor(cfg, 'dev', 'review')).toBe('In Review');
    expect(targetStatusFor(cfg, 'iterate', 'review')).toBe('Back to review');
    expect(targetStatusFor(cfg, 'review', 'approve')).toBe('To Merge');
    expect(targetStatusFor(cfg, 'review', 'changes')).toBe('Changes Requested');
  });

  it('returns null when the configured transition is disabled', () => {
    const cfg = cfgWith({
      reviewer: {
        trigger_column: 'In Review',
        auto_transition_approve: null,
        auto_transition_changes: 'Changes Requested',
      },
    });
    expect(targetStatusFor(cfg, 'review', 'approve')).toBeNull();
  });

  it('throws on an unsupported agent/kind pair (only the reviewer approves)', () => {
    expect(() => targetStatusFor(DEFAULT_FERRY_CONFIG, 'dev', 'approve')).toThrow(UsageError);
  });
});

describe('resolveTransition', () => {
  const args = (over: Partial<ResolveTransitionArgs> = {}): ResolveTransitionArgs => ({
    repoRoot: '/repo',
    ticketKey: 'FER-9',
    agent: 'dev',
    kind: 'review',
    fallbackId: '',
    outputName: 'transition_id',
    ...over,
  });

  it('resolves the config status name to a transition id via the tracker', async () => {
    const cfg = cfgWith({
      developer: { trigger_column: 'In Development', auto_transition: 'In Review' },
    });
    const id = await resolveTransition(args(), cfg, () => Promise.resolve(FER_TRANSITIONS));
    expect(id).toBe('3');
  });

  it('honors --fallback-id without fetching (back-compat override)', async () => {
    const fetch = vi.fn(() => Promise.resolve(FER_TRANSITIONS));
    const id = await resolveTransition(args({ fallbackId: '42' }), DEFAULT_FERRY_CONFIG, fetch);
    expect(id).toBe('42');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns an empty id (no fetch) when the transition is disabled', async () => {
    const cfg = cfgWith({
      reviewer: {
        trigger_column: 'In Review',
        auto_transition_approve: null,
        auto_transition_changes: 'Changes Requested',
      },
    });
    const fetch = vi.fn(() => Promise.resolve(FER_TRANSITIONS));
    const id = await resolveTransition(args({ agent: 'review', kind: 'approve' }), cfg, fetch);
    expect(id).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('parseArgs', () => {
  it('parses a full argument list', () => {
    const parsed = parseArgs([
      '--ticket-key',
      'FER-9',
      '--agent',
      'review',
      '--kind',
      'changes',
      '--fallback-id',
      '5',
      '--repo-root',
      '/repo',
    ]);
    expect(parsed).toMatchObject({
      ticketKey: 'FER-9',
      agent: 'review',
      kind: 'changes',
      fallbackId: '5',
      repoRoot: '/repo',
      outputName: 'transition_id',
    });
  });

  it('rejects a missing ticket key and an invalid agent/kind', () => {
    expect(() => parseArgs(['--agent', 'dev', '--kind', 'review'])).toThrow(UsageError);
    expect(() => parseArgs(['--ticket-key', 'X', '--agent', 'nope', '--kind', 'review'])).toThrow(
      UsageError,
    );
    expect(() => parseArgs(['--ticket-key', 'X', '--agent', 'dev', '--kind', 'nope'])).toThrow(
      UsageError,
    );
  });
});
