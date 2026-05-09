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

/** Context7 is enabled by default for all agents. Set FERRY_MCP_DEFAULTS_DISABLED=true to opt out. */
export const DEFAULT_MCP_SERVERS: McpServerConfig[] = [
  { name: 'context7', url: 'https://mcp.context7.com/mcp' },
];

export function loadMcpServers(): McpServerConfig[] {
  const defaults =
    process.env.FERRY_MCP_DEFAULTS_DISABLED === 'true' ? [] : [...DEFAULT_MCP_SERVERS];

  const raw = process.env.AGENT_MCP_SERVERS;
  if (!raw) return defaults;

  let consumer: McpServerConfig[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaults;
    consumer = parsed.filter(isValidMcpServer);
  } catch {
    return defaults;
  }

  // Consumer entries with the same name shadow the default (allows disabling context7 by name)
  const consumerNames = new Set(consumer.map((s) => s.name));
  const filteredDefaults = defaults.filter((d) => !consumerNames.has(d.name));
  return [...filteredDefaults, ...consumer];
}
