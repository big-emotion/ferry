import type { CheckResult, CheckStatus } from './types.js';

const ICONS: Record<CheckStatus, string> = {
  green: '✓',
  yellow: '⚠',
  red: '✗',
  skip: '–',
};

const LABELS: Record<CheckStatus, string> = {
  green: 'OK',
  yellow: 'WARN',
  red: 'FAIL',
  skip: 'SKIP',
};

function pad(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

export function renderTable(results: CheckResult[]): string {
  const lines: string[] = [];
  const labelWidth = Math.max(...results.map((r) => r.label.length), 20);

  lines.push('');
  lines.push('  ' + '─'.repeat(labelWidth + 30));

  for (const r of results) {
    const icon = ICONS[r.status];
    const statusTag = LABELS[r.status];
    const label = pad(r.label, labelWidth);
    lines.push(`  ${icon}  ${label}  [${statusTag}]  ${r.detail}`);
    if (r.remedy && (r.status === 'red' || r.status === 'yellow')) {
      lines.push(`       ${' '.repeat(labelWidth)}         → ${r.remedy}`);
    }
  }

  lines.push('  ' + '─'.repeat(labelWidth + 30));
  lines.push('');

  const reds = results.filter((r) => r.status === 'red').length;
  const yellows = results.filter((r) => r.status === 'yellow').length;
  const greens = results.filter((r) => r.status === 'green').length;

  if (reds > 0) {
    lines.push(`  ✗  ${reds} check(s) failed — ferry will not function until resolved`);
  } else if (yellows > 0) {
    lines.push(`  ⚠  ${greens} checks passed, ${yellows} warning(s) — review before going live`);
  } else {
    lines.push(`  ✓  All ${greens} checks passed — ferry is healthy`);
  }

  lines.push('');
  return lines.join('\n');
}
