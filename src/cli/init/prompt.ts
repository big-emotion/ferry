import { createInterface, type Interface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

let _rl: Interface | null = null;

function rl(): Interface {
  if (!_rl) {
    _rl = createInterface({ input, output, terminal: false });
  }
  return _rl;
}

export async function ask(question: string, defaultValue?: string): Promise<string> {
  const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  const answer = await rl().question(prompt);
  const trimmed = answer.trim();
  return trimmed || defaultValue || '';
}

export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await ask(`${question} (${hint})`);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

export function closePrompt(): void {
  if (_rl) {
    _rl.close();
    _rl = null;
  }
}

export function print(msg: string): void {
  process.stdout.write(msg + '\n');
}

export function printStep(step: number, total: number, title: string): void {
  print(`\n[${step}/${total}] ${title}`);
}

export function printSuccess(msg: string): void {
  print(`  ✓ ${msg}`);
}

export function printSkip(msg: string): void {
  print(`  – ${msg}`);
}

export function printWarn(msg: string): void {
  print(`  ! ${msg}`);
}

export function printError(msg: string): void {
  print(`  ✗ ${msg}`);
}
