import { describe, it, expect } from 'vitest';
import { runRefiner, type LlmCall, type RefinerInput } from './refine.js';

const ticket: RefinerInput['ticket'] = {
  key: 'CHAN-27',
  title: 'Add login button',
  description: 'Users want a login button on the home page.',
  comments: ['comment 1', 'comment 2'],
  labels: ['feature'],
  attachments: ['mock.png'],
};

const validPlan = {
  subtasks: [
    { title: 'Add LoginButton component', description: 'New file src/components/LoginButton.tsx' },
    { title: 'Wire LoginButton on Home', description: 'Edit src/pages/Home.tsx' },
  ],
  touch_paths: ['src/components/LoginButton.tsx', 'src/pages/Home.tsx'],
  output_locale: 'en' as const,
  audit_summary: '2 sub-tasks planned',
};

const okLlm: LlmCall = async (prompt) => ({
  text: JSON.stringify(validPlan),
  promptIncluded: prompt,
  usage: { inputTokens: 100, outputTokens: 50, costEur: 0.012 },
});

describe('runRefiner happy path (Story 3-1)', () => {
  it('returns parsed plan and audit summary', async () => {
    const result = await runRefiner({
      ticket,
      callLlm: okLlm,
      runLink: 'https://example.com/run/1',
    });
    expect(result.plan).toEqual(validPlan);
    expect(result.auditSummary).toEqual({
      subtaskCount: 2,
      costEur: 0.012,
      runLink: 'https://example.com/run/1',
      attachmentNames: ['mock.png'],
    });
  });

  it('passes the ticket payload through delimitUntrusted before calling the LLM', async () => {
    let captured = '';
    const captureLlm: LlmCall = async (prompt) => {
      captured = prompt;
      return { text: JSON.stringify(validPlan), usage: null };
    };
    await runRefiner({
      ticket,
      callLlm: captureLlm,
      runLink: 'https://example.com/run/1',
    });
    // ticket title is wrapped in delimiters, not raw
    expect(captured).toContain('<<<UNTRUSTED>>>');
    expect(captured).toContain('Add login button');
    expect(captured).toContain('<<<END UNTRUSTED>>>');
  });
});

describe('runRefiner error paths (Story 3-1)', () => {
  it('throws state-invariant on malformed JSON', async () => {
    const badLlm: LlmCall = async () => ({ text: 'not json', usage: null });
    await expect(runRefiner({ ticket, callLlm: badLlm, runLink: 'r' })).rejects.toMatchObject({
      code: 'state-invariant',
    });
  });

  it('throws state-invariant on schema violation', async () => {
    // output_locale='es' violates the schema (only 'en' | 'fr' are allowed).
    const reallyBad: LlmCall = async () => ({
      text: JSON.stringify({ ...validPlan, output_locale: 'es' }),
      usage: null,
    });
    await expect(runRefiner({ ticket, callLlm: reallyBad, runLink: 'r' })).rejects.toMatchObject({
      code: 'state-invariant',
    });
  });

  it('throws oscillation on touch_paths over the cap', async () => {
    const tooBig = Array.from({ length: 21 }, (_, i) => `src/file${i}.ts`);
    const overLlm: LlmCall = async () => ({
      text: JSON.stringify({ ...validPlan, touch_paths: tooBig }),
      usage: null,
    });
    await expect(runRefiner({ ticket, callLlm: overLlm, runLink: 'r' })).rejects.toMatchObject({
      code: 'oscillation',
    });
    await expect(runRefiner({ ticket, callLlm: overLlm, runLink: 'r' })).rejects.toThrow(
      /spec-too-broad/,
    );
  });

  it('accepts touch_paths exactly at the cap (boundary 20)', async () => {
    const atCap = Array.from({ length: 20 }, (_, i) => `src/file${i}.ts`);
    const okLlm: LlmCall = async () => ({
      text: JSON.stringify({ ...validPlan, touch_paths: atCap }),
      usage: null,
    });
    const result = await runRefiner({ ticket, callLlm: okLlm, runLink: 'r' });
    expect(result.plan.touch_paths).toHaveLength(20);
  });

  it('reports cost 0 when usage missing', async () => {
    const noUsage: LlmCall = async () => ({ text: JSON.stringify(validPlan), usage: null });
    const result = await runRefiner({ ticket, callLlm: noUsage, runLink: 'r' });
    expect(result.auditSummary.costEur).toBe(0);
  });
});
