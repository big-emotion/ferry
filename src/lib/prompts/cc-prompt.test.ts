import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resolveActionPrompt,
  resolveCcPrompt,
  substituteTokens,
  CC_PROMPT_TOKENS,
  CC_AGENTS,
} from './cc-prompt.js';

const REPO_ROOT = '/workspace/repo';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveCcPrompt', () => {
  it('returns the bundled default when no consumer override exists', () => {
    const result = resolveCcPrompt('dev', REPO_ROOT, 'BUNDLED', () => false);
    expect(result).toEqual({ source: 'bundled', text: 'BUNDLED' });
  });

  it('returns the consumer override when prompts/<agent>.claude-code.md exists', () => {
    const check = (p: string) => p === '/workspace/repo/prompts/dev.claude-code.md';
    const read = vi.fn(() => 'OVERRIDE');
    const result = resolveCcPrompt('dev', REPO_ROOT, 'BUNDLED', check, read);
    expect(result).toEqual({ source: 'override', text: 'OVERRIDE' });
    expect(read).toHaveBeenCalledWith('/workspace/repo/prompts/dev.claude-code.md', 'utf8');
  });

  it('returns a codex-cli consumer override when prompts/<agent>.codex-cli.md exists', () => {
    const check = (p: string) => p === '/workspace/repo/prompts/dev.codex-cli.md';
    const read = vi.fn(() => 'CODEX');
    const result = resolveActionPrompt('codex-cli', 'dev', REPO_ROOT, 'BUNDLED', check, read);
    expect(result).toEqual({ source: 'override', text: 'CODEX' });
    expect(read).toHaveBeenCalledWith('/workspace/repo/prompts/dev.codex-cli.md', 'utf8');
  });

  it('honours FERRY_PROMPTS_DIR as the override directory', () => {
    vi.stubEnv('FERRY_PROMPTS_DIR', '/custom/prompts');
    const check = (p: string) => p === '/custom/prompts/review.claude-code.md';
    const read = vi.fn(() => 'CUSTOM');
    const result = resolveCcPrompt('review', REPO_ROOT, 'BUNDLED', check, read);
    expect(result).toEqual({ source: 'override', text: 'CUSTOM' });
  });

  it('falls back to the bundled default when the FERRY_PROMPTS_DIR file is absent', () => {
    vi.stubEnv('FERRY_PROMPTS_DIR', '/custom/prompts');
    const result = resolveCcPrompt('refiner', REPO_ROOT, 'BUNDLED', () => false);
    expect(result.source).toBe('bundled');
  });

  it('resolves each agent independently', () => {
    const check = (p: string) => p === '/workspace/repo/prompts/iterate.claude-code.md';
    expect(resolveCcPrompt('dev', REPO_ROOT, 'B', check).source).toBe('bundled');
    expect(resolveCcPrompt('iterate', REPO_ROOT, 'B', check, () => 'I').source).toBe('override');
  });
});

describe('substituteTokens', () => {
  it('substitutes the run id inside an audit fingerprint line', () => {
    expect(substituteTokens('[ferry:refiner:RUN_ID]', { RUN_ID: 'run-9' })).toBe(
      '[ferry:refiner:run-9]',
    );
  });

  it('substitutes the ticket key inside a branch name', () => {
    expect(substituteTokens('work on `ferry/TICKET_KEY`', { TICKET_KEY: 'ABC-1' })).toBe(
      'work on `ferry/ABC-1`',
    );
  });

  it('substitutes every occurrence', () => {
    expect(substituteTokens('TICKET_KEY ... TICKET_KEY', { TICKET_KEY: 'X-1' })).toBe(
      'X-1 ... X-1',
    );
  });

  it('substitutes an empty string for a disabled transition', () => {
    expect(substituteTokens('id: `APPROVE_TRANSITION_ID`', { APPROVE_TRANSITION_ID: '' })).toBe(
      'id: ``',
    );
  });

  it('does not re-scan a substituted value (single pass)', () => {
    // TICKET_KEY resolves to the literal text "RUN_ID" — it must stay literal.
    const out = substituteTokens('TICKET_KEY RUN_ID', { TICKET_KEY: 'RUN_ID', RUN_ID: 'real' });
    expect(out).toBe('RUN_ID real');
  });

  it('does not substitute a token that is a substring of a longer word', () => {
    expect(substituteTokens('MY_RUN_IDENTIFIER', { RUN_ID: 'x' })).toBe('MY_RUN_IDENTIFIER');
  });

  it('leaves unrelated text untouched', () => {
    expect(substituteTokens('no tokens here', { TICKET_KEY: 'X' })).toBe('no tokens here');
  });

  it('returns the text unchanged when no values are given', () => {
    expect(substituteTokens('TICKET_KEY', {})).toBe('TICKET_KEY');
  });
});

describe('CC_PROMPT_TOKENS', () => {
  it('covers every agent', () => {
    for (const agent of CC_AGENTS) {
      expect(CC_PROMPT_TOKENS[agent]).toContain('TICKET_KEY');
      expect(CC_PROMPT_TOKENS[agent]).toContain('RUN_ID');
    }
  });

  it('declares the reviewer-specific transition tokens', () => {
    expect(CC_PROMPT_TOKENS.review).toContain('APPROVE_TRANSITION_ID');
    expect(CC_PROMPT_TOKENS.review).toContain('CHANGES_TRANSITION_ID');
  });

  it('declares the review transition token for dev and iterate', () => {
    expect(CC_PROMPT_TOKENS.dev).toContain('REVIEW_TRANSITION_ID');
    expect(CC_PROMPT_TOKENS.iterate).toContain('REVIEW_TRANSITION_ID');
  });
});

describe('bundled prompt ↔ CC_PROMPT_TOKENS coupling', () => {
  const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../prompts');

  it.each([...CC_AGENTS])('prompts/%s.claude-code.md contains all required tokens', (agent) => {
    const text = readFileSync(path.join(PROMPTS_DIR, `${agent}.claude-code.md`), 'utf8');
    for (const token of CC_PROMPT_TOKENS[agent]) {
      expect(text, `${agent}.claude-code.md is missing token "${token}"`).toContain(token);
    }
  });

  it.each([...CC_AGENTS])('prompts/%s.codex-cli.md contains all required tokens', (agent) => {
    const text = readFileSync(path.join(PROMPTS_DIR, `${agent}.codex-cli.md`), 'utf8');
    for (const token of CC_PROMPT_TOKENS[agent]) {
      expect(text, `${agent}.codex-cli.md is missing token "${token}"`).toContain(token);
    }
  });
});
