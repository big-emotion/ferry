import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHttpsPost = vi.hoisted(() => vi.fn());

vi.mock('../../http.js', () => ({
  httpsPost: mockHttpsPost,
  httpsGet: vi.fn(),
}));

vi.mock('../prompt.js', () => ({
  print: vi.fn(),
  printSuccess: vi.fn(),
  printError: vi.fn(),
  printWarn: vi.fn(),
  printSkip: vi.fn(),
}));

import { verifyAnthropicKey, stepVerify } from './verify.js';

describe('verifyAnthropicKey', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns true for a 200 response', async () => {
    mockHttpsPost.mockResolvedValue({ statusCode: 200, body: '{}' });
    const result = await verifyAnthropicKey('sk-ant-valid');
    expect(result).toBe(true);
  });

  it('returns true for a 201 response', async () => {
    mockHttpsPost.mockResolvedValue({ statusCode: 201, body: '{}' });
    const result = await verifyAnthropicKey('sk-ant-valid');
    expect(result).toBe(true);
  });

  it('returns false for a 401 response', async () => {
    mockHttpsPost.mockResolvedValue({ statusCode: 401, body: 'Unauthorized' });
    const result = await verifyAnthropicKey('sk-ant-bad');
    expect(result).toBe(false);
  });

  it('returns false for a 403 response', async () => {
    mockHttpsPost.mockResolvedValue({ statusCode: 403, body: 'Forbidden' });
    const result = await verifyAnthropicKey('sk-ant-bad');
    expect(result).toBe(false);
  });

  it('returns true for non-auth failure status codes', async () => {
    mockHttpsPost.mockResolvedValue({ statusCode: 500, body: 'Server Error' });
    const result = await verifyAnthropicKey('sk-ant-valid');
    expect(result).toBe(true);
  });

  it('returns false when httpsPost throws a network error', async () => {
    mockHttpsPost.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await verifyAnthropicKey('sk-ant-key');
    expect(result).toBe(false);
  });
});

describe('stepVerify', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns ok:true when key is valid', async () => {
    mockHttpsPost.mockResolvedValue({ statusCode: 200, body: '{}' });
    const result = await stepVerify('sk-ant-valid');
    expect(result.ok).toBe(true);
  });

  it('returns ok:false with reason when key is invalid', async () => {
    mockHttpsPost.mockResolvedValue({ statusCode: 401, body: 'Unauthorized' });
    const result = await stepVerify('sk-ant-bad');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('verification failed');
  });

  it('returns ok:false when network error occurs', async () => {
    mockHttpsPost.mockRejectedValue(new Error('timeout'));
    const result = await stepVerify('sk-ant-key');
    expect(result.ok).toBe(false);
  });
});
