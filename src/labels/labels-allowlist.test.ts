import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { LABELS_ALLOWLIST } from './allowlist.js';

const LABEL_PATTERN = /['"`]((?:ferry:|agent:|needs-human|status:|critical)[^'"`\s]+)['"`]/g;

function walkTs(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walkTs(full));
    } else if (full.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('labels allowlist', () => {
  it('every label used in src/lib/ and src/agents/ belongs to the allowlist', () => {
    const roots = [join(process.cwd(), 'src', 'lib'), join(process.cwd(), 'src', 'agents')];
    const violations: Array<{ file: string; label: string }> = [];

    for (const root of roots) {
      let files: string[] = [];
      try {
        files = walkTs(root);
      } catch {
        // directory may not exist yet
        continue;
      }
      for (const file of files) {
        const source = readFileSync(file, 'utf-8');
        let match: RegExpExecArray | null;
        LABEL_PATTERN.lastIndex = 0;
        while ((match = LABEL_PATTERN.exec(source)) !== null) {
          const label = match[1];
          if (!(LABELS_ALLOWLIST as readonly string[]).includes(label)) {
            violations.push({ file: file.replace(process.cwd() + '/', ''), label });
          }
        }
      }
    }

    expect(violations, `Labels not in allowlist: ${JSON.stringify(violations)}`).toHaveLength(0);
  });
});
