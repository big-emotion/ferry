#!/usr/bin/env node
/**
 * Runs `npm audit --omit=dev` and exits non-zero for any high/critical
 * finding not present in the allowlist defined in audit-ci.json.
 *
 * Always writes npm-audit-report.json to the working directory for
 * upload as a CI artifact.
 *
 * Allowlist format (audit-ci.json):
 * {
 *   "allowlist": [
 *     {
 *       "id": "GHSA-xxxx-xxxx-xxxx",
 *       "rationale": "Why this is a false positive or acceptable risk"
 *     }
 *   ]
 * }
 * Plain string IDs are also accepted: { "allowlist": ["GHSA-xxxx-xxxx-xxxx"] }
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const REPORT_PATH = 'npm-audit-report.json';
const CONFIG_PATH = 'audit-ci.json';

// Load allowlist from audit-ci.json
let config = { allowlist: [] };
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  // No config file — proceed with empty allowlist
}

const allowedIds = new Set(
  (config.allowlist ?? []).map((entry) =>
    typeof entry === 'string' ? entry : String(entry.id),
  ),
);

// Run npm audit and capture JSON output.
// npm audit exits non-zero when vulnerabilities are found; stdout is
// still valid JSON in that case, so we capture from the caught error.
let auditJson;
try {
  const stdout = execSync('npm audit --omit=dev --json', {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  auditJson = JSON.parse(stdout);
} catch (err) {
  const raw = /** @type {any} */ (err).stdout ?? '{}';
  try {
    auditJson = JSON.parse(raw);
  } catch {
    process.stderr.write(`npm audit produced non-JSON output:\n${raw}\n`);
    process.exit(1);
  }
}

writeFileSync(REPORT_PATH, JSON.stringify(auditJson, null, 2));
console.log(`Audit report written to ${REPORT_PATH}`);

// Collect high/critical findings not covered by the allowlist.
const vulns = auditJson.vulnerabilities ?? {};
const blocking = [];

for (const [pkg, vuln] of Object.entries(vulns)) {
  const { severity } = /** @type {any} */ (vuln);
  if (severity !== 'high' && severity !== 'critical') continue;

  // `via` entries that are objects have a `source` advisory ID.
  const advisoryIds = (/** @type {any[]} */ (vuln.via ?? []))
    .filter((v) => typeof v === 'object' && v.source != null)
    .map((v) => String(v.source));

  // A finding is suppressed only when every advisory behind it is allowlisted.
  const allAllowed =
    advisoryIds.length > 0 && advisoryIds.every((id) => allowedIds.has(id));

  if (!allAllowed) {
    blocking.push({ pkg, severity, advisoryIds });
  }
}

if (blocking.length === 0) {
  console.log('npm audit: clean — no blocking high/critical vulnerabilities.');
  process.exit(0);
}

process.stderr.write('\nnpm audit: FAILED — blocking vulnerabilities found:\n\n');
for (const { pkg, severity, advisoryIds } of blocking) {
  const ids = advisoryIds.length ? advisoryIds.join(', ') : 'no advisory ID';
  process.stderr.write(`  ${pkg} [${severity}] — advisory IDs: ${ids}\n`);
}
process.stderr.write(
  '\nTo suppress a known false positive, add its advisory ID to audit-ci.json ' +
    'with a "rationale" field explaining why.\n',
);
process.exit(1);
