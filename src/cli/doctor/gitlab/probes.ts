/**
 * Live probes for `ferry-doctor --forge gitlab` (issue #214 part B).
 *
 * Each probe reuses the same `httpsGet` mock surface as the GitHub-side
 * checks so unit tests stay HTTP-mocked. The probes return a `CheckResult`
 * shaped exactly like the GitHub checks so they render in the same table.
 *
 * Probes implemented:
 *   1. `probeProjectAccess`     — `GET /projects/:id` reads the project
 *   2. `probeTokenScopes`       — `GET /personal_access_tokens/self` inspects scopes
 *   3. `probePipelineTrigger`   — `GET /projects/:id/triggers` verifies the configured trigger
 *   4. `probeProjectVariables`  — `GET /projects/:id/variables` checks required CI/CD vars
 *   5. `probeJiraWebhookManual` — prints a [MANUAL] line (no network probe possible)
 */
import { URL } from 'node:url';
import { httpsGet } from '../../http.js';
import type { CheckResult } from '../types.js';

/**
 * Required CI/CD variables on a GitLab project running Ferry. Sourced from
 * `examples/consumer-setup-gitlab/README.md` step 2. The LLM key requirement
 * (at least one of ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY) is
 * enforced separately by `probeProjectVariables` because it's a disjunction,
 * not a single required key.
 */
export const REQUIRED_PROJECT_VARIABLES = [
  'FERRY_VERSION',
  'FERRY_JIRA_BASE_URL',
  'FERRY_JIRA_EMAIL',
  'FERRY_JIRA_API_TOKEN',
  'FERRY_GITLAB_TOKEN',
  'FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN',
  'FERRY_REVIEW_TRANSITION_ID',
  'FERRY_ITER_TRANSITION_ID',
  'FERRY_APPROVE_TRANSITION_ID',
  'FERRY_AUDIT_ISSUE',
] as const;

const LLM_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY'] as const;
/** Token-bearing CI/CD variables that should always be Masked + Protected. */
const SENSITIVE_KEYS = new Set<string>([
  'FERRY_JIRA_API_TOKEN',
  'FERRY_GITLAB_TOKEN',
  'FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN',
  ...LLM_KEYS,
]);

export interface GitLabProbeOpts {
  apiBase: string;
  token: string;
  projectPath: string;
  triggerToken: string;
}

interface GitLabProject {
  id: number;
  path_with_namespace: string;
}

interface GitLabTokenSelf {
  scopes?: string[];
  active?: boolean;
  revoked?: boolean;
}

interface GitLabTrigger {
  id: number;
  token: string;
  description?: string;
}

interface GitLabVariable {
  key: string;
  variable_type?: string;
  masked?: boolean;
  protected?: boolean;
}

/**
 * Split an API-base URL like `https://gitlab.com/api/v4` into the pieces
 * `httpsGet` (which mirrors `https.RequestOptions`) needs.
 */
function splitApiBase(apiBase: string): { hostname: string; basePath: string; port?: number } {
  const u = new URL(apiBase);
  const basePath = u.pathname.replace(/\/+$/, '');
  return {
    hostname: u.hostname,
    basePath,
    ...(u.port ? { port: Number(u.port) } : {}),
  };
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': 'ferry-doctor/1',
  };
}

function networkError(label: string, e: unknown, remedy: string): CheckResult {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    label,
    status: 'red',
    detail: `Network error reaching the GitLab API: ${msg}`,
    remedy,
  };
}

// ── 1. Project access ─────────────────────────────────────────────────────────

export async function probeProjectAccess(opts: GitLabProbeOpts): Promise<CheckResult> {
  const label = 'GitLab project access';
  if (!opts.token) {
    return {
      label,
      status: 'skip',
      detail: 'No GitLab token provided — skipping',
      remedy: 'Pass --token or set FERRY_GITLAB_TOKEN',
    };
  }
  if (!opts.projectPath) {
    return {
      label,
      status: 'skip',
      detail: 'No GitLab project path provided — skipping',
      remedy: 'Pass --project owner/repo or set FERRY_GITLAB_PROJECT_PATH',
    };
  }

  const { hostname, basePath, port } = splitApiBase(opts.apiBase);
  const encoded = encodeURIComponent(opts.projectPath);

  try {
    const res = await httpsGet({
      hostname,
      ...(port !== undefined ? { port } : {}),
      path: `${basePath}/projects/${encoded}`,
      headers: authHeaders(opts.token),
    });
    if (res.statusCode === 401) {
      return {
        label,
        status: 'red',
        detail: `Token rejected (401) when reading /projects/${opts.projectPath}`,
        remedy:
          'Re-create the project access token with scopes: api, read_repository (Settings → Access tokens).',
      };
    }
    if (res.statusCode === 404) {
      return {
        label,
        status: 'red',
        detail: `Project ${opts.projectPath} not found or token lacks access (404)`,
        remedy: `Verify the project path (got "${opts.projectPath}") and that the token belongs to a member with at least Reporter role.`,
      };
    }
    if (res.statusCode !== 200) {
      return {
        label,
        status: 'red',
        detail: `Unexpected status ${res.statusCode} from GET /projects/${opts.projectPath}`,
        remedy:
          'Check the FERRY_GITLAB_API_BASE setting and the GitLab status page (status.gitlab.com).',
      };
    }
    const project = JSON.parse(res.body) as GitLabProject;
    return {
      label,
      status: 'green',
      detail: `Project #${project.id} (${project.path_with_namespace}) reachable with token`,
    };
  } catch (e) {
    return networkError(
      label,
      e,
      'Check FERRY_GITLAB_API_BASE and that the runner can reach the GitLab API.',
    );
  }
}

// ── 2. Token scopes ───────────────────────────────────────────────────────────

export async function probeTokenScopes(opts: GitLabProbeOpts): Promise<CheckResult> {
  const label = 'GitLab token scopes';
  if (!opts.token) {
    return {
      label,
      status: 'skip',
      detail: 'No GitLab token provided — skipping',
      remedy: 'Pass --token or set FERRY_GITLAB_TOKEN',
    };
  }

  const { hostname, basePath, port } = splitApiBase(opts.apiBase);

  try {
    const res = await httpsGet({
      hostname,
      ...(port !== undefined ? { port } : {}),
      path: `${basePath}/personal_access_tokens/self`,
      headers: authHeaders(opts.token),
    });

    if (res.statusCode === 401) {
      return {
        label,
        status: 'red',
        detail: 'Token rejected (401) by /personal_access_tokens/self',
        remedy: 'Re-issue the token (Settings → Access tokens) with the `api` scope.',
      };
    }
    if (res.statusCode === 404) {
      // GitLab project access tokens cannot inspect themselves via this
      // endpoint; we cannot verify scopes server-side but `probeProjectAccess`
      // already covers the practical "token works" case.
      return {
        label,
        status: 'yellow',
        detail: 'Cannot introspect scopes — endpoint returned 404 (likely a project access token)',
        remedy:
          'Project-access tokens cannot self-introspect. Confirm scopes manually in Settings → Access tokens (need: api).',
      };
    }
    if (res.statusCode !== 200) {
      return {
        label,
        status: 'red',
        detail: `Unexpected status ${res.statusCode} from /personal_access_tokens/self`,
        remedy: 'Check the FERRY_GITLAB_API_BASE setting and GitLab API status.',
      };
    }
    const self = JSON.parse(res.body) as GitLabTokenSelf;
    if (self.revoked || self.active === false) {
      return {
        label,
        status: 'red',
        detail: 'Token is revoked or inactive',
        remedy: 'Re-issue the token with the `api` scope.',
      };
    }
    const scopes = self.scopes ?? [];
    if (!scopes.includes('api')) {
      return {
        label,
        status: 'red',
        detail: `Missing required scope: api (have: ${scopes.join(', ') || 'none'})`,
        remedy:
          'Re-issue the token with the `api` scope — required to write MR notes and trigger pipelines.',
      };
    }
    return {
      label,
      status: 'green',
      detail: `Token scopes include api (${scopes.join(', ')})`,
    };
  } catch (e) {
    return networkError(
      label,
      e,
      'Check connectivity to the GitLab API and FERRY_GITLAB_API_BASE.',
    );
  }
}

// ── 3. Pipeline trigger ───────────────────────────────────────────────────────

export async function probePipelineTrigger(opts: GitLabProbeOpts): Promise<CheckResult> {
  const label = 'GitLab pipeline trigger';
  if (!opts.triggerToken) {
    return {
      label,
      status: 'skip',
      detail: 'No pipeline trigger token configured — skipping',
      remedy:
        'Pass --trigger-token or set FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN to enable this probe.',
    };
  }
  if (!opts.token || !opts.projectPath) {
    return {
      label,
      status: 'skip',
      detail: 'Project access token or project path missing — skipping',
      remedy: 'Set FERRY_GITLAB_TOKEN and FERRY_GITLAB_PROJECT_PATH.',
    };
  }

  const { hostname, basePath, port } = splitApiBase(opts.apiBase);
  const encoded = encodeURIComponent(opts.projectPath);

  try {
    const res = await httpsGet({
      hostname,
      ...(port !== undefined ? { port } : {}),
      path: `${basePath}/projects/${encoded}/triggers`,
      headers: authHeaders(opts.token),
    });
    if (res.statusCode === 401) {
      return {
        label,
        status: 'red',
        detail: 'Token rejected (401) when listing pipeline triggers',
        remedy: 'Re-issue the project access token with the `api` scope.',
      };
    }
    if (res.statusCode === 403) {
      return {
        label,
        status: 'red',
        detail: 'Forbidden (403) when listing pipeline triggers',
        remedy:
          'Project access token must have the `api` scope and Maintainer role to list pipeline triggers.',
      };
    }
    if (res.statusCode !== 200) {
      return {
        label,
        status: 'red',
        detail: `Unexpected status ${res.statusCode} from /projects/${opts.projectPath}/triggers`,
        remedy: 'Check FERRY_GITLAB_API_BASE and that the project has CI/CD enabled.',
      };
    }
    const triggers = JSON.parse(res.body) as GitLabTrigger[];
    if (triggers.length === 0) {
      return {
        label,
        status: 'red',
        detail: 'No pipeline triggers exist on this project',
        remedy:
          'Settings → CI/CD → Pipeline triggers → Add trigger, then export its token as FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN.',
      };
    }
    // GitLab masks tokens after creation — only the first few characters are
    // returned by GET. Accept either a full match or a prefix match.
    const configured = opts.triggerToken;
    const match = triggers.find(
      (t) => t.token === configured || (t.token && configured.startsWith(t.token)),
    );
    if (!match) {
      return {
        label,
        status: 'red',
        detail: `Configured pipeline trigger token not found among ${triggers.length} project trigger(s)`,
        remedy:
          'Re-copy the token from Settings → CI/CD → Pipeline triggers, or rotate FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN to match an existing trigger.',
      };
    }
    return {
      label,
      status: 'green',
      detail: `Pipeline trigger #${match.id} matches FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN${match.description ? ` (${match.description})` : ''}`,
    };
  } catch (e) {
    return networkError(label, e, 'Check connectivity to the GitLab API.');
  }
}

// ── 4. Project CI/CD variables ────────────────────────────────────────────────

export async function probeProjectVariables(opts: GitLabProbeOpts): Promise<CheckResult> {
  const label = 'GitLab CI/CD variables';
  if (!opts.token) {
    return {
      label,
      status: 'skip',
      detail: 'No GitLab token provided — skipping',
      remedy: 'Pass --token or set FERRY_GITLAB_TOKEN',
    };
  }
  if (!opts.projectPath) {
    return {
      label,
      status: 'skip',
      detail: 'No GitLab project path provided — skipping',
      remedy: 'Pass --project owner/repo or set FERRY_GITLAB_PROJECT_PATH',
    };
  }

  const { hostname, basePath, port } = splitApiBase(opts.apiBase);
  const encoded = encodeURIComponent(opts.projectPath);

  try {
    const res = await httpsGet({
      hostname,
      ...(port !== undefined ? { port } : {}),
      path: `${basePath}/projects/${encoded}/variables`,
      headers: authHeaders(opts.token),
    });
    if (res.statusCode === 401) {
      return {
        label,
        status: 'red',
        detail: 'Token rejected (401) when listing CI/CD variables',
        remedy:
          'Re-issue the project access token with `api` scope and Maintainer role on the project.',
      };
    }
    if (res.statusCode === 403) {
      return {
        label,
        status: 'red',
        detail: 'Forbidden (403) when listing CI/CD variables',
        remedy: 'The token role must be at least Maintainer to read /projects/:id/variables.',
      };
    }
    if (res.statusCode !== 200) {
      return {
        label,
        status: 'red',
        detail: `Unexpected status ${res.statusCode} from /projects/${opts.projectPath}/variables`,
        remedy: 'Check FERRY_GITLAB_API_BASE and the GitLab project is accessible.',
      };
    }
    const vars = JSON.parse(res.body) as GitLabVariable[];
    const present = new Set(vars.map((v) => v.key));
    const missing = REQUIRED_PROJECT_VARIABLES.filter((k) => !present.has(k));

    if (missing.length > 0) {
      const lines = missing.map((k) => `  [FAIL] ${k}`).join('\n');
      return {
        label,
        status: 'red',
        detail: `Missing required CI/CD variable(s):\n${lines}`,
        remedy:
          'Settings → CI/CD → Variables — add the listed keys (Masked + Protected). See examples/consumer-setup-gitlab/README.md.',
      };
    }

    const hasLlm = LLM_KEYS.some((k) => present.has(k));
    if (!hasLlm) {
      return {
        label,
        status: 'red',
        detail: `No LLM provider key set — need at least one of ${LLM_KEYS.join(', ')}`,
        remedy:
          'Add ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY (Masked + Protected) under Settings → CI/CD → Variables.',
      };
    }

    // All required keys present — warn if any sensitive ones are unmasked.
    const unmasked = vars
      .filter((v) => SENSITIVE_KEYS.has(v.key) && v.masked === false)
      .map((v) => v.key);
    if (unmasked.length > 0) {
      return {
        label,
        status: 'yellow',
        detail: `All required keys set, but unmasked: ${unmasked.join(', ')}`,
        remedy:
          'Re-save each token-bearing variable with the "Masked" checkbox enabled to keep secrets out of job logs.',
      };
    }

    return {
      label,
      status: 'green',
      detail: `All required CI/CD variables are set (${REQUIRED_PROJECT_VARIABLES.length} keys + LLM provider)`,
    };
  } catch (e) {
    return networkError(label, e, 'Check connectivity to the GitLab API.');
  }
}

// ── 5. Jira automation webhook (manual only) ──────────────────────────────────

/**
 * The Jira-Automation → GitLab webhook target cannot be probed from
 * `ferry-doctor`: we don't have the Jira rule definition, and even if we did,
 * its outbound network egress isn't observable from this process. Surface a
 * `[MANUAL]` line so the operator confirms it explicitly.
 */
export async function probeJiraWebhookManual(): Promise<CheckResult> {
  return Promise.resolve({
    label: 'Jira → GitLab webhook',
    status: 'skip',
    detail: '[MANUAL] Cannot probe automation webhook from this process',
    remedy:
      'In Jira → Automation, fire a test execution of each rule that targets {API_BASE}/projects/:id/trigger/pipeline and confirm a pipeline starts in GitLab.',
  });
}
