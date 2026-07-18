import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workflowTemplates, routerWorkflowTemplate } from '../../init/templates.js';
import type { CheckResult } from '../types.js';

export function checkWorkflowDrift(opts: { repoRoot: string; ferryVersion: string }): CheckResult {
  const { repoRoot, ferryVersion } = opts;
  const workflowDir = join(repoRoot, '.github', 'workflows');

  // Router model: a single ferry-router.yml replaces the five per-agent stubs,
  // so its presence switches the drift comparison and drops the legacy demand.
  const router = routerWorkflowTemplate(ferryVersion);
  const routerPath = join(workflowDir, router.filename);
  if (existsSync(routerPath)) {
    // Leftover legacy stubs also fire on the legacy events the router listens
    // for — every legacy dispatch would run twice until they are removed.
    const leftoverStubs = [
      'ferry-refine.yml',
      'ferry-dev.yml',
      'ferry-review.yml',
      'ferry-iterate.yml',
      'ferry-merge.yml',
    ].filter((f) => existsSync(join(workflowDir, f)));
    if (leftoverStubs.length > 0) {
      return {
        label: 'Workflow files',
        status: 'yellow',
        detail: `Legacy per-agent stubs still present alongside ${router.filename}: ${leftoverStubs.join(', ')} — both fire on legacy events`,
        remedy: 'Finish the router migration: migrate the Jira rule, then delete the legacy stubs',
      };
    }
    const installed = readFileSync(routerPath, 'utf8');
    if (installed !== router.content) {
      return {
        label: 'Workflow files',
        status: 'yellow',
        detail: `${router.filename} differs from Ferry ${ferryVersion}`,
        remedy: `Run \`npx -p @big-emotion/ferry ferry-update\` to upgrade the router workflow, or \`ferry-init --overwrite\` to re-run full setup`,
      };
    }
    return {
      label: 'Workflow files',
      status: 'green',
      detail: `${router.filename} matches Ferry ${ferryVersion} (router model — legacy per-agent files not required)`,
    };
  }

  const templates = workflowTemplates(ferryVersion);

  const missing: string[] = [];
  const drifted: string[] = [];
  const upToDate: string[] = [];

  for (const tmpl of templates) {
    const filePath = join(workflowDir, tmpl.filename);
    if (!existsSync(filePath)) {
      missing.push(tmpl.filename);
      continue;
    }
    const existing = readFileSync(filePath, 'utf8');
    if (existing !== tmpl.content) {
      drifted.push(tmpl.filename);
    } else {
      upToDate.push(tmpl.filename);
    }
  }

  if (missing.length > 0) {
    return {
      label: 'Workflow files',
      status: 'red',
      detail: `Missing: ${missing.join(', ')}`,
      remedy: `Run \`npx -p @big-emotion/ferry ferry-init\` to install the missing workflow files`,
    };
  }

  if (drifted.length > 0) {
    return {
      label: 'Workflow files',
      status: 'yellow',
      detail: `${drifted.length} file(s) differ from Ferry ${ferryVersion}: ${drifted.join(', ')}`,
      remedy: `Run \`npx -p @big-emotion/ferry ferry-update\` to upgrade the workflow files, or \`ferry-init --overwrite\` to re-run full setup`,
    };
  }

  return {
    label: 'Workflow files',
    status: 'green',
    detail: `All ${upToDate.length} workflow files match Ferry ${ferryVersion}`,
  };
}
