import type { WorkflowEntry } from './types.js';

export function workflowTemplates(version: string): WorkflowEntry[] {
  return [
    {
      filename: 'ferry-refine.yml',
      content: `# Managed by ferry-init. Re-run \`npx -p @big-emotion/ferry ferry-init\` to update.
# Required secrets: FERRY_JIRA_BASE_URL, FERRY_JIRA_EMAIL, FERRY_JIRA_API_TOKEN, ANTHROPIC_API_KEY
# Required variables: FERRY_AUDIT_ISSUE (GitHub Issue number for the audit log)

name: Ferry — Refine

on:
  repository_dispatch:
    types: [ferry-refine]

# cancel-in-progress: true — Refiner is pure read + audit comment; latest human edit wins
concurrency:
  group: ferry-\${{ github.workflow }}-\${{ github.event.client_payload.ticket_key || 'ferry-invalid-payload-sinkhole' }}
  cancel-in-progress: true

jobs:
  gate-envelope:
    name: Validate event envelope
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Validate event envelope
        uses: big-emotion/ferry/.github/actions/ferry-envelope-validate@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}

  run-agent:
    name: Run Refiner agent
    needs: [gate-envelope]
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Install gitleaks
        shell: bash
        run: |
          curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz" \\
            | tar -xz -C /usr/local/bin gitleaks

      - name: Run Refiner agent
        uses: big-emotion/ferry/.github/actions/ferry-run-refiner@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          ferry_model: claude-sonnet-4-6

  emit-audit:
    name: Emit audit line
    needs: [run-agent]
    if: needs.run-agent.result != 'skipped'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Emit audit line
        uses: big-emotion/ferry/.github/actions/ferry-emit-audit@${version}
        with:
          ticket: \${{ github.event.client_payload.ticket_key }}
          phase: refine
          run_id: \${{ github.event.client_payload.event_id }}
          model: claude-sonnet-4-6
          outcome: \${{ needs.run-agent.result }}
          start_ms: \${{ github.run_id }}
          audit_issue: \${{ vars.FERRY_AUDIT_ISSUE }}
          github_token: \${{ secrets.GITHUB_TOKEN }}
`,
    },
    {
      filename: 'ferry-dev.yml',
      content: `# Managed by ferry-init. Re-run \`npx -p @big-emotion/ferry ferry-init\` to update.
# Required secrets: FERRY_JIRA_BASE_URL, FERRY_JIRA_EMAIL, FERRY_JIRA_API_TOKEN,
#                   ANTHROPIC_API_KEY, FERRY_REVIEW_TRANSITION_ID
# Required variables: FERRY_AUDIT_ISSUE (GitHub Issue number for the audit log)

name: Ferry — Dev

on:
  repository_dispatch:
    types: [ferry-dev]

# cancel-in-progress: false — writes .ferry/state.json, branch, and PR; cancellation mid-commit = state/branch divergence
concurrency:
  group: ferry-\${{ github.workflow }}-\${{ github.event.client_payload.ticket_key || 'ferry-invalid-payload-sinkhole' }}
  cancel-in-progress: false

jobs:
  gate-envelope:
    name: Validate event envelope
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Validate event envelope
        uses: big-emotion/ferry/.github/actions/ferry-envelope-validate@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}

  run-agent:
    name: Run Developer agent
    needs: [gate-envelope]
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    outputs:
      input_tokens: \${{ steps.run-developer.outputs.input_tokens }}
      output_tokens: \${{ steps.run-developer.outputs.output_tokens }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Install gitleaks
        shell: bash
        run: |
          curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz" \\
            | tar -xz -C /usr/local/bin gitleaks

      - name: Run Developer agent
        id: run-developer
        uses: big-emotion/ferry/.github/actions/ferry-run-developer@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}
          ferry_review_transition_id: \${{ secrets.FERRY_REVIEW_TRANSITION_ID }}
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}
          ferry_model: claude-sonnet-4-6

  emit-audit:
    name: Emit audit line
    needs: [run-agent]
    if: needs.run-agent.result != 'skipped'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Emit audit line
        uses: big-emotion/ferry/.github/actions/ferry-emit-audit@${version}
        with:
          ticket: \${{ github.event.client_payload.ticket_key }}
          phase: dev
          run_id: \${{ github.event.client_payload.event_id }}
          model: claude-sonnet-4-6
          outcome: \${{ needs.run-agent.result }}
          input_tokens: \${{ needs.run-agent.outputs.input_tokens || '0' }}
          output_tokens: \${{ needs.run-agent.outputs.output_tokens || '0' }}
          start_ms: \${{ github.run_id }}
          audit_issue: \${{ vars.FERRY_AUDIT_ISSUE }}
          github_token: \${{ github.token }}
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

# cancel-in-progress: false — writes fingerprints to state.iteration_history[] + PR review body; must complete atomically
concurrency:
  group: ferry-\${{ github.workflow }}-\${{ github.event.client_payload.ticket_key || 'ferry-invalid-payload-sinkhole' }}
  cancel-in-progress: false

jobs:
  gate-envelope:
    name: Validate event envelope
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Validate event envelope
        uses: big-emotion/ferry/.github/actions/ferry-envelope-validate@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}

  run-agent:
    name: Run Reviewer agent
    needs: [gate-envelope]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
      checks: read
    outputs:
      input_tokens: \${{ steps.run-reviewer.outputs.input_tokens }}
      output_tokens: \${{ steps.run-reviewer.outputs.output_tokens }}
      model: \${{ steps.run-reviewer.outputs.model }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Install gitleaks
        shell: bash
        run: |
          curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz" \\
            | tar -xz -C /usr/local/bin gitleaks

      - name: Run Reviewer agent
        id: run-reviewer
        uses: big-emotion/ferry/.github/actions/ferry-run-reviewer@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}
          ferry_iter_transition_id: \${{ secrets.FERRY_ITER_TRANSITION_ID }}
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}
          ferry_review_model: \${{ vars.FERRY_REVIEW_MODEL || 'claude-sonnet-4-6' }}

  emit-audit:
    name: Emit audit line
    needs: [run-agent]
    if: needs.run-agent.result != 'skipped'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Emit audit line
        uses: big-emotion/ferry/.github/actions/ferry-emit-audit@${version}
        with:
          ticket: \${{ github.event.client_payload.ticket_key }}
          phase: review
          run_id: \${{ github.event.client_payload.event_id }}
          model: \${{ needs.run-agent.outputs.model || 'claude-sonnet-4-6' }}
          outcome: \${{ needs.run-agent.result }}
          input_tokens: \${{ needs.run-agent.outputs.input_tokens || '0' }}
          output_tokens: \${{ needs.run-agent.outputs.output_tokens || '0' }}
          start_ms: \${{ github.run_id }}
          audit_issue: \${{ vars.FERRY_AUDIT_ISSUE }}
          github_token: \${{ github.token }}
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

# cancel-in-progress: false — same as dev; writes state.json and branch commits
concurrency:
  group: ferry-\${{ github.workflow }}-\${{ github.event.client_payload.ticket_key || 'ferry-invalid-payload-sinkhole' }}
  cancel-in-progress: false

jobs:
  gate-envelope:
    name: Validate event envelope
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Validate event envelope
        uses: big-emotion/ferry/.github/actions/ferry-envelope-validate@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}

  run-agent:
    name: Run Iterator agent
    needs: [gate-envelope]
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    outputs:
      input_tokens: \${{ steps.run-iterator.outputs.input_tokens }}
      output_tokens: \${{ steps.run-iterator.outputs.output_tokens }}
      model: \${{ steps.run-iterator.outputs.model }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          fetch-depth: 0

      - name: Install gitleaks
        shell: bash
        run: |
          curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz \\
            | tar -xz -C /usr/local/bin gitleaks

      - name: Run Iterator agent
        id: run-iterator
        uses: big-emotion/ferry/.github/actions/ferry-run-iterator@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}
          ferry_review_transition_id: \${{ secrets.FERRY_REVIEW_TRANSITION_ID }}
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}
          ferry_iter_model: \${{ vars.FERRY_ITER_MODEL || 'claude-sonnet-4-6' }}
          ferry_iter_max_input_tokens: \${{ vars.FERRY_ITER_MAX_INPUT_TOKENS || '500000' }}

  emit-audit:
    name: Emit audit line
    needs: [run-agent]
    if: needs.run-agent.result != 'skipped'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Emit audit line
        uses: big-emotion/ferry/.github/actions/ferry-emit-audit@${version}
        with:
          ticket: \${{ github.event.client_payload.ticket_key }}
          phase: iterate
          run_id: \${{ github.event.client_payload.event_id }}
          model: \${{ needs.run-agent.outputs.model || 'claude-sonnet-4-6' }}
          outcome: \${{ needs.run-agent.result }}
          input_tokens: \${{ needs.run-agent.outputs.input_tokens || '0' }}
          output_tokens: \${{ needs.run-agent.outputs.output_tokens || '0' }}
          start_ms: \${{ github.run_id }}
          audit_issue: \${{ vars.FERRY_AUDIT_ISSUE }}
          github_token: \${{ github.token }}
`,
    },
  ];
}
