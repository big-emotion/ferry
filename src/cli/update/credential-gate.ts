/**
 * Manifest-driven credential gate for `ferry-update` (ADR-0006 §7,
 * decisions/0002 §G).
 *
 * This is a **pure decision function** — no IO, no prompting, no config
 * writes. `ferry-update` feeds it the secrets declared by the crossed
 * `MIGRATIONS.md` range (`requires-secrets:`), the secrets currently set on
 * the repo, whether the run is interactive, and any explicit
 * `execution_path` from `ferry.config.json`. It returns the matrix outcome.
 *
 * It is a **general mechanism**: nothing here is claude-code specific. Any
 * future release that declares a newly-required secret reuses it unchanged.
 */

export type CredentialGateOutcome =
  /** No `requires-secrets:` in the crossed range — credential-silent. */
  | 'silent'
  /** All required secrets present — adopt the conditional default. */
  | 'satisfied'
  /** Interactive + some missing — prompt only the missing, then adopt. */
  | 'prompt-missing'
  /** Non-interactive + missing — keep the script path + mandatory follow-up. */
  | 'stay-on-script'
  /** `execution_path: script` set explicitly — respected, never overridden. */
  | 'explicit-script';

export interface CredentialGateInput {
  /** Secrets the crossed MIGRATIONS.md range declares as required. */
  requiredSecrets: string[];
  /** Secrets currently set on the repo (`gh secret list`). */
  existingSecrets: string[];
  /** True when `ferry-update` can prompt (TTY, not `--yes`, not `--dry-run`). */
  interactive: boolean;
  /** Explicit `execution_path` from `ferry.config.json`, if any. */
  explicitExecutionPath?: string;
}

export interface CredentialGateResult {
  outcome: CredentialGateOutcome;
  /** Required secrets not present on the repo (order preserved). */
  missing: string[];
  /** Whether the conditional default should be adopted on this upgrade. */
  adopt: boolean;
  /** Mandatory follow-up printed when the path is deferred (stay-on-script). */
  followUp?: string;
}

/**
 * Resolve the credential-gate outcome. Precedence (matches decisions/0002 §G):
 *
 * 1. No required secrets               → `silent`
 * 2. `execution_path: script` explicit → `explicit-script` (always respected)
 * 3. All required present              → `satisfied`
 * 4. Missing + interactive             → `prompt-missing`
 * 5. Missing + non-interactive         → `stay-on-script`
 */
export function evaluateCredentialGate(input: CredentialGateInput): CredentialGateResult {
  const { requiredSecrets, existingSecrets, interactive, explicitExecutionPath } = input;

  // 1 — code-only range: the "never re-prompts for credentials" property.
  if (requiredSecrets.length === 0) {
    return { outcome: 'silent', missing: [], adopt: false };
  }

  const existing = new Set(existingSecrets);
  const missing = requiredSecrets.filter((s) => !existing.has(s));

  // 2 — an explicit script pin is never overridden by the gate.
  if (explicitExecutionPath === 'script') {
    return { outcome: 'explicit-script', missing, adopt: false };
  }

  // 3 — already provisioned: adopt the conditional default silently.
  if (missing.length === 0) {
    return { outcome: 'satisfied', missing, adopt: true };
  }

  // 4 — interactive: prompt only for the missing secrets, then adopt.
  if (interactive) {
    return { outcome: 'prompt-missing', missing, adopt: true };
  }

  // 5 — non-interactive: zero breakage, stay on the script path + follow-up.
  return {
    outcome: 'stay-on-script',
    missing,
    adopt: false,
    followUp:
      `Missing required secret(s): ${missing.join(', ')}. ` +
      `Ferry stays on the bundled script path (no breakage). ` +
      `Re-run \`ferry-update\` interactively (a TTY, without --yes) to provision ` +
      `the secret(s) and adopt the new execution path.`,
  };
}
