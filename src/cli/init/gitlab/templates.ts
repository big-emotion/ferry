/**
 * GitLab CI templates scaffolded by `ferry-init --forge gitlab`.
 *
 * The source of truth lives at `examples/consumer-setup-gitlab/` — this module
 * embeds those files verbatim so the published package can scaffold the same
 * artefact without shipping the `examples/` tree. A test enforces byte-for-byte
 * equivalence so the two never drift.
 */
import type { WorkflowEntry } from '../types.js';

export const GITLAB_TEMPLATE_FILENAMES = [
  'refine.gitlab-ci.yml',
  'dev.gitlab-ci.yml',
  'review.gitlab-ci.yml',
  'iterate.gitlab-ci.yml',
  'reconcile.gitlab-ci.yml',
  'cost-daily.gitlab-ci.yml',
] as const;

export type GitLabTemplateFilename = (typeof GITLAB_TEMPLATE_FILENAMES)[number];

const REFINE = `# Ferry — Refiner role (GitLab CI, EXPERIMENTAL)
# Triggered by Jira Automation → POST /projects/:id/trigger/pipeline
# with variables[FERRY_DISPATCH_TYPE]=ferry-refine.

ferry-refine:
  stage: build
  image: node:20-alpine
  rules:
    - if: '$FERRY_DISPATCH_TYPE == "ferry-refine"'
  variables:
    FERRY_AGENT_ROLE: refiner
    FERRY_REFINER_MODEL: \${FERRY_REFINER_MODEL:-claude-opus-4-8}
  script:
    - npm install -g "@big-emotion/ferry@\${FERRY_VERSION}"
    - ferry-agent run --role refiner
`;

const DEV = `# Ferry — Developer role (GitLab CI, EXPERIMENTAL)
# Triggered with variables[FERRY_DISPATCH_TYPE]=ferry-dev.

ferry-dev:
  stage: build
  image: node:20-alpine
  rules:
    - if: '$FERRY_DISPATCH_TYPE == "ferry-dev"'
  variables:
    FERRY_AGENT_ROLE: developer
    FERRY_DEV_MODEL: \${FERRY_DEV_MODEL:-claude-sonnet-5}
  script:
    - apk add --no-cache git
    - npm install -g "@big-emotion/ferry@\${FERRY_VERSION}"
    - ferry-agent run --role developer
`;

const REVIEW = `# Ferry — Reviewer role (GitLab CI, EXPERIMENTAL)
# Triggered with variables[FERRY_DISPATCH_TYPE]=ferry-review.

ferry-review:
  stage: build
  image: node:20-alpine
  rules:
    - if: '$FERRY_DISPATCH_TYPE == "ferry-review"'
  variables:
    FERRY_AGENT_ROLE: reviewer
    FERRY_REVIEW_MODEL: \${FERRY_REVIEW_MODEL:-claude-opus-4-8}
  script:
    - npm install -g "@big-emotion/ferry@\${FERRY_VERSION}"
    - ferry-agent run --role reviewer
`;

const ITERATE = `# Ferry — Iterator role (GitLab CI, EXPERIMENTAL)
# Triggered with variables[FERRY_DISPATCH_TYPE]=ferry-iterate.

ferry-iterate:
  stage: build
  image: node:20-alpine
  rules:
    - if: '$FERRY_DISPATCH_TYPE == "ferry-iterate"'
  variables:
    FERRY_AGENT_ROLE: iterator
    FERRY_ITER_MODEL: \${FERRY_ITER_MODEL:-claude-sonnet-5}
  script:
    - apk add --no-cache git
    - npm install -g "@big-emotion/ferry@\${FERRY_VERSION}"
    - ferry-agent run --role iterator
`;

const RECONCILE = `# Ferry — Reconciler sweep (GitLab CI, EXPERIMENTAL)
# Wire this to a scheduled pipeline (CI/CD → Schedules) with the CI variable
# schedule_reconcile=true. Recommended cadence: every 10 minutes.

ferry-reconcile:
  stage: build
  image: node:20-alpine
  rules:
    - if: '$schedule_reconcile == "true"'
  script:
    - npm install -g "@big-emotion/ferry@\${FERRY_VERSION}"
    - ferry-reconcile
`;

const COST_DAILY = `# Ferry — Cost-governance daily audit (GitLab CI, EXPERIMENTAL)
# Wire this to a scheduled pipeline with the CI variable schedule_cost_daily=true.
# Recommended cadence: once per day.

ferry-cost-daily:
  stage: build
  image: node:20-alpine
  rules:
    - if: '$schedule_cost_daily == "true"'
  script:
    - npm install -g "@big-emotion/ferry@\${FERRY_VERSION}"
    - ferry-cost-check
`;

export function gitlabTemplates(): WorkflowEntry[] {
  return [
    { filename: 'refine.gitlab-ci.yml', content: REFINE },
    { filename: 'dev.gitlab-ci.yml', content: DEV },
    { filename: 'review.gitlab-ci.yml', content: REVIEW },
    { filename: 'iterate.gitlab-ci.yml', content: ITERATE },
    { filename: 'reconcile.gitlab-ci.yml', content: RECONCILE },
    { filename: 'cost-daily.gitlab-ci.yml', content: COST_DAILY },
  ];
}
