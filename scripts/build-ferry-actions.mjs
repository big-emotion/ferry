import { build } from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { execSync } from 'child_process';

const rootDeps = JSON.parse(readFileSync('package.json', 'utf8')).dependencies;

mkdirSync('.ferry/schemas', { recursive: true });
mkdirSync('.ferry/prompts', { recursive: true });
for (const name of ['refiner', 'dev', 'review', 'review-comment', 'iterate']) {
  copyFileSync(`prompts/${name}.md`, `.ferry/prompts/${name}.md`);
}

// Drop legacy per-role bundles — replaced by the unified agent.js entrypoint.
for (const stale of [
  '.ferry/refiner-action.js',
  '.ferry/dev-action.js',
  '.ferry/review-action.js',
  '.ferry/iterate-action.js',
]) {
  if (existsSync(stale)) rmSync(stale);
}

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  minify: false,
  // Keep LLM SDKs out of the bundle — they carry deeply-CJS transitive deps
  // (e.g. google-auth-library uses dynamic require('child_process')) that break
  // esbuild's ESM shim. Each action's package.json declares only what it needs.
  external: ['@anthropic-ai/sdk', '@google/genai', 'openai'],
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
    entryPoints: ['src/cli/agent/run.ts'],
    outfile: '.ferry/agent.js',
  }),
]);

// The schema is loaded at runtime via createRequire(import.meta.url).
// Copy it alongside the bundle and fix the relative path so the bundle
// resolves it from .ferry/schemas/ instead of the source tree.
copyFileSync('src/schemas/event.v1.schema.json', '.ferry/schemas/event.v1.schema.json');
for (const f of [
  'validate-action.js',
  'skip-task-type-action.js',
  'agent.js',
]) {
  const p = `.ferry/${f}`;
  writeFileSync(
    p,
    readFileSync(p, 'utf8').replaceAll(
      '"../../schemas/event.v1.schema.json"',
      '"./schemas/event.v1.schema.json"',
    ),
  );
}

// Minimal package.json — LLM SDKs are now external (not bundled) so they must
// be installed at runtime alongside the action bundles.
writeFileSync(
  '.ferry/package.json',
  JSON.stringify(
    {
      name: 'ferry-actions',
      version: '0.0.0',
      private: true,
      type: 'module',
      dependencies: {
        ajv: rootDeps['ajv'],
        'ajv-formats': rootDeps['ajv-formats'],
        '@octokit/rest': rootDeps['@octokit/rest'],
        '@anthropic-ai/sdk': rootDeps['@anthropic-ai/sdk'],
        '@google/genai': rootDeps['@google/genai'],
        openai: rootDeps['openai'],
        yaml: '^2.6.0',
      },
    },
    null,
    2,
  ) + '\n',
);

execSync('npm install --prefer-offline', { cwd: '.ferry', stdio: 'inherit' });

// --- Self-contained composite action bundles ---
// Copy the built validate-action bundle and schema into the composite action
// directory so consumers can use `uses: big-emotion/ferry/.github/actions/…@v1`
// without needing .ferry/ in their own workspace (fixes issue #64).

const validateActionDir = '.github/actions/ferry-envelope-validate';
mkdirSync(`${validateActionDir}/schemas`, { recursive: true });
copyFileSync('.ferry/validate-action.js', `${validateActionDir}/validate-action.js`);
copyFileSync(
  'src/schemas/event.v1.schema.json',
  `${validateActionDir}/schemas/event.v1.schema.json`,
);
writeFileSync(
  `${validateActionDir}/package.json`,
  JSON.stringify(
    {
      name: 'ferry-envelope-validate-action',
      version: '0.0.0',
      private: true,
      type: 'module',
      dependencies: {
        ajv: '^8.0.0',
        'ajv-formats': '^3.0.1',
      },
    },
    null,
    2,
  ) + '\n',
);
execSync('npm install --prefer-offline', { cwd: validateActionDir, stdio: 'inherit' });

const emitAuditActionDir = '.github/actions/ferry-emit-audit';
copyFileSync('.ferry/emit-audit-action.js', `${emitAuditActionDir}/emit-audit-action.js`);
writeFileSync(
  `${emitAuditActionDir}/package.json`,
  JSON.stringify(
    {
      name: 'ferry-emit-audit-action',
      version: '0.0.0',
      private: true,
      type: 'module',
      dependencies: {
        '@octokit/rest': '^22.0.1',
      },
    },
    null,
    2,
  ) + '\n',
);
execSync('npm install --prefer-offline', { cwd: emitAuditActionDir, stdio: 'inherit' });

// --- Agent runner composite action bundles ---
// Each agent has a self-contained composite action under .github/actions/ferry-run-{role}/.
// All four directories receive the SAME unified agent.js bundle; the action.yml
// passes --role <role> to disambiguate at runtime.

const agentBaseDeps = {
  ajv: rootDeps['ajv'],
  'ajv-formats': rootDeps['ajv-formats'],
  yaml: '^2.6.0',
};

const allProviderDeps = {
  '@anthropic-ai/sdk': rootDeps['@anthropic-ai/sdk'],
  '@google/genai': rootDeps['@google/genai'],
  openai: rootDeps['openai'],
};

const agentActions = [
  {
    actionDir: '.github/actions/ferry-run-refiner',
    packageName: 'ferry-run-refiner-action',
    prompts: ['refiner'],
    legacyBundle: 'refiner-action.js',
  },
  {
    actionDir: '.github/actions/ferry-run-developer',
    packageName: 'ferry-run-developer-action',
    prompts: ['dev'],
    legacyBundle: 'dev-action.js',
  },
  {
    actionDir: '.github/actions/ferry-run-reviewer',
    packageName: 'ferry-run-reviewer-action',
    prompts: ['review', 'review-comment'],
    legacyBundle: 'review-action.js',
  },
  {
    actionDir: '.github/actions/ferry-run-iterator',
    packageName: 'ferry-run-iterator-action',
    prompts: ['iterate'],
    legacyBundle: 'iterate-action.js',
  },
];

for (const agent of agentActions) {
  mkdirSync(`${agent.actionDir}/schemas`, { recursive: true });
  mkdirSync(`${agent.actionDir}/prompts`, { recursive: true });

  // Copy the unified agent bundle (schema path already fixed above)
  copyFileSync('.ferry/agent.js', `${agent.actionDir}/agent.js`);

  // Drop the legacy per-role bundle if it exists.
  const legacyPath = `${agent.actionDir}/${agent.legacyBundle}`;
  if (existsSync(legacyPath)) rmSync(legacyPath);

  // Copy skip-task bundle into each agent action dir
  copyFileSync('.ferry/skip-task-type-action.js', `${agent.actionDir}/skip-task-type-action.js`);

  // Copy event schema (used at runtime via createRequire)
  copyFileSync(
    'src/schemas/event.v1.schema.json',
    `${agent.actionDir}/schemas/event.v1.schema.json`,
  );

  // Copy bundled prompts (FERRY_BUNDLED_PROMPTS_DIR in action.yml points here)
  for (const name of agent.prompts) {
    copyFileSync(`prompts/${name}.md`, `${agent.actionDir}/prompts/${name}.md`);
  }

  writeFileSync(
    `${agent.actionDir}/package.json`,
    JSON.stringify(
      {
        name: agent.packageName,
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: { ...agentBaseDeps, ...allProviderDeps },
      },
      null,
      2,
    ) + '\n',
  );
  execSync('npm install --prefer-offline', { cwd: agent.actionDir, stdio: 'inherit' });
}

console.log('Built .ferry/ action bundles.');
