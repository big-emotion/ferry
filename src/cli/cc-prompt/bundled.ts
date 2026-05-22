import type { CcAgent } from '../../lib/prompts/cc-prompt.js';
import refiner from '../../../prompts/refiner.claude-code.md';
import dev from '../../../prompts/dev.claude-code.md';
import review from '../../../prompts/review.claude-code.md';
import iterate from '../../../prompts/iterate.claude-code.md';

/**
 * Ferry's default claude-code-path prompts. esbuild's `text` loader inlines the
 * four `prompts/*.claude-code.md` files into the bundle at build time — the npm
 * package ships only `dist/cli/`, so they cannot be read from disk at runtime.
 */
export const BUNDLED_CC_PROMPTS: Record<CcAgent, string> = { refiner, dev, review, iterate };
