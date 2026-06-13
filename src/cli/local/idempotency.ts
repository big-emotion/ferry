import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface SeenState {
  events: Record<string, string>;
}

export class LocalIdempotencyStore {
  private readonly rootDir: string;
  private readonly filePath: string;

  constructor(repoRoot: string) {
    this.rootDir = join(repoRoot, '.ferry-local');
    this.filePath = join(this.rootDir, 'seen.json');
    mkdirSync(this.rootDir, { recursive: true });
  }

  markIfUnseen(ticketKey: string, eventId: string): boolean {
    const state = this.readState();
    if (state.events[ticketKey] === eventId) return false;
    state.events[ticketKey] = eventId;
    this.writeState(state);
    return true;
  }

  private readState(): SeenState {
    if (!existsSync(this.filePath)) return { events: {} };
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<SeenState>;
      return {
        events: raw.events && typeof raw.events === 'object' ? raw.events : {},
      };
    } catch {
      return { events: {} };
    }
  }

  private writeState(state: SeenState): void {
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    renameSync(tempPath, this.filePath);
  }
}
