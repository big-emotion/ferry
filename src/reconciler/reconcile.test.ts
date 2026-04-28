import { describe, expect, it } from 'vitest';
import { reconcileTickets } from './reconcile.js';

describe('reconciler', () => {
  it('dispatches when Jira column does not match state.phase', () => {
    const out = reconcileTickets({
      tickets: [
        {
          ticket_key: 'CHAN-1',
          jira_column: 'In Review',
          state_phase: 'developing',
          last_audit_minutes_ago: 30,
        },
      ],
    });
    expect(out.dispatched).toHaveLength(1);
    expect(out.dispatched[0].ticket_key).toBe('CHAN-1');
    expect(out.dispatched[0].source).toBe('reconciler');
    expect(out.dispatched[0].event_id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it('does NOT dispatch when column matches state.phase', () => {
    const out = reconcileTickets({
      tickets: [
        {
          ticket_key: 'CHAN-2',
          jira_column: 'In Review',
          state_phase: 'reviewing',
          last_audit_minutes_ago: 30,
        },
      ],
    });
    expect(out.dispatched).toEqual([]);
  });

  it('dispatches when no state file but recent audit is older than 20 minutes', () => {
    const out = reconcileTickets({
      tickets: [
        {
          ticket_key: 'CHAN-3',
          jira_column: 'In Development',
          state_phase: undefined,
          last_audit_minutes_ago: 25,
        },
      ],
    });
    expect(out.dispatched).toHaveLength(1);
  });

  it('does NOT dispatch when no state file but a recent audit (<20m) exists', () => {
    const out = reconcileTickets({
      tickets: [
        {
          ticket_key: 'CHAN-4',
          jira_column: 'In Development',
          state_phase: undefined,
          last_audit_minutes_ago: 5,
        },
      ],
    });
    expect(out.dispatched).toEqual([]);
  });

  it('does NOT dispatch tickets in terminal/holding columns when no state file (Paused, Cancelled, Ready to Merge, Needs Human)', () => {
    const terminal = ['Paused', 'Cancelled', 'Ready to Merge', 'Needs Human'];
    for (const col of terminal) {
      const out = reconcileTickets({
        tickets: [
          {
            ticket_key: 'CHAN-T',
            jira_column: col,
            state_phase: undefined,
            last_audit_minutes_ago: 999,
          },
        ],
      });
      expect(out.dispatched, `terminal column ${col} must not be dispatched`).toEqual([]);
    }
  });

  it('does NOT dispatch tickets in unknown columns when no state file', () => {
    const out = reconcileTickets({
      tickets: [
        {
          ticket_key: 'CHAN-U',
          jira_column: 'Some Custom Column',
          state_phase: undefined,
          last_audit_minutes_ago: 999,
        },
      ],
    });
    expect(out.dispatched).toEqual([]);
  });

  it('summary includes total ticket count scanned', () => {
    const out = reconcileTickets({
      tickets: [
        {
          ticket_key: 'CHAN-1',
          jira_column: 'In Review',
          state_phase: 'reviewing',
          last_audit_minutes_ago: 1,
        },
        {
          ticket_key: 'CHAN-2',
          jira_column: 'In Review',
          state_phase: 'developing',
          last_audit_minutes_ago: 30,
        },
      ],
    });
    expect(out.scanned).toBe(2);
  });
});
