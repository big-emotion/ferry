/**
 * Minimal MCP stdio client implementing JSON-RPC 2.0 over stdin/stdout.
 *
 * Uses only Node.js built-ins so no extra npm package is required.
 * The wire format is newline-delimited JSON per the MCP stdio transport spec.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface McpImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface McpResourceContent {
  type: 'resource';
  resource: unknown;
}

export type McpContent = McpTextContent | McpImageContent | McpResourceContent;

export interface McpCallResult {
  content: McpContent[];
  isError?: boolean;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

type PendingCall = {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
};

export class StdioMcpClient {
  private readonly proc: ChildProcess;
  private readonly rl: readline.Interface;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private closed = false;
  private initialized = false;

  constructor(command: string, args: string[], env?: Record<string, string>) {
    const mergedEnv: NodeJS.ProcessEnv = env ? { ...process.env, ...env } : process.env;

    this.proc = spawn(command, args, {
      env: mergedEnv,
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    if (!this.proc.stdout || !this.proc.stdin) {
      throw new Error(`Failed to spawn MCP server: ${command}`);
    }

    this.rl = readline.createInterface({ input: this.proc.stdout, crlfDelay: Infinity });

    this.rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(trimmed) as JsonRpcResponse;
      } catch {
        return;
      }
      if (msg.id === undefined) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
      } else {
        p.resolve(msg.result);
      }
    });

    this.proc.once('exit', () => {
      const err = new Error('MCP server process exited unexpectedly');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.closed = true;
    });

    this.proc.once('error', (err: Error) => {
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.closed = true;
    });
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('MCP client is closed'));
    return new Promise<unknown>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      this.proc.stdin!.write(JSON.stringify(msg) + '\n');
    });
  }

  private notify(method: string, params?: unknown): void {
    if (this.closed) return;
    const msg: JsonRpcRequest = { jsonrpc: '2.0', method, params };
    this.proc.stdin!.write(JSON.stringify(msg) + '\n');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ferry-mcp-client', version: '1.0.0' },
    });
    this.notify('notifications/initialized');
    this.initialized = true;
  }

  async listTools(): Promise<McpTool[]> {
    if (!this.initialized) await this.initialize();
    const result = (await this.request('tools/list', {})) as { tools?: McpTool[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    if (!this.initialized) await this.initialize();
    return (await this.request('tools/call', {
      name,
      arguments: args,
    })) as McpCallResult;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rl.close();
    try {
      this.proc.stdin?.end();
    } catch {
      // ignore
    }
    this.proc.kill('SIGTERM');
    const err = new Error('MCP client closed');
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}
