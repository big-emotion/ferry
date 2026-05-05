import { httpsPost } from '../../http.js';
import { loadFerryConfig } from '../../../lib/config.js';
import { listRepoSecrets } from './secrets.js';
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

export async function checkLlmKeys(opts: {
  anthropicApiKey: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  repoRoot?: string;
  repo?: string;
}): Promise<CheckResult> {
  const { anthropicApiKey, openaiApiKey = '', googleApiKey = '', repoRoot, repo } = opts;

  // Determine which providers are required by the ferry config.
  const requiredProviders = new Set<string>(['anthropic']);
  if (repoRoot) {
    try {
      const cfg = loadFerryConfig(repoRoot);
      for (const route of Object.values(cfg.models)) {
        requiredProviders.add(route.provider);
      }
    } catch {
      // Config may not exist in doctor context; fall back to Anthropic-only check.
    }
  }

  // Lazily fetch repo secrets once if we need to cross-check missing keys.
  let repoSecrets: string[] | null = null;
  function getRepoSecrets(): string[] {
    if (repoSecrets === null) {
      repoSecrets = repo ? listRepoSecrets(repo) : [];
    }
    return repoSecrets;
  }

  const missing: string[] = [];
  const details: string[] = [];

  if (requiredProviders.has('anthropic')) {
    if (!anthropicApiKey) {
      missing.push('ANTHROPIC_API_KEY (required for anthropic provider)');
    } else {
      const { ok, detail } = await probeAnthropic(anthropicApiKey);
      if (ok) {
        details.push(detail);
      } else {
        return {
          label: 'LLM keys valid',
          status: 'red',
          detail,
          remedy:
            'Generate a new key at console.anthropic.com/account/keys, then re-run `npx -p @big-emotion/ferry ferry-init --overwrite`',
        };
      }
    }
  }

  if (requiredProviders.has('openai')) {
    if (!openaiApiKey) {
      // Cross-check repo secrets: workflows use OPENAI_API_KEY; legacy env uses FERRY_OPENAI_KEY.
      const secrets = getRepoSecrets();
      if (secrets.includes('OPENAI_API_KEY') || secrets.includes('FERRY_OPENAI_KEY')) {
        details.push('OpenAI key present in repo secrets (not verifiable locally)');
      } else {
        missing.push(
          'OPENAI_API_KEY (required for openai provider — set via `gh secret set OPENAI_API_KEY`)',
        );
      }
    } else {
      details.push('OpenAI key present');
    }
  }

  if (requiredProviders.has('google')) {
    if (!googleApiKey) {
      // Cross-check repo secrets: workflows use GOOGLE_API_KEY; legacy env uses FERRY_GOOGLE_AI_KEY.
      const secrets = getRepoSecrets();
      if (secrets.includes('GOOGLE_API_KEY') || secrets.includes('FERRY_GOOGLE_AI_KEY')) {
        details.push('Google AI key present in repo secrets (not verifiable locally)');
      } else {
        missing.push(
          'GOOGLE_API_KEY (required for google provider — set via `gh secret set GOOGLE_API_KEY`)',
        );
      }
    } else {
      details.push('Google AI key present');
    }
  }

  if (missing.length > 0) {
    const missingList = missing.join(', ');
    return {
      label: 'LLM keys valid',
      status: requiredProviders.has('anthropic') && !anthropicApiKey ? 'skip' : 'yellow',
      detail: `Missing keys for configured providers: ${missingList}`,
      remedy: `Add the missing secrets to your repository: ${missingList}`,
    };
  }

  return {
    label: 'LLM keys valid',
    status: 'green',
    detail: details.join('; '),
  };
}
