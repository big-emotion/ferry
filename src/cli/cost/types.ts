export interface AuditLine {
  ticket: string;
  phase: string;
  run_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_eur: number;
  outcome: string;
  duration_ms: number;
  timestamp: string;
  triggered_labels?: string[];
  resolved_mcp_servers?: string[];
}

export interface GroupStats {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costEur: number;
}
