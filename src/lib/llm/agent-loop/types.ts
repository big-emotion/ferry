export interface AgentTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// MCP server descriptor for HTTP/SSE remote servers (stdio is out of scope).
export interface McpServerConfig {
  name: string;
  url: string;
  authorization_token?: string;
  allowed_tools?: string[];
  denied_tools?: string[];
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
