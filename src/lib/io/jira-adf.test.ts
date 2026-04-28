import { describe, it, expect } from 'vitest';
import { textToAdf, adfToText } from './jira-adf.js';

describe('textToAdf', () => {
  it('produces a single-paragraph doc for plain text', () => {
    const doc = textToAdf('hello world');
    expect(doc.version).toBe(1);
    expect(doc.type).toBe('doc');
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe('paragraph');
    expect(doc.content[0].content).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('splits on double newline into multiple paragraphs', () => {
    const doc = textToAdf('first paragraph\n\nsecond paragraph');
    expect(doc.content).toHaveLength(2);
    expect(doc.content[0].content[0]).toEqual({ type: 'text', text: 'first paragraph' });
    expect(doc.content[1].content[0]).toEqual({ type: 'text', text: 'second paragraph' });
  });

  it('inserts hardBreak nodes for inline newlines within a paragraph', () => {
    const doc = textToAdf('line one\nline two');
    expect(doc.content).toHaveLength(1);
    const para = doc.content[0];
    expect(para.content).toEqual([
      { type: 'text', text: 'line one' },
      { type: 'hardBreak' },
      { type: 'text', text: 'line two' },
    ]);
  });

  it('handles multi-paragraph with inline breaks', () => {
    const doc = textToAdf('a\nb\n\nc\nd');
    expect(doc.content).toHaveLength(2);
    expect(doc.content[0].content).toEqual([
      { type: 'text', text: 'a' },
      { type: 'hardBreak' },
      { type: 'text', text: 'b' },
    ]);
    expect(doc.content[1].content).toEqual([
      { type: 'text', text: 'c' },
      { type: 'hardBreak' },
      { type: 'text', text: 'd' },
    ]);
  });

  it('returns a minimal doc for empty string', () => {
    const doc = textToAdf('');
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].content[0]).toEqual({ type: 'text', text: '' });
  });

  it('preserves ferry idempotency markers as text', () => {
    const marker = '[ferry:refiner:run-abc] some body text';
    const doc = textToAdf(marker);
    expect(doc.content[0].content[0]).toEqual({ type: 'text', text: marker });
  });
});

describe('adfToText', () => {
  it('extracts text from a single-paragraph doc', () => {
    const doc = textToAdf('hello world');
    expect(adfToText(doc)).toBe('hello world');
  });

  it('joins paragraphs with double newline', () => {
    const doc = textToAdf('first\n\nsecond');
    expect(adfToText(doc)).toBe('first\n\nsecond');
  });

  it('converts hardBreak nodes back to newline characters', () => {
    const doc = textToAdf('line one\nline two');
    expect(adfToText(doc)).toBe('line one\nline two');
  });

  it('returns empty string for null input', () => {
    expect(adfToText(null)).toBe('');
  });

  it('returns empty string for undefined input', () => {
    expect(adfToText(undefined)).toBe('');
  });

  it('round-trips text through ADF without loss', () => {
    const original = 'Ferry comment\n\nSecond paragraph\nwith inline break';
    expect(adfToText(textToAdf(original))).toBe(original);
  });

  it('extracts ferry marker text for idempotency checks', () => {
    const doc = textToAdf('[ferry:developer:run-1] PR looks good');
    expect(adfToText(doc)).toContain('[ferry:developer:run-1]');
  });
});
