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

const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const BACKSPACE = String.fromCharCode(8);
const DEL = String.fromCharCode(127);

export async function askSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    // Non-TTY (CI, pipes): the OS won't echo input anyway
    return ask(question);
  }

  // Close the shared readline to avoid conflicts while in raw mode
  closePrompt();

  return new Promise<string>((resolve) => {
    let value = '';
    output.write(`${question}: `);

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (char: string): void => {
      if (char === '\r' || char === '\n' || char === CTRL_D) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        output.write('\n');
        resolve(value);
      } else if (char === CTRL_C) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        output.write('\n');
        process.exit(130);
      } else if (char === DEL || char === BACKSPACE) {
        value = value.slice(0, -1);
      } else if (char.charCodeAt(0) >= 32) {
        value += char;
      }
    };

    process.stdin.on('data', onData);
  });
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
