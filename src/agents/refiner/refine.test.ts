import { describe, it, expect } from 'vitest';
import { runRefiner, type LlmCall, type RefinerInput } from './refine.js';
import { FerryError } from '../../lib/errors/index.js';

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

  it('prompt includes all required schema fields so LLM knows what to output', async () => {
    let captured = '';
    const captureLlm: LlmCall = async (prompt) => {
      captured = prompt;
      return { text: JSON.stringify(validPlan), usage: null };
    };
    await runRefiner({ ticket, callLlm: captureLlm, runLink: 'r' });
    expect(captured).toContain('touch_paths');
    expect(captured).toContain('output_locale');
    expect(captured).toContain('subtasks');
    expect(captured).toContain('audit_summary');
  });
});

describe('runRefiner markdown fence stripping', () => {
  it('parses JSON wrapped in ```json fences', async () => {
    const fencedLlm: LlmCall = async () => ({
      text: '```json\n' + JSON.stringify(validPlan) + '\n```',
      usage: null,
    });
    const result = await runRefiner({ ticket, callLlm: fencedLlm, runLink: 'r' });
    expect(result.plan).toEqual(validPlan);
  });

  it('parses JSON wrapped in plain ``` fences', async () => {
    const fencedLlm: LlmCall = async () => ({
      text: '```\n' + JSON.stringify(validPlan) + '\n```',
      usage: null,
    });
    const result = await runRefiner({ ticket, callLlm: fencedLlm, runLink: 'r' });
    expect(result.plan).toEqual(validPlan);
  });
});

describe('runRefiner error paths (Story 3-1)', () => {
  it('throws state-invariant on malformed JSON', async () => {
    const badLlm: LlmCall = async () => ({ text: 'not json', usage: null });
    await expect(runRefiner({ ticket, callLlm: badLlm, runLink: 'r' })).rejects.toBeInstanceOf(
      FerryError,
    );
  });

  it('throws state-invariant on schema violation', async () => {
    const badLlm: LlmCall = async () => ({
      text: JSON.stringify({ ...validPlan, subtasks: [] }),
      usage: null,
    });
    // empty subtasks is allowed by schema; force a real violation
    const reallyBad: LlmCall = async () => ({
      text: JSON.stringify({ ...validPlan, output_locale: 'es' }),
      usage: null,
    });
    void badLlm;
    await expect(runRefiner({ ticket, callLlm: reallyBad, runLink: 'r' })).rejects.toBeInstanceOf(
      FerryError,
    );
  });

  it('throws oscillation on touch_paths over the cap', async () => {
    const tooBig = Array.from({ length: 21 }, (_, i) => `src/file${i}.ts`);
    const overLlm: LlmCall = async () => ({
      text: JSON.stringify({ ...validPlan, touch_paths: tooBig }),
      usage: null,
    });
    await expect(runRefiner({ ticket, callLlm: overLlm, runLink: 'r' })).rejects.toThrow(
      /spec-too-broad/,
    );
  });

  it('reports cost 0 when usage missing', async () => {
    const noUsage: LlmCall = async () => ({ text: JSON.stringify(validPlan), usage: null });
    const result = await runRefiner({ ticket, callLlm: noUsage, runLink: 'r' });
    expect(result.auditSummary.costEur).toBe(0);
  });
});
