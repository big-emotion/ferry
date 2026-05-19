import type { ExecutionPath } from '../../lib/config.js';

export type { ExecutionPath };

export type LlmProvider = 'anthropic' | 'openai' | 'google';

export interface FerryConfig {
  owner: string;
  repo: string;
  ferryVersion: string;
  appId: string;
  privateKey: string;
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraProjectKey: string;
  jiraWorkspaceId: string;
  jiraProjectId: string;
  anthropicApiKey: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  /** Execution path chosen at install time (ADR-0006 §6). */
  executionPath: ExecutionPath;
  /** Claude Code OAuth token — set only on the claude-code path. */
  claudeCodeOauthToken?: string;
  refinerProvider: LlmProvider;
  devProvider: LlmProvider;
  reviewProvider: LlmProvider;
  iterateProvider: LlmProvider;
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
