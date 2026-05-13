import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { ForgeKind } from '../lib/forge.js';

export interface MigrationNote {
  kind: 'info' | 'action';
  message: string;
}

/** Which forge a migration entry applies to. `both` is the default. */
export type MigrationForge = 'github' | 'gitlab' | 'both';

export interface ParsedMigration {
  keyTo: string;
  forge: MigrationForge;
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

/** Parse a `forge:` field (case-insensitive) from a single line. */
function parseForgeLine(line: string): MigrationForge | undefined {
  const m = line.match(/^\s*forge\s*:\s*([A-Za-z]+)\s*$/i);
  if (!m) return undefined;
  const v = m[1]!.toLowerCase();
  if (v === 'github' || v === 'gitlab' || v === 'both') return v;
  // Unknown value → treat as `both` for backwards-compatibility.
  return 'both';
}

/**
 * Parse MIGRATIONS.md content into structured entries.
 *
 * Each `## <from> → <to>` heading starts a section. Optional `forge:` field
 * on a subsequent line declares which forge the section applies to
 * (`github`, `gitlab`, or `both`). Default is `both`. Note bullets follow
 * the existing `- **(action)** ...` / `- **(info)** ...` shape.
 *
 * Exported for unit tests; consumers should call `getRelevantMigrations()`.
 */
export function parseMigrationsContent(content: string): ParsedMigration[] {
  const result: ParsedMigration[] = [];
  let current: ParsedMigration | null = null;

  for (const line of content.split('\n')) {
    // ── Section heading: ## v0.3.x → v0.4.0  or  ## v0.3.x -> v0.4.0 ──
    const headingMatch = line.match(/^##\s+v[\d.x]+\s*(?:→|->)\s*(v[\d.]+)/);
    if (headingMatch) {
      if (current !== null) result.push(current);
      current = { keyTo: headingMatch[1]!, forge: 'both', notes: [] };
      continue;
    }

    if (current === null) continue;

    // ── Optional `forge:` annotation (case-insensitive, anywhere before
    //    the first bullet) ─────────────────────────────────────────────
    if (current.notes.length === 0) {
      const forge = parseForgeLine(line);
      if (forge !== undefined) {
        current.forge = forge;
        continue;
      }
    }

    // ── Note bullets ───────────────────────────────────────────────────
    const actionMatch = line.match(/^-\s+\*\*\(action\)\*\*\s+(.*)/);
    if (actionMatch) {
      current.notes.push({ kind: 'action', message: actionMatch[1]!.trim() });
      continue;
    }
    const infoMatch = line.match(/^-\s+\*\*\(info\)\*\*\s+(.*)/);
    if (infoMatch) {
      current.notes.push({ kind: 'info', message: infoMatch[1]!.trim() });
    }
  }

  if (current !== null) result.push(current);
  return result;
}

/**
 * Filter parsed migrations by forge. Entries marked `both` always pass.
 * If `forge` is `undefined`, all entries pass (backwards-compatible).
 */
export function filterMigrationsByForge(
  migrations: ParsedMigration[],
  forge: ForgeKind | undefined,
): ParsedMigration[] {
  if (forge === undefined) return migrations;
  return migrations.filter((m) => m.forge === 'both' || m.forge === forge);
}

function parseMigrationsFile(migrationsPath?: string): ParsedMigration[] {
  const path = migrationsPath ?? getMigrationsFilePath();
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  return parseMigrationsContent(content);
}

export interface GetRelevantMigrationsOptions {
  /** Override the MIGRATIONS.md location (mostly for tests). */
  migrationsPath?: string;
  /** Active forge — when set, gitlab-only / github-only entries are filtered. */
  forge?: ForgeKind;
}

/**
 * Return migration notes that apply when upgrading from `fromVersion` to
 * `toVersion`. Parses MIGRATIONS.md at runtime, applies the optional forge
 * filter, and collects all entries whose target version is > fromVersion and
 * <= toVersion (covering multi-hop upgrades in a single pass).
 *
 * Backwards-compatible call shape: `getRelevantMigrations(from, to)` returns
 * everything (no forge filter). Callers that know the active forge should
 * pass `{ forge }` to scope the result.
 */
export function getRelevantMigrations(
  fromVersion: string,
  toVersion: string,
  options: GetRelevantMigrationsOptions = {},
): MigrationNote[] {
  const all = parseMigrationsFile(options.migrationsPath);
  const filtered = filterMigrationsByForge(all, options.forge);

  const notes: MigrationNote[] = [];
  for (const { keyTo, notes: migNotes } of filtered) {
    if (semverLt(fromVersion, keyTo) && semverLte(keyTo, toVersion)) {
      notes.push(...migNotes);
    }
  }
  return notes;
}
