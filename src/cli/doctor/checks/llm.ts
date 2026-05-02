import { httpsPost } from '../../http.js';
import type { CheckResult } from '../types.js';

async function probeAnthropic(apiKey: string): Promise<{ ok: boolean; detail: string }> {
  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  });

  try {
    const res = await httpsPost(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
        },
      },
      body,
    );

    if (res.statusCode === 200 || res.statusCode === 201) {
      return { ok: true, detail: 'Anthropic key valid (claude-haiku-4-5 responded)' };
    }
    if (res.statusCode === 401 || res.statusCode === 403) {
      return { ok: false, detail: `Anthropic key rejected (${res.statusCode})` };
    }
    if (res.statusCode === 429) {
      return { ok: true, detail: 'Anthropic key valid (rate-limited, but key accepted)' };
    }
    return { ok: false, detail: `Anthropic API returned unexpected status ${res.statusCode}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: `Network error reaching Anthropic: ${msg}` };
  }
}

export async function checkLlmKeys(opts: { anthropicApiKey: string }): Promise<CheckResult> {
  const { anthropicApiKey } = opts;

  if (!anthropicApiKey) {
    return {
      label: 'LLM keys valid',
      status: 'skip',
      detail: 'No Anthropic API key provided — skipping',
      remedy:
        'Provide --anthropic-key or set ANTHROPIC_API_KEY. Generate at console.anthropic.com/account/keys',
    };
  }

  const { ok, detail } = await probeAnthropic(anthropicApiKey);

  if (ok) {
    return { label: 'LLM keys valid', status: 'green', detail };
  }

  return {
    label: 'LLM keys valid',
    status: 'red',
    detail,
    remedy:
      'Generate a new key at console.anthropic.com/account/keys, then re-run `npx -p @big-emotion/ferry ferry-init --overwrite`',
  };
}
