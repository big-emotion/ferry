export interface MigrationNote {
  kind: 'info' | 'action';
  message: string;
}

// Keyed by "vFrom -> vTo" (semver without "v" prefix, range-matched).
// Add entries here whenever a release introduces consumer-visible changes.
const MIGRATIONS: Record<string, MigrationNote[]> = {
  // Example shape — fill in as releases are cut:
  // 'v0.3.x -> v0.4.0': [
  //   { kind: 'action', message: 'New required secret: `FERRY_FOO`. Set with: `gh secret set FERRY_FOO ...`' },
  //   { kind: 'action', message: 'Jira rule `Ferry — Iterate` trigger renamed `Iteration` → `Changes Requested`. Update in Jira UI.' },
  // ],
};

function stripV(v: string): string {
  return v.replace(/^v/, '');
}

/**
 * Return migration notes that apply when upgrading from `fromVersion` to `toVersion`.
 * Checks for exact keys ("v0.3.0 -> v0.3.1") and wildcard-ish keys ("v0.3.x -> v0.4.0").
 */
export function getRelevantMigrations(fromVersion: string, toVersion: string): MigrationNote[] {
  const from = stripV(fromVersion);
  const to = stripV(toVersion);

  const notes: MigrationNote[] = [];

  for (const [key, migrations] of Object.entries(MIGRATIONS)) {
    const [keyFrom, keyTo] = key.split('->').map((s) => s.trim());
    if (!keyFrom || !keyTo) continue;

    const kFrom = stripV(keyFrom);
    const kTo = stripV(keyTo);

    // Exact match
    if (kFrom === from && kTo === to) {
      notes.push(...migrations);
      continue;
    }

    // Wildcard: "0.3.x -> 0.4.0"  matches any 0.3.* from
    if (kFrom.endsWith('.x') && kTo === to) {
      const prefix = kFrom.slice(0, kFrom.lastIndexOf('.x'));
      if (from.startsWith(prefix + '.')) {
        notes.push(...migrations);
      }
    }
  }

  return notes;
}
