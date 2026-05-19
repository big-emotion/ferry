import { askSecret, printSuccess, printSkip, printWarn, print } from '../init/prompt.js';
import { listExistingSecrets, setSecret } from '../init/steps/secrets.js';
import { extractJiraConfigFromSetupFile } from './extract-jira-config.js';
import { getRequiredSecretsForRange } from './migrations.js';
import { evaluateCredentialGate } from './credential-gate.js';
import { readExecutionPath, applyClaudeCodeExecutionPath } from './exec-path.js';
import type { ForgeKind } from '../lib/forge.js';

/**
 * Orchestrates the manifest-driven credential gate during `ferry-update`
 * (GitHub flow). Pure decision logic lives in `credential-gate.ts`; this
 * module wires it to real IO (secret listing/prompting, config write) and
 * keeps every external dependency injectable so it is unit-testable without
 * touching `gh` or a TTY.
 *
 * Credential-silent for code-only ranges: when the crossed MIGRATIONS.md
 * range declares no `requires-secrets:`, this returns immediately with no
 * output — preserving the "never re-prompts for credentials" property.
 */
export interface CredentialGateRunOptions {
  repoRoot: string;
  fromVersion: string;
  toVersion: string;
  /** True when `ferry-update` may prompt (TTY, not --yes). */
  interactive: boolean;
  dryRun: boolean;
  /** Override MIGRATIONS.md location (tests). */
  migrationsPath?: string;
  /** Injectable IO (defaults wrap the real `gh`-backed helpers). */
  listSecrets?: (repo: string) => string[];
  promptSecret?: (name: string) => Promise<string>;
  setRepoSecret?: (repo: string, name: string, value: string) => void;
}

export interface CredentialGateRunResult {
  /** False when the range is code-only (silent path). */
  ran: boolean;
  /** Follow-up lines to append to "Manual follow-ups required". */
  followUps: string[];
}

export async function runCredentialGate(
  opts: CredentialGateRunOptions,
): Promise<CredentialGateRunResult> {
  const listSecrets = opts.listSecrets ?? listExistingSecrets;
  const promptSecret = opts.promptSecret ?? ((name) => askSecret(`Enter value for ${name}`));
  const setRepoSecret = opts.setRepoSecret ?? setSecret;

  const requiredSecrets = getRequiredSecretsForRange(opts.fromVersion, opts.toVersion, {
    forge: 'github' as ForgeKind,
    migrationsPath: opts.migrationsPath,
  });

  // Code-only update: stay completely silent (property preserved).
  if (requiredSecrets.length === 0) {
    return { ran: false, followUps: [] };
  }

  const followUps: string[] = [];

  const jira = extractJiraConfigFromSetupFile(opts.repoRoot);
  const repo = jira ? `${jira.owner}/${jira.repo}` : undefined;
  const existingSecrets = repo ? listSecrets(repo) : [];
  const explicitExecutionPath = readExecutionPath(opts.repoRoot);

  // Without a resolvable repo we can neither list nor set secrets — force the
  // deferral path so nothing is adopted blindly.
  const canPrompt = opts.interactive && !opts.dryRun && repo !== undefined;

  const result = evaluateCredentialGate({
    requiredSecrets,
    existingSecrets,
    interactive: canPrompt,
    explicitExecutionPath,
  });

  print('');
  print('════════════════════════════════════════');
  print('  Credential gate (MIGRATIONS requires-secrets)');
  print('════════════════════════════════════════');

  if (!repo && result.outcome !== 'explicit-script') {
    printWarn(
      'Could not determine the GitHub repo from ferry-jira-automation-setup.md — ' +
        'cannot check or set secrets automatically.',
    );
  }

  const adopt = (): void => {
    if (opts.dryRun) {
      printSkip('[dry-run] would set execution_path: claude-code in ferry.config.json');
      return;
    }
    const applied = applyClaudeCodeExecutionPath(opts.repoRoot);
    if (applied === 'written') {
      printSuccess('execution_path set to claude-code in ferry.config.json');
    } else if (applied === 'already-claude-code') {
      printSkip('execution_path already claude-code — nothing to do');
    } else {
      followUps.push(
        'Set `execution_path: claude-code` in ferry.config.yaml (no ferry.config.json ' +
          'found) to adopt the new execution path, or re-run `ferry-init`.',
      );
    }
  };

  switch (result.outcome) {
    case 'explicit-script':
      printSkip('execution_path: script set explicitly — credential gate skipped; path unchanged.');
      break;

    case 'satisfied':
      printSuccess(`Required secret(s) already set: ${requiredSecrets.join(', ')}`);
      adopt();
      break;

    case 'prompt-missing': {
      printWarn(`Missing required secret(s): ${result.missing.join(', ')}`);
      let allProvided = true;
      for (const name of result.missing) {
        const value = (await promptSecret(name)).trim();
        if (!value) {
          allProvided = false;
          printWarn(`No value entered for ${name} — skipped.`);
          continue;
        }
        try {
          setRepoSecret(repo!, name, value);
          printSuccess(`Set ${name}`);
        } catch (err) {
          allProvided = false;
          const msg = err instanceof Error ? err.message : String(err);
          printWarn(`Failed to set ${name}: ${msg}`);
        }
      }
      if (allProvided) {
        adopt();
      } else {
        followUps.push(
          `Provide the remaining required secret(s) and re-run \`ferry-update\` ` +
            `to adopt the new execution path. Ferry stays on the bundled script until then.`,
        );
      }
      break;
    }

    case 'stay-on-script':
      printWarn(result.followUp ?? 'Required secrets missing — staying on the script path.');
      if (result.followUp) followUps.push(result.followUp);
      break;

    case 'silent':
      // unreachable — handled by the early return above.
      break;
  }

  print('');
  return { ran: true, followUps };
}
