export interface UpdateConfig {
  repoRoot: string;
  fromVersion: string;
  toVersion: string;
  dryRun: boolean;
  yes: boolean;
}

export interface WorkflowChange {
  filename: string;
  status: 'updated' | 'unchanged' | 'added';
  diff: string;
}
