#!/usr/bin/env node
import { createRequire } from 'node:module';
import { renderCodexConfigToml } from '../../lib/codex/config-toml.js';

const _require = createRequire(import.meta.url);

function packageVersion(): string {
  try {
    const pkg = _require('../../../package.json') as { version: string };
    return `v${pkg.version}`;
  } catch {
    return 'v0.0.0';
  }
}

process.stdout.write(renderCodexConfigToml({ version: packageVersion() }));
