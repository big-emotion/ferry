import type { MessageParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages.js';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compact tool_result content in user messages that are older than `windowTurns`
 * turns behind the latest tool-result message.
 *
 * A "turn" is one user message containing tool_result blocks. Tool-call
 * arguments in preceding assistant messages are left intact for traceability.
 *
 * Mutates `messages` in place.
 */
export function compactOldToolResults(messages: MessageParam[], windowTurns: number): void {
  const toolResultIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const content = msg.content as ToolResultBlockParam[];
      if (content.some((b) => b.type === 'tool_result')) {
        toolResultIndices.push(i);
      }
    }
  }

  if (toolResultIndices.length <= windowTurns) return;

  const compactCount = toolResultIndices.length - windowTurns;
  for (let k = 0; k < compactCount; k++) {
    const idx = toolResultIndices[k];
    const msg = messages[idx];
    const content = msg.content as ToolResultBlockParam[];
    for (let j = 0; j < content.length; j++) {
      const block = content[j];
      if (block.type !== 'tool_result') continue;
      if (typeof block.content !== 'string') continue;
      if (block.content.startsWith('[compacted')) continue;
      const tokens = estimateTokens(block.content);
      content[j] = { ...block, content: `[compacted — ~${tokens} tokens elided]` };
    }
  }
}
