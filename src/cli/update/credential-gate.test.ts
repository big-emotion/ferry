import { describe, it, expect } from 'vitest';
import { evaluateCredentialGate } from './credential-gate.js';

// Full coverage of the migration matrix in decisions/0002 §G:
//
// | Situation on `ferry-update`                         | Outcome                       |
// | --------------------------------------------------- | ----------------------------- |
// | Crossed range has no `requires-secrets:` (code-only) | Silent — no prompt, untouched |
// | Declares secret, already set                         | Auto-adopts (default applied) |
// | Declares it, missing, interactive                    | Prompts only missing → adopt  |
// | Declares it, missing, non-interactive                | Stays on script + follow-up   |
// | `execution_path: script` explicitly set              | Respected — never overridden  |

describe('evaluateCredentialGate — decisions/0002 §G matrix', () => {
  it('row 1 — code-only range → silent, no adoption, property preserved', () => {
    const r = evaluateCredentialGate({
      requiredSecrets: [],
      existingSecrets: ['CLAUDE_CODE_OAUTH_TOKEN'],
      interactive: true,
    });
    expect(r.outcome).toBe('silent');
    expect(r.adopt).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.followUp).toBeUndefined();
  });

  it('row 2 — required secret already set → satisfied, adopt', () => {
    const r = evaluateCredentialGate({
      requiredSecrets: ['CLAUDE_CODE_OAUTH_TOKEN'],
      existingSecrets: ['FERRY_APP_ID', 'CLAUDE_CODE_OAUTH_TOKEN'],
      interactive: false,
    });
    expect(r.outcome).toBe('satisfied');
    expect(r.adopt).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('row 3 — missing + interactive → prompt only the missing, then adopt', () => {
    const r = evaluateCredentialGate({
      requiredSecrets: ['CLAUDE_CODE_OAUTH_TOKEN', 'OTHER_SECRET'],
      existingSecrets: ['OTHER_SECRET'],
      interactive: true,
    });
    expect(r.outcome).toBe('prompt-missing');
    expect(r.adopt).toBe(true);
    expect(r.missing).toEqual(['CLAUDE_CODE_OAUTH_TOKEN']);
  });

  it('row 4 — missing + non-interactive → stay on script + mandatory follow-up', () => {
    const r = evaluateCredentialGate({
      requiredSecrets: ['CLAUDE_CODE_OAUTH_TOKEN'],
      existingSecrets: [],
      interactive: false,
    });
    expect(r.outcome).toBe('stay-on-script');
    expect(r.adopt).toBe(false);
    expect(r.missing).toEqual(['CLAUDE_CODE_OAUTH_TOKEN']);
    expect(r.followUp).toBeDefined();
    expect(r.followUp).toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('row 5 — explicit execution_path: script is respected even when satisfied', () => {
    const r = evaluateCredentialGate({
      requiredSecrets: ['CLAUDE_CODE_OAUTH_TOKEN'],
      existingSecrets: ['CLAUDE_CODE_OAUTH_TOKEN'],
      interactive: true,
      explicitExecutionPath: 'script',
    });
    expect(r.outcome).toBe('explicit-script');
    expect(r.adopt).toBe(false);
  });

  it('row 5 takes precedence over row 4 (explicit script, missing, non-interactive)', () => {
    const r = evaluateCredentialGate({
      requiredSecrets: ['CLAUDE_CODE_OAUTH_TOKEN'],
      existingSecrets: [],
      interactive: false,
      explicitExecutionPath: 'script',
    });
    expect(r.outcome).toBe('explicit-script');
    expect(r.adopt).toBe(false);
    expect(r.followUp).toBeUndefined();
  });

  it('an explicit non-script execution_path does not suppress the gate', () => {
    const r = evaluateCredentialGate({
      requiredSecrets: ['CLAUDE_CODE_OAUTH_TOKEN'],
      existingSecrets: ['CLAUDE_CODE_OAUTH_TOKEN'],
      interactive: true,
      explicitExecutionPath: 'claude-code',
    });
    expect(r.outcome).toBe('satisfied');
    expect(r.adopt).toBe(true);
  });

  it('computes the missing set as required minus existing, order preserved', () => {
    const r = evaluateCredentialGate({
      requiredSecrets: ['A', 'B', 'C'],
      existingSecrets: ['B'],
      interactive: true,
    });
    expect(r.missing).toEqual(['A', 'C']);
  });

  it('is a general mechanism — works for any secret name, not just cc', () => {
    const r = evaluateCredentialGate({
      requiredSecrets: ['SOME_FUTURE_SECRET'],
      existingSecrets: [],
      interactive: false,
    });
    expect(r.outcome).toBe('stay-on-script');
    expect(r.followUp).toContain('SOME_FUTURE_SECRET');
  });
});
