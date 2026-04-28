/**
 * Reviewer findings schema and rule-taxonomy validation.
 *
 * Findings must reference a `rule_id` drawn from `examples/reviewer-rules.yaml`
 * (plus the synthetic `ci-failure` id used by the CI gate). Unknown rule_ids
 * cause a `ReviewerFindingsSchemaError` so the agent can re-run once with the
 * taxonomy re-injected before escalating to `needs-human` (FR57).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

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

/** Synthetic IDs that are not declared in reviewer-rules.yaml but are valid. */
const SYNTHETIC_RULE_IDS = new Set<string>(['ci-failure']);

let cachedTaxonomy: Set<string> | undefined;

/** FS read injection seam (overridable in tests via `setTaxonomyReader`). */
let readTaxonomyFile: (path: string) => string = (p) => readFileSync(p, 'utf8');

/** Test-only: replace the FS reader. Pair with `resetTaxonomyCache()`. */
export function setTaxonomyReader(reader: (path: string) => string): void {
  readTaxonomyFile = reader;
}

/** Test-only: restore the default `readFileSync` taxonomy reader. */
export function restoreDefaultTaxonomyReader(): void {
  readTaxonomyFile = (p) => readFileSync(p, 'utf8');
}

/** Test-only: clear the in-memory taxonomy cache so the next call re-reads. */
export function resetTaxonomyCache(): void {
  cachedTaxonomy = undefined;
}

function loadTaxonomy(): Set<string> {
  if (cachedTaxonomy) return cachedTaxonomy;
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..', '..');
  const yamlPath = path.join(repoRoot, 'examples', 'reviewer-rules.yaml');
  const ids = new Set<string>();
  try {
    const text = readTaxonomyFile(yamlPath);
    const re = /^\s*-\s*id:\s*([A-Za-z0-9_-]+)\s*$/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      ids.add(match[1]);
    }
  } catch {
    // taxonomy file missing — leave empty so unknown ids are rejected loudly
  }
  cachedTaxonomy = ids;
  return cachedTaxonomy;
}

export function knownRuleIds(): Set<string> {
  return new Set([...loadTaxonomy(), ...SYNTHETIC_RULE_IDS]);
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
