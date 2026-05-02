import type { WorkflowEntry } from './types.js';

export function workflowTemplates(version: string): WorkflowEntry[] {
  return [
    {
      filename: 'ferry-refine.yml',
      content: `# Managed by ferry-init. Re-run \`npx -p @big-emotion/ferry ferry-init\` to update.
# Required secrets: FERRY_JIRA_BASE_URL, FERRY_JIRA_EMAIL, FERRY_JIRA_API_TOKEN,
#                   ANTHROPIC_API_KEY
# Required variables: FERRY_AUDIT_ISSUE (GitHub Issue number for the audit log)

name: Ferry — Refine

on:
  repository_dispatch:
    types: [ferry-refine]

permissions:
  contents: read
  issues: write

# Concurrency is managed by the reusable workflow. Adding a block here would deadlock.

jobs:
  refine:
    uses: big-emotion/ferry/.github/workflows/refine.yml@${version}
    with:
      ticket_key: \${{ github.event.client_payload.ticket_key }}
      event_id: \${{ github.event.client_payload.event_id }}
      payload: \${{ toJson(github.event.client_payload) }}
    secrets: inherit
`,
    },
    {
      filename: 'ferry-dev.yml',
      content: `# Managed by ferry-init. Re-run \`npx -p @big-emotion/ferry ferry-init\` to update.
# Required secrets: FERRY_JIRA_BASE_URL, FERRY_JIRA_EMAIL, FERRY_JIRA_API_TOKEN,
#                   ANTHROPIC_API_KEY, FERRY_REVIEW_TRANSITION_ID
# Required variables: FERRY_AUDIT_ISSUE (GitHub Issue number for the audit log)
# Developer model: hardcoded to claude-sonnet-4-6 in the reusable dev.yml.
# To override, set models.dev.model in ferry.config.yaml.

name: Ferry — Dev

on:
  repository_dispatch:
    types: [ferry-dev]

permissions:
  contents: write
  issues: write
  pull-requests: write

# Concurrency is managed by the reusable workflow. Adding a block here would deadlock.

jobs:
  dev:
    uses: big-emotion/ferry/.github/workflows/dev.yml@${version}
    with:
      ticket_key: \${{ github.event.client_payload.ticket_key }}
      event_id: \${{ github.event.client_payload.event_id }}
      payload: \${{ toJson(github.event.client_payload) }}
    secrets: inherit
`,
    },
    {
      filename: 'ferry-review.yml',
      content: `# Managed by ferry-init. Re-run \`npx -p @big-emotion/ferry ferry-init\` to update.
# Required secrets: FERRY_JIRA_BASE_URL, FERRY_JIRA_EMAIL, FERRY_JIRA_API_TOKEN,
#                   ANTHROPIC_API_KEY, FERRY_ITER_TRANSITION_ID
# Required variables: FERRY_AUDIT_ISSUE (GitHub Issue number for the audit log)
# Optional variables: FERRY_REVIEW_MODEL (default: claude-sonnet-4-6)

name: Ferry — Review

on:
  repository_dispatch:
    types: [ferry-review]

permissions:
  contents: read
  issues: write
  pull-requests: write
  checks: read

# Concurrency is managed by the reusable workflow. Adding a block here would deadlock.

jobs:
  review:
    uses: big-emotion/ferry/.github/workflows/review.yml@${version}
    with:
      ticket_key: \${{ github.event.client_payload.ticket_key }}
      event_id: \${{ github.event.client_payload.event_id }}
      payload: \${{ toJson(github.event.client_payload) }}
    secrets: inherit
`,
    },
    {
      filename: 'ferry-iterate.yml',
      content: `# Managed by ferry-init. Re-run \`npx -p @big-emotion/ferry ferry-init\` to update.
# Required secrets: FERRY_JIRA_BASE_URL, FERRY_JIRA_EMAIL, FERRY_JIRA_API_TOKEN,
#                   ANTHROPIC_API_KEY, FERRY_REVIEW_TRANSITION_ID
# Required variables: FERRY_AUDIT_ISSUE (GitHub Issue number for the audit log)
# Optional variables: FERRY_ITER_MODEL (default: claude-sonnet-4-6)
#                     FERRY_ITER_MAX_INPUT_TOKENS (default: 500000)

name: Ferry — Iterate

on:
  repository_dispatch:
    types: [ferry-iterate]

permissions:
  contents: write
  issues: write
  pull-requests: write

# Concurrency is managed by the reusable workflow. Adding a block here would deadlock.

jobs:
  iterate:
    uses: big-emotion/ferry/.github/workflows/iterate.yml@${version}
    with:
      ticket_key: \${{ github.event.client_payload.ticket_key }}
      event_id: \${{ github.event.client_payload.event_id }}
      payload: \${{ toJson(github.event.client_payload) }}
    secrets: inherit
`,
    },
  ];
}
