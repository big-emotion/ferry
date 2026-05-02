import { build } from 'esbuild';
import { mkdirSync, chmodSync } from 'node:fs';

mkdirSync('dist/cli/init', { recursive: true });
mkdirSync('dist/cli/doctor', { recursive: true });
mkdirSync('dist/cli/uninstall', { recursive: true });
mkdirSync('dist/cli/update', { recursive: true });

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
]);

chmodSync('dist/cli/init/index.js', 0o755);
chmodSync('dist/cli/doctor/index.js', 0o755);
chmodSync('dist/cli/uninstall/index.js', 0o755);
chmodSync('dist/cli/update/index.js', 0o755);

console.log('Built dist/cli/ bundles.');
