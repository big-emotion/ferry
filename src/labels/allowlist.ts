export const LABELS_ALLOWLIST = [
  // Agent re-triggers (user-applied to trigger a phase)
  'agent:refiner',
  'agent:developer',
  'agent:reviewer',
  'agent:iterator',
  // Ferry phase status labels
  'ferry:refining',
  'ferry:developing',
  'ferry:reviewing',
  'ferry:iterating',
  'ferry:ready',
  'ferry:approved',
  'ferry:paused',
  'ferry:cancelled',
  'ferry:spend-cap',
  // Audit rotation
  'ferry:audit-log:active',
  // Escalation labels
  'ferry:blocked',
  'needs-human',
  'status:stale',
  // Ticket-type label overrides (user-applied, hardcoded built-ins — no config required)
  'ferry:type:enable-task',
  'ferry:type:force-bug',
  'ferry:type:force-spike',
  'ferry:type:force-story',
  // Configuration override labels (user-applied; parsed by resolveTicketOverrides)
  // Prefix-only entries: the actual label appends additional segments
  'ferry:model/',
  'ferry:provider/',
  'ferry:budget/',
  'ferry:budget/max-cost/',
  'ferry:budget/max-tokens/',
  'ferry:max-iterations/',
  'ferry:max-tokens/',
  'ferry:skip/',
  'ferry:thinking/',
  'ferry:thinking/on',
  'ferry:thinking/off',
  'ferry:git/',
  'ferry:git/no-pr',
  // Config-label namespace prefixes (handled by resolveCapabilities, not resolveTicketOverrides)
  'ferry:mcp/',
  'ferry:profile/',
  // Routing (user-applied, not agent-applied)
  'critical',
  // Dynamic cost-estimate labels (prefix only; full label is "ferry:cost-estimate:<lo>-<hi>")
  'ferry:cost-estimate:',
  // Logger component identifiers (not GitHub labels — used in createLogger calls)
  'ferry:refiner-action',
  'ferry:dev-action',
  'ferry:review-action',
  'ferry:iterate-action',
  'ferry:dispatch',
  'ferry:envelope',
  'ferry:dev-loop',
  'ferry:review-loop',
  'ferry:tool-loop',
] as const;
