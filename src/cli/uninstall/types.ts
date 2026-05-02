export interface UninstallOptions {
  dryRun: boolean;
  yes: boolean;
  keepSecrets: boolean;
  keepWorkflows: boolean;
  includeAnthropic: boolean;
  closeAuditIssue: boolean;
  repo: string;
  repoRoot: string;
}

export interface WorkflowItem {
  filename: string;
  present: boolean;
}

export interface AuditIssueState {
  number: number;
  hasLabel: boolean;
}
