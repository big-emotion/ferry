import type { CcAgent, DirectActionPromptPath } from '../../lib/prompts/cc-prompt.js';
import refinerClaude from '../../../prompts/refiner.claude-code.md';
import devClaude from '../../../prompts/dev.claude-code.md';
import reviewClaude from '../../../prompts/review.claude-code.md';
import iterateClaude from '../../../prompts/iterate.claude-code.md';
import mergeClaude from '../../../prompts/merge.claude-code.md';
import refinerCodex from '../../../prompts/refiner.codex-cli.md';
import devCodex from '../../../prompts/dev.codex-cli.md';
import reviewCodex from '../../../prompts/review.codex-cli.md';
import iterateCodex from '../../../prompts/iterate.codex-cli.md';
import mergeCodex from '../../../prompts/merge.codex-cli.md';

/** Ferry's default prompts for direct-action execution paths. */
export const BUNDLED_ACTION_PROMPTS: Record<DirectActionPromptPath, Record<CcAgent, string>> = {
  'claude-code': {
    refiner: refinerClaude,
    dev: devClaude,
    review: reviewClaude,
    iterate: iterateClaude,
    merge: mergeClaude,
  },
  'codex-cli': {
    refiner: refinerCodex,
    dev: devCodex,
    review: reviewCodex,
    iterate: iterateCodex,
    merge: mergeCodex,
  },
};

/** @deprecated Use BUNDLED_ACTION_PROMPTS. */
export const BUNDLED_CC_PROMPTS: Record<CcAgent, string> = BUNDLED_ACTION_PROMPTS['claude-code'];
