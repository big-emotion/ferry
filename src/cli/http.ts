import https from 'node:https';
import type { RequestOptions } from 'node:https';

export interface HttpResponse {
  statusCode: number;
  body: string;
}

function httpsRequest(options: RequestOptions, body?: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer | string) => {
        data += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode ?? 0, body: data });
      });
    });
    req.on('error', reject);
    const httpTimeoutMs = parseInt(process.env.FERRY_HTTP_TIMEOUT_MS ?? '', 10) || 15_000;
    req.setTimeout(httpTimeoutMs, () => {
      req.destroy(new Error('Request timed out'));
    });
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

export function httpsGet(options: RequestOptions): Promise<HttpResponse> {
  return httpsRequest({ ...options, method: 'GET' });
}

export function httpsPost(options: RequestOptions, body: string): Promise<HttpResponse> {
  return httpsRequest({ ...options, method: 'POST' }, body);
}
