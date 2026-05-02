import { execSync } from 'node:child_process';
import type { CheckResult } from '../types.js';

const PROBE_TICKET = 'FERRY-DOCTOR-0';
const PROBE_EVENT_TYPE = 'ferry-refine';
const POLL_INTERVAL_MS = parseInt(process.env.FERRY_DISPATCH_POLL_INTERVAL_MS ?? '', 10) || 3_000;
const POLL_TIMEOUT_MS = parseInt(process.env.FERRY_DISPATCH_PROBE_TIMEOUT_MS ?? '', 10) || 45_000;

interface WorkflowRun {
  databaseId: number;
  status: string;
  conclusion: string | null;
  url: string;
  headBranch: string;
  event: string;
}

function triggerDispatch(repo: string, eventId: string): void {
  const payload = JSON.stringify({
    event_type: PROBE_EVENT_TYPE,
    client_payload: {
      phase: 'refine',
      ticket_key: PROBE_TICKET,
      event_id: eventId,
      issue_type: 'Task',
      actor: 'ferry-doctor',
      source: 'doctor-probe',
    },
  });
  execSync(`gh api repos/${repo}/dispatches --method POST --input -`, {
    input: payload,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function listRecentRuns(repo: string, after: number): WorkflowRun[] {
  try {
    const out = execSync(
      `gh run list --repo ${repo} --workflow ferry-refine.yml --limit 5 --json databaseId,status,conclusion,url,headBranch,event`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const runs = JSON.parse(out) as WorkflowRun[];
    return runs.filter((r) => r.databaseId > after);
  } catch {
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkSyntheticDispatch(opts: {
  repo: string;
  noDispatch: boolean;
}): Promise<CheckResult> {
  const { repo, noDispatch } = opts;

  if (noDispatch) {
    return {
      label: 'Synthetic dispatch',
      status: 'skip',
      detail: 'Skipped (--no-dispatch flag)',
      remedy: 'Remove --no-dispatch to enable the end-to-end workflow probe',
    };
  }

  const eventId = `doctor-${Date.now()}`;

  // Record highest existing run ID before triggering
  let baselineId = 0;
  try {
    const existing = listRecentRuns(repo, 0);
    baselineId = existing.reduce((max, r) => Math.max(max, r.databaseId), 0);
  } catch {
    // ignore
  }

  // Trigger
  try {
    triggerDispatch(repo, eventId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('permission') || msg.includes('403')) {
      return {
        label: 'Synthetic dispatch',
        status: 'red',
        detail: 'Permission denied triggering repository_dispatch',
        remedy:
          'Ensure gh CLI is authenticated with a token that has `repo` scope: `gh auth refresh -s repo`',
      };
    }
    if (msg.includes('not found') || msg.includes('404')) {
      return {
        label: 'Synthetic dispatch',
        status: 'red',
        detail: `Repo "${repo}" not found or dispatch not allowed`,
        remedy:
          'Verify the repo name is correct and `ferry-refine.yml` is committed to the default branch',
      };
    }
    return {
      label: 'Synthetic dispatch',
      status: 'red',
      detail: `Dispatch failed: ${msg}`,
      remedy: 'Check gh CLI authentication and internet connectivity',
    };
  }

  // Poll for the workflow run to appear
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let foundRun: WorkflowRun | undefined;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const newRuns = listRecentRuns(repo, baselineId);
    if (newRuns.length > 0) {
      foundRun = newRuns[0];
      break;
    }
  }

  if (!foundRun) {
    return {
      label: 'Synthetic dispatch',
      status: 'yellow',
      detail: 'Dispatch sent but no workflow run appeared within 45 s',
      remedy:
        'Verify ferry-refine.yml exists on the default branch and triggers on `ferry-refine` events. Check the Actions tab manually.',
    };
  }

  // Capture narrowed value in a const so closures below see WorkflowRun, not WorkflowRun|undefined
  const confirmedRun: WorkflowRun = foundRun;

  // Give the run a few more seconds to progress past the initial gate step
  await sleep(6_000);
  const updatedRuns = listRecentRuns(repo, baselineId);
  const updated = updatedRuns.find((r) => r.databaseId === confirmedRun.databaseId) ?? confirmedRun;

  const runUrl = updated.url;

  if (updated.status === 'completed' && updated.conclusion === 'failure') {
    return {
      label: 'Synthetic dispatch',
      status: 'yellow',
      detail: `Run started and reached gate step (expected failure with fake ticket) — ${runUrl}`,
      remedy: 'This is expected behaviour for a probe run — the gate rejected the fake ticket key',
    };
  }

  if (updated.status === 'in_progress' || updated.status === 'queued') {
    return {
      label: 'Synthetic dispatch',
      status: 'green',
      detail: `Run #${updated.databaseId} is ${updated.status} — workflow wired up correctly`,
    };
  }

  return {
    label: 'Synthetic dispatch',
    status: 'green',
    detail: `Run #${updated.databaseId} completed (${updated.conclusion ?? 'unknown'}) — gate reached`,
  };
}
