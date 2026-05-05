import type { Logger } from '../../logger/index.js';

export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type ToolHandler = (input: Record<string, unknown>) => Promise<string> | string;

export interface ToolLoopUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolCallRecord {
  name: string;
  outputSize: number;
}

export interface ToolLoopResult<T> {
  done: T;
  usage: ToolLoopUsage;
  iterations: number;
  toolCounts: Record<string, number>;
  toolCallRecords: ToolCallRecord[];
}

export interface ToolLoopRunOpts<T> {
  system: string;
  initialPrompt: string;
  tools: ToolDef[];
  /** Keyed by tool name; called when LLM invokes that tool. */
  handlers: Record<string, ToolHandler>;
  /** Name of the tool that terminates the loop. */
  finishTool: string;
  /** Extracts the typed result from the finish tool's input. */
  extractDone: (input: Record<string, unknown>) => T;
  maxIterations: number;
  maxTokens: number;
  logger: Logger;
}

export interface ToolCallLoop {
  run<T>(opts: ToolLoopRunOpts<T>): Promise<ToolLoopResult<T>>;
}
