export interface AgentTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Minimal MCP server descriptor — wired up in #39; carried here so #39 doesn't reshape the interface.
export interface McpServerConfig {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

export interface DonePayload {
  actionable: boolean;
  summary: string;
  commit_message?: string;
  reason_if_not_actionable?: string;
}

export interface AgentLoopUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface AgentLoopResult {
  done: DonePayload;
  usage: AgentLoopUsage;
  iterations: number;
}

export interface AgentLoop {
  run(input: {
    system: string;
    initialPrompt: string;
    tools: AgentTool[];
    repoRoot: string;
    branchName: string;
    secretScan: () => Promise<void>;
    mcpServers?: McpServerConfig[];
  }): Promise<AgentLoopResult>;
}
