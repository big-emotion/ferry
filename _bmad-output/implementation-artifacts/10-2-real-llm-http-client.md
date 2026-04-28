# Story 10.2: Real LLM HTTP client

Status: review

## Story

As a Ferry agent (Refiner / Developer / Reviewer / Iterator),
I want a real multi-provider LLM HTTP client behind `src/lib/llm/call.ts`,
so that agent runs produce real model outputs instead of returning placeholder stubs.

## Acceptance Criteria

1. `createLlmCall(route: LlmRoute): LlmCall` — factory exported from `src/lib/llm/call.ts`; reads the provider API key from `FERRY_ANTHROPIC_KEY`, `FERRY_GOOGLE_AI_KEY`, or `FERRY_OPENAI_KEY` based on `route.provider`; throws `FerryError('state-invariant', { reason: 'missing-env', key: '...' })` if the key is absent.
2. **Anthropic provider** (`src/lib/llm/anthropic.ts`): calls `client.messages.create({ model, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] })` via `@anthropic-ai/sdk`; returns `{ text, usage: { inputTokens, outputTokens, costEur } }`.
3. **OpenAI provider** (`src/lib/llm/openai.ts`): calls `client.chat.completions.create({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 4096 })` via `openai` SDK; returns same shape.
4. **Google provider** (`src/lib/llm/google.ts`): calls `ai.models.generateContent({ model, contents: prompt })` via `@google/genai`; returns same shape.
5. `src/lib/llm/pricing.ts` exports `computeCostEur(provider: LlmProvider, model: string, inputTokens: number, outputTokens: number): number` — pinned per-1M-token EUR rates for the models used in Ferry; unknown models fall back to the most expensive known rate for that provider (conservative).
6. `src/lib/llm/budget.ts` exports `createSessionBudget(maxCostEur?: number): SessionBudget` — before each call, if the estimated input cost would push the session total past `maxCostEur` (default: `FERRY_MAX_COST_EUR_PER_RUN` env var, fallback 10.0), throws `FerryError('spend-cap', { reason: 'budget-exceeded' })`; after each call, records actual cost.
7. Provider HTTP 429 → `FerryError('spend-cap')`. Provider HTTP 5xx / network error → `FerryError('transient')`. Retryable errors flow through existing `retry()` from `src/lib/io/retry.ts`.
8. All API keys from env vars only — no hardcoding. All three env-var names used in the codebase (`FERRY_ANTHROPIC_KEY`, `FERRY_GOOGLE_AI_KEY`, `FERRY_OPENAI_KEY`).
9. No live network calls in CI: every test uses mocked SDK instances (`vi.mock`).
10. `LlmCall`, `LlmResult`, `LlmUsage` types are exported from `src/lib/llm/call.ts`; existing definitions in `src/agents/refiner/refine.ts` remain unchanged (no breaking import change in this story).

## Tasks / Subtasks

- [x] Task 1 — Write failing tests for `pricing.ts` (AC: 5)
  - [x] 1.1 Create `src/lib/llm/pricing.test.ts` asserting correct EUR cost for known anthropic/openai/google models at known token counts
  - [x] 1.2 Assert unknown-model fallback uses the highest rate for that provider
  - [x] 1.3 Confirm tests fail (no implementation yet)
- [x] Task 2 — Implement `src/lib/llm/pricing.ts` (AC: 5)
  - [x] 2.1 Define rates table: `Record<string, { inputPer1M: number; outputPer1M: number }>` keyed by `"<provider>/<model>"`
  - [x] 2.2 Implement `computeCostEur` with per-provider fallback for unknown models
  - [x] 2.3 Confirm pricing tests pass
- [x] Task 3 — Write failing tests for `budget.ts` (AC: 6)
  - [x] 3.1 Create `src/lib/llm/budget.test.ts` — assert that `checkBefore` throws `FerryError('spend-cap')` when estimated cost would exceed cap; assert `recordUsage` accumulates correctly
  - [x] 3.2 Assert default cap reads `FERRY_MAX_COST_EUR_PER_RUN` env var, falling back to 10.0
  - [x] 3.3 Confirm tests fail
- [x] Task 4 — Implement `src/lib/llm/budget.ts` (AC: 6)
  - [x] 4.1 Implement `SessionBudget` with `checkBefore(estimatedCostEur)` and `recordUsage(actualCostEur)`
  - [x] 4.2 Confirm budget tests pass
- [x] Task 5 — Write failing tests for provider wrappers + `call.ts` (AC: 1, 2, 3, 4, 7, 8, 9)
  - [x] 5.1 Create `src/lib/llm/call.test.ts` — mock `@anthropic-ai/sdk`, `openai`, `@google/genai` entirely; test that each provider's mock is called with correct args and that `LlmResult` shape is returned
  - [x] 5.2 Assert env-var validation throws `FerryError('state-invariant')` for each missing key
  - [x] 5.3 Assert provider-level errors map correctly: SDK rate-limit → `FerryError('spend-cap')`, network error → `FerryError('transient')`
  - [x] 5.4 Confirm tests fail
- [x] Task 6 — Implement `src/lib/llm/anthropic.ts` (AC: 2)
  - [x] 6.1 Create `invokeAnthropic({ apiKey, model, prompt, maxTokens }): Promise<LlmResult>`
  - [x] 6.2 Map `message.usage.input_tokens` / `output_tokens` → `LlmUsage`; call `computeCostEur`
  - [x] 6.3 Catch HTTP errors: status 429 → `FerryError('spend-cap')`; status 5xx or network → `FerryError('transient')`
- [x] Task 7 — Implement `src/lib/llm/openai.ts` (AC: 3)
  - [x] 7.1 Create `invokeOpenAI({ apiKey, model, prompt, maxTokens }): Promise<LlmResult>`
  - [x] 7.2 Map `completion.usage.prompt_tokens` / `completion_tokens` → `LlmUsage`
  - [x] 7.3 Same error mapping as Anthropic
- [x] Task 8 — Implement `src/lib/llm/google.ts` (AC: 4)
  - [x] 8.1 Create `invokeGoogle({ apiKey, model, prompt }): Promise<LlmResult>`
  - [x] 8.2 Map `response.usageMetadata.promptTokenCount` / `candidatesTokenCount` → `LlmUsage`
  - [x] 8.3 Same error mapping
- [x] Task 9 — Implement `src/lib/llm/call.ts` (AC: 1, 7, 10)
  - [x] 9.1 Export `LlmCall`, `LlmResult`, `LlmUsage` types
  - [x] 9.2 Implement `createLlmCall(route: LlmRoute): LlmCall` — reads env key, delegates to the correct provider invoke function, wraps in `retry()` for transient errors
  - [x] 9.3 Confirm call.test.ts passes for all providers
- [x] Task 10 — Run full test suite and typecheck (AC: all)
  - [x] 10.1 `npx vitest run src/lib/llm/` — 45 tests pass
  - [x] 10.2 `npm run typecheck` — zero errors
  - [x] 10.3 `npm run lint` — zero errors
  - [x] 10.4 `npx vitest run` — 432 tests pass, no regressions

## Dev Notes

### Architecture constraints

- **No agent framework.** Custom harness only. Do not import LangChain, LangGraph, or any agent SDK. [Source: architecture.md D4]
- **One file per provider.** `anthropic.ts`, `openai.ts`, `google.ts` — each is a thin SDK wrapper; business logic lives in `call.ts`. [Source: architecture.md D4 file layout]
- **All three SDKs are already installed.** `@anthropic-ai/sdk ^0.91.1`, `@google/genai ^1.0.0`, `openai ^6.34.0`. No new dependencies needed. [Source: package.json]
- **`retry()` from `src/lib/io/retry.ts`.** Only `FerryError('transient')` is retried; max 3 attempts, 2 s base delay. Wrap the provider call in `retry()` inside `createLlmCall`. [Source: retry.ts pattern established in Story 1-6]
- **No `console.log`.** ESLint rule enforced. [Source: architecture.md enforcement guidelines]
- **No `default` exports.** ESLint rule. Use named exports throughout. [Source: architecture.md enforcement guidelines]
- **One-way dependency.** `src/lib/llm/` must not import from `src/agents/`. [Source: architecture.md dependency table]

### LlmCall / LlmResult contract

`refine.ts` currently owns these type definitions (Story 3-1 established them):
```typescript
export type LlmCall = (prompt: string) => Promise<LlmResult>;
export interface LlmUsage { inputTokens: number; outputTokens: number; costEur: number; }
export interface LlmResult { text: string; promptIncluded?: string; usage: LlmUsage | null; }
```
**This story re-exports identical types from `call.ts`** without changing `refine.ts`. The agent entry-point (Story 10-5) will later import `LlmCall` from `call.ts`.

### Provider SDK invocation — exact API shapes

**Anthropic `@anthropic-ai/sdk` v0.91:**
```typescript
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({ apiKey });
const msg = await client.messages.create({
  model,                          // e.g. "claude-sonnet-4-6"
  max_tokens: 4096,
  messages: [{ role: 'user', content: prompt }],
});
// msg.content[0].type === 'text'
// msg.content[0].text — string
// msg.usage.input_tokens, msg.usage.output_tokens — numbers
```
Anthropic SDK surfaces rate-limit errors as `Anthropic.RateLimitError` (HTTP 429). Other API errors are `Anthropic.APIError` with a `.status` property.

**OpenAI `openai` v6.34:**
```typescript
import OpenAI from 'openai';
const client = new OpenAI({ apiKey });
const completion = await client.chat.completions.create({
  model,                          // e.g. "gpt-4.1-mini"
  messages: [{ role: 'user', content: prompt }],
  max_tokens: 4096,
});
// completion.choices[0].message.content — string | null
// completion.usage?.prompt_tokens, completion.usage?.completion_tokens
```
OpenAI SDK throws `OpenAI.RateLimitError` (429) and `OpenAI.APIError` with `.status`.

**Google `@google/genai` v1.0.0:**
```typescript
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey });
const response = await ai.models.generateContent({
  model,                          // e.g. "gemini-2.5-flash"
  contents: prompt,
});
// response.text — string
// response.usageMetadata?.promptTokenCount — number | undefined
// response.usageMetadata?.candidatesTokenCount — number | undefined
```
Google GenAI SDK does not have named error classes for rate-limits in v1.0.0; catch generic `Error` and inspect `.message` or use `response.promptFeedback` for safety blocks. For network errors, catch and re-throw as `FerryError('transient')`.

### Pricing (EUR rates, pinned 2025-Q2)

EUR/USD ≈ 0.93. Rates are per 1M tokens:

| Provider | Model glob | Input €/1M | Output €/1M |
|----------|-----------|-----------|------------|
| anthropic | `claude-sonnet-4-6` | 2.79 | 13.95 |
| anthropic | `claude-opus-*` | 13.95 | 69.75 |
| anthropic | `claude-haiku-*` | 0.23 | 1.16 |
| openai | `gpt-4.1-mini` | 0.14 | 0.56 |
| openai | `gpt-4.*` / `gpt-5.*` | 2.79 | 8.37 |
| google | `gemini-2.5-flash` | 0.07 | 0.28 |
| google | `gemini-2.5-pro` | 1.05 | 4.20 |

**Implementation:** key on exact model string first; fall through to prefix match (e.g., `startsWith('claude-sonnet')`); unknown model → use provider's highest output rate. Round `costEur` to 4 decimal places. Source of truth is `pricing.ts`; adding a model without a test entry fails CI (`pricing.test.ts` asserts coverage).

### Budget enforcement

```typescript
export interface SessionBudget {
  checkBefore(estimatedInputCostEur: number): void;  // throws if would exceed cap
  recordUsage(actualCostEur: number): void;
  totalCostEur(): number;
}

export function createSessionBudget(maxCostEur?: number): SessionBudget;
```

- `maxCostEur` defaults to `parseFloat(process.env.FERRY_MAX_COST_EUR_PER_RUN ?? '10')`.
- `checkBefore`: estimate = `inputTokens × inputRate` (rough `chars / 4` approximation for the check; real cost recorded after). Throws `FerryError('spend-cap', { reason: 'budget-exceeded', sessionTotal: ..., estimatedAdd: ..., cap: ... })`.
- Module-level singleton is NOT used — `createSessionBudget()` returns a fresh instance. Agent entry-points (Story 10-5 through 10-8) will create one instance per run and pass it to `createLlmCall`.

### Error mapping

| Condition | FerryError code |
|---|---|
| Provider HTTP 429 / RateLimitError | `spend-cap` |
| Provider HTTP 5xx | `transient` |
| Network error (ECONNREFUSED, ETIMEDOUT, fetch failed) | `transient` |
| Missing API key env var | `state-invariant` |
| Budget cap exceeded | `spend-cap` |

### Test strategy

Use `vi.mock('@anthropic-ai/sdk', ...)` etc. to replace the entire SDK module. Return a mock client whose method (`.messages.create`, `.chat.completions.create`, `.models.generateContent`) resolves with a minimal shaped object. Do NOT use `vi.stubGlobal('fetch', ...)` — the SDKs manage their own HTTP; mock at the SDK constructor level.

Pattern (from `scan.test.ts` and `jira.test.ts`):
```typescript
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'plan json here' }],
    usage: { input_tokens: 100, output_tokens: 50 },
  });
  return {
    default: vi.fn().mockReturnValue({ messages: { create: mockCreate } }),
  };
});
```

### File layout impact

```
src/lib/llm/
  call.ts          ← NEW: createLlmCall factory + LlmCall/LlmResult/LlmUsage types
  anthropic.ts     ← NEW: invokeAnthropic()
  openai.ts        ← NEW: invokeOpenAI()
  google.ts        ← NEW: invokeGoogle()
  pricing.ts       ← NEW: computeCostEur(), rates table
  budget.ts        ← NEW: createSessionBudget(), SessionBudget interface
  pricing.test.ts  ← NEW
  budget.test.ts   ← NEW
  call.test.ts     ← NEW (consolidates all provider + factory tests)
  config.ts        ← unchanged
  config.test.ts   ← unchanged
  route.ts         ← unchanged
  route.test.ts    ← unchanged
```

### Previous story intelligence (10-1)

- **TDD pattern:** RED (write tests first, confirm fail) → GREEN (implement) → verify.
- **`vi.mock` before imports:** `vi.mock(...)` calls must appear before `import` statements in test files; vitest hoists them automatically.
- **Unused imports cause lint errors** — only import what you use in tests.
- **`vi.clearAllMocks()` in `beforeEach`** — prevents mock state bleeding between tests.
- **`vi.unstubAllEnvs()` in `afterEach`** — required when using `vi.stubEnv`.
- **No `default` exports anywhere** — ESLint enforces; use `export class`, `export function`, `export interface`.
- **`FerryError` constructor:** `new FerryError(code, context?)` where context is `Record<string, unknown>`.

### References

- Architecture D4 (LLM harness): `_bmad-output/planning-artifacts/architecture.md` lines 405–468
- Architecture budget enforcement: lines 808–813
- Architecture anti-patterns (no console.log, no default export): lines 820–850
- `LlmCall`, `LlmResult`, `LlmUsage` current definitions: `src/agents/refiner/refine.ts` lines 39–51
- `LlmRoute`, `LlmProvider`, `loadFerryLlmConfig`: `src/lib/llm/config.ts`
- `retry()`: `src/lib/io/retry.ts`
- `FerryError`: `src/lib/error.ts`
- SDK versions: `package.json` (anthropic ^0.91.1, genai ^1.0.0, openai ^6.34.0)
- Sprint change proposal (10-2 context): `_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-28.md` lines 183

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

No blockers. Key learnings: Vitest v4 requires `class` or regular function (not arrow) for constructor mocks; `vi.hoisted()` needed to expose mock functions across `vi.mock` factory boundaries; transient errors retried by `retry()` become `FerryError('unknown')` after exhaustion — tests use `vi.useFakeTimers()` + `vi.runAllTimersAsync()` to drain retry delays without wall-clock waits. `LlmProvider` extended to include `'google'` in `config.ts` (backward-compatible union addition).

### Completion Notes List

- `pricing.ts`: rates table keyed by `"<provider>/<model>"` with exact-match-first then prefix-match lookup; unknown models fall back to provider's highest output rate. 13 tests pass.
- `budget.ts`: `createSessionBudget()` returns a fresh closure-based instance with `checkBefore/recordUsage/totalCostEur`; env var fallback guards `parseFloat('')` → NaN edge case. 11 tests pass.
- `anthropic.ts`: `invokeAnthropic()` — maps `RateLimitError` → `spend-cap`, `APIError.status >= 500` → `transient`, network keywords → `transient`.
- `openai.ts`: `invokeOpenAI()` — maps `RateLimitError` → `spend-cap`, `APIConnectionError` → `transient`, 5xx `APIError` → `transient`.
- `google.ts`: `invokeGoogle()` — all errors mapped to `transient` (SDK v1 has no named rate-limit class).
- `call.ts`: `createLlmCall(route)` reads env key eagerly (throws `state-invariant` before any async work), then delegates to the correct provider, wrapped in `retry()`.
- All 432 tests pass; typecheck and lint clean.

### File List

**New files:**
- `src/lib/llm/pricing.ts`
- `src/lib/llm/pricing.test.ts`
- `src/lib/llm/budget.ts`
- `src/lib/llm/budget.test.ts`
- `src/lib/llm/anthropic.ts`
- `src/lib/llm/openai.ts`
- `src/lib/llm/google.ts`
- `src/lib/llm/call.ts`
- `src/lib/llm/call.test.ts`

**Modified files:**
- `src/lib/llm/config.ts` — extended `LlmProvider` union to include `'google'`

## Change Log

- 2026-04-28: Implement Story 10.2 — Real LLM HTTP client. Added `pricing.ts` (computeCostEur with 2025-Q2 EUR rates), `budget.ts` (createSessionBudget with per-run cost cap), `anthropic.ts` / `openai.ts` / `google.ts` (thin SDK wrappers with error mapping), `call.ts` (createLlmCall factory + LlmCall/LlmResult/LlmUsage type exports). Extended LlmProvider in config.ts to include 'google'.
