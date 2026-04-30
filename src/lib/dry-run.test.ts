import { describe, it, expect, afterEach } from 'vitest';
import { isDryRun } from './dry-run.js';

describe('isDryRun', () => {
  afterEach(() => {
    delete process.env.FERRY_DRY_RUN;
  });

  it('returns false when unset', () => {
    delete process.env.FERRY_DRY_RUN;
    expect(isDryRun()).toBe(false);
  });

  it('returns true for "1"', () => {
    process.env.FERRY_DRY_RUN = '1';
    expect(isDryRun()).toBe(true);
  });

  it('returns true for "true"', () => {
    process.env.FERRY_DRY_RUN = 'true';
    expect(isDryRun()).toBe(true);
  });

  it('returns false for "0"', () => {
    process.env.FERRY_DRY_RUN = '0';
    expect(isDryRun()).toBe(false);
  });

  it('returns false for empty string', () => {
    process.env.FERRY_DRY_RUN = '';
    expect(isDryRun()).toBe(false);
  });
});
