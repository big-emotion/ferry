import { httpsGet } from '../../http.js';
import { detectInstalledVersion } from '../../update/detect.js';
import type { CheckResult } from '../types.js';

async function fetchLatestNpmVersion(): Promise<string | undefined> {
  try {
    const res = await httpsGet({
      hostname: 'registry.npmjs.org',
      path: '/@big-emotion/ferry/latest',
    });
    if (res.statusCode !== 200) return undefined;
    const data = JSON.parse(res.body) as { version?: string };
    return data.version ? `v${data.version}` : undefined;
  } catch {
    return undefined;
  }
}

function normalizeVersion(v: string): string {
  return v.replace(/^v/, '');
}

export async function checkUpdateAvailable(opts: { repoRoot: string }): Promise<CheckResult> {
  const installed = detectInstalledVersion(opts.repoRoot);

  if (!installed) {
    return {
      label: 'Ferry update available',
      status: 'skip',
      detail: 'No workflow files found — run ferry-init first',
    };
  }

  const latest = await fetchLatestNpmVersion();

  if (!latest) {
    return {
      label: 'Ferry update available',
      status: 'skip',
      detail: `Could not reach npm registry (installed: ${installed})`,
    };
  }

  if (normalizeVersion(installed) === normalizeVersion(latest)) {
    return {
      label: 'Ferry update available',
      status: 'green',
      detail: `Up to date (${installed})`,
    };
  }

  return {
    label: 'Ferry update available',
    status: 'yellow',
    detail: `Installed: ${installed} — latest: ${latest}`,
    remedy: `Run \`npx -p @big-emotion/ferry@${normalizeVersion(latest)} ferry-update\` to upgrade`,
  };
}
