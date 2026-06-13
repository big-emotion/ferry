import http from 'node:http';
import { processLocalTransition } from './process.js';

export interface WebhookRequest {
  headers: Record<string, string | undefined>;
  body: string;
}

export interface WebhookResponse {
  status: number;
  body: string;
}

export interface CreateWebhookHandlerOptions {
  secret: string;
  handleTransition: (input: {
    ticketKey: string;
    status: string;
    ts?: string;
    eventId?: string;
  }) => Promise<void>;
}

function normalizeHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

function extractTransition(payload: unknown): {
  ticketKey: string;
  status: string;
  ts?: string;
  eventId?: string;
} {
  const obj = payload as {
    issue?: {
      key?: string;
      fields?: { status?: { name?: string }; updated?: string };
      id?: string;
    };
    ticket_key?: string;
    status?: string;
    ts?: string;
    event_id?: string;
  };
  const ticketKey = obj.issue?.key ?? obj.ticket_key;
  const status = obj.issue?.fields?.status?.name ?? obj.status;
  const ts = obj.issue?.fields?.updated ?? obj.ts;
  const eventId = obj.event_id;
  if (!ticketKey || !status) {
    throw new Error('Invalid webhook payload: expected issue.key and issue.fields.status.name');
  }
  return { ticketKey, status, ts, eventId };
}

export function createWebhookHandler(options: CreateWebhookHandlerOptions) {
  return async (request: WebhookRequest): Promise<WebhookResponse> => {
    const headers = normalizeHeaders(request.headers);
    if (headers['x-lf-token'] !== options.secret) {
      return { status: 401, body: 'unauthorized' };
    }

    const transition = extractTransition(JSON.parse(request.body) as unknown);
    await options.handleTransition(transition);
    return { status: 202, body: 'accepted' };
  };
}

export async function serveLocalRunner(options: {
  repoRoot: string;
  port: number;
  dryRun?: boolean;
}): Promise<void> {
  const secret = process.env.FERRY_LOCAL_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('FERRY_LOCAL_WEBHOOK_SECRET is required for ferry-local serve');
  }

  const handler = createWebhookHandler({
    secret,
    handleTransition: async (transition) => {
      await processLocalTransition({
        repoRoot: options.repoRoot,
        ticketKey: transition.ticketKey,
        status: transition.status,
        ts: transition.ts,
        eventId: transition.eventId,
        dryRun: options.dryRun,
      });
    },
  });

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('method not allowed');
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void handler({
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([key, value]) => [
            key,
            Array.isArray(value) ? value[0] : value,
          ]),
        ),
        body: Buffer.concat(chunks).toString('utf8'),
      })
        .then((response) => {
          res.statusCode = response.status;
          res.end(response.body);
        })
        .catch((error: unknown) => {
          res.statusCode = 400;
          res.end((error as Error).message);
        });
    });
  });

  await new Promise<void>((resolve) => server.listen(options.port, resolve));
  console.log(`[ferry-local] listening on :${options.port}`);
}
