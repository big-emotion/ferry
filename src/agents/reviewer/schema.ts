/**
 * Reviewer findings schema and rule-taxonomy validation.
 *
 * Findings must reference a `rule_id` drawn from `RULE_IDS` (plus the synthetic
 * `ci-failure` id used by the CI gate). Unknown rule_ids cause a
 * `ReviewerFindingsSchemaError` so the agent can re-run once with the taxonomy
 * re-injected before escalating to `needs-human` (FR57).
 */

export interface ReviewerFinding {
  rule_id: string;
  message: string;
  file?: string;
  line_start?: number;
  line_end?: number;
}

export class ReviewerFindingsSchemaError extends Error {
  constructor(
    message: string,
    public readonly unknownRuleIds: string[] = [],
  ) {
    super(message);
    this.name = 'ReviewerFindingsSchemaError';
  }
}

export const RULE_IDS = [
  'no-co-authored-by',
  'conventional-commit',
  'tests-accompany-source-changes',
  'no-skipped-tests',
  'no-hardcoded-secrets',
  'gitleaks-clean',
  'schema-version-bumped-when-shape-changes',
  'ferry-never-merges',
  'ferry-never-moves-jira-columns-except-allowed',
] as const;

/** Synthetic IDs not declared in RULE_IDS but valid (emitted by the CI gate). */
const SYNTHETIC_RULE_IDS = ['ci-failure'] as const;

export function knownRuleIds(): Set<string> {
  return new Set<string>([...RULE_IDS, ...SYNTHETIC_RULE_IDS]);
}

export function validateFindings(findings: ReviewerFinding[]): ReviewerFinding[] {
  const known = knownRuleIds();
  const unknown: string[] = [];
  for (const f of findings) {
    if (!f.message || f.message.trim().length === 0) {
      throw new ReviewerFindingsSchemaError(`finding for rule_id=${f.rule_id} has empty message`);
    }
    if (!known.has(f.rule_id)) unknown.push(f.rule_id);
  }
  if (unknown.length > 0) {
    throw new ReviewerFindingsSchemaError(`unknown rule_id(s): ${unknown.join(', ')}`, unknown);
  }
  return findings;
}
