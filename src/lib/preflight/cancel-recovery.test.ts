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

  it('flags as stale when schema validation fails (full output assertions)', () => {
    const out = detectStaleAfterCancel({
      stored_pr_sha: 'aaa',
      current_head_sha: 'aaa',
      schema_ok: false,
    });
    // Story 7-1 epic-7 review (Finding 1): the schema-fail path must short-circuit
    // writes and apply status:stale, same as SHA-mismatch — not just set stale=true.
    expect(out.stale).toBe(true);
    expect(out.add_labels).toContain('status:stale');
    expect(out.exit_without_writes).toBe(true);
  });

  it('flags as stale on the corrupt-fresh-ticket case (schema_ok=false + stored_pr_sha undefined)', () => {
    // Story 7-1 epic-7 review (Finding 2): explicit coverage of !schema_ok with no
    // stored SHA — the logic handles it (!false = true) but the intent is now pinned.
    const out = detectStaleAfterCancel({
      stored_pr_sha: undefined,
      current_head_sha: 'abc',
      schema_ok: false,
    });
    expect(out.stale).toBe(true);
    expect(out.add_labels).toContain('status:stale');
    expect(out.exit_without_writes).toBe(true);
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
