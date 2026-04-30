import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FerryError } from '../errors/index.js';
import { retry } from './retry.js';

function flushAsync(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe('io/retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries up to 3 times with exponential backoff for transient errors', async () => {
    const fn = vi
      .fn((): Promise<string> => Promise.resolve(''))
      .mockRejectedValueOnce(new FerryError('transient'))
      .mockRejectedValueOnce(new FerryError('transient'))
      .mockResolvedValueOnce('ok');

    const p = retry(fn, { baseDelayMs: 2000, maxAttempts: 3 })();
    // attach handler immediately to avoid unhandled rejection noise
    p.catch(() => {});

    // attempt 1 fails -> waits ~2s
    await vi.advanceTimersByTimeAsync(2500);
    // attempt 2 fails -> waits ~4s
    await vi.advanceTimersByTimeAsync(5000);

    await vi.runAllTimersAsync();
    await flushAsync();

    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('adds ±50% jitter to delay (bounded)', async () => {
    const fn = vi
      .fn((): Promise<string> => Promise.resolve(''))
      .mockRejectedValue(new FerryError('transient'));

    // force deterministic jitter
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0); // -50%

    const p = retry(fn, { baseDelayMs: 2000, maxAttempts: 3 })();
    // attach handler immediately to avoid unhandled rejection noise
    p.catch(() => {});

    // first delay should be 1000ms (2000 * 0.5)
    await vi.advanceTimersByTimeAsync(1100);

    // fully flush so the promise resolves/rejects within the test and doesn't leak
    await vi.runAllTimersAsync();
    await flushAsync();

    await expect(p).rejects.toMatchObject({ code: 'unknown' });

    randomSpy.mockRestore();
  });

  it('does not retry non-transient errors', async () => {
    const fn = vi
      .fn((): Promise<string> => Promise.resolve(''))
      .mockRejectedValue(new FerryError('state-invariant'));

    await expect(retry(fn, { baseDelayMs: 2000, maxAttempts: 3 })()).rejects.toMatchObject({
      code: 'state-invariant',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('escalates to FerryError("unknown") after exhausting attempts', async () => {
    const fn = vi
      .fn((): Promise<string> => Promise.resolve(''))
      .mockRejectedValue(new FerryError('transient'));

    const p = retry(fn, { baseDelayMs: 2000, maxAttempts: 3 })();
    // attach handler immediately to avoid unhandled rejection noise
    p.catch(() => {});

    await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000 + 1000);

    await vi.runAllTimersAsync();
    await flushAsync();

    await expect(p).rejects.toMatchObject({ code: 'unknown' });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
