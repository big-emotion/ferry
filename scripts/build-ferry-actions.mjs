import { build } from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

mkdirSync('.ferry/schemas', { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  minify: false,
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ['src/lib/envelope/validate-action.ts'],
    outfile: '.ferry/validate-action.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/lib/audit/emit-audit-action.ts'],
    outfile: '.ferry/emit-audit-action.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/lib/dispatch/skip-task-type-action.ts'],
    outfile: '.ferry/skip-task-type-action.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/agents/developer/dev-action.ts'],
    outfile: '.ferry/dev-action.js',
  }),
]);

// The schema is loaded at runtime via createRequire(import.meta.url).
// Copy it alongside the bundle and fix the relative path so the bundle
// resolves it from .ferry/schemas/ instead of the source tree.
copyFileSync('src/schemas/event.v1.schema.json', '.ferry/schemas/event.v1.schema.json');
for (const f of ['validate-action.js', 'skip-task-type-action.js', 'dev-action.js']) {
  const p = `.ferry/${f}`;
  writeFileSync(p, readFileSync(p, 'utf8').replaceAll(
    '"../../schemas/event.v1.schema.json"',
    '"./schemas/event.v1.schema.json"',
  ));
}

// Minimal package.json so `npm ci` in .ferry/ installs only the three
// packages that the bundled scripts still resolve at runtime via createRequire.
writeFileSync('.ferry/package.json', JSON.stringify({
  name: 'ferry-actions',
  version: '0.0.0',
  private: true,
  type: 'module',
  dependencies: {
    'ajv': '^8.0.0',
    'ajv-formats': '^3.0.1',
    '@octokit/rest': '^22.0.1',
    '@anthropic-ai/sdk': '^0.91.1',
  },
}, null, 2) + '\n');

execSync('npm install --prefer-offline', { cwd: '.ferry', stdio: 'inherit' });

console.log('Built .ferry/ action bundles.');
