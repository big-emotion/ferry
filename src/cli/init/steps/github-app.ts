import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ask, print, printSuccess, printWarn } from '../prompt.js';
import type { StepResult } from '../types.js';

const NEW_APP_URL = 'https://github.com/settings/apps/new';
const DOCS_URL = 'https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app';

export async function stepGitHubApp(
  owner: string,
  existingAppId?: string,
): Promise<{ result: StepResult; appId: string; privateKey: string }> {
  print('');
  print('Ferry uses a GitHub App (not a PAT) so it can post as a bot identity.');
  print('');
  print('Quick guide:');
  print(`  1. Open: ${NEW_APP_URL}`);
  print(`     (docs: ${DOCS_URL})`);
  print('  2. Name: e.g. "ferry-<your-org>"');
  print('  3. Homepage URL: any placeholder URL');
  print('  4. Webhook: uncheck Active');
  print('  5. Repository permissions:');
  print('       Contents       → Read and write');
  print('       Pull requests  → Read and write');
  print('       Issues         → Read and write');
  print('       Metadata       → Read-only (auto)');
  print('  6. "Where can this app be installed?" → Only on this account');
  print('  7. Create GitHub App → note the App ID shown on the settings page');
  print('  8. Click "Generate a private key" → the browser saves a .pem file');
  print(`  9. Install the app on the "${owner}" org/account (left sidebar → Install App)`);
  print('');

  if (existingAppId) {
    printWarn(`An App ID is already configured (${existingAppId}). Press Enter to keep it.`);
  }

  const appId = await ask('App ID (numeric, from the App settings page)', existingAppId);
  if (!appId) {
    return { result: { ok: false, reason: 'App ID is required' }, appId: '', privateKey: '' };
  }
  if (!/^\d+$/.test(appId)) {
    return {
      result: { ok: false, reason: `App ID must be numeric, got: ${appId}` },
      appId: '',
      privateKey: '',
    };
  }

  print('');
  const pemPath = await ask(
    'Path to the downloaded .pem private key file (e.g. ~/Downloads/ferry-acme.pem)',
  );
  if (!pemPath) {
    return {
      result: { ok: false, reason: 'Private key path is required' },
      appId: '',
      privateKey: '',
    };
  }

  const resolvedPath = resolve(pemPath.replace(/^~/, process.env.HOME ?? '~'));
  if (!existsSync(resolvedPath)) {
    return {
      result: { ok: false, reason: `File not found: ${resolvedPath}` },
      appId: '',
      privateKey: '',
    };
  }

  const privateKey = readFileSync(resolvedPath, 'utf8').trim();
  if (!privateKey.includes('-----BEGIN')) {
    return {
      result: { ok: false, reason: `${resolvedPath} does not look like a PEM file` },
      appId: '',
      privateKey: '',
    };
  }

  printSuccess(`GitHub App configured (ID: ${appId}, key loaded from ${resolvedPath})`);
  return { result: { ok: true }, appId, privateKey };
}
