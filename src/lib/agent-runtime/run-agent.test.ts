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

function stubExitAndError() {
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  return { exit, error };
}

describe('runAgent', () => {
  it('invokes handler with the validated envelope on the success path', async () => {
    vi.stubEnv('FERRY_ENVELOPE_PAYLOAD', JSON.stringify(VALID_ENVELOPE));
    const { exit } = stubExitAndError();
    const handler = vi.fn().mockResolvedValue(undefined);

    await runAgent('refiner', handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ ticket_key: 'PROJ-1', phase: 'refine' });
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits 1 with a logged fatal when validation fails', async () => {
    vi.stubEnv('FERRY_ENVELOPE_PAYLOAD', JSON.stringify({ version: 'v1' })); // missing fields
    const { exit, error } = stubExitAndError();
    const handler = vi.fn();

    await runAgent('reviewer', handler);

    expect(handler).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalled();
    const firstCallArgs = error.mock.calls[0] as unknown[];
    expect(String(firstCallArgs[0])).toBe('[ferry:review-action] fatal:');
  });

  it('exits 1 with a logged fatal when handler throws', async () => {
    vi.stubEnv('FERRY_ENVELOPE_PAYLOAD', JSON.stringify(VALID_ENVELOPE));
    const { exit, error } = stubExitAndError();
    const handler = vi.fn().mockRejectedValue(new Error('boom'));

    await runAgent('iterator', handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    const firstCallArgs = error.mock.calls[0] as unknown[];
    expect(String(firstCallArgs[0])).toBe('[ferry:iterate-action] fatal:');
    expect(String(firstCallArgs[1])).toBe('boom');
  });

  it('exits 1 when FERRY_ENVELOPE_PAYLOAD is missing', async () => {
    vi.stubEnv('FERRY_ENVELOPE_PAYLOAD', '');
    const { exit, error } = stubExitAndError();
    const handler = vi.fn();

    await runAgent('developer', handler);

    expect(handler).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    const firstCallArgs = error.mock.calls[0] as unknown[];
    expect(String(firstCallArgs[0])).toBe('[ferry:dev-action] fatal:');
  });
});
