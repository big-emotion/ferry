import { httpsGet } from '../http.js';
import type { CheckResult } from '../types.js';

function jiraAuthHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

interface JiraMyselfResponse {
  displayName?: string;
  emailAddress?: string;
}

interface JiraProjectResponse {
  key?: string;
  name?: string;
}

export async function checkJira(opts: {
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraProjectKey: string;
}): Promise<CheckResult> {
  const { jiraBaseUrl, jiraEmail, jiraApiToken, jiraProjectKey } = opts;

  if (!jiraBaseUrl || !jiraEmail || !jiraApiToken) {
    return {
      label: 'Jira reachable',
      status: 'skip',
      detail: 'Jira credentials not provided — skipping',
      remedy:
        'Provide --jira-url, --jira-email, --jira-token, or set FERRY_JIRA_BASE_URL / FERRY_JIRA_EMAIL / FERRY_JIRA_API_TOKEN',
    };
  }

  let hostname: string;
  let basePath: string;
  try {
    const url = new URL(jiraBaseUrl);
    hostname = url.hostname;
    basePath = url.pathname.replace(/\/$/, '');
  } catch {
    return {
      label: 'Jira reachable',
      status: 'red',
      detail: `Invalid Jira URL: ${jiraBaseUrl}`,
      remedy: 'FERRY_JIRA_BASE_URL must be a valid URL, e.g. https://acme.atlassian.net',
    };
  }

  const headers = {
    Authorization: jiraAuthHeader(jiraEmail, jiraApiToken),
    Accept: 'application/json',
    'User-Agent': 'ferry-doctor/1',
  };

  // Check /myself
  let displayName: string;
  try {
    const res = await httpsGet({
      hostname,
      path: `${basePath}/rest/api/3/myself`,
      headers,
    });

    if (res.statusCode === 401 || res.statusCode === 403) {
      return {
        label: 'Jira reachable',
        status: 'red',
        detail: `Authentication failed (${res.statusCode}) for ${jiraEmail}`,
        remedy:
          'Verify FERRY_JIRA_EMAIL and FERRY_JIRA_API_TOKEN. Generate a new token at id.atlassian.com/manage-profile/security/api-tokens',
      };
    }
    if (res.statusCode !== 200) {
      return {
        label: 'Jira reachable',
        status: 'red',
        detail: `Unexpected status ${res.statusCode} from Jira /myself`,
        remedy: `Check that ${jiraBaseUrl} is reachable and the Jira instance is active`,
      };
    }

    const body = JSON.parse(res.body) as JiraMyselfResponse;
    displayName = body.displayName ?? jiraEmail;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      label: 'Jira reachable',
      status: 'red',
      detail: `Network error reaching Jira: ${msg}`,
      remedy: `Check that ${jiraBaseUrl} is reachable and FERRY_JIRA_BASE_URL is correct`,
    };
  }

  // Check project key (optional — skip if not provided)
  if (!jiraProjectKey) {
    return {
      label: 'Jira reachable',
      status: 'green',
      detail: `Authenticated as ${displayName} — no project key to verify`,
    };
  }

  try {
    const res = await httpsGet({
      hostname,
      path: `${basePath}/rest/api/3/project/${encodeURIComponent(jiraProjectKey)}`,
      headers,
    });

    if (res.statusCode === 404) {
      return {
        label: 'Jira reachable',
        status: 'red',
        detail: `Authenticated as ${displayName} but project "${jiraProjectKey}" not found`,
        remedy: `Verify the project key is correct and ${jiraEmail} has access to it in Jira`,
      };
    }
    if (res.statusCode !== 200) {
      return {
        label: 'Jira reachable',
        status: 'yellow',
        detail: `Authenticated as ${displayName}; project check returned ${res.statusCode}`,
        remedy: `Manually verify that project "${jiraProjectKey}" exists and is accessible`,
      };
    }

    const project = JSON.parse(res.body) as JiraProjectResponse;
    const projectName = project.name ?? jiraProjectKey;
    return {
      label: 'Jira reachable',
      status: 'green',
      detail: `${displayName} authenticated; project "${projectName}" (${jiraProjectKey}) resolved`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      label: 'Jira reachable',
      status: 'yellow',
      detail: `Authenticated as ${displayName}; project check failed: ${msg}`,
      remedy: 'Manually verify Jira project key and account permissions',
    };
  }
}
