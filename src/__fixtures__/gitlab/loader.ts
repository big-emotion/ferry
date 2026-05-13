/**
 * Tiny fixture loader for GitLab HTTP samples. Reads from this directory
 * via createRequire (the JSON files are compile-time static, so we don't
 * want a runtime fetch / fs walk in unit tests).
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require_ = createRequire(import.meta.url);
const DIR = dirname(fileURLToPath(import.meta.url));

export function gitlabFixture<T = unknown>(name: string): T {
  return require_(`./${name}.json`) as T;
}

export function gitlabRawFixture(name: string): string {
  return readFileSync(join(DIR, name), 'utf8');
}
