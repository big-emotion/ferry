/**
 * Tool definitions and dispatch for the `ferry-jira-mcp` server.
 *
 * Exposes exactly the Jira operations the claude-code-path agents need: read a
 * ticket, enumerate / create sub-tasks, list / apply workflow transitions, and
 * post a comment. The agent holds Jira write credentials on this path, so the
 * surface is deliberately Ferry-owned and minimal (no third-party Jira MCP).
 *
 * Dispatch is a pure switch over an injected {@link JiraMcpDeps}, so it is
 * unit-testable with a fake tracker — no network, no env.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { IssueTracker } from '../lib/io/tracker/types.js';

/** A single workflow transition currently available on an issue. */
export interface JiraTransitionInfo {
  id: string;
  name: string;
}

/** Injected collaborators — the entrypoint wires these to a live Jira client. */
export interface JiraMcpDeps {
  tracker: IssueTracker;
  /** Lists the workflow transitions currently available on an issue. */
  getTransitions: (key: string) => Promise<JiraTransitionInfo[]>;
}

/**
 * Result shape returned to the MCP client. Structurally a `CallToolResult`;
 * the index signature satisfies that type's open (passthrough) object schema.
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

const KEY_PROP = { type: 'string', description: 'Jira issue key, e.g. ABC-123.' } as const;

/** The six tools exposed by the server. Shape matches MCP's `Tool` JSON Schema. */
export const JIRA_MCP_TOOLS: Tool[] = [
  {
    name: 'get_issue',
    description: 'Read a Jira issue: summary, description, comments, labels and issue type.',
    inputSchema: {
      type: 'object',
      properties: { key: KEY_PROP },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_subtasks',
    description:
      'List the sub-tasks of an issue with their key, title, description and status. ' +
      'Call this before creating sub-tasks to avoid creating duplicates.',
    inputSchema: {
      type: 'object',
      properties: { key: KEY_PROP },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_subtask',
    description: 'Create a sub-task under a parent issue.',
    inputSchema: {
      type: 'object',
      properties: {
        parent_key: { type: 'string', description: 'Key of the parent issue.' },
        title: { type: 'string', description: 'Sub-task summary / title.' },
        description: { type: 'string', description: 'Sub-task description (plain text).' },
      },
      required: ['parent_key', 'title', 'description'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_transitions',
    description: 'List the workflow transitions currently available on an issue.',
    inputSchema: {
      type: 'object',
      properties: { key: KEY_PROP },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'transition_issue',
    description: 'Move an issue through a workflow transition.',
    inputSchema: {
      type: 'object',
      properties: {
        key: KEY_PROP,
        transition_id: {
          type: 'string',
          description: 'Transition id, as returned by get_transitions.',
        },
      },
      required: ['key', 'transition_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'post_comment',
    description: 'Post a comment on an issue (plain text).',
    inputSchema: {
      type: 'object',
      properties: {
        key: KEY_PROP,
        body: { type: 'string', description: 'Comment body (plain text).' },
      },
      required: ['key', 'body'],
      additionalProperties: false,
    },
  },
];

/** Extracts a required, non-empty string argument or throws a caller-safe error. */
function str(args: Record<string, unknown> | undefined, field: string): string {
  const value = args?.[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`missing or invalid string argument: ${field}`);
  }
  return value;
}

/** Runs one tool and returns its textual payload. Throws on any failure. */
async function runTool(
  name: string,
  args: Record<string, unknown> | undefined,
  deps: JiraMcpDeps,
): Promise<string> {
  switch (name) {
    case 'get_issue':
      return JSON.stringify(await deps.tracker.getIssue(str(args, 'key')), null, 2);
    case 'list_subtasks':
      return JSON.stringify(await deps.tracker.getSubtaskDetails(str(args, 'key')), null, 2);
    case 'create_subtask':
      return JSON.stringify(
        await deps.tracker.createSubtask(
          str(args, 'parent_key'),
          str(args, 'title'),
          str(args, 'description'),
        ),
        null,
        2,
      );
    case 'get_transitions':
      return JSON.stringify(await deps.getTransitions(str(args, 'key')), null, 2);
    case 'transition_issue':
      await deps.tracker.postTransition(str(args, 'key'), str(args, 'transition_id'));
      return JSON.stringify({ ok: true });
    case 'post_comment':
      await deps.tracker.postComment(str(args, 'key'), str(args, 'body'));
      return JSON.stringify({ ok: true });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

/**
 * Dispatches a tool call. Never throws — failures are returned as an
 * `isError` result so the MCP client (the agent) sees the message and can
 * react, rather than the server connection dropping.
 */
export async function dispatchTool(
  name: string,
  args: Record<string, unknown> | undefined,
  deps: JiraMcpDeps,
): Promise<ToolResult> {
  try {
    return { content: [{ type: 'text', text: await runTool(name, args, deps) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
}
