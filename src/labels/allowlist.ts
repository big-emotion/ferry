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
  'ferry:paused',
  'ferry:cancelled',
  'ferry:spend-cap',
  // Escalation labels
  'needs-human',
  'status:stale',
  // Routing (user-applied, not agent-applied)
  'critical',
] as const;
