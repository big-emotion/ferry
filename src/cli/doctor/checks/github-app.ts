import { createSign } from 'node:crypto';
import { httpsGet, httpsPost } from '../../http.js';
import type { CheckResult } from '../types.js';

const REQUIRED_PERMISSIONS: Record<string, string> = {
  contents: 'write',
  pull_requests: 'write',
  issues: 'write',
  metadata: 'read',
};

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/={1,2}$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function makeAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(
    Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId })),
  );
  const data = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(data);
  const sig = base64url(sign.sign(privateKey));
  return `${data}.${sig}`;
}

interface Installation {
  id: number;
  account: { login: string };
}

interface AccessToken {
  token: string;
  permissions: Record<string, string>;
}

export async function checkGitHubApp(opts: {
  appId: string;
  privateKey: string;
  repo: string;
}): Promise<CheckResult> {
  const { appId, privateKey, repo } = opts;

  if (!appId || !privateKey) {
    return {
      label: 'GitHub App',
      status: 'skip',
      detail: 'No App ID / private key provided — skipping',
      remedy: 'Provide --app-id and --private-key-path, or set FERRY_APP_ID / FERRY_PRIVATE_KEY',
    };
  }

  let jwt: string;
  try {
    jwt = makeAppJwt(appId, privateKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      label: 'GitHub App',
      status: 'red',
      detail: `Could not sign JWT: ${msg}`,
      remedy: 'Verify FERRY_PRIVATE_KEY is a valid RSA PEM. Re-download from GitHub App settings.',
    };
  }

  const authHeader = `Bearer ${jwt}`;

  // Get installations
  let installations: Installation[];
  try {
    const res = await httpsGet({
      hostname: 'api.github.com',
      path: '/app/installations',
      headers: {
        Authorization: authHeader,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ferry-doctor/1',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.statusCode === 401) {
      return {
        label: 'GitHub App',
        status: 'red',
        detail: 'JWT rejected (401) — private key does not match App ID',
        remedy:
          'Re-download the private key from GitHub → App settings → Generate a new private key',
      };
    }
    if (res.statusCode !== 200) {
      return {
        label: 'GitHub App',
        status: 'red',
        detail: `Unexpected status ${res.statusCode} from /app/installations`,
        remedy: 'Check GitHub App permissions and that the app is installed on this account',
      };
    }
    installations = JSON.parse(res.body) as Installation[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      label: 'GitHub App',
      status: 'red',
      detail: `Network error reaching api.github.com: ${msg}`,
      remedy: 'Check internet connectivity and GitHub API status at githubstatus.com',
    };
  }

  if (installations.length === 0) {
    return {
      label: 'GitHub App',
      status: 'red',
      detail: 'App has no installations',
      remedy:
        'Install the GitHub App on your org/account: App settings → Install App → select the repo',
    };
  }

  // Find installation matching the repo's owner, fall back to first available
  const [owner] = repo.split('/') as [string, string];
  const byOwner = installations.find((i) => i.account.login.toLowerCase() === owner.toLowerCase());
  const installation: Installation = byOwner ?? (installations[0] as Installation);

  // Mint installation access token
  let token: AccessToken;
  try {
    const res = await httpsPost(
      {
        hostname: 'api.github.com',
        path: `/app/installations/${installation.id}/access_tokens`,
        headers: {
          Authorization: authHeader,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ferry-doctor/1',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Length': '0',
        },
      },
      '',
    );
    if (res.statusCode !== 201) {
      return {
        label: 'GitHub App',
        status: 'red',
        detail: `Token creation returned ${res.statusCode}`,
        remedy:
          'Verify the App is installed and the private key is current. Check GitHub App settings.',
      };
    }
    token = JSON.parse(res.body) as AccessToken;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      label: 'GitHub App',
      status: 'red',
      detail: `Failed to mint installation token: ${msg}`,
      remedy: 'Check internet connectivity and GitHub API status',
    };
  }

  // Check permissions
  const missing: string[] = [];
  const insufficient: string[] = [];

  for (const [perm, required] of Object.entries(REQUIRED_PERMISSIONS)) {
    const granted = token.permissions[perm];
    if (!granted) {
      missing.push(perm);
    } else if (required === 'write' && granted === 'read') {
      insufficient.push(`${perm} (needs write, has read)`);
    }
  }

  if (missing.length > 0 || insufficient.length > 0) {
    const problems = [...missing.map((p) => `${p} missing`), ...insufficient].join(', ');
    return {
      label: 'GitHub App',
      status: 'red',
      detail: `Permission issues: ${problems}`,
      remedy:
        'In GitHub App settings → Permissions, set: Contents=write, Pull requests=write, Issues=write, Metadata=read',
    };
  }

  return {
    label: 'GitHub App',
    status: 'green',
    detail: `Installation token minted; permissions OK (installation #${installation.id})`,
  };
}
