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
  'needs-human',
  'status:stale',
  // Routing (user-applied, not agent-applied)
  'critical',
  // Logger component identifiers (not GitHub labels — used in createLogger calls)
  'ferry:refiner-action',
  'ferry:dev-action',
  'ferry:review-action',
  'ferry:iterate-action',
  'ferry:dispatch',
  'ferry:envelope',
  'ferry:dev-loop',
  'ferry:review-loop',
] as const;
