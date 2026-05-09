import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendOutput } from './output.js';

describe('appendOutput', () => {
  let tmpDir: string;
  let outputFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-output-test-'));
    outputFile = join(tmpDir, 'github-output');
    process.env.GITHUB_OUTPUT = outputFile;
  });

  afterEach(() => {
    delete process.env.GITHUB_OUTPUT;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes non-zero cost_eur for a known Anthropic model', () => {
    appendOutput({
      input_tokens: 1000,
      output_tokens: 500,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
    const content = readFileSync(outputFile, 'utf8');
    expect(content).toContain('input_tokens=1000');
    expect(content).toContain('output_tokens=500');
    const match = content.match(/cost_eur=([0-9.]+)/);
    expect(match).toBeTruthy();
    expect(parseFloat(match![1])).toBeGreaterThan(0);
  });

  it('writes cache_read_tokens and cache_write_tokens', () => {
    appendOutput({
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 100,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
    const content = readFileSync(outputFile, 'utf8');
    expect(content).toContain('cache_read_tokens=200');
    expect(content).toContain('cache_write_tokens=100');
  });

  it('writes cost_eur=0 when model is "placeholder"', () => {
    appendOutput({
      input_tokens: 1000,
      output_tokens: 500,
      provider: 'anthropic',
      model: 'placeholder',
    });
    const content = readFileSync(outputFile, 'utf8');
    expect(content).toContain('cost_eur=0');
  });

  it('writes cost_eur=0 when no provider/model supplied', () => {
    appendOutput({ input_tokens: 1000, output_tokens: 500 });
    const content = readFileSync(outputFile, 'utf8');
    expect(content).toContain('cost_eur=0');
  });

  it('writes zero cache tokens on early-exit calls', () => {
    appendOutput({
      input_tokens: 0,
      output_tokens: 0,
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
    });
    const content = readFileSync(outputFile, 'utf8');
    expect(content).toContain('cache_read_tokens=0');
    expect(content).toContain('cache_write_tokens=0');
    expect(content).toContain('cost_eur=0');
  });

  it('does not throw when GITHUB_OUTPUT is unset', () => {
    delete process.env.GITHUB_OUTPUT;
    expect(() => appendOutput({ input_tokens: 100, output_tokens: 50 })).not.toThrow();
  });
});
