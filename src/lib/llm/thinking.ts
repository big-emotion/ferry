/**
 * Helpers for translating the ferry:thinking/{on,off,extended} label override
 * into an Anthropic Messages API `thinking` parameter (or a no-op when unset).
 *
 * Anthropic SDK shape (from `@anthropic-ai/sdk/resources/messages.js`):
 *   thinking?:
 *     | { type: 'enabled'; budget_tokens: number; display?: 'summarized' | 'omitted' | null }
 *     | { type: 'disabled' }
 *     | { type: 'adaptive'; display?: 'summarized' | 'omitted' | null }
 *
 * See https://docs.claude.com/en/docs/build-with-claude/extended-thinking
 */
import type { Logger } from '../logger/index.js';
import type { TicketOverrides } from '../labels/capabilities.js';

/**
 * Anthropic Messages API `thinking` parameter value.
 *
 * - `{ type: 'enabled', budget_tokens }` — extended thinking on, with a budget
 * - `{ type: 'disabled' }`               — extended thinking off (forces off)
 * - `undefined`                          — leave the default (model-dependent)
 */
export type ThinkingParam =
  | { type: 'enabled'; budget_tokens: number }
  | { type: 'disabled' }
  | undefined;

/**
 * Budget-token defaults for the two enabled modes.
 *
 * `on` is the conservative default (≥1024 is the SDK minimum).
 * `extended` provides a larger budget for complex refactors / analyses.
 * Both budgets must be smaller than the call's `max_tokens` — the caller is
 * responsible for ensuring that.
 */
export const THINKING_BUDGET_ON = 2_000;
export const THINKING_BUDGET_EXTENDED = 8_000;

/**
 * Translates a `TicketOverrides.thinking` value into the Anthropic SDK's
 * `thinking` parameter.
 *
 * Returns `undefined` when no override is set, leaving the model's default
 * behaviour in place.
 */
export function thinkingParamFromOverride(thinking: TicketOverrides['thinking']): ThinkingParam {
  switch (thinking) {
    case 'extended':
      return { type: 'enabled', budget_tokens: THINKING_BUDGET_EXTENDED };
    case 'on':
      return { type: 'enabled', budget_tokens: THINKING_BUDGET_ON };
    case 'off':
      return { type: 'disabled' };
    default:
      return undefined;
  }
}

/**
 * Resolves the `thinking` override for a given provider. Anthropic-only —
 * when the override is set but the provider is not `anthropic`, logs a
 * warning to the supplied logger (stderr via the logger sink) and returns
 * `undefined` so the invoker silently no-ops.
 *
 * The override is NOT removed from `TicketOverrides`; suppression happens
 * here, at invoke time, so the audit comment still reflects the user's intent.
 */
export function resolveThinkingForProvider(
  thinking: TicketOverrides['thinking'],
  provider: string,
  logger?: Logger,
): ThinkingParam {
  if (thinking === undefined) return undefined;
  if (provider !== 'anthropic') {
    logger?.warn('ferry:thinking label set but provider is not anthropic — ignoring', {
      provider,
      thinking,
    });
    return undefined;
  }
  return thinkingParamFromOverride(thinking);
}
