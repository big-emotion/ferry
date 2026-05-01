import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '../logger/index.js';

export function resolvePromptPath(
  name: string,
  repoRoot: string,
  _checkExists: (p: string) => boolean = existsSync,
  _logger?: Logger,
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
  _logger?.info(`${name}: consumer override not found, using shipped default`);
  return path.join(bundledDir, `${name}.md`);
}

const PROJECT_SNIPPET_MAX_BYTES = 2048;

export function loadProjectSnippet(
  repoRoot: string,
  _checkExists: (p: string) => boolean = existsSync,
  _readFile: (p: string, enc: BufferEncoding) => string = (p, enc) => readFileSync(p, enc),
  _logger?: Logger,
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
        _logger?.warn('_project.md exceeds limit — truncating', { limit: PROJECT_SNIPPET_MAX_BYTES });
        return raw.slice(0, PROJECT_SNIPPET_MAX_BYTES);
      }
      _logger?.info('loaded _project.md', { path: candidate });
      return raw;
    }
  }
  return null;
}

const AGENT_EXTENSION_MAX_BYTES = 4096;

export function loadAgentExtension(
  name: string,
  repoRoot: string,
  _checkExists: (p: string) => boolean = existsSync,
  _readFile: (p: string, enc: BufferEncoding) => string = (p, enc) => readFileSync(p, enc),
  _logger?: Logger,
): string | null {
  const overridesDir = process.env.FERRY_PROMPTS_DIR || path.join(repoRoot, 'prompts');
  const candidate = path.join(overridesDir, `${name}.extra.md`);
  if (!_checkExists(candidate)) {
    return null;
  }
  const raw = _readFile(candidate, 'utf8');
  if (raw.length > AGENT_EXTENSION_MAX_BYTES) {
    _logger?.warn(`${name}.extra.md exceeds limit — truncating`, { limit: AGENT_EXTENSION_MAX_BYTES });
    return raw.slice(0, AGENT_EXTENSION_MAX_BYTES);
  }
  _logger?.info(`loaded ${name}.extra.md`, { path: candidate });
  return raw;
}
