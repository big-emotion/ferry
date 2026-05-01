/**
 * CLI entrypoint for the reconciler sweep (FR50, FR51, NFR-P4).
 *
 * Wires reconcileTickets() to real I/O:
 *   - Jira JQL search (if FERRY_JIRA_PROJECT is set) for tickets in active columns
 *   - .ferry/<key>/state.json for known state phases
 *   - GitHub audit issue comments for last-audit timestamps
 *   - GitHub repository_dispatch to re-trigger stalled tickets
 *
 * Called from .github/workflows/reconcile.yml on a cron schedule.
 */

import { existsSync, readFileSync, readdirSync, appendFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { Octokit } from '@octokit/rest';
import {
  reconcileTickets,
  type TicketSnapshot,
  type DispatchDirective,
  type ReconcileOutcome,
} from './reconcile.js';

const FERRY_ACTIVE_COLUMNS = new Set([
  'Refinement',
  'In Development',
  'In Review',
  'Changes Requested',
]);

export interface ReconcilerConfig {
  githubToken: string;
  owner: string;
  repo: string;
  auditIssue: number;
  nowMs: number;
  /** Root of the consumer repo. State files are at `<workspace>/.ferry/<key>/state.json`. Defaults to CWD. */
  workspace: string;
  jiraBaseUrl?: string;
  jiraAuthHeader?: string;
  jiraProject?: string;
}

export interface ReconcilerDeps {
  searchJira(config: ReconcilerConfig): Promise<Array<{ key: string; column: string }>>;
  readStatePhase(ticketKey: string, workspace: string): string | undefined;
  scanStateTickets(workspace: string): string[];
  fetchAuditComments(
    config: ReconcilerConfig,
  ): Promise<Array<{ body: string | null; created_at: string }>>;
  issueDispatch(config: ReconcilerConfig, directive: DispatchDirective): Promise<void>;
}

export function buildDefaultDeps(): ReconcilerDeps {
  return {
    async searchJira(config) {
      if (!config.jiraBaseUrl || !config.jiraAuthHeader || !config.jiraProject) return [];
      const columns = [...FERRY_ACTIVE_COLUMNS].map((c) => `"${c}"`).join(',');
      const jql =
        `project = "${config.jiraProject}" AND status in (${columns}) ORDER BY updated DESC`;
      const res = await fetch(
        `${config.jiraBaseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=status&maxResults=100`,
        { headers: { Authorization: config.jiraAuthHeader, Accept: 'application/json' } },
      );
      if (!res.ok) {
        console.warn(`[reconciler] Jira search returned ${res.status} — skipping Jira scan`);
        return [];
      }
      const data = (await res.json()) as {
        issues: Array<{ key: string; fields: { status: { name: string } } }>;
      };
      return data.issues.map((i) => ({ key: i.key, column: i.fields.status.name }));
    },

    readStatePhase(ticketKey, workspace = '.') {
      const path = `${workspace}/.ferry/${ticketKey}/state.json`;
      if (!existsSync(path)) return undefined;
      try {
        return (JSON.parse(readFileSync(path, 'utf8')) as { phase?: string }).phase;
      } catch {
        return undefined;
      }
    },

    scanStateTickets(workspace = '.') {
      const ferryDir = `${workspace}/.ferry`;
      if (!existsSync(ferryDir)) return [];
      try {
        return readdirSync(ferryDir, { withFileTypes: true })
          .filter((e) => e.isDirectory() && existsSync(`${ferryDir}/${e.name}/state.json`))
          .map((e) => e.name);
      } catch {
        return [];
      }
    },

    fetchAuditComments(config) {
      const octokit = new Octokit({ auth: config.githubToken });
      return octokit.paginate(octokit.rest.issues.listComments, {
        owner: config.owner,
        repo: config.repo,
        issue_number: config.auditIssue,
        per_page: 100,
      }) as unknown as Promise<Array<{ body: string | null; created_at: string }>>;
    },

    async issueDispatch(config, directive) {
      const octokit = new Octokit({ auth: config.githubToken });
      await octokit.rest.repos.createDispatchEvent({
        owner: config.owner,
        repo: config.repo,
        event_type: `ferry-${directive.phase}`,
        client_payload: {
          version: 'v1',
          event_id: directive.event_id,
          ticket_key: directive.ticket_key,
          phase: directive.phase,
          source: 'reconciler' as const,
          ts: new Date(config.nowMs).toISOString(),
        },
      });
    },
  };
}

function parseLastAuditPerTicket(
  comments: Array<{ body: string | null; created_at: string }>,
  nowMs: number,
): Map<string, number> {
  const lastAuditMs = new Map<string, number>();
  for (const c of comments) {
    if (!c.body?.includes('[ferry:audit:')) continue;
    const m = c.body.match(/\[ferry:audit:[^\]]+\]\n([\s\S]+)/);
    if (!m) continue;
    try {
      const line = JSON.parse(m[1]) as { ticket?: string };
      if (!line.ticket) continue;
      const t = new Date(c.created_at).getTime();
      const prev = lastAuditMs.get(line.ticket);
      if (prev === undefined || t > prev) lastAuditMs.set(line.ticket, t);
    } catch {
      // ignore malformed comments
    }
  }
  const minutesAgo = new Map<string, number>();
  for (const [ticket, lastMs] of lastAuditMs) {
    minutesAgo.set(ticket, Math.floor((nowMs - lastMs) / 60_000));
  }
  return minutesAgo;
}

export async function run(
  config: ReconcilerConfig,
  deps: ReconcilerDeps = buildDefaultDeps(),
): Promise<ReconcileOutcome> {
  const stateKeys = deps.scanStateTickets(config.workspace);
  const [jiraTickets, auditComments] = await Promise.all([
    deps.searchJira(config),
    deps.fetchAuditComments(config),
  ]);

  const lastAuditMinutesAgo = parseLastAuditPerTicket(auditComments, config.nowMs);

  // Merge ticket sources — Jira has authoritative column; state files cover
  // tickets not yet in Jira scope (e.g. project key not configured).
  const columnByKey = new Map(jiraTickets.map((t) => [t.key, t.column]));
  const allKeys = new Set([...jiraTickets.map((t) => t.key), ...stateKeys]);

  const snapshots: TicketSnapshot[] = [];
  for (const key of allKeys) {
    const jira_column = columnByKey.get(key) ?? 'In Development';
    if (!FERRY_ACTIVE_COLUMNS.has(jira_column)) continue;
    snapshots.push({
      ticket_key: key,
      jira_column,
      state_phase: deps.readStatePhase(key, config.workspace),
      last_audit_minutes_ago: lastAuditMinutesAgo.get(key) ?? 9999,
    });
  }

  const outcome = reconcileTickets({ tickets: snapshots, now_iso: new Date(config.nowMs).toISOString() });

  for (const directive of outcome.dispatched) {
    console.log(`[reconciler] dispatching ${directive.ticket_key} → ${directive.phase} (${directive.event_id})`);
    await deps.issueDispatch(config, directive);
  }

  console.log(`[reconciler] scanned=${outcome.scanned} dispatched=${outcome.dispatched.length}`);
  return outcome;
}

export function configFromEnv(): ReconcilerConfig {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) throw new Error('GITHUB_TOKEN is required');
  const githubRepository = process.env.GITHUB_REPOSITORY;
  if (!githubRepository) throw new Error('GITHUB_REPOSITORY is required (owner/repo)');
  const auditIssueStr = process.env.FERRY_AUDIT_ISSUE;
  if (!auditIssueStr) throw new Error('FERRY_AUDIT_ISSUE is required');
  const auditIssue = parseInt(auditIssueStr, 10);
  if (isNaN(auditIssue))
    throw new Error(`FERRY_AUDIT_ISSUE must be a number, got: ${auditIssueStr}`);

  const [owner, repo] = githubRepository.split('/');

  const jiraBaseUrl = process.env.FERRY_JIRA_BASE_URL;
  const jiraEmail = process.env.FERRY_JIRA_EMAIL;
  const jiraApiToken = process.env.FERRY_JIRA_API_TOKEN;
  const jiraProject = process.env.FERRY_JIRA_PROJECT;
  const jiraAuthHeader =
    jiraEmail && jiraApiToken
      ? `Basic ${Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64')}`
      : undefined;

  return {
    githubToken,
    owner,
    repo,
    auditIssue,
    nowMs: Date.now(),
    workspace: process.env.FERRY_WORKSPACE ?? '.',
    jiraBaseUrl,
    jiraAuthHeader,
    jiraProject,
  };
}

// Only run when invoked directly — not when imported in tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(configFromEnv())
    .then((outcome) => {
      const summary = `Reconciler: scanned ${outcome.scanned}, dispatched ${outcome.dispatched.length}`;
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${summary}\n`);
      }
      console.log(summary);
    })
    .catch((err: unknown) => {
      console.error('[reconciler] fatal:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
