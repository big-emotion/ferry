export type FerryErrorCode =
  | 'state-invariant'
  | 'spend-cap'
  | 'transient'
  | 'oscillation'
  | 'unknown';

export class FerryError extends Error {
  constructor(
    public readonly code: FerryErrorCode,
    public readonly context?: Record<string, unknown>,
  ) {
    super(`[ferry:${code}]${context ? ` ${JSON.stringify(context)}` : ''}`);
    this.name = 'FerryError';
  }
}
