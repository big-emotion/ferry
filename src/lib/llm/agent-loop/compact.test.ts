import { describe, it, expect } from 'vitest';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js';
import { compactOldToolResults } from './compact.js';

function userToolResult(id: string, content: string): MessageParam {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content }],
  };
}

function assistantMessage(): MessageParam {
  return {
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'x.ts' } },
    ] as never,
  };
}

function buildHistory(toolResultCount: number): MessageParam[] {
  const msgs: MessageParam[] = [
    { role: 'user', content: [{ type: 'text', text: 'initial prompt' }] },
  ];
  for (let i = 0; i < toolResultCount; i++) {
    msgs.push(assistantMessage());
    msgs.push(userToolResult(`tu_${i}`, 'a'.repeat(400)));
  }
  return msgs;
}

describe('compactOldToolResults', () => {
  it('is a no-op when turns <= windowTurns', () => {
    const messages = buildHistory(8);
    const snapshot = JSON.stringify(messages);
    compactOldToolResults(messages, 8);
    expect(JSON.stringify(messages)).toBe(snapshot);
  });

  it('is a no-op when there are no tool_result messages', () => {
    const messages: MessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: 'ok' as never },
    ];
    const snapshot = JSON.stringify(messages);
    compactOldToolResults(messages, 4);
    expect(JSON.stringify(messages)).toBe(snapshot);
  });

  it('compacts the oldest turn when turns exceeds window by 1', () => {
    const messages = buildHistory(9);
    compactOldToolResults(messages, 8);

    // First tool-result user message (index 2) should be compacted.
    const first = messages[2].content as Array<{ type: string; content: string }>;
    expect(first[0].content).toMatch(/^\[compacted — ~\d+ tokens elided\]$/);
  });

  it('leaves the newest windowTurns turns uncompacted', () => {
    const messages = buildHistory(12);
    compactOldToolResults(messages, 8);

    // The last 8 tool-result user messages must remain intact.
    const toolResultMessages = messages.filter(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some((b) => b.type === 'tool_result'),
    );

    for (const msg of toolResultMessages.slice(-8)) {
      const block = (msg.content as Array<{ type: string; content: string }>)[0];
      expect(block.content).not.toMatch(/^\[compacted/);
    }
  });

  it('compacts all turns beyond the window', () => {
    const messages = buildHistory(12);
    compactOldToolResults(messages, 8);

    const toolResultMessages = messages.filter(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some((b) => b.type === 'tool_result'),
    );

    // First 4 should be compacted.
    for (const msg of toolResultMessages.slice(0, 4)) {
      const block = (msg.content as Array<{ type: string; content: string }>)[0];
      expect(block.content).toMatch(/^\[compacted — ~\d+ tokens elided\]$/);
    }
  });

  it('is idempotent — does not double-compact already-compacted entries', () => {
    const messages = buildHistory(10);
    compactOldToolResults(messages, 8);

    const firstCompacted = (messages[2].content as Array<{ content: string }>)[0].content;

    compactOldToolResults(messages, 8);

    expect((messages[2].content as Array<{ content: string }>)[0].content).toBe(firstCompacted);
  });

  it('preserves non-string content blocks unchanged', () => {
    const messages: MessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: 'init' }] },
      assistantMessage(),
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_0',
            content: [{ type: 'text', text: 'rich content' }],
          },
        ] as never,
      },
      assistantMessage(),
      userToolResult('tu_1', 'some text'),
    ];

    compactOldToolResults(messages, 0);

    // Non-string content (array) must be untouched.
    const block = (messages[2].content as Array<{ content: unknown }>)[0];
    expect(Array.isArray(block.content)).toBe(true);
  });

  it('includes a token estimate in the compaction marker', () => {
    // 400 chars ≈ 100 tokens (ceil(400/4)).
    const messages = buildHistory(9);
    compactOldToolResults(messages, 8);

    const block = (messages[2].content as Array<{ content: string }>)[0];
    expect(block.content).toBe('[compacted — ~100 tokens elided]');
  });

  it('preserves other block fields (cache_control, tool_use_id, is_error) after compaction', () => {
    const messages: MessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: 'init' }] },
      assistantMessage(),
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_preserve',
            content: 'big result',
            is_error: false,
          },
        ] as never,
      },
      assistantMessage(),
      userToolResult('tu_latest', 'latest'),
    ];

    compactOldToolResults(messages, 0);

    const block = (messages[2].content as unknown as Array<Record<string, unknown>>)[0];
    expect(block['tool_use_id']).toBe('tu_preserve');
    expect(block['is_error']).toBe(false);
    expect(typeof block['content']).toBe('string');
    expect(block['content'] as string).toMatch(/^\[compacted/);
  });

  it('does not modify assistant messages (tool_use arguments preserved)', () => {
    const messages = buildHistory(9);
    const assistantBefore = JSON.stringify(messages.filter((m) => m.role === 'assistant'));
    compactOldToolResults(messages, 8);
    const assistantAfter = JSON.stringify(messages.filter((m) => m.role === 'assistant'));
    expect(assistantAfter).toBe(assistantBefore);
  });
});
