import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateLocalOverrides,
  loadLocalOverrides,
  applyLocalOverrides,
} from './local-overrides.js';
import { workflowTemplates } from '../init/templates.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ferry-local-overrides-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ── validateLocalOverrides ────────────────────────────────────────────────────

describe('validateLocalOverrides', () => {
  it('accepts null/undefined as empty overrides', () => {
    expect(validateLocalOverrides(null)).toEqual({ valid: true, value: {} });
    expect(validateLocalOverrides(undefined)).toEqual({ valid: true, value: {} });
  });

  it('accepts an empty object', () => {
    expect(validateLocalOverrides({})).toEqual({ valid: true, value: {} });
  });

  it('accepts version: 1', () => {
    const r = validateLocalOverrides({ version: 1 });
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.value.version).toBe(1);
  });

  it('rejects unknown version', () => {
    const r = validateLocalOverrides({ version: 2 });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0]).toMatch(/version/);
  });

  it('accepts review.ciGate: disabled', () => {
    const r = validateLocalOverrides({ review: { ciGate: 'disabled' } });
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.value.review?.ciGate).toBe('disabled');
  });

  it('rejects unknown review.ciGate value', () => {
    const r = validateLocalOverrides({ review: { ciGate: 'partial' } });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0]).toMatch(/review\.ciGate/);
  });

  it('accepts global.runner as string', () => {
    const r = validateLocalOverrides({ global: { runner: 'ubuntu-latest' } });
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.value.global?.runner).toBe('ubuntu-latest');
  });

  it('accepts global.runner as string array', () => {
    const r = validateLocalOverrides({ global: { runner: ['self-hosted', 'X64'] } });
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.value.global?.runner).toEqual(['self-hosted', 'X64']);
  });

  it('rejects empty string runner', () => {
    const r = validateLocalOverrides({ global: { runner: '' } });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0]).toMatch(/global\.runner/);
  });

  it('rejects empty array runner', () => {
    const r = validateLocalOverrides({ global: { runner: [] } });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0]).toMatch(/global\.runner/);
  });

  it('rejects runner as a number', () => {
    const r = validateLocalOverrides({ global: { runner: 42 } });
    expect(r.valid).toBe(false);
  });

  it('rejects array with non-string element', () => {
    const r = validateLocalOverrides({ global: { runner: ['self-hosted', 42] } });
    expect(r.valid).toBe(false);
  });

  it('collects multiple errors', () => {
    const r = validateLocalOverrides({
      version: 99,
      review: { ciGate: 'partial' },
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.length).toBeGreaterThan(1);
  });
});

// ── loadLocalOverrides ────────────────────────────────────────────────────────

describe('loadLocalOverrides', () => {
  it('returns null when file does not exist', () => {
    const dir = makeTempDir();
    expect(loadLocalOverrides(dir)).toBeNull();
    cleanup(dir);
  });

  it('parses a valid ferry.local.yml', () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, 'ferry.local.yml'),
      `version: 1\nreview:\n  ciGate: disabled\n`,
      'utf8',
    );
    const result = loadLocalOverrides(dir);
    expect(result?.review?.ciGate).toBe('disabled');
    cleanup(dir);
  });

  it('parses global.runner as array', () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, 'ferry.local.yml'),
      `version: 1\nglobal:\n  runner:\n    - self-hosted\n    - X64\n`,
      'utf8',
    );
    const result = loadLocalOverrides(dir);
    expect(result?.global?.runner).toEqual(['self-hosted', 'X64']);
    cleanup(dir);
  });

  it('throws on malformed YAML', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'ferry.local.yml'), '{{invalid: yaml: [', 'utf8');
    expect(() => loadLocalOverrides(dir)).toThrow(/ferry\.local\.yml/);
    cleanup(dir);
  });

  it('throws on invalid schema', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'ferry.local.yml'), 'review:\n  ciGate: unknown\n', 'utf8');
    expect(() => loadLocalOverrides(dir)).toThrow(/ferry\.local\.yml/);
    cleanup(dir);
  });
});

// ── applyLocalOverrides ───────────────────────────────────────────────────────

describe('applyLocalOverrides — review.ciGate: disabled', () => {
  const templates = workflowTemplates('vTEST');
  const reviewTmpl = templates.find((t) => t.filename === 'ferry-review.yml')!;

  it('removes the ci-gate job from ferry-review.yml', () => {
    const result = applyLocalOverrides(templates, { review: { ciGate: 'disabled' } });
    const review = result.find((t) => t.filename === 'ferry-review.yml')!;
    expect(review.content).not.toContain('ci-gate:');
    expect(review.content).not.toContain('ferry-ci-gate@');
  });

  it('removes ci-gate from run-agent-claude-code needs', () => {
    const result = applyLocalOverrides(templates, { review: { ciGate: 'disabled' } });
    const review = result.find((t) => t.filename === 'ferry-review.yml')!;
    expect(review.content).not.toContain('needs: [route, ci-gate]');
    expect(review.content).toContain('    needs: [route]\n');
  });

  it('removes ci-gate proceed guard from run-agent-claude-code if', () => {
    const result = applyLocalOverrides(templates, { review: { ciGate: 'disabled' } });
    const review = result.find((t) => t.filename === 'ferry-review.yml')!;
    expect(review.content).not.toContain("ci-gate.outputs.proceed == 'true'");
    expect(review.content).toContain("    if: needs.route.outputs.path == 'claude-code'\n");
    expect(review.content).toContain("    if: needs.route.outputs.path == 'codex-cli'\n");
  });

  it('removes ci-gate from emit-audit needs', () => {
    const result = applyLocalOverrides(templates, { review: { ciGate: 'disabled' } });
    const review = result.find((t) => t.filename === 'ferry-review.yml')!;
    expect(review.content).not.toContain(
      'needs: [run-agent, run-agent-claude-code, run-agent-codex-cli, ci-gate]',
    );
    expect(review.content).toContain(
      '    needs: [run-agent, run-agent-claude-code, run-agent-codex-cli]\n',
    );
  });

  it('simplifies emit-audit if expression', () => {
    const result = applyLocalOverrides(templates, { review: { ciGate: 'disabled' } });
    const review = result.find((t) => t.filename === 'ferry-review.yml')!;
    expect(review.content).not.toContain("needs.ci-gate.result != 'skipped'");
    expect(review.content).toContain(
      "    if: always() && (needs.run-agent.result != 'skipped' || needs.run-agent-claude-code.result != 'skipped' || needs.run-agent-codex-cli.result != 'skipped')\n",
    );
  });

  it('removes ci-gate references from emit-audit outcome', () => {
    const result = applyLocalOverrides(templates, { review: { ciGate: 'disabled' } });
    const review = result.find((t) => t.filename === 'ferry-review.yml')!;
    expect(review.content).not.toContain('ci-gate.outputs.outcome');
    expect(review.content).toContain(
      "          outcome: ${{ (needs.run-agent.result != 'skipped' && needs.run-agent.result) || (needs.run-agent-claude-code.result != 'skipped' && needs.run-agent-claude-code.result) || needs.run-agent-codex-cli.result }}\n",
    );
  });

  it('does not modify non-review templates', () => {
    const result = applyLocalOverrides(templates, { review: { ciGate: 'disabled' } });
    for (const tmpl of result) {
      if (tmpl.filename === 'ferry-review.yml') continue;
      const original = templates.find((t) => t.filename === tmpl.filename)!;
      expect(tmpl.content).toBe(original.content);
    }
  });

  it('produces valid YAML structure (jobs: block is intact)', () => {
    const result = applyLocalOverrides(templates, { review: { ciGate: 'disabled' } });
    const review = result.find((t) => t.filename === 'ferry-review.yml')!;
    // Essential jobs should still be present
    expect(review.content).toContain('\n  gate-envelope:\n');
    expect(review.content).toContain('\n  route:\n');
    expect(review.content).toContain('\n  run-agent:\n');
    expect(review.content).toContain('\n  run-agent-claude-code:\n');
    expect(review.content).toContain('\n  run-agent-codex-cli:\n');
    expect(review.content).toContain('\n  emit-audit:\n');
  });

  it('is idempotent — applying twice gives the same result', () => {
    const once = applyLocalOverrides(templates, { review: { ciGate: 'disabled' } });
    const twice = applyLocalOverrides(once, { review: { ciGate: 'disabled' } });
    const review1 = once.find((t) => t.filename === 'ferry-review.yml')!;
    const review2 = twice.find((t) => t.filename === 'ferry-review.yml')!;
    expect(review2.content).toBe(review1.content);
  });

  it('original template still contains ci-gate (sanity check)', () => {
    expect(reviewTmpl.content).toContain('\n  ci-gate:\n');
    expect(reviewTmpl.content).toContain('    needs: [route, ci-gate]\n');
  });
});

describe('applyLocalOverrides — global.runner', () => {
  const templates = workflowTemplates('vTEST');

  it('replaces runner expression with a plain string in all templates', () => {
    const result = applyLocalOverrides(templates, { global: { runner: 'my-runner' } });
    for (const tmpl of result) {
      expect(tmpl.content).not.toContain(
        `\${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}`,
      );
      expect(tmpl.content).toContain('    runs-on: my-runner\n');
    }
  });

  it('replaces runner expression with fromJSON array syntax', () => {
    const result = applyLocalOverrides(templates, {
      global: { runner: ['self-hosted', 'X64'] },
    });
    for (const tmpl of result) {
      expect(tmpl.content).not.toContain(
        `\${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}`,
      );
      expect(tmpl.content).toContain(`    runs-on: \${{ fromJSON('["self-hosted","X64"]') }}\n`);
    }
  });

  it('applies runner to all four workflow templates', () => {
    const result = applyLocalOverrides(templates, { global: { runner: 'fast-runner' } });
    expect(result).toHaveLength(templates.length);
    for (const tmpl of result) {
      const original = templates.find((t) => t.filename === tmpl.filename)!;
      expect(tmpl.content).not.toBe(original.content);
      expect(tmpl.content).toContain('    runs-on: fast-runner\n');
    }
  });
});

describe('applyLocalOverrides — combined overrides', () => {
  const templates = workflowTemplates('vTEST');

  it('applies both ciGate:disabled and global.runner together', () => {
    const result = applyLocalOverrides(templates, {
      review: { ciGate: 'disabled' },
      global: { runner: 'my-runner' },
    });
    const review = result.find((t) => t.filename === 'ferry-review.yml')!;
    // ci-gate removed
    expect(review.content).not.toContain('ci-gate:');
    // runner replaced
    expect(review.content).not.toContain('fromJSON(vars.FERRY_RUNNER');
    expect(review.content).toContain('    runs-on: my-runner\n');
  });
});
