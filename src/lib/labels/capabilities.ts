import type { LabelCapability } from '../config.js';
import type { McpServerConfig } from '../llm/agent-loop/types.js';

export interface ResolvedCapabilities {
  mcpServerNames: string[];
  serverAllowedTools: Record<string, string[]>; // server name → tools (empty = all allowed)
  triggeredLabels: string[];
  unknownFerryLabels: string[];
}

/**
 * Resolves ticket labels against the ferry.config labels section.
 *
 * Only labels declared in configLabels are honoured. Any ferry:* label
 * not present in configLabels is logged to stderr and excluded.
 */
export function resolveCapabilities(
  ticketLabels: string[],
  configLabels: Record<string, LabelCapability> | undefined,
): ResolvedCapabilities {
  if (!configLabels) {
    return {
      mcpServerNames: [],
      serverAllowedTools: {},
      triggeredLabels: [],
      unknownFerryLabels: [],
    };
  }

  const triggeredLabels: string[] = [];
  const unknownFerryLabels: string[] = [];

  // server name → union of allowed tools (null = all tools allowed)
  const serverToolSets: Record<string, Set<string> | null> = {};

  for (const label of ticketLabels) {
    if (Object.prototype.hasOwnProperty.call(configLabels, label)) {
      triggeredLabels.push(label);
      const cap = configLabels[label];
      for (const server of cap.mcp_servers ?? []) {
        if (cap.tools && cap.tools.length > 0) {
          if (serverToolSets[server] === undefined) {
            serverToolSets[server] = new Set(cap.tools);
          } else if (serverToolSets[server] !== null) {
            for (const t of cap.tools) serverToolSets[server].add(t);
          }
          // if already null (all tools allowed from a previous label), keep null
        } else {
          serverToolSets[server] = null; // all tools from this server allowed
        }
      }
    } else if (label.startsWith('ferry:')) {
      unknownFerryLabels.push(label);
      console.error(`[ferry:capabilities] unknown ferry label ignored: ${label}`);
    }
  }

  const serverAllowedTools: Record<string, string[]> = {};
  for (const [server, tools] of Object.entries(serverToolSets)) {
    serverAllowedTools[server] = tools ? [...tools] : [];
  }

  return {
    mcpServerNames: Object.keys(serverToolSets),
    serverAllowedTools,
    triggeredLabels,
    unknownFerryLabels,
  };
}

/**
 * Filters a pool of MCP servers to those enabled by the resolved capabilities.
 * Applies per-server tool allowlists where specified.
 *
 * If configLabels is undefined (no labels section in ferry.config), returns
 * the full pool unchanged to preserve backward compatibility.
 */
export function filterMcpServers(
  pool: McpServerConfig[],
  capabilities: ResolvedCapabilities,
  hasLabelsConfig: boolean,
): McpServerConfig[] {
  if (!hasLabelsConfig) return pool;
  return pool
    .filter((s) => capabilities.mcpServerNames.includes(s.name))
    .map((s): McpServerConfig => {
      const allowedTools = capabilities.serverAllowedTools[s.name];
      if (allowedTools && allowedTools.length > 0) {
        return { ...s, allowed_tools: allowedTools } as McpServerConfig;
      }
      return s;
    });
}
