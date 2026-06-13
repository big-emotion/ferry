import { describe, expect, it, vi } from 'vitest';
import { createWebhookHandler } from './serve.js';

describe('createWebhookHandler', () => {
  it('rejects requests without the shared secret', async () => {
    const handleTransition = vi.fn();
    const handler = createWebhookHandler({ secret: 'topsecret', handleTransition });

    const response = await handler({
      headers: {},
      body: JSON.stringify({
        issue: { key: 'CHAN-1', fields: { status: { name: 'In Development' } } },
      }),
    });

    expect(response).toEqual({ status: 401, body: 'unauthorized' });
    expect(handleTransition).not.toHaveBeenCalled();
  });

  it('accepts a Jira-style payload with the right secret', async () => {
    const handleTransition = vi.fn().mockResolvedValue(undefined);
    const handler = createWebhookHandler({ secret: 'topsecret', handleTransition });

    const response = await handler({
      headers: { 'x-lf-token': 'topsecret' },
      body: JSON.stringify({
        issue: { key: 'CHAN-1', fields: { status: { name: 'In Development' } } },
      }),
    });

    expect(response).toEqual({ status: 202, body: 'accepted' });
    expect(handleTransition).toHaveBeenCalledWith({
      ticketKey: 'CHAN-1',
      status: 'In Development',
      ts: undefined,
      eventId: undefined,
    });
  });
});
