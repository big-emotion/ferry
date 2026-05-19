/**
 * Secret-scan-before-push as a deterministic gate for the claude-code path.
 *
 * On the bundled-script path, `makeSecretScan` (`src/lib/agent-runtime/
 * secret-scan.ts`) is a callback invoked *inside* `commitProgress`, between
 * `git commit` and `git push`. `claude-code-action`'s loop is opaque — there is
 * no in-loop hook to inject (decisions/0002 §D: "must re-engineer"). ADR-0006
 * §5 / decisions/0002 §D therefore re-engineer it as a deterministic gate that
 * *brackets* the action: the LLM is denied `git push` entirely by the tool
 * policy (`tool-policy.ts`), and the only sanctioned push is performed by a
 * post-action step that is structurally downstream of this gate.
 *
 * `gatedPush` makes the invariant structural rather than procedural: `push` is
 * a continuation that only runs after a clean scan, so "push is impossible
 * without passing the secret-scan gate" holds by construction — there is no
 * code path to `push` that does not first await a clean `secretScanGate`.
 *
 * Behaviour parity with the in-loop hook is exact: same engine
 * (`scanWithGitleaks`), same `FerryError('state-invariant', { reason:
 * 'secret-scan-hit', findings })`, same no-leak guarantee (only the finding
 * *count* is ever surfaced).
 */

import { scanWithGitleaks } from '../safety/scan.js';
import type { ScanOptions, ScanResult } from '../safety/scan.js';
import { FerryError } from '../errors/index.js';

export type ScanFn = (opts: ScanOptions) => Promise<ScanResult>;

export interface SecretScanGateOptions {
  /** Repository root to scan. */
  repoRoot: string;
  /** gitleaks binary; defaults to `$GITLEAKS_PATH` then `gitleaks` on PATH. */
  gitleaksPath?: string;
  /** Injectable scanner (defaults to the real gitleaks engine) — for tests. */
  scan?: ScanFn;
}

export interface GatedPushOptions extends SecretScanGateOptions {
  /** The deterministic push action. Runs only after a clean scan. */
  push: () => Promise<void> | void;
}

/**
 * Run the secret scan. Resolves on a clean tree; throws
 * `FerryError('state-invariant')` (count only — never the leaked content) when
 * gitleaks reports findings.
 */
export async function secretScanGate(opts: SecretScanGateOptions): Promise<void> {
  const scan = opts.scan ?? scanWithGitleaks;
  const binaryPath = opts.gitleaksPath ?? process.env.GITLEAKS_PATH ?? 'gitleaks';
  const result = await scan({ path: opts.repoRoot, binaryPath });
  if (result.leaksFound) {
    throw new FerryError('state-invariant', {
      reason: 'secret-scan-hit',
      findings: result.findings.length,
    });
  }
}

/**
 * Gate then push. `push` is invoked exactly once, and only if the secret scan
 * is clean — there is no path to `push` that bypasses the gate. A scan hit
 * throws before `push` is ever referenced; a `push` failure propagates
 * unchanged (the gate has already passed).
 */
export async function gatedPush(opts: GatedPushOptions): Promise<'pushed'> {
  await secretScanGate(opts);
  await opts.push();
  return 'pushed';
}
