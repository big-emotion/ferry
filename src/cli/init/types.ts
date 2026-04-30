export interface FerryConfig {
  owner: string;
  repo: string;
  ferryVersion: string;
  appId: string;
  privateKey: string;
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  anthropicApiKey: string;
}

export interface SecretEntry {
  name: string;
  value: string;
  description: string;
}

export interface WorkflowEntry {
  filename: string;
  content: string;
}

export type StepResult = { ok: true } | { ok: false; reason: string };
