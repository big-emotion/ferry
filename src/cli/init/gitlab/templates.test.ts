import { describe, it, expect } from 'vitest';
import { gitlabTemplates, GITLAB_TEMPLATE_FILENAMES } from './templates.js';

describe('gitlabTemplates', () => {
  it('returns the six GitLab CI files documented in examples/consumer-setup-gitlab/README.md', () => {
    const templates = gitlabTemplates();
    expect(templates).toHaveLength(6);
  });

  it('exposes filenames matching the consumer-setup-gitlab examples', () => {
    const names = gitlabTemplates().map((t) => t.filename);
    for (const expected of GITLAB_TEMPLATE_FILENAMES) {
      expect(names).toContain(expected);
    }
  });

  it('each refine/dev/review/iterate template gates on $FERRY_DISPATCH_TYPE', () => {
    const dispatchByRole = {
      'refine.gitlab-ci.yml': 'ferry-refine',
      'dev.gitlab-ci.yml': 'ferry-dev',
      'review.gitlab-ci.yml': 'ferry-review',
      'iterate.gitlab-ci.yml': 'ferry-iterate',
    } as const;
    const templates = gitlabTemplates();
    for (const [filename, dispatch] of Object.entries(dispatchByRole)) {
      const tmpl = templates.find((t) => t.filename === filename);
      expect(tmpl, `missing ${filename}`).toBeDefined();
      expect(tmpl!.content).toContain(`$FERRY_DISPATCH_TYPE == "${dispatch}"`);
    }
  });

  it('scheduled jobs gate on $schedule_reconcile / $schedule_cost_daily', () => {
    const templates = gitlabTemplates();
    const reconcile = templates.find((t) => t.filename === 'reconcile.gitlab-ci.yml');
    const costDaily = templates.find((t) => t.filename === 'cost-daily.gitlab-ci.yml');
    expect(reconcile?.content).toContain('$schedule_reconcile == "true"');
    expect(costDaily?.content).toContain('$schedule_cost_daily == "true"');
  });

  it('every template installs the pinned @big-emotion/ferry package from ${FERRY_VERSION}', () => {
    for (const tmpl of gitlabTemplates()) {
      expect(tmpl.content).toContain('@big-emotion/ferry@${FERRY_VERSION}');
    }
  });

  it('template content stays byte-identical to examples/consumer-setup-gitlab/ on disk', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const exampleDir = resolve(here, '../../../../examples/consumer-setup-gitlab');
    for (const tmpl of gitlabTemplates()) {
      const onDisk = await readFile(`${exampleDir}/${tmpl.filename}`, 'utf8');
      expect(tmpl.content, `${tmpl.filename} drifted from examples/consumer-setup-gitlab/`).toBe(
        onDisk,
      );
    }
  });
});
