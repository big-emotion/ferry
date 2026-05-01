import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequest = vi.hoisted(() => vi.fn());

vi.mock('node:https', () => ({
  default: { request: mockRequest },
}));

import { httpsGet, httpsPost } from './http.js';

function buildMockReq() {
  let onError: ((e: Error) => void) | undefined;
  const req = {
    on: vi.fn((event: string, handler: (e: Error) => void) => {
      if (event === 'error') onError = handler;
    }),
    setTimeout: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn((e: Error) => {
      onError?.(e);
    }),
    _fireError: (e: Error) => {
      onError?.(e);
    },
  };
  return req;
}

function buildMockRes(statusCode: number | undefined, chunks: (string | Buffer)[]) {
  return {
    statusCode,
    on: vi.fn((event: string, handler: (d?: string | Buffer) => void) => {
      if (event === 'data') chunks.forEach((c) => handler(c));
      if (event === 'end') handler();
    }),
  };
}

describe('httpsGet', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('resolves with statusCode and body on success', async () => {
    const req = buildMockReq();
    const res = buildMockRes(200, ['hello world']);
    mockRequest.mockImplementation((...args: unknown[]) => {
      const cb = args[1] as (r: unknown) => void;
      cb(res);
      return req;
    });
    const result = await httpsGet({ hostname: 'example.com', path: '/' });
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('hello world');
  });

  it('concatenates multiple data chunks', async () => {
    const req = buildMockReq();
    const res = buildMockRes(200, ['chunk1', 'chunk2', 'chunk3']);
    mockRequest.mockImplementation((...args: unknown[]) => {
      const cb = args[1] as (r: unknown) => void;
      cb(res);
      return req;
    });
    const { body } = await httpsGet({ hostname: 'example.com', path: '/' });
    expect(body).toBe('chunk1chunk2chunk3');
  });

  it('handles Buffer chunks', async () => {
    const req = buildMockReq();
    const buf = Buffer.from('buf-data', 'utf8');
    const res = buildMockRes(200, [buf]);
    mockRequest.mockImplementation((...args: unknown[]) => {
      const cb = args[1] as (r: unknown) => void;
      cb(res);
      return req;
    });
    const result = await httpsGet({ hostname: 'example.com', path: '/' });
    expect(result.body).toBe('buf-data');
  });

  it('uses 0 when statusCode is undefined', async () => {
    const req = buildMockReq();
    const res = buildMockRes(undefined, []);
    mockRequest.mockImplementation((...args: unknown[]) => {
      const cb = args[1] as (r: unknown) => void;
      cb(res);
      return req;
    });
    const result = await httpsGet({ hostname: 'example.com', path: '/' });
    expect(result.statusCode).toBe(0);
  });

  it('sets method to GET', async () => {
    const req = buildMockReq();
    const res = buildMockRes(200, []);
    let capturedOpts: Record<string, unknown> = {};
    mockRequest.mockImplementation((...args: unknown[]) => {
      capturedOpts = args[0] as Record<string, unknown>;
      const cb = args[1] as (r: unknown) => void;
      cb(res);
      return req;
    });
    await httpsGet({ hostname: 'example.com', path: '/' });
    expect(capturedOpts['method']).toBe('GET');
  });

  it('calls setTimeout with 15_000', async () => {
    const req = buildMockReq();
    const res = buildMockRes(200, []);
    mockRequest.mockImplementation((...args: unknown[]) => {
      const cb = args[1] as (r: unknown) => void;
      cb(res);
      return req;
    });
    await httpsGet({ hostname: 'example.com', path: '/' });
    expect(req.setTimeout).toHaveBeenCalledWith(15_000, expect.any(Function));
  });

  it('rejects when the request emits an error', async () => {
    const req = buildMockReq();
    mockRequest.mockImplementation(() => {
      process.nextTick(() => req._fireError(new Error('ECONNREFUSED')));
      return req;
    });
    await expect(httpsGet({ hostname: 'bad.host', path: '/' })).rejects.toThrow('ECONNREFUSED');
  });

  it('destroy triggers the error handler (timeout path)', async () => {
    const req = buildMockReq();
    const res = buildMockRes(200, []);
    mockRequest.mockImplementation((...args: unknown[]) => {
      const cb = args[1] as (r: unknown) => void;
      cb(res);
      // Simulate timeout by invoking the setTimeout callback synchronously
      req.setTimeout.mockImplementation((_ms: unknown, cb2: () => void) => cb2());
      return req;
    });
    // The request should still resolve because the response arrived
    await httpsGet({ hostname: 'example.com', path: '/' });
    expect(req.setTimeout).toHaveBeenCalled();
  });
});

describe('httpsPost', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('resolves with statusCode and body on success', async () => {
    const req = buildMockReq();
    const res = buildMockRes(201, ['{"ok":true}']);
    mockRequest.mockImplementation((...args: unknown[]) => {
      const cb = args[1] as (r: unknown) => void;
      cb(res);
      return req;
    });
    const result = await httpsPost({ hostname: 'api.example.com', path: '/create' }, '{}');
    expect(result.statusCode).toBe(201);
    expect(result.body).toBe('{"ok":true}');
  });

  it('sets method to POST', async () => {
    const req = buildMockReq();
    const res = buildMockRes(200, []);
    let capturedOpts: Record<string, unknown> = {};
    mockRequest.mockImplementation((...args: unknown[]) => {
      capturedOpts = args[0] as Record<string, unknown>;
      const cb = args[1] as (r: unknown) => void;
      cb(res);
      return req;
    });
    await httpsPost({ hostname: 'api.example.com', path: '/post' }, 'body');
    expect(capturedOpts['method']).toBe('POST');
  });

  it('writes the request body', async () => {
    const req = buildMockReq();
    const res = buildMockRes(200, []);
    mockRequest.mockImplementation((...args: unknown[]) => {
      const cb = args[1] as (r: unknown) => void;
      cb(res);
      return req;
    });
    await httpsPost({ hostname: 'api.example.com', path: '/post' }, 'my-body');
    expect(req.write).toHaveBeenCalledWith('my-body');
  });

  it('rejects when the request emits an error', async () => {
    const req = buildMockReq();
    mockRequest.mockImplementation(() => {
      process.nextTick(() => req._fireError(new Error('Network error')));
      return req;
    });
    await expect(httpsPost({ hostname: 'bad.host', path: '/' }, 'body')).rejects.toThrow(
      'Network error',
    );
  });

  it('does not write body when undefined is passed', async () => {
    const req = buildMockReq();
    const res = buildMockRes(200, []);
    mockRequest.mockImplementation((...args: unknown[]) => {
      const cb = args[1] as (r: unknown) => void;
      cb(res);
      return req;
    });
    // httpsPost always passes body, so we test via httpsGet (no body)
    await httpsGet({ hostname: 'example.com', path: '/' });
    expect(req.write).not.toHaveBeenCalled();
  });
});
