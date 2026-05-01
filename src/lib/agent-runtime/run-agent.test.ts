import { describe, it, expect, vi, afterEach } from 'vitest';
import { runAgent } from './run-agent.js';

const VALID_ENVELOPE = {
  version: 'v1',
  event_id: '01JFBK9Q4BVCJAGTYQ6S3XTDMN',
  ticket_key: 'PROJ-1',
  phase: 'refine',
  source: 'jira-column',
  ts: '2026-04-27T00:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function stubExit() {
  return vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
}

function captureStderr() {
  const lines: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

describe('runAgent', () => {
  it('invokes handler with the validated envelope on the success path', async () => {
    vi.stubEnv('FERRY_ENVELOPE_PAYLOAD', JSON.stringify(VALID_ENVELOPE));
    const exit = stubExit();
    const handler = vi.fn().mockResolvedValue(undefined);

    await runAgent('refiner', handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ ticket_key: 'PROJ-1', phase: 'refine' });
    expect(exit).not.toHaveBeenCalled();
  });

  it('passes a logger with the envelope correlation_id to the handler', async () => {
    vi.stubEnv('FERRY_ENVELOPE_PAYLOAD', JSON.stringify(VALID_ENVELOPE));
    stubExit();
    let receivedLogger: unknown;
    const handler = vi.fn().mockImplementation((_env, logger) => {
      receivedLogger = logger;
      return Promise.resolve();
    });

    await runAgent('refiner', handler);

    expect(receivedLogger).toBeDefined();
    expect(typeof (receivedLogger as { info: unknown }).info).toBe('function');
  });

  it('exits 1 with a structured fatal log when validation fails', async () => {
    vi.stubEnv('FERRY_ENVELOPE_PAYLOAD', JSON.stringify({ version: 'v1' }));
    const exit = stubExit();
    const lines = captureStderr();
    const handler = vi.fn();

    await runAgent('reviewer', handler);

    expect(handler).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    expect(lines.length).toBeGreaterThan(0);
    const record = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: 'error',
      component: 'ferry:review-action',
      message: 'fatal',
    });
  });

  it('exits 1 with a structured fatal log when handler throws', async () => {
    vi.stubEnv('FERRY_ENVELOPE_PAYLOAD', JSON.stringify(VALID_ENVELOPE));
    const exit = stubExit();
    const lines = captureStderr();
    const handler = vi.fn().mockRejectedValue(new Error('boom'));

    await runAgent('iterator', handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    const record = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: 'error',
      component: 'ferry:iterate-action',
      message: 'fatal',
      error: 'boom',
    });
  });

  it('exits 1 when FERRY_ENVELOPE_PAYLOAD is missing', async () => {
    vi.stubEnv('FERRY_ENVELOPE_PAYLOAD', '');
    const exit = stubExit();
    const lines = captureStderr();
    const handler = vi.fn();

    await runAgent('developer', handler);

    expect(handler).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    const record = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: 'error',
      component: 'ferry:dev-action',
      message: 'fatal',
    });
  });
});
