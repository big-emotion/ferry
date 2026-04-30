/**
 * Story 4-1: Developer agent context builder.
 */

import { FerryError } from '../../lib/errors/index.js';
import { delimitUntrusted } from '../../lib/llm/delimit-untrusted.js';

export const MAX_TOUCH_PATHS = 20;
export const MAX_CONTEXT_BYTES = 200_000;

export interface BuildContextInput {
  ticket: {
    key: string;
    title: string;
    description: string;
  };
  touchPaths: string[];
  readFile: (path: string) => Promise<string>;
  maxBytes?: number;
}

export async function buildContext(input: BuildContextInput): Promise<string> {
  if (!input.touchPaths || input.touchPaths.length === 0) {
    throw new FerryError('state-invariant', { reason: 'missing-touch-paths' });
  }
  if (input.touchPaths.length > MAX_TOUCH_PATHS) {
    throw new FerryError('state-invariant', {
      reason: 'too-many-touch-paths',
      count: input.touchPaths.length,
      cap: MAX_TOUCH_PATHS,
    });
  }
  const cap = input.maxBytes ?? MAX_CONTEXT_BYTES;

  const fileBlocks: string[] = [];
  let total = 0;
  for (const path of input.touchPaths) {
    const content = await input.readFile(path);
    total += Buffer.byteLength(content, 'utf-8');
    if (total > cap) {
      throw new FerryError('state-invariant', {
        reason: 'context-too-large',
        bytes: total,
        cap,
      });
    }
    fileBlocks.push(`<file path="${path}">\n${content}\n</file>`);
  }

  const ticketBlock = delimitUntrusted(
    `TICKET ${input.ticket.key}\nTITLE: ${input.ticket.title}\nDESCRIPTION:\n${input.ticket.description}`,
  );

  return `${ticketBlock}\n\n${fileBlocks.join('\n\n')}`;
}
