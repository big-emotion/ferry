import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

export interface MigrationNote {
  kind: 'info' | 'action';
  message: string;
}

interface ParsedMigration {
  keyTo: string;
  notes: MigrationNote[];
}

function getMigrationsFilePath(): string {
  // Resolves to package root whether running from dist/cli/update/ or src/cli/update/
  const dir = dirname(fileURLToPath(import.meta.url));
  return join(dir, '..', '..', '..', 'MIGRATIONS.md');
}

function parseSemver(v: string): [number, number, number] {
  const [a = '0', b = '0', c = '0'] = v.replace(/^v/, '').split('.');
  return [parseInt(a, 10), parseInt(b, 10), parseInt(c, 10)];
}

function semverLt(a: string, b: string): boolean {
  const [aMaj, aMin, aPat] = parseSemver(a);
  const [bMaj, bMin, bPat] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj < bMaj;
  if (aMin !== bMin) return aMin < bMin;
  return aPat < bPat;
}

function semverLte(a: string, b: string): boolean {
  return !semverLt(b, a);
}

function parseMigrationsFile(migrationsPath?: string): ParsedMigration[] {
  const path = migrationsPath ?? getMigrationsFilePath();
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return [];
  }

  const result: ParsedMigration[] = [];
  let currentKeyTo: string | null = null;
  let currentNotes: MigrationNote[] = [];

  for (const line of content.split('\n')) {
    // Match heading: ## v0.3.x → v0.4.0  or  ## v0.3.x -> v0.4.0
    const headingMatch = line.match(/^##\s+v[\d.x]+\s*(?:→|->)\s*(v[\d.]+)/);
    if (headingMatch) {
      if (currentKeyTo !== null) {
        result.push({ keyTo: currentKeyTo, notes: currentNotes });
      }
      currentKeyTo = headingMatch[1]!;
      currentNotes = [];
      continue;
    }

    if (currentKeyTo === null) continue;

    const actionMatch = line.match(/^-\s+\*\*\(action\)\*\*\s+(.*)/);
    if (actionMatch) {
      currentNotes.push({ kind: 'action', message: actionMatch[1]!.trim() });
      continue;
    }

    const infoMatch = line.match(/^-\s+\*\*\(info\)\*\*\s+(.*)/);
    if (infoMatch) {
      currentNotes.push({ kind: 'info', message: infoMatch[1]!.trim() });
    }
  }

  if (currentKeyTo !== null) {
    result.push({ keyTo: currentKeyTo, notes: currentNotes });
  }

  return result;
}

/**
 * Return migration notes that apply when upgrading from `fromVersion` to `toVersion`.
 * Parses MIGRATIONS.md at runtime and collects all entries whose target version is
 * > fromVersion and <= toVersion, covering multi-hop upgrades in a single pass.
 */
export function getRelevantMigrations(fromVersion: string, toVersion: string): MigrationNote[] {
  const migrations = parseMigrationsFile();
  const notes: MigrationNote[] = [];

  for (const { keyTo, notes: migNotes } of migrations) {
    // Include if the user hasn't passed this step yet (from < keyTo)
    // and will reach or pass it (keyTo <= to).
    if (semverLt(fromVersion, keyTo) && semverLte(keyTo, toVersion)) {
      notes.push(...migNotes);
    }
  }

  return notes;
}
