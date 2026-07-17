import { describe, it, expect } from 'vitest';
import { deriveAgentRole, roleToPhase, roleToModelVar } from './derive-role.js';
import { DEFAULT_FERRY_CONFIG, type FerryConfig } from '../config.js';

const CUSTOM_COLUMNS: FerryConfig = {
  ...DEFAULT_FERRY_CONFIG,
  workflow: {
    agents: {
      ...DEFAULT_FERRY_CONFIG.workflow.agents,
      refiner: { trigger_column: 'REFINEMENT', auto_transition: null },
      developer: { trigger_column: 'IN DEVELOPMENT', auto_transition: 'Revue en cours' },
      reviewer: {
        trigger_column: 'Revue en cours',
        auto_transition_approve: 'TO MERGE',
        auto_transition_changes: 'CHANGES REQUESTED',
      },
      iterator: { trigger_column: 'CHANGES REQUESTED', auto_transition: 'Revue en cours' },
    },
  },
};

describe('deriveAgentRole', () => {
  it('maps each legacy event type directly to its role', () => {
    expect(deriveAgentRole('ferry-refine', undefined, DEFAULT_FERRY_CONFIG)).toBe('refiner');
    expect(deriveAgentRole('ferry-dev', undefined, DEFAULT_FERRY_CONFIG)).toBe('developer');
    expect(deriveAgentRole('ferry-review', undefined, DEFAULT_FERRY_CONFIG)).toBe('reviewer');
    expect(deriveAgentRole('ferry-iterate', undefined, DEFAULT_FERRY_CONFIG)).toBe('iterator');
    expect(deriveAgentRole('ferry-merge', undefined, DEFAULT_FERRY_CONFIG)).toBe('merger');
  });

  it('legacy events ignore to_status entirely', () => {
    expect(deriveAgentRole('ferry-dev', 'In Review', DEFAULT_FERRY_CONFIG)).toBe('developer');
  });

  it('ferry-transition maps to_status to the agent whose trigger_column matches', () => {
    expect(deriveAgentRole('ferry-transition', 'Refinement', DEFAULT_FERRY_CONFIG)).toBe('refiner');
    expect(deriveAgentRole('ferry-transition', 'In Development', DEFAULT_FERRY_CONFIG)).toBe(
      'developer',
    );
    expect(deriveAgentRole('ferry-transition', 'In Review', DEFAULT_FERRY_CONFIG)).toBe('reviewer');
    expect(deriveAgentRole('ferry-transition', 'Changes Requested', DEFAULT_FERRY_CONFIG)).toBe(
      'iterator',
    );
  });

  it('honors custom (localized) trigger columns, case-insensitively', () => {
    expect(deriveAgentRole('ferry-transition', 'revue en cours', CUSTOM_COLUMNS)).toBe('reviewer');
    expect(deriveAgentRole('ferry-transition', '  IN DEVELOPMENT ', CUSTOM_COLUMNS)).toBe(
      'developer',
    );
  });

  it('returns none for a status mapped to no agent (router must no-op)', () => {
    expect(deriveAgentRole('ferry-transition', 'Backlog', DEFAULT_FERRY_CONFIG)).toBe('none');
    expect(deriveAgentRole('ferry-transition', 'Done', DEFAULT_FERRY_CONFIG)).toBe('none');
  });

  it('NEVER maps a to_status to the merger, even a "To Merge" column (ADR-0005)', () => {
    // The reviewer approve target lands on TO MERGE — moving a ticket there by
    // hand must not trigger a merge; only the reviewer-emitted ferry-merge does.
    expect(deriveAgentRole('ferry-transition', 'TO MERGE', CUSTOM_COLUMNS)).toBe('none');
    expect(deriveAgentRole('ferry-transition', 'To Merge', DEFAULT_FERRY_CONFIG)).toBe('none');
  });

  it('returns none for a missing/empty to_status or an unknown event type', () => {
    expect(deriveAgentRole('ferry-transition', undefined, DEFAULT_FERRY_CONFIG)).toBe('none');
    expect(deriveAgentRole('ferry-transition', '   ', DEFAULT_FERRY_CONFIG)).toBe('none');
    expect(deriveAgentRole('something-else', 'In Review', DEFAULT_FERRY_CONFIG)).toBe('none');
  });
});

describe('roleToPhase', () => {
  it('maps every role to its audit phase token', () => {
    expect(roleToPhase('refiner')).toBe('refine');
    expect(roleToPhase('developer')).toBe('dev');
    expect(roleToPhase('reviewer')).toBe('review');
    expect(roleToPhase('iterator')).toBe('iterate');
    expect(roleToPhase('merger')).toBe('merge');
  });
});

describe('roleToModelVar', () => {
  it('maps every role to its FERRY_*_MODEL repo-variable name', () => {
    expect(roleToModelVar('refiner')).toBe('FERRY_REFINER_MODEL');
    expect(roleToModelVar('developer')).toBe('FERRY_DEV_MODEL');
    expect(roleToModelVar('reviewer')).toBe('FERRY_REVIEW_MODEL');
    expect(roleToModelVar('iterator')).toBe('FERRY_ITER_MODEL');
    expect(roleToModelVar('merger')).toBe('FERRY_MERGER_MODEL');
  });
});
