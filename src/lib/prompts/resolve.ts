import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

export function resolvePromptPath(
  name: string,
  repoRoot: string,
  _checkExists: (p: string) => boolean = existsSync,
): string {
  const overridesDir = process.env.FERRY_PROMPTS_DIR || path.join(repoRoot, 'prompts');
  const overridePath = path.join(overridesDir, `${name}.md`);
  if (_checkExists(overridePath)) {
    return overridePath;
  }
  // FERRY_BUNDLED_PROMPTS_DIR is set by composite actions so bundled prompts are found
  // without needing .ferry/ in the consumer workspace (fixes issue #71).
  const bundledDir =
    process.env.FERRY_BUNDLED_PROMPTS_DIR ?? path.join(repoRoot, '.ferry', 'prompts');
  console.error(`[ferry:prompts] ${name}: consumer override not found, using shipped default`);
  return path.join(bundledDir, `${name}.md`);
}

const PROJECT_SNIPPET_MAX_BYTES = 2048;

export function loadProjectSnippet(
  repoRoot: string,
  _checkExists: (p: string) => boolean = existsSync,
  _readFile: (p: string, enc: BufferEncoding) => string = (p, enc) => readFileSync(p, enc),
): string | null {
  const overridesDir = process.env.FERRY_PROMPTS_DIR || path.join(repoRoot, 'prompts');
  const candidates = [
    path.join(overridesDir, '_project.md'),
    path.join(repoRoot, '.ferry', 'prompts', '_project.md'),
  ];
  for (const candidate of candidates) {
    if (_checkExists(candidate)) {
      const raw = _readFile(candidate, 'utf8');
      if (raw.length > PROJECT_SNIPPET_MAX_BYTES) {
        console.error(
          `[ferry:prompts] _project.md exceeds ${PROJECT_SNIPPET_MAX_BYTES}B — truncating`,
        );
        return raw.slice(0, PROJECT_SNIPPET_MAX_BYTES);
      }
      console.error(`[ferry:prompts] loaded _project.md from ${candidate}`);
      return raw;
    }
  }
  return null;
}
