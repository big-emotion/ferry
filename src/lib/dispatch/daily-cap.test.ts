import { describe, it, expect, afterEach } from 'vitest';
import {
  checkDailyTicketCap,
  formatCapPauseComment,
  getConfiguredCap,
  DEFAULT_DAILY_CAP,
} from './daily-cap.js';

const NOW = new Date('2026-04-28T12:00:00Z');
const TODAY_START = new Date('2026-04-28T00:00:00Z');
const YESTERDAY = new Date('2026-04-27T22:00:00Z');

describe('checkDailyTicketCap (Story 2-3 FR7)', () => {
  it('allows the run when count is below cap', async () => {
    const result = await checkDailyTicketCap({
      ticketKey: 'CHAN-27',
      cap: 10,
      now: NOW,
      listClaimsToday: () => Promise.resolve([TODAY_START, TODAY_START, TODAY_START]),
    });
    expect(result).toEqual({ allowed: true, count: 3, cap: 10, ticketKey: 'CHAN-27' });
  });

  it('blocks the run at the cap boundary (count === cap)', async () => {
    const result = await checkDailyTicketCap({
      ticketKey: 'CHAN-27',
      cap: 3,
      now: NOW,
      listClaimsToday: () => Promise.resolve([TODAY_START, TODAY_START, TODAY_START]),
    });
    expect(result).toEqual({ allowed: false, count: 3, cap: 3, ticketKey: 'CHAN-27' });
  });

  it('blocks the run when count exceeds cap', async () => {
    const result = await checkDailyTicketCap({
      ticketKey: 'CHAN-27',
      cap: 2,
      now: NOW,
      listClaimsToday: () => Promise.resolve([TODAY_START, TODAY_START, TODAY_START]),
    });
    expect(result.allowed).toBe(false);
    expect(result.count).toBe(3);
  });

  it('drops claims from before today (UTC midnight boundary)', async () => {
    const result = await checkDailyTicketCap({
      ticketKey: 'CHAN-27',
      cap: 2,
      now: NOW,
      listClaimsToday: () => Promise.resolve([YESTERDAY, YESTERDAY, TODAY_START]),
    });
    expect(result.count).toBe(1);
    expect(result.allowed).toBe(true);
  });

  it('treats an empty claim list as allowed', async () => {
    const result = await checkDailyTicketCap({
      ticketKey: 'CHAN-27',
      cap: 10,
      now: NOW,
      listClaimsToday: () => Promise.resolve([]),
    });
    expect(result).toEqual({ allowed: true, count: 0, cap: 10, ticketKey: 'CHAN-27' });
  });
});

describe('formatCapPauseComment (Story 2-3 AC4)', () => {
  it('returns the documented FR7 comment string', () => {
    expect(
      formatCapPauseComment({
        phase: 'refine',
        runId: '01HXYZ',
        ticketKey: 'CHAN-27',
        cap: 10,
      }),
    ).toBe(
      '[ferry:refiner:01HXYZ] Paused — daily trigger cap (10) reached for CHAN-27. Resets at midnight UTC.',
    );
  });

  it('uses dev / review / iterate phase as agent name verbatim', () => {
    expect(formatCapPauseComment({ phase: 'dev', runId: 'r1', ticketKey: 'CHAN-1', cap: 5 })).toBe(
      '[ferry:dev:r1] Paused — daily trigger cap (5) reached for CHAN-1. Resets at midnight UTC.',
    );
  });
});

describe('getConfiguredCap (Story 2-3 dev notes)', () => {
  const originalEnv = process.env.FERRY_DAILY_TICKET_CAP;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FERRY_DAILY_TICKET_CAP;
    } else {
      process.env.FERRY_DAILY_TICKET_CAP = originalEnv;
    }
  });

  it('returns the default when env var is unset', () => {
    delete process.env.FERRY_DAILY_TICKET_CAP;
    expect(getConfiguredCap()).toBe(DEFAULT_DAILY_CAP);
    expect(DEFAULT_DAILY_CAP).toBe(10);
  });

  it('returns the parsed env override when valid', () => {
    process.env.FERRY_DAILY_TICKET_CAP = '25';
    expect(getConfiguredCap()).toBe(25);
  });

  it('falls back to default for invalid values (non-numeric, zero, negative)', () => {
    process.env.FERRY_DAILY_TICKET_CAP = 'banana';
    expect(getConfiguredCap()).toBe(DEFAULT_DAILY_CAP);
    process.env.FERRY_DAILY_TICKET_CAP = '0';
    expect(getConfiguredCap()).toBe(DEFAULT_DAILY_CAP);
    process.env.FERRY_DAILY_TICKET_CAP = '-1';
    expect(getConfiguredCap()).toBe(DEFAULT_DAILY_CAP);
  });
});
