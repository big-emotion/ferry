import { existsSync } from 'node:fs';
import * as path from 'node:path';

export function resolvePromptPath(
  name: string,
  repoRoot: string,
  _checkExists: (p: string) => boolean = existsSync,
): string {
  const overridesDir = process.env.FERRY_PROMPTS_DIR ?? path.join(repoRoot, 'prompts');
  const overridePath = path.join(overridesDir, `${name}.md`);
  if (_checkExists(overridePath)) {
    return overridePath;
  }
  const defaultPath = path.join(repoRoot, '.ferry', 'prompts', `${name}.md`);
  console.error(`[ferry:prompts] ${name}: consumer override not found, using shipped default`);
  return defaultPath;
}
