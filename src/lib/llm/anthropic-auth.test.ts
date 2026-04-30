import { describe, it, expect } from 'vitest';
import { resolveAnthropicAuth } from './anthropic-auth.js';

describe('resolveAnthropicAuth', () => {
  it('returns { authToken } when CLAUDE_CODE_OAUTH_TOKEN is set', () => {
    const result = resolveAnthropicAuth({
      apiKeyEnv: 'FERRY_ANTHROPIC_KEY',
      env: { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-tok-123' },
    });
    expect(result).toEqual({ authToken: 'oauth-tok-123' });
  });

  it('returns { apiKey } when only the primary key env is set', () => {
    const result = resolveAnthropicAuth({
      apiKeyEnv: 'FERRY_ANTHROPIC_KEY',
      env: { FERRY_ANTHROPIC_KEY: 'sk-ant-abc' },
    });
    expect(result).toEqual({ apiKey: 'sk-ant-abc' });
  });

  it('prefers CLAUDE_CODE_OAUTH_TOKEN over the primary key', () => {
    const result = resolveAnthropicAuth({
      apiKeyEnv: 'FERRY_ANTHROPIC_KEY',
      env: { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-tok-123', FERRY_ANTHROPIC_KEY: 'sk-ant-abc' },
    });
    expect(result).toEqual({ authToken: 'oauth-tok-123' });
    expect(result).not.toHaveProperty('apiKey');
  });

  it('treats empty-string CLAUDE_CODE_OAUTH_TOKEN as not set', () => {
    const result = resolveAnthropicAuth({
      apiKeyEnv: 'FERRY_ANTHROPIC_KEY',
      env: { CLAUDE_CODE_OAUTH_TOKEN: '', FERRY_ANTHROPIC_KEY: 'sk-ant-abc' },
    });
    expect(result).toEqual({ apiKey: 'sk-ant-abc' });
  });

  it('treats empty-string primary key as not set', () => {
    expect(() =>
      resolveAnthropicAuth({
        apiKeyEnv: 'FERRY_ANTHROPIC_KEY',
        env: { FERRY_ANTHROPIC_KEY: '' },
      }),
    ).toThrow(expect.objectContaining({ code: 'state-invariant' }));
  });

  it('throws FerryError("state-invariant") with reason="missing-env" and the apiKeyEnv when neither is set', () => {
    expect(() =>
      resolveAnthropicAuth({
        apiKeyEnv: 'FERRY_ANTHROPIC_KEY',
        env: {},
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'state-invariant',
        context: { reason: 'missing-env', key: 'FERRY_ANTHROPIC_KEY' },
      }),
    );
  });

  it('uses the correct key name in the error when apiKeyEnv is ANTHROPIC_API_KEY', () => {
    expect(() =>
      resolveAnthropicAuth({
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        env: {},
      }),
    ).toThrow(
      expect.objectContaining({
        context: { reason: 'missing-env', key: 'ANTHROPIC_API_KEY' },
      }),
    );
  });

  it('works smoke test for apiKeyEnv=FERRY_ANTHROPIC_KEY', () => {
    const result = resolveAnthropicAuth({
      apiKeyEnv: 'FERRY_ANTHROPIC_KEY',
      env: { FERRY_ANTHROPIC_KEY: 'sk-ant-ferry' },
    });
    expect(result).toHaveProperty('apiKey', 'sk-ant-ferry');
  });

  it('works smoke test for apiKeyEnv=ANTHROPIC_API_KEY', () => {
    const result = resolveAnthropicAuth({
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      env: { ANTHROPIC_API_KEY: 'sk-ant-action' },
    });
    expect(result).toHaveProperty('apiKey', 'sk-ant-action');
  });

  it('never returns both apiKey and authToken simultaneously', () => {
    const withOauth = resolveAnthropicAuth({
      apiKeyEnv: 'FERRY_ANTHROPIC_KEY',
      env: { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-tok', FERRY_ANTHROPIC_KEY: 'sk-ant-abc' },
    });
    expect(withOauth).not.toHaveProperty('apiKey');
    expect(withOauth).toHaveProperty('authToken');

    const withKey = resolveAnthropicAuth({
      apiKeyEnv: 'FERRY_ANTHROPIC_KEY',
      env: { FERRY_ANTHROPIC_KEY: 'sk-ant-abc' },
    });
    expect(withKey).not.toHaveProperty('authToken');
    expect(withKey).toHaveProperty('apiKey');
  });
});
