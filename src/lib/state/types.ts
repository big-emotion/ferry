export type FerryPhase =
  | 'refining'
  | 'developing'
  | 'reviewing'
  | 'iterating'
  | 'ready'
  | 'paused'
  | 'cancelled'
  | 'needs-human';

export interface Fingerprint {
  file: string;
  line_start: number;
  line_end: number;
  rule_id: string;
  hash: string;
}

export interface IterationHistoryEntry {
  iteration: number;
  run_id: string;
  completed_at: string;
  pr_sha: string;
  fingerprints: Fingerprint[];
  review_verdict?: 'clean' | 'findings' | 'escalate';
}

export interface FerryStateV1 {
  version: 'v1';
  ticket_key: string;
  phase: FerryPhase;
  run_id: string;
  prompt_version: string;
  iteration: number;
  iteration_history: IterationHistoryEntry[];
  updated_at: string;
  updated_by_run?: string;
  findings_fingerprints?: Fingerprint[];
  /** only present when Developer has opened a PR */
  pr_number?: number;
  /** HEAD SHA at the time this state was written — used by preflight SHA check */
  pr_sha?: string;
  /** set of touch_paths authorised by the Refiner */
  touch_paths?: string[];
}
