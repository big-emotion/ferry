import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockQuestion = vi.hoisted(() => vi.fn());
const mockClose = vi.hoisted(() => vi.fn());

vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(() => ({
    question: mockQuestion,
    close: mockClose,
  })),
}));

import { ask, askSecret } from './prompt.js';

describe('ask', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns trimmed answer', async () => {
    mockQuestion.mockResolvedValueOnce('  hello  ');
    const result = await ask('Name');
    expect(result).toBe('hello');
  });

  it('returns default when answer is empty', async () => {
    mockQuestion.mockResolvedValueOnce('');
    const result = await ask('Name', 'default-value');
    expect(result).toBe('default-value');
  });

  it('returns typed answer over default', async () => {
    mockQuestion.mockResolvedValueOnce('custom');
    const result = await ask('Name', 'default-value');
    expect(result).toBe('custom');
  });
});

describe('askSecret', () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('delegates to ask() in non-TTY environments (no masking needed)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });
    mockQuestion.mockResolvedValueOnce('  sk-ant-secret  ');
    const result = await askSecret('API key');
    expect(result).toBe('sk-ant-secret');
    // readline.question was called (via ask fallback), confirming delegation
    expect(mockQuestion).toHaveBeenCalledOnce();
  });

  it('returns empty string when user provides no input in non-TTY', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });
    mockQuestion.mockResolvedValueOnce('');
    const result = await askSecret('API key');
    expect(result).toBe('');
  });

  it('uses setRawMode(true) in TTY mode to suppress echo', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });

    if (!('setRawMode' in process.stdin)) {
      Object.defineProperty(process.stdin, 'setRawMode', {
        value: vi.fn(),
        writable: true,
        configurable: true,
      });
    }
    const setRawModeSpy = vi.spyOn(process.stdin, 'setRawMode').mockReturnThis();
    vi.spyOn(process.stdin, 'resume').mockReturnThis();
    vi.spyOn(process.stdin, 'pause').mockReturnThis();
    vi.spyOn(process.stdin, 'setEncoding').mockReturnThis();
    vi.spyOn(process.stdin, 'removeListener').mockReturnThis();

    let capturedHandler: ((char: string) => void) | undefined;
    vi.spyOn(process.stdin, 'on').mockImplementation(((event: string, handler: unknown) => {
      if (event === 'data') capturedHandler = handler as (char: string) => void;
      return process.stdin;
    }) as typeof process.stdin.on);

    const promise = askSecret('Secret key');

    // Simulate typing then pressing Enter
    expect(capturedHandler).toBeDefined();
    capturedHandler!('a');
    capturedHandler!('b');
    capturedHandler!('c');
    capturedHandler!('\r');

    const result = await promise;

    expect(result).toBe('abc');
    // Must have enabled raw mode to suppress terminal echo
    expect(setRawModeSpy).toHaveBeenCalledWith(true);
    // readline.question must NOT have been invoked (raw mode bypasses readline)
    expect(mockQuestion).not.toHaveBeenCalled();
  });

  it('handles backspace in TTY mode', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });

    if (!('setRawMode' in process.stdin)) {
      Object.defineProperty(process.stdin, 'setRawMode', {
        value: vi.fn(),
        writable: true,
        configurable: true,
      });
    }
    vi.spyOn(process.stdin, 'setRawMode').mockReturnThis();
    vi.spyOn(process.stdin, 'resume').mockReturnThis();
    vi.spyOn(process.stdin, 'pause').mockReturnThis();
    vi.spyOn(process.stdin, 'setEncoding').mockReturnThis();
    vi.spyOn(process.stdin, 'removeListener').mockReturnThis();

    let capturedHandler: ((char: string) => void) | undefined;
    vi.spyOn(process.stdin, 'on').mockImplementation(((event: string, handler: unknown) => {
      if (event === 'data') capturedHandler = handler as (char: string) => void;
      return process.stdin;
    }) as typeof process.stdin.on);

    const promise = askSecret('Secret key');

    capturedHandler!('a');
    capturedHandler!('b');
    capturedHandler!('c');
    capturedHandler!(String.fromCharCode(127)); // DEL (backspace)
    capturedHandler!('\r');

    const result = await promise;
    expect(result).toBe('ab');
  });
});
