import { describe, it, expect } from 'vitest';
import { runRefiner, type LlmCall, type RefinerInput } from './refine.js';
import { FerryError } from '../../lib/errors/index.js';
import type { TrackerSubtask } from '../../lib/io/tracker/types.js';

const ticket: RefinerInput['ticket'] = {
  key: 'CHAN-27',
  title: 'Add login button',
  description: 'Users want a login button on the home page.',
  comments: ['comment 1', 'comment 2'],
  labels: ['feature'],
  attachments: ['mock.png'],
};

const validPlan = {
  actions: [
    {
      type: 'create' as const,
      title: 'Add LoginButton component',
      description: 'New file src/components/LoginButton.tsx',
    },
    {
      type: 'create' as const,
      title: 'Wire LoginButton on Home',
      description: 'Edit src/pages/Home.tsx',
    },
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

describe('runRefiner happy path', () => {
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

  it('subtaskCount counts only create actions', async () => {
    const mixedPlan = {
      actions: [
        { type: 'create' as const, title: 'New task', description: 'desc' },
        { type: 'keep' as const, existing_key: 'PROJ-1', reason: 'still valid' },
        { type: 'noop' as const, reason: 'nothing else needed' },
      ],
      touch_paths: [],
      output_locale: 'en' as const,
      audit_summary: 'mixed plan',
    };
    const llm: LlmCall = async () => ({ text: JSON.stringify(mixedPlan), usage: null });
    const result = await runRefiner({ ticket, callLlm: llm, runLink: 'r' });
    expect(result.auditSummary.subtaskCount).toBe(1);
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
    expect(captured).toContain('actions');
    expect(captured).toContain('audit_summary');
  });

  it('prompt includes EXISTING_SUBTASKS when provided', async () => {
    const existingSubtasks: TrackerSubtask[] = [
      { key: 'CHAN-28', title: 'Old task', description: 'old desc', status: 'To Do' },
    ];
    let captured = '';
    const captureLlm: LlmCall = async (prompt) => {
      captured = prompt;
      return { text: JSON.stringify(validPlan), usage: null };
    };
    await runRefiner({ ticket, existingSubtasks, callLlm: captureLlm, runLink: 'r' });
    expect(captured).toContain('EXISTING_SUBTASKS');
    expect(captured).toContain('CHAN-28');
    expect(captured).toContain('Old task');
  });

  it('prompt includes PRIOR_REFINER_RUNS when provided', async () => {
    let captured = '';
    const captureLlm: LlmCall = async (prompt) => {
      captured = prompt;
      return { text: JSON.stringify(validPlan), usage: null };
    };
    await runRefiner({
      ticket,
      priorRefinerRuns: ['[ferry:refiner:evt-001] Refined. Created 2 sub-task(s).'],
      callLlm: captureLlm,
      runLink: 'r',
    });
    expect(captured).toContain('PRIOR_REFINER_RUNS');
    expect(captured).toContain('ferry:refiner:evt-001');
  });

  it('noop action parses correctly', async () => {
    const noopPlan = {
      actions: [{ type: 'noop' as const, reason: 'unchanged' }],
      touch_paths: [],
      output_locale: 'en' as const,
      audit_summary: 'nothing to do',
    };
    const llm: LlmCall = async () => ({ text: JSON.stringify(noopPlan), usage: null });
    const result = await runRefiner({ ticket, callLlm: llm, runLink: 'r' });
    expect(result.plan.actions[0].type).toBe('noop');
    expect(result.auditSummary.subtaskCount).toBe(0);
  });
});

describe('runRefiner markdown fence stripping (regression guard)', () => {
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

describe('runRefiner prose preamble / trailing prose (D9)', () => {
  it('parses JSON preceded by prose preamble', async () => {
    const preambleLlm: LlmCall = async () => ({
      text: 'Here is the plan:\n\n' + JSON.stringify(validPlan),
      usage: null,
    });
    const result = await runRefiner({ ticket, callLlm: preambleLlm, runLink: 'r' });
    expect(result.plan).toEqual(validPlan);
  });

  it('parses JSON followed by trailing prose', async () => {
    const trailingLlm: LlmCall = async () => ({
      text: JSON.stringify(validPlan) + '\n\nLet me know if you need changes.',
      usage: null,
    });
    const result = await runRefiner({ ticket, callLlm: trailingLlm, runLink: 'r' });
    expect(result.plan).toEqual(validPlan);
  });

  it('throws state-invariant when LLM returns only prose with no JSON object', async () => {
    const proseLlm: LlmCall = async () => ({
      text: 'I cannot help with that request.',
      usage: null,
    });
    await expect(runRefiner({ ticket, callLlm: proseLlm, runLink: 'r' })).rejects.toBeInstanceOf(
      FerryError,
    );
  });
});

describe('runRefiner error paths', () => {
  it('throws state-invariant on malformed JSON', async () => {
    const badLlm: LlmCall = async () => ({ text: 'not json', usage: null });
    await expect(runRefiner({ ticket, callLlm: badLlm, runLink: 'r' })).rejects.toBeInstanceOf(
      FerryError,
    );
  });

  it('includes a sample of the raw LLM text on JSON parse failure', async () => {
    const raw = 'Here is the plan: { "actions": [ ... }';
    const badLlm: LlmCall = async () => ({ text: raw, usage: null });
    try {
      await runRefiner({ ticket, callLlm: badLlm, runLink: 'r' });
      throw new Error('expected runRefiner to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FerryError);
      const ctx = (err as FerryError).context;
      expect(ctx?.reason).toBe('refiner-output-invalid');
      expect(ctx?.stage).toBe('parse');
      expect(ctx?.sample).toBe(raw);
      expect(ctx?.text_length).toBe(raw.length);
    }
  });

  it('throws state-invariant on schema violation', async () => {
    const reallyBad: LlmCall = async () => ({
      text: JSON.stringify({ ...validPlan, output_locale: 'es' }),
      usage: null,
    });
    await expect(runRefiner({ ticket, callLlm: reallyBad, runLink: 'r' })).rejects.toBeInstanceOf(
      FerryError,
    );
  });

  it('includes a sample and error paths on schema violation', async () => {
    const raw = JSON.stringify({ ...validPlan, output_locale: 'es' });
    const badLlm: LlmCall = async () => ({ text: raw, usage: null });
    try {
      await runRefiner({ ticket, callLlm: badLlm, runLink: 'r' });
      throw new Error('expected runRefiner to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FerryError);
      const ctx = (err as FerryError).context;
      expect(ctx?.reason).toBe('refiner-output-invalid');
      expect(ctx?.stage).toBe('schema');
      expect(Array.isArray(ctx?.paths)).toBe(true);
    }
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
