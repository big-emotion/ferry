import { FerryError } from '../errors/index.js';

export interface AnthropicClientOptions {
  apiKey?: string;
  authToken?: string;
}

export interface ResolveAnthropicAuthInput {
  /** Primary key env var name, e.g. 'FERRY_ANTHROPIC_KEY' or 'ANTHROPIC_API_KEY'. */
  apiKeyEnv: string;
  /** Process env override for testability. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve Anthropic SDK auth options.
 * CLAUDE_CODE_OAUTH_TOKEN takes precedence when set (subscription auth).
 * Falls back to the named API key env var.
 * Throws if neither is set.
 * Returns exactly one of { authToken } or { apiKey } — never both.
 */
export function resolveAnthropicAuth(input: ResolveAnthropicAuthInput): AnthropicClientOptions {
  const env = input.env ?? process.env;
  const oauthToken = env['CLAUDE_CODE_OAUTH_TOKEN'];
  if (oauthToken) {
    return { authToken: oauthToken };
  }
  const apiKey = env[input.apiKeyEnv];
  if (apiKey) {
    return { apiKey };
  }
  throw new FerryError('state-invariant', { reason: 'missing-env', key: input.apiKeyEnv });
}
