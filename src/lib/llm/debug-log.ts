// Debug events contain only numeric counters and stop_reason enum — no string payloads
// from tool inputs/outputs — so no secret-redaction is needed for these events.

export type DebugEvent =
  | {
      type: 'turn';
      iter: number;
      depth: number;
      stop_reason: string;
      tools: number;
      mcp_tools: number;
      in: number;
      cache_w: number;
      cache_r: number;
      out: number;
      elapsed_ms: number;
    }
  | {
      type: 'result';
      subtype: 'success';
      iterations: number;
      total_in: number;
      total_out: number;
      elapsed_ms: number;
    };

function isDebugEnabled(env?: NodeJS.ProcessEnv): boolean {
  return (env ?? process.env)['LOG_VERBOSITY'] === 'debug';
}

/** Emit one JSON line on stderr when debug is enabled; no-op otherwise. */
export function emitDebug(event: DebugEvent, env?: NodeJS.ProcessEnv): void {
  if (!isDebugEnabled(env)) return;
  console.error(JSON.stringify(event));
}
