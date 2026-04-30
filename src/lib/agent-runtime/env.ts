import { FerryError } from '../errors/index.js';
import type { McpServerConfig } from '../llm/agent-loop/types.js';

export function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new FerryError('state-invariant', { reason: 'missing-env', key });
  return val;
}

function isValidMcpServer(s: unknown): s is McpServerConfig {
  if (s === null || typeof s !== 'object') return false;
  const obj = s as Record<string, unknown>;
  if (typeof obj.name !== 'string' || obj.name.length === 0) return false;
  if (obj.type === 'stdio') {
    return typeof obj.command === 'string' && obj.command.length > 0;
  }
  // HTTP server: type 'url' or absent
  return typeof obj.url === 'string' && obj.url.length > 0;
}

export function loadMcpServers(): McpServerConfig[] {
  const raw = process.env.AGENT_MCP_SERVERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidMcpServer);
  } catch {
    return [];
  }
}
