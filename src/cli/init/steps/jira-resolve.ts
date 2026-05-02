import { httpsGet } from '../../http.js';

function jiraAuthHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

interface TenantInfoResponse {
  cloudId?: string;
}

interface JiraProjectIdResponse {
  id?: string;
}

export async function resolveJiraWorkspaceId(
  baseUrl: string,
  email: string,
  token: string,
): Promise<string | null> {
  try {
    const url = new URL(baseUrl);
    const basePath = url.pathname.replace(/\/$/, '');
    const res = await httpsGet({
      hostname: url.hostname,
      path: `${basePath}/_edge/tenant_info`,
      headers: {
        Authorization: jiraAuthHeader(email, token),
        Accept: 'application/json',
        'User-Agent': 'ferry-init/1',
      },
    });
    if (res.statusCode !== 200) return null;
    const data = JSON.parse(res.body) as TenantInfoResponse;
    return data.cloudId ?? null;
  } catch {
    return null;
  }
}

export async function resolveJiraProjectId(
  baseUrl: string,
  email: string,
  token: string,
  projectKey: string,
): Promise<string | null> {
  try {
    const url = new URL(baseUrl);
    const basePath = url.pathname.replace(/\/$/, '');
    const res = await httpsGet({
      hostname: url.hostname,
      path: `${basePath}/rest/api/3/project/${encodeURIComponent(projectKey)}`,
      headers: {
        Authorization: jiraAuthHeader(email, token),
        Accept: 'application/json',
        'User-Agent': 'ferry-init/1',
      },
    });
    if (res.statusCode !== 200) return null;
    const data = JSON.parse(res.body) as JiraProjectIdResponse;
    return data.id ?? null;
  } catch {
    return null;
  }
}
