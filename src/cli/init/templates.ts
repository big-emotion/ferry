import type { ExecutionPath } from '../../lib/config.js';
import type { WorkflowEntry } from './types.js';

const MANAGED_BY_LINE =
  '# Managed by ferry-init. Re-run `npx -p @big-emotion/ferry ferry-init` to update.\n';

const CLAUDE_CODE_HEADER =
  '# Execution path: claude-code — agents run via claude-code-action.\n' +
  '# Required secret: CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`; Claude Pro/Max subscription).\n' +
  '# Set execution_path: script in ferry.config.yaml to revert to the bundled multi-provider path.\n';

const CODEX_HEADER =
  '# Execution path: codex-cli — agents run via openai/codex-action.\n' +
  '# Required secret: OPENAI_API_KEY.\n' +
  '# Set execution_path: script in ferry.config.yaml to revert to the bundled multi-provider path.\n';

const CLAUDE_CODE_ACTION_PIN =
  'anthropics/claude-code-action@1dc994ee7a008f0ecc866d9ac23ef036b7229f84 # v1.0.127';
const CODEX_ACTION_PIN = 'openai/codex-action@a26d2d4d8b78a694338b8e3715c3630254340b2c # v1';

function applyExecutionPath(
  templates: WorkflowEntry[],
  executionPath: ExecutionPath,
): WorkflowEntry[] {
  if (executionPath === 'script') return templates;
  const header = executionPath === 'claude-code' ? CLAUDE_CODE_HEADER : CODEX_HEADER;
  return templates.map((t) => ({
    filename: t.filename,
    content: t.content.replace(MANAGED_BY_LINE, MANAGED_BY_LINE + header),
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
#                     FERRY_RUNNER (default: "ubuntu-latest"; JSON string or array for self-hosted runners, e.g. '["self-hosted","X64"]')

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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions:
      contents: write
      pull-requests: write
      issues: read
      id-token: write # required by anthropics/claude-code-action@v1 OIDC auth
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: \${{ vars.FERRY_INTEGRATION_BRANCH || 'main' }}
          fetch-depth: 0
      # Resolve the system prompt: prompts/refiner.claude-code.md from this repo
      # if present, otherwise Ferry's bundled default. To customise the prompt
      # edit that file — no need to touch this workflow. See docs/CONFIGURATION.md.
      - name: Resolve agent prompt
        id: prompt
        run: >-
          npx -y -p @big-emotion/ferry@${version} ferry-cc-prompt
          --agent refiner
          --ticket-key "\${{ github.event.client_payload.ticket_key }}"
          --run-id "\${{ github.event.client_payload.event_id }}"
      - uses: ${CLAUDE_CODE_ACTION_PIN}
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          prompt: \${{ steps.prompt.outputs.prompt }}
          claude_args: >-
            --mcp-config '{"mcpServers":{"jira":{"command":"npx","args":["-y","-p","@big-emotion/ferry@${version}","ferry-jira-mcp"],"env":{"FERRY_JIRA_BASE_URL":"\${{ secrets.FERRY_JIRA_BASE_URL }}","FERRY_JIRA_EMAIL":"\${{ secrets.FERRY_JIRA_EMAIL }}","FERRY_JIRA_API_TOKEN":"\${{ secrets.FERRY_JIRA_API_TOKEN }}"}}}}'
            --permission-mode bypassPermissions
            --disallowedTools 'Bash(gh pr merge),Bash(gh pr merge:*),Bash(gh pr close:*)'
            --model \${{ vars.FERRY_REFINER_MODEL || 'claude-sonnet-4-6' }}

  run-agent-codex-cli:
    name: Run Refiner agent (codex-cli path)
    needs: [route]
    if: needs.route.outputs.path == 'codex-cli'
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions:
      contents: read
      issues: read
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Resolve agent prompt
        id: prompt
        run: >-
          npx -y -p @big-emotion/ferry@${version} ferry-action-prompt
          --path codex-cli
          --agent refiner
          --ticket-key "\${{ github.event.client_payload.ticket_key }}"
          --run-id "\${{ github.event.client_payload.event_id }}"
      - name: Generate Codex config
        run: |
          mkdir -p codex-home
          npx -y -p @big-emotion/ferry@${version} ferry-codex-config > codex-home/config.toml
      - uses: ${CODEX_ACTION_PIN}
        with:
          openai-api-key: \${{ secrets.OPENAI_API_KEY }}
          prompt: \${{ steps.prompt.outputs.prompt }}
          model: \${{ vars.FERRY_REFINER_MODEL || 'gpt-5-codex' }}
          effort: \${{ vars.FERRY_CODEX_EFFORT || '' }}
          sandbox: \${{ vars.FERRY_CODEX_SANDBOX || 'workspace-write' }}
          safety-strategy: \${{ vars.FERRY_CODEX_SAFETY_STRATEGY || 'drop-sudo' }}
          codex-version: \${{ vars.FERRY_CODEX_VERSION || '' }}
          codex-home: codex-home

  emit-audit:
    name: Emit audit line
    needs: [run-agent, run-agent-claude-code, run-agent-codex-cli]
    if: always() && (needs.run-agent.result != 'skipped' || needs.run-agent-claude-code.result != 'skipped' || needs.run-agent-codex-cli.result != 'skipped')
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
          outcome: \${{ (needs.run-agent.result != 'skipped' && needs.run-agent.result) || (needs.run-agent-claude-code.result != 'skipped' && needs.run-agent-claude-code.result) || needs.run-agent-codex-cli.result }}
          # claude-code path does cost tracking best-effort by design — it emits no token/cost outputs.
          input_tokens: '0'
          output_tokens: '0'
          cost_eur: '0'
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
#                     FERRY_RUNNER (default: "ubuntu-latest"; JSON string or array for self-hosted runners, e.g. '["self-hosted","X64"]')
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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions:
      contents: write
      pull-requests: write
      issues: read
      checks: read     # PR check-runs / statusCheckRollup
      actions: read    # gh run view --log-failed / actions/runs
      id-token: write # required by anthropics/claude-code-action@v1 OIDC auth
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: \${{ vars.FERRY_INTEGRATION_BRANCH || 'main' }}
          fetch-depth: 0
      # Resolve the system prompt: prompts/dev.claude-code.md from this repo if
      # present, otherwise Ferry's bundled default. To customise the prompt edit
      # that file — no need to touch this workflow. See docs/CONFIGURATION.md.
      - name: Resolve agent prompt
        id: prompt
        run: >-
          npx -y -p @big-emotion/ferry@${version} ferry-cc-prompt
          --agent dev
          --ticket-key "\${{ github.event.client_payload.ticket_key }}"
          --run-id "\${{ github.event.client_payload.event_id }}"
          --review-transition-id "\${{ secrets.FERRY_REVIEW_TRANSITION_ID }}"
      - uses: ${CLAUDE_CODE_ACTION_PIN}
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          prompt: \${{ steps.prompt.outputs.prompt }}
          claude_args: >-
            --mcp-config '{"mcpServers":{"jira":{"command":"npx","args":["-y","-p","@big-emotion/ferry@${version}","ferry-jira-mcp"],"env":{"FERRY_JIRA_BASE_URL":"\${{ secrets.FERRY_JIRA_BASE_URL }}","FERRY_JIRA_EMAIL":"\${{ secrets.FERRY_JIRA_EMAIL }}","FERRY_JIRA_API_TOKEN":"\${{ secrets.FERRY_JIRA_API_TOKEN }}"}}}}'
            --permission-mode bypassPermissions
            --disallowedTools 'Bash(gh pr merge),Bash(gh pr merge:*),Bash(gh pr close:*)'
            --model \${{ vars.FERRY_DEV_MODEL || 'claude-sonnet-4-6' }}

  run-agent-codex-cli:
    name: Run Developer agent (codex-cli path)
    needs: [route]
    if: needs.route.outputs.path == 'codex-cli'
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions:
      contents: write
      pull-requests: write
      issues: read
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Resolve agent prompt
        id: prompt
        run: >-
          npx -y -p @big-emotion/ferry@${version} ferry-action-prompt
          --path codex-cli
          --agent dev
          --ticket-key "\${{ github.event.client_payload.ticket_key }}"
          --run-id "\${{ github.event.client_payload.event_id }}"
          --review-transition-id "\${{ secrets.FERRY_REVIEW_TRANSITION_ID }}"
      - name: Generate Codex config
        run: |
          mkdir -p codex-home
          npx -y -p @big-emotion/ferry@${version} ferry-codex-config > codex-home/config.toml
      - uses: ${CODEX_ACTION_PIN}
        with:
          openai-api-key: \${{ secrets.OPENAI_API_KEY }}
          prompt: \${{ steps.prompt.outputs.prompt }}
          model: \${{ vars.FERRY_DEV_MODEL || 'gpt-5-codex' }}
          effort: \${{ vars.FERRY_CODEX_EFFORT || '' }}
          sandbox: \${{ vars.FERRY_CODEX_SANDBOX || 'workspace-write' }}
          safety-strategy: \${{ vars.FERRY_CODEX_SAFETY_STRATEGY || 'drop-sudo' }}
          codex-version: \${{ vars.FERRY_CODEX_VERSION || '' }}
          codex-home: codex-home

  emit-audit:
    name: Emit audit line
    needs: [run-agent, run-agent-claude-code, run-agent-codex-cli]
    if: always() && (needs.run-agent.result != 'skipped' || needs.run-agent-claude-code.result != 'skipped' || needs.run-agent-codex-cli.result != 'skipped')
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
          outcome: \${{ (needs.run-agent.result != 'skipped' && needs.run-agent.result) || (needs.run-agent-claude-code.result != 'skipped' && needs.run-agent-claude-code.result) || needs.run-agent-codex-cli.result }}
          # claude-code path does cost tracking best-effort by design — it emits no token/cost outputs.
          input_tokens: \${{ needs.run-agent.outputs.input_tokens || '0' }}
          output_tokens: \${{ needs.run-agent.outputs.output_tokens || '0' }}
          cost_eur: \${{ needs.run-agent.outputs.cost_eur || '0' }}
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
#                     FERRY_RUNNER (default: "ubuntu-latest"; JSON string or array for self-hosted runners, e.g. '["self-hosted","X64"]')
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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions:
      contents: write
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

  ci-gate:
    name: Reviewer CI pre-gate
    needs: [route]
    if: needs.route.outputs.path == 'claude-code' || needs.route.outputs.path == 'codex-cli'
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions:
      contents: read
      pull-requests: write
      checks: read
    outputs:
      proceed: \${{ steps.ci-gate.outputs.proceed }}
      outcome: \${{ steps.ci-gate.outputs.outcome }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Resolve reviewer CI pre-gate
        id: ci-gate
        uses: big-emotion/ferry/.github/actions/ferry-ci-gate@${version}
        with:
          ticket_key: \${{ github.event.client_payload.ticket_key }}
          run_id: \${{ github.event.client_payload.event_id }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}
          ferry_iter_transition_id: \${{ secrets.FERRY_ITER_TRANSITION_ID }}

  run-agent-claude-code:
    name: Run Reviewer agent (claude-code path)
    needs: [route, ci-gate]
    if: needs.route.outputs.path == 'claude-code' && needs.ci-gate.outputs.proceed == 'true'
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions:
      contents: write
      pull-requests: write
      issues: read
      id-token: write # required by anthropics/claude-code-action@v1 OIDC auth
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ferry/\${{ github.event.client_payload.ticket_key }}
          fetch-depth: 0
      # Resolve the system prompt: prompts/review.claude-code.md from this repo
      # if present, otherwise Ferry's bundled default. To customise the prompt
      # edit that file — no need to touch this workflow. See docs/CONFIGURATION.md.
      - name: Resolve agent prompt
        id: prompt
        run: >-
          npx -y -p @big-emotion/ferry@${version} ferry-cc-prompt
          --agent review
          --ticket-key "\${{ github.event.client_payload.ticket_key }}"
          --run-id "\${{ github.event.client_payload.event_id }}"
          --approve-transition-id "\${{ secrets.FERRY_APPROVE_TRANSITION_ID }}"
          --changes-transition-id "\${{ secrets.FERRY_ITER_TRANSITION_ID }}"
      - uses: ${CLAUDE_CODE_ACTION_PIN}
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          prompt: \${{ steps.prompt.outputs.prompt }}
          claude_args: >-
            --mcp-config '{"mcpServers":{"jira":{"command":"npx","args":["-y","-p","@big-emotion/ferry@${version}","ferry-jira-mcp"],"env":{"FERRY_JIRA_BASE_URL":"\${{ secrets.FERRY_JIRA_BASE_URL }}","FERRY_JIRA_EMAIL":"\${{ secrets.FERRY_JIRA_EMAIL }}","FERRY_JIRA_API_TOKEN":"\${{ secrets.FERRY_JIRA_API_TOKEN }}"}}}}'
            --permission-mode bypassPermissions
            --disallowedTools 'Bash(gh pr merge),Bash(gh pr merge:*),Bash(gh pr close:*)'
            --model \${{ vars.FERRY_REVIEW_MODEL || 'claude-sonnet-4-6' }}

  run-agent-codex-cli:
    name: Run Reviewer agent (codex-cli path)
    needs: [route, ci-gate]
    if: needs.route.outputs.path == 'codex-cli' && needs.ci-gate.outputs.proceed == 'true'
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions:
      contents: write
      pull-requests: write
      issues: read
      checks: read
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Resolve agent prompt
        id: prompt
        run: >-
          npx -y -p @big-emotion/ferry@${version} ferry-action-prompt
          --path codex-cli
          --agent review
          --ticket-key "\${{ github.event.client_payload.ticket_key }}"
          --run-id "\${{ github.event.client_payload.event_id }}"
          --approve-transition-id "\${{ secrets.FERRY_APPROVE_TRANSITION_ID }}"
          --changes-transition-id "\${{ secrets.FERRY_ITER_TRANSITION_ID }}"
      - name: Generate Codex config
        run: |
          mkdir -p codex-home
          npx -y -p @big-emotion/ferry@${version} ferry-codex-config > codex-home/config.toml
      - uses: ${CODEX_ACTION_PIN}
        with:
          openai-api-key: \${{ secrets.OPENAI_API_KEY }}
          prompt: \${{ steps.prompt.outputs.prompt }}
          model: \${{ vars.FERRY_REVIEW_MODEL || 'gpt-5-codex' }}
          effort: \${{ vars.FERRY_CODEX_EFFORT || '' }}
          sandbox: \${{ vars.FERRY_CODEX_SANDBOX || 'workspace-write' }}
          safety-strategy: \${{ vars.FERRY_CODEX_SAFETY_STRATEGY || 'drop-sudo' }}
          codex-version: \${{ vars.FERRY_CODEX_VERSION || '' }}
          codex-home: codex-home

  emit-audit:
    name: Emit audit line
    needs: [run-agent, run-agent-claude-code, run-agent-codex-cli, ci-gate]
    if: always() && (needs.run-agent.result != 'skipped' || needs.run-agent-claude-code.result != 'skipped' || needs.run-agent-codex-cli.result != 'skipped' || (needs.ci-gate.result != 'skipped' && needs.ci-gate.outputs.outcome == 'ci-red'))
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
          outcome: \${{ (needs.run-agent.result != 'skipped' && needs.run-agent.result) || (needs.run-agent-claude-code.result != 'skipped' && needs.run-agent-claude-code.result) || (needs.run-agent-codex-cli.result != 'skipped' && needs.run-agent-codex-cli.result) || (needs.ci-gate.outputs.outcome == 'ci-red' && 'ci-red') || needs.run-agent-codex-cli.result || needs.run-agent-claude-code.result }}
          # claude-code path does cost tracking best-effort by design — it emits no token/cost outputs.
          input_tokens: \${{ needs.run-agent.outputs.input_tokens || '0' }}
          output_tokens: \${{ needs.run-agent.outputs.output_tokens || '0' }}
          cost_eur: \${{ needs.run-agent.outputs.cost_eur || '0' }}
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
#                     FERRY_RUNNER (default: "ubuntu-latest"; JSON string or array for self-hosted runners, e.g. '["self-hosted","X64"]')
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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions:
      contents: write
      pull-requests: write
      issues: read
      checks: read     # PR check-runs / statusCheckRollup
      actions: read    # gh run view --log-failed / actions/runs
      id-token: write # required by anthropics/claude-code-action@v1 OIDC auth
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ferry/\${{ github.event.client_payload.ticket_key }}
          fetch-depth: 0
      # Resolve the system prompt: prompts/iterate.claude-code.md from this repo
      # if present, otherwise Ferry's bundled default. To customise the prompt
      # edit that file — no need to touch this workflow. See docs/CONFIGURATION.md.
      - name: Resolve agent prompt
        id: prompt
        run: >-
          npx -y -p @big-emotion/ferry@${version} ferry-cc-prompt
          --agent iterate
          --ticket-key "\${{ github.event.client_payload.ticket_key }}"
          --run-id "\${{ github.event.client_payload.event_id }}"
          --review-transition-id "\${{ secrets.FERRY_REVIEW_TRANSITION_ID }}"
      - uses: ${CLAUDE_CODE_ACTION_PIN}
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          prompt: \${{ steps.prompt.outputs.prompt }}
          claude_args: >-
            --mcp-config '{"mcpServers":{"jira":{"command":"npx","args":["-y","-p","@big-emotion/ferry@${version}","ferry-jira-mcp"],"env":{"FERRY_JIRA_BASE_URL":"\${{ secrets.FERRY_JIRA_BASE_URL }}","FERRY_JIRA_EMAIL":"\${{ secrets.FERRY_JIRA_EMAIL }}","FERRY_JIRA_API_TOKEN":"\${{ secrets.FERRY_JIRA_API_TOKEN }}"}}}}'
            --permission-mode bypassPermissions
            --disallowedTools 'Bash(gh pr merge),Bash(gh pr merge:*),Bash(gh pr close:*)'
            --model \${{ vars.FERRY_ITER_MODEL || 'claude-sonnet-4-6' }}

  run-agent-codex-cli:
    name: Run Iterator agent (codex-cli path)
    needs: [route]
    if: needs.route.outputs.path == 'codex-cli'
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions:
      contents: write
      pull-requests: write
      issues: read
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Resolve agent prompt
        id: prompt
        run: >-
          npx -y -p @big-emotion/ferry@${version} ferry-action-prompt
          --path codex-cli
          --agent iterate
          --ticket-key "\${{ github.event.client_payload.ticket_key }}"
          --run-id "\${{ github.event.client_payload.event_id }}"
          --review-transition-id "\${{ secrets.FERRY_REVIEW_TRANSITION_ID }}"
      - name: Generate Codex config
        run: |
          mkdir -p codex-home
          npx -y -p @big-emotion/ferry@${version} ferry-codex-config > codex-home/config.toml
      - uses: ${CODEX_ACTION_PIN}
        with:
          openai-api-key: \${{ secrets.OPENAI_API_KEY }}
          prompt: \${{ steps.prompt.outputs.prompt }}
          model: \${{ vars.FERRY_ITER_MODEL || 'gpt-5-codex' }}
          effort: \${{ vars.FERRY_CODEX_EFFORT || '' }}
          sandbox: \${{ vars.FERRY_CODEX_SANDBOX || 'workspace-write' }}
          safety-strategy: \${{ vars.FERRY_CODEX_SAFETY_STRATEGY || 'drop-sudo' }}
          codex-version: \${{ vars.FERRY_CODEX_VERSION || '' }}
          codex-home: codex-home

  emit-audit:
    name: Emit audit line
    needs: [run-agent, run-agent-claude-code, run-agent-codex-cli]
    if: always() && (needs.run-agent.result != 'skipped' || needs.run-agent-claude-code.result != 'skipped' || needs.run-agent-codex-cli.result != 'skipped')
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
          outcome: \${{ (needs.run-agent.result != 'skipped' && needs.run-agent.result) || (needs.run-agent-claude-code.result != 'skipped' && needs.run-agent-claude-code.result) || needs.run-agent-codex-cli.result }}
          # claude-code path does cost tracking best-effort by design — it emits no token/cost outputs.
          input_tokens: \${{ needs.run-agent.outputs.input_tokens || '0' }}
          output_tokens: \${{ needs.run-agent.outputs.output_tokens || '0' }}
          cost_eur: \${{ needs.run-agent.outputs.cost_eur || '0' }}
          start_ms: \${{ github.run_id }}
          audit_issue: \${{ vars.FERRY_AUDIT_ISSUE }}
          github_token: \${{ github.token }}
`,
    },
    {
      filename: 'ferry-merge.yml',
      content: `# Managed by ferry-init. Re-run \`npx -p @big-emotion/ferry ferry-init\` to update.
# Required secrets: FERRY_JIRA_BASE_URL, FERRY_JIRA_EMAIL, FERRY_JIRA_API_TOKEN
#                   ANTHROPIC_API_KEY  — required when FERRY_MERGER_PROVIDER=anthropic (default)
#                   OPENAI_API_KEY     — required when FERRY_MERGER_PROVIDER=openai
#                   GOOGLE_API_KEY     — required when FERRY_MERGER_PROVIDER=google
#                   CLAUDE_CODE_OAUTH_TOKEN — required only when execution_path=claude-code
#                                             (ADR-0006 §6 — anthropic_api_key is forbidden on this path)
# Required variables: FERRY_AUDIT_ISSUE (GitHub Issue number for the audit log)
# Optional variables: FERRY_MERGER_PROVIDER (default: anthropic; also: openai, google)
#                     FERRY_MERGER_MODEL (default: claude-sonnet-4-6; use model ID matching your provider)
#                     FERRY_RUNNER (default: "ubuntu-latest"; JSON string or array for self-hosted runners, e.g. '["self-hosted","X64"]')

name: Ferry — Merge

on:
  repository_dispatch:
    types: [ferry-merge]

# cancel-in-progress: false — merge must complete atomically; cancellation mid-merge = inconsistent PR state
concurrency:
  group: ferry-\${{ github.workflow }}-\${{ github.event.client_payload.ticket_key || 'ferry-invalid-payload-sinkhole' }}
  cancel-in-progress: false

jobs:
  gate-envelope:
    name: Validate event envelope
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
          role: merger
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}

  run-agent:
    name: Run Merger agent (script path)
    needs: [route]
    if: needs.route.outputs.path == 'script'
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions:
      contents: write
      pull-requests: write
      issues: write
    outputs:
      input_tokens: \${{ steps.run-merger.outputs.input_tokens }}
      output_tokens: \${{ steps.run-merger.outputs.output_tokens }}
      cost_eur: \${{ steps.run-merger.outputs.cost_eur }}
      model: \${{ steps.run-merger.outputs.model }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Run Merger agent
        id: run-merger
        uses: big-emotion/ferry/.github/actions/ferry-run-merger@${version}
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
          ferry_merger_model: \${{ vars.FERRY_MERGER_MODEL || 'claude-sonnet-4-6' }}

  run-agent-claude-code:
    name: Run Merger agent (claude-code path)
    needs: [route]
    if: needs.route.outputs.path == 'claude-code'
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions:
      contents: write
      pull-requests: write
      issues: read
      checks: read     # PR check-runs / statusCheckRollup
      actions: read    # gh run view --log-failed / actions/runs
      id-token: write # required by anthropics/claude-code-action@v1 OIDC auth
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ferry/\${{ github.event.client_payload.ticket_key }}
          fetch-depth: 0
      # Resolve the system prompt: prompts/merge.claude-code.md from this repo
      # if present, otherwise Ferry's bundled default. To customise the prompt
      # edit that file — no need to touch this workflow. See docs/CONFIGURATION.md.
      - name: Resolve agent prompt
        id: prompt
        run: >-
          npx -y -p @big-emotion/ferry@${version} ferry-cc-prompt
          --agent merge
          --ticket-key "\${{ github.event.client_payload.ticket_key }}"
          --run-id "\${{ github.event.client_payload.event_id }}"
      - uses: ${CLAUDE_CODE_ACTION_PIN}
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          prompt: \${{ steps.prompt.outputs.prompt }}
          claude_args: >-
            --mcp-config '{"mcpServers":{"jira":{"command":"npx","args":["-y","-p","@big-emotion/ferry@${version}","ferry-jira-mcp"],"env":{"FERRY_JIRA_BASE_URL":"\${{ secrets.FERRY_JIRA_BASE_URL }}","FERRY_JIRA_EMAIL":"\${{ secrets.FERRY_JIRA_EMAIL }}","FERRY_JIRA_API_TOKEN":"\${{ secrets.FERRY_JIRA_API_TOKEN }}"}}}}'
            --permission-mode bypassPermissions
            --disallowedTools 'Bash(gh pr close),Bash(gh pr close:*)'
            --model \${{ vars.FERRY_MERGER_MODEL || 'claude-sonnet-4-6' }}

  run-agent-codex-cli:
    name: Run Merger agent (codex-cli path)
    needs: [route]
    if: needs.route.outputs.path == 'codex-cli'
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions:
      contents: write
      pull-requests: write
      issues: read
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Resolve agent prompt
        id: prompt
        run: >-
          npx -y -p @big-emotion/ferry@${version} ferry-action-prompt
          --path codex-cli
          --agent merge
          --ticket-key "\${{ github.event.client_payload.ticket_key }}"
          --run-id "\${{ github.event.client_payload.event_id }}"
      - name: Generate Codex config
        run: |
          mkdir -p codex-home
          npx -y -p @big-emotion/ferry@${version} ferry-codex-config > codex-home/config.toml
      - uses: ${CODEX_ACTION_PIN}
        with:
          openai-api-key: \${{ secrets.OPENAI_API_KEY }}
          prompt: \${{ steps.prompt.outputs.prompt }}
          model: \${{ vars.FERRY_MERGER_MODEL || 'gpt-5-codex' }}
          effort: \${{ vars.FERRY_CODEX_EFFORT || '' }}
          sandbox: \${{ vars.FERRY_CODEX_SANDBOX || 'workspace-write' }}
          safety-strategy: \${{ vars.FERRY_CODEX_SAFETY_STRATEGY || 'drop-sudo' }}
          codex-version: \${{ vars.FERRY_CODEX_VERSION || '' }}
          codex-home: codex-home

  emit-audit:
    name: Emit audit line
    needs: [run-agent, run-agent-claude-code, run-agent-codex-cli]
    if: always() && (needs.run-agent.result != 'skipped' || needs.run-agent-claude-code.result != 'skipped' || needs.run-agent-codex-cli.result != 'skipped')
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
          phase: merge
          run_id: \${{ github.event.client_payload.event_id }}
          model: \${{ needs.run-agent.outputs.model || 'claude-sonnet-4-6' }}
          outcome: \${{ (needs.run-agent.result != 'skipped' && needs.run-agent.result) || (needs.run-agent-claude-code.result != 'skipped' && needs.run-agent-claude-code.result) || needs.run-agent-codex-cli.result }}
          # claude-code path does cost tracking best-effort by design — it emits no token/cost outputs.
          input_tokens: \${{ needs.run-agent.outputs.input_tokens || '0' }}
          output_tokens: \${{ needs.run-agent.outputs.output_tokens || '0' }}
          cost_eur: \${{ needs.run-agent.outputs.cost_eur || '0' }}
          start_ms: \${{ github.run_id }}
          audit_issue: \${{ vars.FERRY_AUDIT_ISSUE }}
          github_token: \${{ github.token }}
`,
    },
  ];
  return applyExecutionPath(templates, executionPath);
}

/**
 * The thin router workflow (claude-code path). One any-column Jira rule sends
 * `ferry-transition` with `to_status`; ferry-route maps it to an agent via
 * `workflow.agents.*.trigger_column` and the shared ferry-run-claude-agent
 * composite does everything else. Legacy per-agent events keep working during
 * migration. The merger is only reachable via the Reviewer-emitted
 * `ferry-merge` dispatch — never from a status move (ADR-0005).
 */
export function routerWorkflowTemplate(version: string): WorkflowEntry {
  return {
    filename: 'ferry-router.yml',
    content: `${MANAGED_BY_LINE}${CLAUDE_CODE_HEADER}# Required secrets: FERRY_JIRA_BASE_URL, FERRY_JIRA_EMAIL, FERRY_JIRA_API_TOKEN,
#                   CLAUDE_CODE_OAUTH_TOKEN
# Optional secrets: FERRY_REVIEW_TRANSITION_ID, FERRY_ITER_TRANSITION_ID,
#                   FERRY_APPROVE_TRANSITION_ID — explicit transition-id overrides.
#                   When unset, ids are auto-resolved from the status names in
#                   ferry.config (workflow.agents.*).
#                   FERRY_CHECKOUT_TOKEN — PAT/App token for agent pushes so CI
#                   re-triggers (a github-actions[bot] push suppresses pull_request events).
# Required variables: FERRY_AUDIT_ISSUE (GitHub Issue number for the audit log)
# Optional variables: FERRY_INTEGRATION_BRANCH (default: main)
#                     FERRY_REFINER_MODEL / FERRY_DEV_MODEL / FERRY_REVIEW_MODEL /
#                     FERRY_ITER_MODEL / FERRY_MERGER_MODEL (default: claude-sonnet-4-6)
#                     FERRY_PRE_AGENT_COMMAND (dependency bootstrap, e.g. "npm ci")
#                     FERRY_EXTRA_CLAUDE_ARGS (extra claude_args, e.g. more --mcp-config)
#                     FERRY_RUNNER (default: "ubuntu-latest"; JSON string or array)

name: Ferry — Router

on:
  repository_dispatch:
    types:
      - ferry-transition
      - ferry-refine
      - ferry-dev
      - ferry-review
      - ferry-iterate
      - ferry-merge

# Per-ticket per-role serialization lives on the run-agent job (the role is only
# known after route). This workflow-level group only de-dupes identical dispatches.
concurrency:
  group: ferry-router-\${{ github.event.action }}-\${{ github.event.client_payload.ticket_key || 'ferry-invalid-payload-sinkhole' }}
  cancel-in-progress: false

jobs:
  gate-envelope:
    name: Validate event envelope
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
    name: Resolve agent and execution path
    needs: [gate-envelope]
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions:
      contents: read
    outputs:
      path: \${{ steps.route.outputs.path }}
      reason: \${{ steps.route.outputs.reason }}
      role: \${{ steps.route.outputs.role }}
      cc_agent: \${{ steps.route.outputs.cc_agent }}
      phase: \${{ steps.route.outputs.phase }}
      model_var: \${{ steps.route.outputs.model_var }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Resolve agent and execution path
        id: route
        uses: big-emotion/ferry/.github/actions/ferry-route@${version}
        with:
          payload: \${{ toJson(github.event.client_payload) }}
          event_type: \${{ github.event.action }}
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}

  # Reviewer CI pre-gate: blocks the review while required checks are red and
  # requests changes itself (FR24) — same behavior as the legacy review stub.
  ci-gate:
    name: Reviewer CI gate
    needs: [route]
    if: needs.route.outputs.role == 'reviewer' && needs.route.outputs.path == 'claude-code'
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions:
      contents: read
      pull-requests: write
      checks: read
    outputs:
      proceed: \${{ steps.gate.outputs.proceed }}
      outcome: \${{ steps.gate.outputs.outcome }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Gate on CI status
        id: gate
        uses: big-emotion/ferry/.github/actions/ferry-ci-gate@${version}
        with:
          ticket_key: \${{ github.event.client_payload.ticket_key }}
          run_id: \${{ github.event.client_payload.event_id }}
          github_token: \${{ github.token }}
          github_repo: \${{ github.repository }}
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}
          ferry_iter_transition_id: \${{ secrets.FERRY_ITER_TRANSITION_ID }}

  run-agent:
    name: Run \${{ needs.route.outputs.role }} agent (claude-code)
    needs: [route, ci-gate]
    # !cancelled() keeps this job eligible when ci-gate is skipped (non-reviewer roles).
    if: >-
      !cancelled() && needs.route.outputs.path == 'claude-code' &&
      needs.route.outputs.role != 'none' &&
      (needs.route.outputs.role != 'reviewer' || needs.ci-gate.outputs.proceed == 'true')
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    # Serialize per ticket and per role; a newer refine may supersede a running one.
    concurrency:
      group: ferry-agent-\${{ needs.route.outputs.role }}-\${{ github.event.client_payload.ticket_key }}
      cancel-in-progress: \${{ needs.route.outputs.role == 'refiner' }}
    timeout-minutes: 120
    permissions:
      contents: write
      pull-requests: write
      issues: read
      checks: read
      actions: read
      id-token: write # required by anthropics/claude-code-action@v1 OIDC auth
    steps:
      - name: Run Ferry agent
        uses: big-emotion/ferry/.github/actions/ferry-run-claude-agent@${version}
        with:
          role: \${{ needs.route.outputs.cc_agent }}
          ferry_version: ${version}
          ticket_key: \${{ github.event.client_payload.ticket_key }}
          event_id: \${{ github.event.client_payload.event_id }}
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          jira_base_url: \${{ secrets.FERRY_JIRA_BASE_URL }}
          jira_email: \${{ secrets.FERRY_JIRA_EMAIL }}
          jira_api_token: \${{ secrets.FERRY_JIRA_API_TOKEN }}
          model: \${{ vars[needs.route.outputs.model_var] || 'claude-sonnet-4-6' }}
          integration_branch: \${{ vars.FERRY_INTEGRATION_BRANCH || 'main' }}
          checkout_token: \${{ secrets.FERRY_CHECKOUT_TOKEN }}
          review_transition_id: \${{ secrets.FERRY_REVIEW_TRANSITION_ID }}
          approve_transition_id: \${{ secrets.FERRY_APPROVE_TRANSITION_ID }}
          changes_transition_id: \${{ secrets.FERRY_ITER_TRANSITION_ID }}
          pre_agent_command: \${{ vars.FERRY_PRE_AGENT_COMMAND }}
          extra_claude_args: \${{ vars.FERRY_EXTRA_CLAUDE_ARGS }}

  unsupported-path:
    name: Unsupported execution path
    needs: [route]
    if: >-
      needs.route.outputs.role != 'none' &&
      (needs.route.outputs.path == 'script' || needs.route.outputs.path == 'codex-cli')
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
    permissions: {}
    steps:
      - name: Fail with guidance
        run: |
          echo "::error::Ferry router only supports execution_path: claude-code. For the script or codex-cli paths, generate the per-agent workflows with ferry-init." >&2
          exit 1

  emit-audit:
    name: Emit audit line
    needs: [route, ci-gate, run-agent]
    if: >-
      !cancelled() && needs.route.outputs.role != 'none' &&
      (needs.run-agent.result != 'skipped' || (needs.ci-gate.result != 'skipped' && needs.ci-gate.outputs.outcome == 'ci-red'))
    runs-on: \${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}
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
          phase: \${{ needs.route.outputs.phase }}
          run_id: \${{ github.event.client_payload.event_id }}
          model: \${{ vars[needs.route.outputs.model_var] || 'claude-sonnet-4-6' }}
          outcome: \${{ (needs.ci-gate.result != 'skipped' && needs.ci-gate.outputs.outcome == 'ci-red' && 'ci-red') || needs.run-agent.result }}
          # claude-code path does cost tracking best-effort by design — it emits no token/cost outputs.
          input_tokens: '0'
          output_tokens: '0'
          cost_eur: '0'
          start_ms: \${{ github.run_id }}
          audit_issue: \${{ vars.FERRY_AUDIT_ISSUE }}
          github_token: \${{ github.token }}
`,
  };
}
