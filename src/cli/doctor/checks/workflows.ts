import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workflowTemplates } from '../../init/templates.js';
import type { CheckResult } from '../types.js';

export function checkWorkflowDrift(opts: { repoRoot: string; ferryVersion: string }): CheckResult {
  const { repoRoot, ferryVersion } = opts;
  const workflowDir = join(repoRoot, '.github', 'workflows');
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
      remedy: `Run \`npx -p @big-emotion/ferry ferry-init --overwrite\` to update the workflows to the current Ferry release`,
    };
  }

  return {
    label: 'Workflow files',
    status: 'green',
    detail: `All ${upToDate.length} workflow files match Ferry ${ferryVersion}`,
  };
}
