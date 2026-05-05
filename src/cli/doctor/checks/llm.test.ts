import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHttpsPost = vi.hoisted(() => vi.fn());
const mockListRepoSecrets = vi.hoisted(() => vi.fn<() => string[]>(() => []));
const mockLoadFerryConfig = vi.hoisted(() => vi.fn());

vi.mock('../../http.js', () => ({
  httpsPost: mockHttpsPost,
  httpsGet: vi.fn(),
}));

vi.mock('./secrets.js', () => ({
  listRepoSecrets: mockListRepoSecrets,
  checkSecrets: vi.fn(),
}));

vi.mock('../../../lib/config.js', () => ({
  loadFerryConfig: mockLoadFerryConfig,
}));

import { checkLlmKeys } from './llm.js';

describe('checkLlmKeys', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockListRepoSecrets.mockReturnValue([]);
  });

  it('returns skip when anthropicApiKey is empty', async () => {
    const result = await checkLlmKeys({ anthropicApiKey: '' });
    expect(result.status).toBe('skip');
    expect(result.detail).toContain('ANTHROPIC_API_KEY');
  });

  it('returns green for a 200 response', async () => {
    mockHttpsPost.mockResolvedValue({ statusCode: 200, body: '{}' });
    const result = await checkLlmKeys({ anthropicApiKey: 'sk-ant-valid' });
    expect(result.status).toBe('green');
    expect(result.detail).toContain('valid');
  });

  it('returns green for a 201 response', async () => {
    mockHttpsPost.mockResolvedValue({ statusCode: 201, body: '{}' });
    const result = await checkLlmKeys({ anthropicApiKey: 'sk-ant-valid' });
    expect(result.status).toBe('green');
  });

  it('returns red for a 401 response', async () => {
    mockHttpsPost.mockResolvedValue({ statusCode: 401, body: 'Unauthorized' });
    const result = await checkLlmKeys({ anthropicApiKey: 'sk-ant-bad' });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('rejected');
  });

  it('returns red for a 403 response', async () => {
    mockHttpsPost.mockResolvedValue({ statusCode: 403, body: 'Forbidden' });
    const result = await checkLlmKeys({ anthropicApiKey: 'sk-ant-bad' });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('rejected');
  });

  it('returns green for a 429 rate-limit response (key accepted)', async () => {
    mockHttpsPost.mockResolvedValue({ statusCode: 429, body: 'Rate limited' });
    const result = await checkLlmKeys({ anthropicApiKey: 'sk-ant-valid' });
    expect(result.status).toBe('green');
    expect(result.detail).toContain('rate-limited');
  });

  it('returns red for an unexpected status code', async () => {
    mockHttpsPost.mockResolvedValue({ statusCode: 500, body: 'Server Error' });
    const result = await checkLlmKeys({ anthropicApiKey: 'sk-ant-key' });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('unexpected status 500');
  });

  it('returns red for a network error', async () => {
    mockHttpsPost.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkLlmKeys({ anthropicApiKey: 'sk-ant-key' });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('Network error');
  });

  it('includes remedy when key is invalid', async () => {
    mockHttpsPost.mockResolvedValue({ statusCode: 401, body: '' });
    const result = await checkLlmKeys({ anthropicApiKey: 'sk-ant-bad' });
    expect(result.remedy).toBeTruthy();
  });

  describe('openai provider configured via repoRoot', () => {
    beforeEach(() => {
      mockHttpsPost.mockResolvedValue({ statusCode: 200, body: '{}' });
      mockLoadFerryConfig.mockReturnValue({
        models: {
          refiner: { provider: 'openai', model: 'gpt-4o' },
          dev: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
          review: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
          iterate: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        },
      });
    });

    it('returns yellow when openai provider is configured but OPENAI_API_KEY is missing from repo and env', async () => {
      mockListRepoSecrets.mockReturnValue([]);
      const result = await checkLlmKeys({
        anthropicApiKey: 'sk-ant-valid',
        repoRoot: '/some/repo',
        repo: 'owner/repo',
      });
      expect(result.status).toBe('yellow');
      expect(result.detail).toContain('OPENAI_API_KEY');
    });

    it('returns green when OPENAI_API_KEY is present in env', async () => {
      const result = await checkLlmKeys({
        anthropicApiKey: 'sk-ant-valid',
        openaiApiKey: 'sk-openai-valid',
        repoRoot: '/some/repo',
      });
      expect(result.status).toBe('green');
      expect(result.detail).toContain('OpenAI key present');
    });

    it('returns green (with note) when OPENAI_API_KEY is in repo secrets but not env', async () => {
      mockListRepoSecrets.mockReturnValue(['OPENAI_API_KEY']);
      const result = await checkLlmKeys({
        anthropicApiKey: 'sk-ant-valid',
        repoRoot: '/some/repo',
        repo: 'owner/repo',
      });
      expect(result.status).toBe('green');
      expect(result.detail).toContain('repo secrets');
    });

    it('accepts legacy FERRY_OPENAI_KEY in repo secrets', async () => {
      mockListRepoSecrets.mockReturnValue(['FERRY_OPENAI_KEY']);
      const result = await checkLlmKeys({
        anthropicApiKey: 'sk-ant-valid',
        repoRoot: '/some/repo',
        repo: 'owner/repo',
      });
      expect(result.status).toBe('green');
      expect(result.detail).toContain('repo secrets');
    });

    it('names the missing secret in the warning', async () => {
      mockListRepoSecrets.mockReturnValue([]);
      const result = await checkLlmKeys({
        anthropicApiKey: 'sk-ant-valid',
        repoRoot: '/some/repo',
        repo: 'owner/repo',
      });
      expect(result.detail).toContain('OPENAI_API_KEY');
      expect(result.remedy).toContain('OPENAI_API_KEY');
    });
  });

  describe('google provider configured via repoRoot', () => {
    beforeEach(() => {
      mockHttpsPost.mockResolvedValue({ statusCode: 200, body: '{}' });
      mockLoadFerryConfig.mockReturnValue({
        models: {
          refiner: { provider: 'google', model: 'gemini-2.5-pro' },
          dev: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
          review: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
          iterate: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        },
      });
    });

    it('returns yellow when google provider is configured and GOOGLE_API_KEY is missing', async () => {
      mockListRepoSecrets.mockReturnValue([]);
      const result = await checkLlmKeys({
        anthropicApiKey: 'sk-ant-valid',
        repoRoot: '/some/repo',
        repo: 'owner/repo',
      });
      expect(result.status).toBe('yellow');
      expect(result.detail).toContain('GOOGLE_API_KEY');
    });

    it('returns green when GOOGLE_API_KEY is present in env', async () => {
      const result = await checkLlmKeys({
        anthropicApiKey: 'sk-ant-valid',
        googleApiKey: 'gai-key-valid',
        repoRoot: '/some/repo',
      });
      expect(result.status).toBe('green');
      expect(result.detail).toContain('Google AI key present');
    });

    it('returns green (with note) when GOOGLE_API_KEY is in repo secrets but not env', async () => {
      mockListRepoSecrets.mockReturnValue(['GOOGLE_API_KEY']);
      const result = await checkLlmKeys({
        anthropicApiKey: 'sk-ant-valid',
        repoRoot: '/some/repo',
        repo: 'owner/repo',
      });
      expect(result.status).toBe('green');
      expect(result.detail).toContain('repo secrets');
    });

    it('accepts legacy FERRY_GOOGLE_AI_KEY in repo secrets', async () => {
      mockListRepoSecrets.mockReturnValue(['FERRY_GOOGLE_AI_KEY']);
      const result = await checkLlmKeys({
        anthropicApiKey: 'sk-ant-valid',
        repoRoot: '/some/repo',
        repo: 'owner/repo',
      });
      expect(result.status).toBe('green');
      expect(result.detail).toContain('repo secrets');
    });
  });
});
