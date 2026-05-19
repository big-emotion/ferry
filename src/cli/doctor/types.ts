export type CheckStatus = 'green' | 'yellow' | 'red' | 'skip';

export interface CheckResult {
  label: string;
  status: CheckStatus;
  detail: string;
  remedy?: string;
}

export interface DoctorConfig {
  repo: string;
  appId: string;
  privateKey: string;
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraProjectKey: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  googleApiKey: string;
  claudeCodeOauthToken: string;
  ferryVersion: string;
  repoRoot: string;
  noDispatch: boolean;
}
