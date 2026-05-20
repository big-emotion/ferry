import type { ExecutionPath } from '../../lib/config.js';
import type { WorkflowEntry } from './types.js';

const MANAGED_BY_LINE =
  '# Managed by ferry-init. Re-run `npx -p @big-emotion/ferry ferry-init` to update.\n';

const CLAUDE_CODE_HEADER =
  '# Execution path: claude-code — agents run via claude-code-action.\n' +
  '# Required secret: CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`; Claude Pro/Max subscription).\n' +
  '# Set execution_path: script in ferry.config.yaml to revert to the bundled multi-provider path.\n';

function applyExecutionPath(
  templates: WorkflowEntry[],
  executionPath: ExecutionPath,
): WorkflowEntry[] {
  if (executionPath !== 'claude-code') return templates;
  return templates.map((t) => ({
    filename: t.filename,
    content: t.content.replace(MANAGED_BY_LINE, MANAGED_BY_LINE + CLAUDE_CODE_HEADER),
  }));
}

export function workflowTemplates(
  version: string,
  executionPath: ExecutionPath = 'script',
): WorkflowEntry[] {
  const templates: WorkflowEntry[] = [
    {
      filename: 'ferry-refine.yml',
      content: `# Managed by ferry-init. Re-run \`npx -p @big-emotion/ferry ferry-init\` to update.
# Required secrets: FERRY_JIRA_BASE_URL, FERRY_JIRA_EMAIL, FERRY_JIRA_API_TOKEN
#                   ANTHROPIC_API_KEY  — required when FERRY_REFINER_PROVIDER=anthropic (default)
#                   OPENAI_API_KEY     — required when FERRY_REFINER_PROVIDER=openai
#                   GOOGLE_API_KEY     — required when FERRY_REFINER_PROVIDER=google
#                   CLAUDE_CODE_OAUTH_TOKEN — required only when execution_path=claude-code
#                                             (ADR-0006 §6 — anthropic_api_key is forbidden on this path)
# Required variables: FERRY_AUDIT_ISSUE (GitHub Issue number for the audit log)
# Optional variables: FERRY_REFINER_PROVIDER (default: anthropic; also: openai, google)
#                     FERRY_REFINER_MODEL (default: claude-sonnet-4-6; use model ID matching your provider)

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

  route:
    name: Resolve execution path
    needs: [gate-envelope]
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      path: \${{ steps.route.outputs.path }}
      reason: \${{ steps.route.outputs.reason }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Resolve execution path
        id: route
        uses: big-emotion/ferry/.github/actions/ferry-route@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          role: refiner
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}

  run-agent:
    name: Run Refiner agent (script path)
    needs: [route]
    if: needs.route.outputs.path == 'script'
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
          openai_api_key: \${{ secrets.OPENAI_API_KEY }}
          google_api_key: \${{ secrets.GOOGLE_API_KEY }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}
          ferry_refiner_model: claude-sonnet-4-6

  run-agent-claude-code:
    name: Run Refiner agent (claude-code path)
    needs: [route]
    if: needs.route.outputs.path == 'claude-code'
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      input_tokens: \${{ steps.cc-apply.outputs.input_tokens }}
      output_tokens: \${{ steps.cc-apply.outputs.output_tokens }}
      cost_eur: \${{ steps.cc-apply.outputs.cost_eur }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Prepare claude-code job
        id: cc-prepare
        uses: big-emotion/ferry/.github/actions/ferry-cc-prepare@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          role: refiner
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}

      - name: Run claude-code-action
        uses: anthropics/claude-code-action@1dc994ee7a008f0ecc866d9ac23ef036b7229f84 # v1.0.127
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          prompt: \${{ steps.cc-prepare.outputs.prompt }}
          claude_args: \${{ steps.cc-prepare.outputs.claude_args }}

      - name: Apply claude-code output
        id: cc-apply
        uses: big-emotion/ferry/.github/actions/ferry-cc-apply@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          role: refiner
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}
          idempotency_marker: \${{ steps.cc-prepare.outputs.idempotency_marker }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}

  emit-audit:
    name: Emit audit line
    needs: [run-agent, run-agent-claude-code]
    if: always() && (needs.run-agent.result != 'skipped' || needs.run-agent-claude-code.result != 'skipped')
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
          outcome: \${{ needs.run-agent.result != 'skipped' && needs.run-agent.result || needs.run-agent-claude-code.result }}
          input_tokens: \${{ needs.run-agent-claude-code.outputs.input_tokens || '0' }}
          output_tokens: \${{ needs.run-agent-claude-code.outputs.output_tokens || '0' }}
          cost_eur: \${{ needs.run-agent-claude-code.outputs.cost_eur || '0' }}
          start_ms: \${{ github.run_id }}
          audit_issue: \${{ vars.FERRY_AUDIT_ISSUE }}
          github_token: \${{ secrets.GITHUB_TOKEN }}
`,
    },
    {
      filename: 'ferry-dev.yml',
      content: `# Managed by ferry-init. Re-run \`npx -p @big-emotion/ferry ferry-init\` to update.
# Required secrets: FERRY_JIRA_BASE_URL, FERRY_JIRA_EMAIL, FERRY_JIRA_API_TOKEN,
#                   FERRY_REVIEW_TRANSITION_ID
#                   ANTHROPIC_API_KEY  — required when FERRY_DEV_PROVIDER=anthropic (default)
#                   OPENAI_API_KEY     — required when FERRY_DEV_PROVIDER=openai
#                   GOOGLE_API_KEY     — required when FERRY_DEV_PROVIDER=google
#                   CLAUDE_CODE_OAUTH_TOKEN — required only when execution_path=claude-code
#                                             (ADR-0006 §6 — anthropic_api_key is forbidden on this path)
# Required variables: FERRY_AUDIT_ISSUE (GitHub Issue number for the audit log)
# Optional variables: FERRY_DEV_PROVIDER (default: anthropic; also: openai, google)
#                     FERRY_DEV_MODEL (default: claude-sonnet-4-6; use model ID matching your provider)
#
# Note: MCP server support is not available for non-Anthropic providers in the Developer agent.

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

  route:
    name: Resolve execution path
    needs: [gate-envelope]
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      path: \${{ steps.route.outputs.path }}
      reason: \${{ steps.route.outputs.reason }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Resolve execution path
        id: route
        uses: big-emotion/ferry/.github/actions/ferry-route@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          role: developer
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}

  run-agent:
    name: Run Developer agent (script path)
    needs: [route]
    if: needs.route.outputs.path == 'script'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    outputs:
      input_tokens: \${{ steps.run-developer.outputs.input_tokens }}
      output_tokens: \${{ steps.run-developer.outputs.output_tokens }}
      cost_eur: \${{ steps.run-developer.outputs.cost_eur }}
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
          openai_api_key: \${{ secrets.OPENAI_API_KEY }}
          google_api_key: \${{ secrets.GOOGLE_API_KEY }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}
          ferry_dev_model: claude-sonnet-4-6

  run-agent-claude-code:
    name: Run Developer agent (claude-code path)
    needs: [route]
    if: needs.route.outputs.path == 'claude-code'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    outputs:
      input_tokens: \${{ steps.cc-apply.outputs.input_tokens }}
      output_tokens: \${{ steps.cc-apply.outputs.output_tokens }}
      cost_eur: \${{ steps.cc-apply.outputs.cost_eur }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Prepare claude-code job
        id: cc-prepare
        uses: big-emotion/ferry/.github/actions/ferry-cc-prepare@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          role: developer
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}

      - name: Run claude-code-action
        uses: anthropics/claude-code-action@1dc994ee7a008f0ecc866d9ac23ef036b7229f84 # v1.0.127
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          prompt: \${{ steps.cc-prepare.outputs.prompt }}
          claude_args: \${{ steps.cc-prepare.outputs.claude_args }}

      - name: Apply claude-code output
        id: cc-apply
        uses: big-emotion/ferry/.github/actions/ferry-cc-apply@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          role: developer
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}
          idempotency_marker: \${{ steps.cc-prepare.outputs.idempotency_marker }}
          ferry_review_transition_id: \${{ secrets.FERRY_REVIEW_TRANSITION_ID }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}

  emit-audit:
    name: Emit audit line
    needs: [run-agent, run-agent-claude-code]
    if: always() && (needs.run-agent.result != 'skipped' || needs.run-agent-claude-code.result != 'skipped')
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
          outcome: \${{ needs.run-agent.result != 'skipped' && needs.run-agent.result || needs.run-agent-claude-code.result }}
          input_tokens: \${{ needs.run-agent.outputs.input_tokens || needs.run-agent-claude-code.outputs.input_tokens || '0' }}
          output_tokens: \${{ needs.run-agent.outputs.output_tokens || needs.run-agent-claude-code.outputs.output_tokens || '0' }}
          cost_eur: \${{ needs.run-agent.outputs.cost_eur || needs.run-agent-claude-code.outputs.cost_eur || '0' }}
          start_ms: \${{ github.run_id }}
          audit_issue: \${{ vars.FERRY_AUDIT_ISSUE }}
          github_token: \${{ github.token }}
`,
    },
    {
      filename: 'ferry-review.yml',
      content: `# Managed by ferry-init. Re-run \`npx -p @big-emotion/ferry ferry-init\` to update.
# Required secrets: FERRY_JIRA_BASE_URL, FERRY_JIRA_EMAIL, FERRY_JIRA_API_TOKEN,
#                   FERRY_ITER_TRANSITION_ID
#                   ANTHROPIC_API_KEY  — required when FERRY_REVIEW_PROVIDER=anthropic (default)
#                   OPENAI_API_KEY     — required when FERRY_REVIEW_PROVIDER=openai
#                   GOOGLE_API_KEY     — required when FERRY_REVIEW_PROVIDER=google
#                   CLAUDE_CODE_OAUTH_TOKEN — required only when execution_path=claude-code
#                                             (ADR-0006 §6 — anthropic_api_key is forbidden on this path)
# Required variables: FERRY_AUDIT_ISSUE (GitHub Issue number for the audit log)
# Optional variables: FERRY_REVIEW_PROVIDER (default: anthropic; also: openai, google)
#                     FERRY_REVIEW_MODEL (default: claude-sonnet-4-6; use model ID matching your provider)
#
# Note: MCP server support is not available for non-Anthropic providers in the Reviewer agent.

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

  route:
    name: Resolve execution path
    needs: [gate-envelope]
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      path: \${{ steps.route.outputs.path }}
      reason: \${{ steps.route.outputs.reason }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Resolve execution path
        id: route
        uses: big-emotion/ferry/.github/actions/ferry-route@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          role: reviewer
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}

  run-agent:
    name: Run Reviewer agent (script path)
    needs: [route]
    if: needs.route.outputs.path == 'script'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
      checks: read
    outputs:
      input_tokens: \${{ steps.run-reviewer.outputs.input_tokens }}
      output_tokens: \${{ steps.run-reviewer.outputs.output_tokens }}
      cost_eur: \${{ steps.run-reviewer.outputs.cost_eur }}
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
          openai_api_key: \${{ secrets.OPENAI_API_KEY }}
          google_api_key: \${{ secrets.GOOGLE_API_KEY }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}
          ferry_review_model: \${{ vars.FERRY_REVIEW_MODEL || 'claude-sonnet-4-6' }}

  run-agent-claude-code:
    name: Run Reviewer agent (claude-code path)
    needs: [route]
    if: needs.route.outputs.path == 'claude-code'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
      checks: read
    outputs:
      input_tokens: \${{ steps.cc-apply.outputs.input_tokens }}
      output_tokens: \${{ steps.cc-apply.outputs.output_tokens }}
      cost_eur: \${{ steps.cc-apply.outputs.cost_eur }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Prepare claude-code job
        id: cc-prepare
        uses: big-emotion/ferry/.github/actions/ferry-cc-prepare@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          role: reviewer
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}

      - name: Run claude-code-action
        uses: anthropics/claude-code-action@1dc994ee7a008f0ecc866d9ac23ef036b7229f84 # v1.0.127
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          prompt: \${{ steps.cc-prepare.outputs.prompt }}
          claude_args: \${{ steps.cc-prepare.outputs.claude_args }}

      - name: Apply claude-code output
        id: cc-apply
        uses: big-emotion/ferry/.github/actions/ferry-cc-apply@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          role: reviewer
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}
          idempotency_marker: \${{ steps.cc-prepare.outputs.idempotency_marker }}
          ferry_pr_number: \${{ steps.cc-prepare.outputs.pr_number }}
          ferry_iter_transition_id: \${{ secrets.FERRY_ITER_TRANSITION_ID }}
          ferry_approve_transition_id: \${{ secrets.FERRY_APPROVE_TRANSITION_ID }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}

  emit-audit:
    name: Emit audit line
    needs: [run-agent, run-agent-claude-code]
    if: always() && (needs.run-agent.result != 'skipped' || needs.run-agent-claude-code.result != 'skipped')
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
          outcome: \${{ needs.run-agent.result != 'skipped' && needs.run-agent.result || needs.run-agent-claude-code.result }}
          input_tokens: \${{ needs.run-agent.outputs.input_tokens || needs.run-agent-claude-code.outputs.input_tokens || '0' }}
          output_tokens: \${{ needs.run-agent.outputs.output_tokens || needs.run-agent-claude-code.outputs.output_tokens || '0' }}
          cost_eur: \${{ needs.run-agent.outputs.cost_eur || needs.run-agent-claude-code.outputs.cost_eur || '0' }}
          start_ms: \${{ github.run_id }}
          audit_issue: \${{ vars.FERRY_AUDIT_ISSUE }}
          github_token: \${{ github.token }}
`,
    },
    {
      filename: 'ferry-iterate.yml',
      content: `# Managed by ferry-init. Re-run \`npx -p @big-emotion/ferry ferry-init\` to update.
# Required secrets: FERRY_JIRA_BASE_URL, FERRY_JIRA_EMAIL, FERRY_JIRA_API_TOKEN,
#                   FERRY_REVIEW_TRANSITION_ID
#                   ANTHROPIC_API_KEY  — required when FERRY_ITER_PROVIDER=anthropic (default)
#                   OPENAI_API_KEY     — required when FERRY_ITER_PROVIDER=openai
#                   GOOGLE_API_KEY     — required when FERRY_ITER_PROVIDER=google
#                   CLAUDE_CODE_OAUTH_TOKEN — required only when execution_path=claude-code
#                                             (ADR-0006 §6 — anthropic_api_key is forbidden on this path)
# Required variables: FERRY_AUDIT_ISSUE (GitHub Issue number for the audit log)
# Optional variables: FERRY_ITER_PROVIDER (default: anthropic; also: openai, google)
#                     FERRY_ITER_MODEL (default: claude-sonnet-4-6; use model ID matching your provider)
#                     FERRY_ITER_MAX_INPUT_TOKENS (default: 500000)
#
# Note: MCP server support is not available for non-Anthropic providers in the Iterator agent.

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

  route:
    name: Resolve execution path
    needs: [gate-envelope]
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      path: \${{ steps.route.outputs.path }}
      reason: \${{ steps.route.outputs.reason }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Resolve execution path
        id: route
        uses: big-emotion/ferry/.github/actions/ferry-route@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          role: iterator
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}

  run-agent:
    name: Run Iterator agent (script path)
    needs: [route]
    if: needs.route.outputs.path == 'script'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    outputs:
      input_tokens: \${{ steps.run-iterator.outputs.input_tokens }}
      output_tokens: \${{ steps.run-iterator.outputs.output_tokens }}
      cost_eur: \${{ steps.run-iterator.outputs.cost_eur }}
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
          openai_api_key: \${{ secrets.OPENAI_API_KEY }}
          google_api_key: \${{ secrets.GOOGLE_API_KEY }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}
          ferry_iter_model: \${{ vars.FERRY_ITER_MODEL || 'claude-sonnet-4-6' }}
          ferry_iter_max_input_tokens: \${{ vars.FERRY_ITER_MAX_INPUT_TOKENS || '500000' }}

  run-agent-claude-code:
    name: Run Iterator agent (claude-code path)
    needs: [route]
    if: needs.route.outputs.path == 'claude-code'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    outputs:
      input_tokens: \${{ steps.cc-apply.outputs.input_tokens }}
      output_tokens: \${{ steps.cc-apply.outputs.output_tokens }}
      cost_eur: \${{ steps.cc-apply.outputs.cost_eur }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          fetch-depth: 0

      - name: Prepare claude-code job
        id: cc-prepare
        uses: big-emotion/ferry/.github/actions/ferry-cc-prepare@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          role: iterator
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}

      - name: Run claude-code-action
        uses: anthropics/claude-code-action@1dc994ee7a008f0ecc866d9ac23ef036b7229f84 # v1.0.127
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          prompt: \${{ steps.cc-prepare.outputs.prompt }}
          claude_args: \${{ steps.cc-prepare.outputs.claude_args }}

      - name: Apply claude-code output
        id: cc-apply
        uses: big-emotion/ferry/.github/actions/ferry-cc-apply@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          role: iterator
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}
          idempotency_marker: \${{ steps.cc-prepare.outputs.idempotency_marker }}
          ferry_review_transition_id: \${{ secrets.FERRY_REVIEW_TRANSITION_ID }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}

  emit-audit:
    name: Emit audit line
    needs: [run-agent, run-agent-claude-code]
    if: always() && (needs.run-agent.result != 'skipped' || needs.run-agent-claude-code.result != 'skipped')
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
          outcome: \${{ needs.run-agent.result != 'skipped' && needs.run-agent.result || needs.run-agent-claude-code.result }}
          input_tokens: \${{ needs.run-agent.outputs.input_tokens || needs.run-agent-claude-code.outputs.input_tokens || '0' }}
          output_tokens: \${{ needs.run-agent.outputs.output_tokens || needs.run-agent-claude-code.outputs.output_tokens || '0' }}
          cost_eur: \${{ needs.run-agent.outputs.cost_eur || needs.run-agent-claude-code.outputs.cost_eur || '0' }}
          start_ms: \${{ github.run_id }}
          audit_issue: \${{ vars.FERRY_AUDIT_ISSUE }}
          github_token: \${{ github.token }}
`,
    },
  ];
  return applyExecutionPath(templates, executionPath);
}
