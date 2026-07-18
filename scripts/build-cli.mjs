import { build } from 'esbuild';
import { mkdirSync, chmodSync } from 'node:fs';

mkdirSync('dist/cli/init', { recursive: true });
mkdirSync('dist/cli/doctor', { recursive: true });
mkdirSync('dist/cli/uninstall', { recursive: true });
mkdirSync('dist/cli/update', { recursive: true });
mkdirSync('dist/cli/agent', { recursive: true });
mkdirSync('dist/cli/cost', { recursive: true });
mkdirSync('dist/cli/jira-mcp', { recursive: true });
mkdirSync('dist/cli/cc-prompt', { recursive: true });
mkdirSync('dist/cli/local', { recursive: true });
mkdirSync('dist/cli/codex-config', { recursive: true });
mkdirSync('dist/cli/resolve-transition', { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  minify: false,
};

// The agent bundle pulls in the four agent entrypoints, which import LLM SDKs
// with CJS transitive deps that break esbuild's ESM shim. Keep them external —
// they're declared in package.json dependencies and resolved at runtime.
const agentShared = {
  ...shared,
  external: ['@anthropic-ai/sdk', '@google/genai', 'openai'],
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ['src/cli/init/index.ts'],
    outfile: 'dist/cli/init/index.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/cli/doctor/index.ts'],
    outfile: 'dist/cli/doctor/index.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/cli/uninstall/index.ts'],
    outfile: 'dist/cli/uninstall/index.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/cli/update/index.ts'],
    outfile: 'dist/cli/update/index.js',
  }),
  build({
    ...agentShared,
    entryPoints: ['src/cli/agent/run.ts'],
    outfile: 'dist/cli/agent/run.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/cli/cost/run.ts'],
    outfile: 'dist/cli/cost/run.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/cli/cost/reconcile-cmd.ts'],
    outfile: 'dist/cli/cost/reconcile-cmd.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/cli/cost/advice-cmd.ts'],
    outfile: 'dist/cli/cost/advice-cmd.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/cli/cost/stats-cmd.ts'],
    outfile: 'dist/cli/cost/stats.js',
  }),
  // ferry-jira-mcp stdio server. The MCP SDK stays external — it is a declared
  // runtime dependency, resolved by npx alongside the published package.
  build({
    ...shared,
    entryPoints: ['src/jira-mcp/index.ts'],
    outfile: 'dist/cli/jira-mcp/index.js',
    external: ['@modelcontextprotocol/sdk'],
  }),
  // ferry-action-prompt / ferry-cc-prompt resolve direct-action path prompts.
  // The `text` loader inlines bundled `prompts/*.{claude-code,codex-cli}.md`
  // defaults into the bundle — the npm package ships only `dist/cli/`.
  build({
    ...shared,
    entryPoints: ['src/cli/cc-prompt/index.ts'],
    outfile: 'dist/cli/cc-prompt/index.js',
    loader: { '.md': 'text' },
  }),
  build({
    ...shared,
    entryPoints: ['src/cli/local/index.ts'],
    outfile: 'dist/cli/local/index.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/cli/codex-config/index.ts'],
    outfile: 'dist/cli/codex-config/index.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/cli/resolve-transition/index.ts'],
    outfile: 'dist/cli/resolve-transition/index.js',
  }),
]);

chmodSync('dist/cli/init/index.js', 0o755);
chmodSync('dist/cli/doctor/index.js', 0o755);
chmodSync('dist/cli/uninstall/index.js', 0o755);
chmodSync('dist/cli/update/index.js', 0o755);
chmodSync('dist/cli/agent/run.js', 0o755);
chmodSync('dist/cli/cost/run.js', 0o755);
chmodSync('dist/cli/cost/reconcile-cmd.js', 0o755);
chmodSync('dist/cli/cost/advice-cmd.js', 0o755);
chmodSync('dist/cli/cost/stats.js', 0o755);
chmodSync('dist/cli/jira-mcp/index.js', 0o755);
chmodSync('dist/cli/cc-prompt/index.js', 0o755);
chmodSync('dist/cli/local/index.js', 0o755);
chmodSync('dist/cli/codex-config/index.js', 0o755);
chmodSync('dist/cli/resolve-transition/index.js', 0o755);

console.log('Built dist/cli/ bundles.');
