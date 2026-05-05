export interface AgentTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// HTTP/SSE remote MCP server — executed server-side by the Anthropic MCP connector.
export interface HttpMcpServerConfig {
  type?: 'url';
  name: string;
  url: string;
  authorization_token?: string;
  allowed_tools?: string[];
  denied_tools?: string[];
}

// Stdio MCP server — executed client-side by spawning a local subprocess.
export interface StdioMcpServerConfig {
  type: 'stdio';
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  allowed_tools?: string[];
  denied_tools?: string[];
}

export type McpServerConfig = HttpMcpServerConfig | StdioMcpServerConfig;

export function isStdioMcpServer(s: McpServerConfig): s is StdioMcpServerConfig {
  return s.type === 'stdio';
}

export function isHttpMcpServer(s: McpServerConfig): s is HttpMcpServerConfig {
  return s.type !== 'stdio';
}

export interface ValidationEntry {
  command: string;
  outcome: string;
}

export type DoneOutcome = 'implemented' | 'already_satisfied' | 'blocked';

export interface DonePayload {
  actionable: boolean;
  outcome?: DoneOutcome;
  summary: string;
  commit_message?: string;
  /** Reason the ticket is blocked (used for outcome=blocked). */
  reason?: string;
  /** @deprecated use reason instead */
  reason_if_not_actionable?: string;
  validation?: ValidationEntry[];
  notes?: string[];
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
