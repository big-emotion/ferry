import { FerryError } from '../errors/index.js';
import type { McpServerConfig } from '../llm/agent-loop/types.js';

export function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new FerryError('state-invariant', { reason: 'missing-env', key });
  return val;
}

export function loadMcpServers(): McpServerConfig[] {
  const raw = process.env.AGENT_MCP_SERVERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is McpServerConfig =>
        s !== null &&
        typeof s === 'object' &&
        typeof (s as Record<string, unknown>).name === 'string' &&
        typeof (s as Record<string, unknown>).url === 'string',
    );
  } catch {
    return [];
  }
}
