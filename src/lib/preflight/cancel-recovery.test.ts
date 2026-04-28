import { describe, expect, it } from 'vitest';
import { detectStaleAfterCancel } from './cancel-recovery.js';

describe('cancel-recovery', () => {
  it('flags as stale when stored pr_sha does not match current HEAD', () => {
    const out = detectStaleAfterCancel({
      stored_pr_sha: 'aaa',
      current_head_sha: 'bbb',
      schema_ok: true,
    });
    expect(out.stale).toBe(true);
    expect(out.add_labels).toContain('status:stale');
    expect(out.exit_without_writes).toBe(true);
  });

  it('flags as stale when schema validation fails', () => {
    const out = detectStaleAfterCancel({
      stored_pr_sha: 'aaa',
      current_head_sha: 'aaa',
      schema_ok: false,
    });
    expect(out.stale).toBe(true);
  });

  it('proceeds when SHAs match and schema is valid', () => {
    const out = detectStaleAfterCancel({
      stored_pr_sha: 'aaa',
      current_head_sha: 'aaa',
      schema_ok: true,
    });
    expect(out.stale).toBe(false);
  });

  it('proceeds when there is no stored pr_sha (fresh ticket)', () => {
    const out = detectStaleAfterCancel({
      stored_pr_sha: undefined,
      current_head_sha: 'aaa',
      schema_ok: true,
    });
    expect(out.stale).toBe(false);
  });
});
