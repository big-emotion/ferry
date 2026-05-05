import { build } from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

const rootDeps = JSON.parse(readFileSync('package.json', 'utf8')).dependencies;

mkdirSync('.ferry/schemas', { recursive: true });
mkdirSync('.ferry/prompts', { recursive: true });
for (const name of ['refiner', 'dev', 'review', 'review-comment', 'iterate']) {
  copyFileSync(`prompts/${name}.md`, `.ferry/prompts/${name}.md`);
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
    entryPoints: ['src/agents/refiner/refiner-action.ts'],
    outfile: '.ferry/refiner-action.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/agents/developer/dev-action.ts'],
    outfile: '.ferry/dev-action.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/agents/reviewer/review-action.ts'],
    outfile: '.ferry/review-action.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/agents/iterator/iterate-action.ts'],
    outfile: '.ferry/iterate-action.js',
  }),
]);

// The schema is loaded at runtime via createRequire(import.meta.url).
// Copy it alongside the bundle and fix the relative path so the bundle
// resolves it from .ferry/schemas/ instead of the source tree.
copyFileSync('src/schemas/event.v1.schema.json', '.ferry/schemas/event.v1.schema.json');
for (const f of [
  'validate-action.js',
  'skip-task-type-action.js',
  'refiner-action.js',
  'dev-action.js',
  'review-action.js',
  'iterate-action.js',
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

// --- Agent runner composite action bundles (fixes issue #71) ---
// Each agent has a self-contained composite action under .github/actions/ferry-run-{agent}/.
// The bundle + prompts + schema live in the action directory; consumers need no .ferry/.

// Shared deps needed by every agent action.
const agentBaseDeps = {
  ajv: rootDeps['ajv'],
  'ajv-formats': rootDeps['ajv-formats'],
  yaml: '^2.6.0',
};

// Every agent bundle statically imports all three provider SDKs (the agent-loop
// modules are evaluated at import time, not lazily), so each action needs all
// three installed at runtime.
const allProviderDeps = {
  '@anthropic-ai/sdk': rootDeps['@anthropic-ai/sdk'],
  '@google/genai': rootDeps['@google/genai'],
  openai: rootDeps['openai'],
};

const agentActions = [
  {
    actionDir: '.github/actions/ferry-run-refiner',
    packageName: 'ferry-run-refiner-action',
    bundle: '.ferry/refiner-action.js',
    bundleOut: 'refiner-action.js',
    prompts: ['refiner'],
    sdkDeps: allProviderDeps,
  },
  {
    actionDir: '.github/actions/ferry-run-developer',
    packageName: 'ferry-run-developer-action',
    bundle: '.ferry/dev-action.js',
    bundleOut: 'dev-action.js',
    prompts: ['dev'],
    sdkDeps: allProviderDeps,
  },
  {
    actionDir: '.github/actions/ferry-run-reviewer',
    packageName: 'ferry-run-reviewer-action',
    bundle: '.ferry/review-action.js',
    bundleOut: 'review-action.js',
    prompts: ['review', 'review-comment'],
    sdkDeps: allProviderDeps,
  },
  {
    actionDir: '.github/actions/ferry-run-iterator',
    packageName: 'ferry-run-iterator-action',
    bundle: '.ferry/iterate-action.js',
    bundleOut: 'iterate-action.js',
    prompts: ['iterate'],
    sdkDeps: allProviderDeps,
  },
];

for (const agent of agentActions) {
  mkdirSync(`${agent.actionDir}/schemas`, { recursive: true });
  mkdirSync(`${agent.actionDir}/prompts`, { recursive: true });

  // Copy the already-built bundle (schema path already fixed above)
  copyFileSync(agent.bundle, `${agent.actionDir}/${agent.bundleOut}`);

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
        dependencies: { ...agentBaseDeps, ...agent.sdkDeps },
      },
      null,
      2,
    ) + '\n',
  );
  execSync('npm install --prefer-offline', { cwd: agent.actionDir, stdio: 'inherit' });
}

console.log('Built .ferry/ action bundles.');
