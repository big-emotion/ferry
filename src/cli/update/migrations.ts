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
  /**
   * Secrets the consumer must have set before this version transition is safe.
   * Declared via an optional `requires-secrets:` line (parallel to `forge:`).
   * Empty for code-only releases — the credential gate stays silent then.
   */
  requiresSecrets: string[];
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
 * Parse a `requires-secrets:` field (case-insensitive) from a single line.
 * Value is a comma- and/or whitespace-separated list of secret names.
 * Returns `undefined` when the line is not a `requires-secrets:` line.
 */
function parseRequiresSecretsLine(line: string): string[] | undefined {
  const m = line.match(/^\s*requires-secrets\s*:\s*(.*)$/i);
  if (!m) return undefined;
  return m[1]!
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parse MIGRATIONS.md content into structured entries.
 *
 * Each `## <from> → <to>` heading starts a section. Optional `forge:` field
 * on a subsequent line declares which forge the section applies to
 * (`github`, `gitlab`, or `both`). Default is `both`. An optional
 * `requires-secrets:` field (parallel to `forge:`, comma/space separated)
 * declares secrets the consumer must have set for this transition. Note
 * bullets follow the existing `- **(action)** ...` / `- **(info)** ...` shape.
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
      current = { keyTo: headingMatch[1]!, forge: 'both', requiresSecrets: [], notes: [] };
      continue;
    }

    if (current === null) continue;

    // ── Optional `forge:` / `requires-secrets:` annotations
    //    (case-insensitive, anywhere before the first bullet) ───────────
    if (current.notes.length === 0) {
      const forge = parseForgeLine(line);
      if (forge !== undefined) {
        current.forge = forge;
        continue;
      }
      const requiresSecrets = parseRequiresSecretsLine(line);
      if (requiresSecrets !== undefined) {
        current.requiresSecrets = requiresSecrets;
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
  const notes: MigrationNote[] = [];
  for (const m of crossedMigrations(fromVersion, toVersion, options)) {
    notes.push(...m.notes);
  }
  return notes;
}

/** Entries whose target version is in `(fromVersion, toVersion]`, forge-filtered. */
function crossedMigrations(
  fromVersion: string,
  toVersion: string,
  options: GetRelevantMigrationsOptions,
): ParsedMigration[] {
  const all = parseMigrationsFile(options.migrationsPath);
  const filtered = filterMigrationsByForge(all, options.forge);
  return filtered.filter((m) => semverLt(fromVersion, m.keyTo) && semverLte(m.keyTo, toVersion));
}

/**
 * Collect the deduped union of `requires-secrets:` declared across every
 * migration section crossed when upgrading `fromVersion` → `toVersion`
 * (forge-filtered). Empty for code-only ranges — that is the property the
 * credential gate relies on to stay silent (ADR-0006 §7, decisions/0002 §G).
 */
export function getRequiredSecretsForRange(
  fromVersion: string,
  toVersion: string,
  options: GetRelevantMigrationsOptions = {},
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const m of crossedMigrations(fromVersion, toVersion, options)) {
    for (const secret of m.requiresSecrets) {
      if (!seen.has(secret)) {
        seen.add(secret);
        ordered.push(secret);
      }
    }
  }
  return ordered;
}
