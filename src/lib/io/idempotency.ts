export interface IdempotencyCheckResult {
  skipped: boolean;
}

export function checkIdempotencyMarker(marker: string, items: string[]): IdempotencyCheckResult {
  for (const item of items) {
    if (item.includes(marker)) return { skipped: true };
  }

  return { skipped: false };
}

export function appendMarker(payload: string, marker: string): string {
  if (payload.includes(marker)) return payload;
  return `${payload}\n\n${marker}`;
}
