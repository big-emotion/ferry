import { FerryError } from '../errors/index.js';

type AsyncFn<TArgs extends unknown[], TResult> = (...args: TArgs) => Promise<TResult>;

export interface RetryOptions {
  baseDelayMs: number;
  maxAttempts: number;
  jitterRatio?: number;
  backoffFactor?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelayMs(attemptIndex: number, opts: Required<RetryOptions>): number {
  const base = opts.baseDelayMs * Math.pow(opts.backoffFactor, attemptIndex);
  const jitter = (Math.random() * 2 - 1) * opts.jitterRatio; // [-ratio, +ratio]
  return Math.max(0, Math.round(base * (1 + jitter)));
}

export function retry<TArgs extends unknown[], TResult>(
  fn: AsyncFn<TArgs, TResult>,
  options: RetryOptions,
): AsyncFn<TArgs, TResult> {
  const opts: Required<RetryOptions> = {
    jitterRatio: 0.5,
    backoffFactor: 2,
    ...options,
  };

  return async (...args: TArgs): Promise<TResult> => {
    let lastErr: unknown;

    for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
      try {
        return await fn(...args);
      } catch (e) {
        lastErr = e;

        const isTransient = e instanceof FerryError && e.code === 'transient';
        const shouldRetry = isTransient && attempt < opts.maxAttempts - 1;
        if (!shouldRetry) break;

        const delayMs = computeDelayMs(attempt, opts);
        await sleep(delayMs);
      }
    }

    if (lastErr instanceof FerryError && lastErr.code === 'transient') {
      throw new FerryError('unknown');
    }

    throw lastErr;
  };
}
