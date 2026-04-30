import { httpsPost } from '../../http.js';
import { printSuccess, printError, printWarn, print } from '../prompt.js';
import type { StepResult } from '../types.js';

const BILLING_LINKS = [
  {
    provider: 'Anthropic',
    url: 'https://console.anthropic.com/settings/limits',
    tip: 'Set a monthly spend limit (≤ 200 USD recommended for pilots)',
  },
  {
    provider: 'Google AI',
    url: 'https://console.cloud.google.com/billing',
    tip: 'Enable budget alerts at 50% and 100% of your target',
  },
  {
    provider: 'OpenAI',
    url: 'https://platform.openai.com/settings/organization/billing/limits',
    tip: 'Set a monthly hard limit',
  },
];

export async function verifyAnthropicKey(apiKey: string): Promise<boolean> {
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
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        timeout: 10_000,
      },
      body,
    );
    return res.statusCode !== 401 && res.statusCode !== 403;
  } catch {
    return false;
  }
}

export async function stepVerify(anthropicApiKey: string): Promise<StepResult> {
  print('  Verifying Anthropic API key...');

  const valid = await verifyAnthropicKey(anthropicApiKey);
  if (valid) {
    printSuccess('Anthropic API key is valid');
  } else {
    printError('Anthropic API key is invalid or unreachable');
    printWarn('Check the key at https://console.anthropic.com/account/keys');
  }

  print('');
  print('  Set spend caps before your first dispatch (cannot be automated):');
  for (const link of BILLING_LINKS) {
    print(`  • ${link.provider}: ${link.url}`);
    print(`    ${link.tip}`);
  }

  if (!valid) {
    return { ok: false, reason: 'Anthropic API key verification failed' };
  }
  return { ok: true };
}
