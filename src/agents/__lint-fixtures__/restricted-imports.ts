// This file exists to ensure our agent import guardrails are enforced.
// It is intentionally excluded from TypeScript compilation and tests.
import { Octokit } from '@octokit/rest';

export function _lintFixture(o: Octokit) {
  return o;
}
