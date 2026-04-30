import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';
import type { ValidateFunction } from 'ajv';
import { FerryError } from '../errors/index.js';
import type { FerryStateV1 } from './types.js';

const _require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stateSchema: Record<string, any> = _require('../../schemas/state.v1.schema.json');

// ajv v8 subpath 'ajv/dist/2020' has no package.json exports declaration.
// TypeScript NodeNext requires exports for subpath imports; createRequire bypasses this.
/* eslint-disable @typescript-eslint/no-explicit-any */
const ajvModule = _require('ajv/dist/2020') as {
  Ajv2020: new (opts?: any) => { compile: (s: any) => ValidateFunction };
};
const ajvInstance = new ajvModule.Ajv2020({ strict: true });
(_require('ajv-formats') as any).default(ajvInstance);
/* eslint-enable @typescript-eslint/no-explicit-any */

const validateState: ValidateFunction = ajvInstance.compile(stateSchema);

function statePath(stateDir: string): string {
  return join(stateDir, '.ferry', 'state.json');
}

export async function loadState(
  envelope: { ticket_key: string },
  stateDir: string = process.cwd(),
): Promise<FerryStateV1 | null> {
  const filePath = statePath(stateDir);
  if (!existsSync(filePath)) {
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    throw new FerryError('state-invariant', { reason: 'failed to parse state.json' });
  }

  if (!validateState(raw)) {
    const safePaths = (validateState.errors ?? []).map((e) => `${e.instancePath} ${e.keyword}`);
    throw new FerryError('state-invariant', { paths: safePaths });
  }

  const state = raw as FerryStateV1;
  if (state.ticket_key !== envelope.ticket_key) {
    throw new FerryError('state-invariant', { reason: 'ticket_key mismatch' });
  }

  return state;
}

export async function writeState(
  state: FerryStateV1,
  stateDir: string = process.cwd(),
): Promise<void> {
  const filePath = statePath(stateDir);
  const tmpPath = filePath + '.tmp';

  mkdirSync(dirname(filePath), { recursive: true });

  writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');

  let written: unknown;
  try {
    written = JSON.parse(readFileSync(tmpPath, 'utf-8'));
  } catch {
    unlinkSync(tmpPath);
    throw new FerryError('state-invariant', { reason: 'failed to re-read tmp state file' });
  }

  if (!validateState(written)) {
    unlinkSync(tmpPath);
    const safePaths = (validateState.errors ?? []).map((e) => `${e.instancePath} ${e.keyword}`);
    throw new FerryError('state-invariant', { paths: safePaths });
  }

  renameSync(tmpPath, filePath);
}
