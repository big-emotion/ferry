import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FERRY_PR_LABELS, stepPrLabels } from './pr-labels.js';

describe('FERRY_PR_LABELS', () => {
  it('covers every label the bundled agent prompts drive', () => {
    expect(FERRY_PR_LABELS.map((l) => l.name)).toEqual([
      'ready-for-review',
      'needs-rereview',
      'approved',
      'changes-requested',
      'ci-green',
      'ci-failing',
    ]);
  });

  it('gives every label a colour and a description', () => {
    for (const label of FERRY_PR_LABELS) {
      expect(label.color).toMatch(/^[0-9a-f]{6}$/);
      expect(label.description.length).toBeGreaterThan(0);
    }
  });
});

describe('stepPrLabels', () => {
  let created: string[];
  let createLabel: (repo: string, name: string, color: string, description: string) => void;

  beforeEach(() => {
    created = [];
    createLabel = vi.fn((_repo, name) => {
      created.push(name);
    });
  });

  it('creates every missing label', async () => {
    const result = await stepPrLabels('acme/site', () => [], createLabel);
    expect(result.ok).toBe(true);
    expect(created).toEqual(FERRY_PR_LABELS.map((l) => l.name));
  });

  it('skips labels the repo already has, matching case-insensitively', async () => {
    const result = await stepPrLabels('acme/site', () => ['Approved', 'ci-green'], createLabel);
    expect(result.ok).toBe(true);
    expect(created).not.toContain('approved');
    expect(created).not.toContain('ci-green');
    expect(created).toContain('ci-failing');
  });

  it('reports failure without aborting the remaining labels', async () => {
    const failing = vi.fn((_repo: string, name: string) => {
      if (name === 'approved') throw new Error('403');
      created.push(name);
    });
    const result = await stepPrLabels('acme/site', () => [], failing);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('approved') });
    expect(created).toContain('ci-failing');
  });
});
