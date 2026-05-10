import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { run } from './refiner-action.js';
import { InMemoryTracker } from '../../lib/io/tracker/in-memory.js';
import type { LlmCall } from './refine.js';
import type { EventEnvelopeV1 } from '../../lib/envelope/types.js';

// Mock the cost-estimate module so we can control baseline presence
vi.mock('./cost-estimate.js', () => ({
  loadCostBaseline: vi.fn(),
  estimateTicketCost: vi.fn(),
}));

import { loadCostBaseline, estimateTicketCost } from './cost-estimate.js';
import type { CostBaseline } from '../../cli/cost/stats.js';

const envelope: EventEnvelopeV1 = {
  version: 'v1',
  event_id: 'evt-cost-001',
  ticket_key: 'PROJ-99',
  phase: 'refine',
  source: 'jira-column',
  ts: '2026-01-01T00:00:00Z',
};

const createPlan = {
  actions: [{ type: 'create' as const, title: 'Task A', description: 'Do A' }],
  touch_paths: ['src/foo.ts'],
  output_locale: 'en' as const,
  audit_summary: 'One task planned',
};

function makeMockLlm(plan: unknown = createPlan): LlmCall {
  return vi.fn<LlmCall>().mockResolvedValue({
    text: JSON.stringify(plan),
    usage: { inputTokens: 100, outputTokens: 50, costEur: 0.01 },
  });
}

function makeTracker(): InMemoryTracker {
  const tracker = new InMemoryTracker();
  tracker.seed({
    key: 'PROJ-99',
    summary: 'Implement something',
    description: 'Description',
    comments: [],
    labels: [],
    issueType: 'Story',
    issueTypeRaw: 'Story',
  });
  return tracker;
}

const mockBaseline: CostBaseline = {
  repo: 'org/repo',
  generatedAt: '2026-05-01T00:00:00Z',
  windowRuns: 20,
  byPhase: [
    { phase: 'refiner', runs: 10, medianUsd: 0.05, p90Usd: 0.1, medianInputTokens: 1000 },
    { phase: 'developer', runs: 10, medianUsd: 0.5, p90Usd: 1.0, medianInputTokens: 10000 },
  ],
};

const mockEstimate = {
  loUsd: 0.55,
  hiUsd: 1.4,
  confidence: 'medium' as const,
  baselineRuns: 20,
};

describe('refiner-action cost estimation', () => {
  const mockedLoad = vi.mocked(loadCostBaseline);
  const mockedEstimate = vi.mocked(estimateTicketCost);

  beforeEach(() => {
    delete process.env.FERRY_DRY_RUN;
    delete process.env.COST_TICKET_MAX_USD;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.FERRY_DRY_RUN;
    delete process.env.COST_TICKET_MAX_USD;
  });

  describe('cold-start (no cost-baseline.json)', () => {
    it('skips estimation entirely — no estimate comment or label posted', async () => {
      mockedLoad.mockReturnValue(null);

      const tracker = makeTracker();
      await run(envelope, { tracker, callLlm: makeMockLlm() });

      const estimateComment = tracker.postedComments.find((c) =>
        c.body.includes('ferry:refiner-estimate'),
      );
      expect(estimateComment).toBeUndefined();
      expect(tracker.addedLabels).toHaveLength(0);
      expect(mockedEstimate).not.toHaveBeenCalled();
    });

    it('still creates subtasks normally', async () => {
      mockedLoad.mockReturnValue(null);

      const tracker = makeTracker();
      await run(envelope, { tracker, callLlm: makeMockLlm() });

      expect(tracker.createdSubtasks).toHaveLength(1);
    });
  });

  describe('warm baseline (baseline exists, estimate below cap)', () => {
    beforeEach(() => {
      mockedLoad.mockReturnValue(mockBaseline);
      mockedEstimate.mockReturnValue(mockEstimate);
    });

    it('posts estimate comment with correct fingerprint and values', async () => {
      const tracker = makeTracker();
      await run(envelope, { tracker, callLlm: makeMockLlm() });

      const estimateComment = tracker.postedComments.find((c) =>
        c.body.includes('ferry:refiner-estimate:evt-cost-001'),
      );
      expect(estimateComment).toBeDefined();
      expect(estimateComment!.body).toContain('$0.55');
      expect(estimateComment!.body).toContain('$1.40');
      expect(estimateComment!.body).toContain('medium');
      expect(estimateComment!.body).toContain('20 runs');
    });

    it('applies cost-estimate label with lo-hi values', async () => {
      const tracker = makeTracker();
      await run(envelope, { tracker, callLlm: makeMockLlm() });

      const label = tracker.addedLabels.find((l) => l.label.startsWith('ferry:cost-estimate:'));
      expect(label).toBeDefined();
      expect(label!.label).toBe('ferry:cost-estimate:0.55-1.40');
    });

    it('still creates subtasks after posting estimate', async () => {
      const tracker = makeTracker();
      await run(envelope, { tracker, callLlm: makeMockLlm() });

      expect(tracker.createdSubtasks).toHaveLength(1);
    });
  });

  describe('COST_TICKET_MAX_USD cap enforcement', () => {
    it('posts cap-refusal comment and does NOT create subtasks when hi > cap', async () => {
      process.env.COST_TICKET_MAX_USD = '0.10';
      mockedLoad.mockReturnValue(mockBaseline);
      // estimate.hiUsd = 1.40 > cap 0.10
      mockedEstimate.mockReturnValue(mockEstimate);

      const tracker = makeTracker();
      await run(envelope, { tracker, callLlm: makeMockLlm() });

      const capComment = tracker.postedComments.find((c) =>
        c.body.includes('ferry:refiner-cap:evt-cost-001'),
      );
      expect(capComment).toBeDefined();
      expect(capComment!.body).toContain('$0.10');
      expect(capComment!.body).toContain('exceeds cap');

      // No subtasks should be created — we returned early
      expect(tracker.createdSubtasks).toHaveLength(0);

      // No estimate comment (cap fires before estimate is posted)
      const estimateComment = tracker.postedComments.find((c) =>
        c.body.includes('ferry:refiner-estimate'),
      );
      expect(estimateComment).toBeUndefined();
    });
  });

  describe('COST_TICKET_MAX_USD not set', () => {
    it('skips cap check even when baseline exists', async () => {
      // COST_TICKET_MAX_USD is not set
      mockedLoad.mockReturnValue(mockBaseline);
      mockedEstimate.mockReturnValue(mockEstimate);

      const tracker = makeTracker();
      await run(envelope, { tracker, callLlm: makeMockLlm() });

      const capComment = tracker.postedComments.find((c) => c.body.includes('ferry:refiner-cap'));
      expect(capComment).toBeUndefined();

      // Normal estimate and subtask creation should proceed
      const estimateComment = tracker.postedComments.find((c) =>
        c.body.includes('ferry:refiner-estimate'),
      );
      expect(estimateComment).toBeDefined();
      expect(tracker.createdSubtasks).toHaveLength(1);
    });
  });
});
