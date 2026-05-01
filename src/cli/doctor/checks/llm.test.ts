import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHttpsPost = vi.hoisted(() => vi.fn());

vi.mock('../../http.js', () => ({
  httpsPost: mockHttpsPost,
  httpsGet: vi.fn(),
}));

import { checkLlmKeys } from './llm.js';

describe('checkLlmKeys', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns skip when anthropicApiKey is empty', async () => {
    const result = await checkLlmKeys({ anthropicApiKey: '' });
    expect(result.status).toBe('skip');
    expect(result.detail).toContain('No Anthropic API key');
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
});
