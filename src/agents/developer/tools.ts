import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { AgentTool } from '../../lib/llm/agent-loop/types.js';
import { assertPathUnderRoot, assertWriteAllowed, assertBashAllowed } from './sandbox.js';

export type ToolName =
  | 'read_file'
  | 'write_file'
  | 'str_replace'
  | 'delete_file'
  | 'move_file'
  | 'list_dir'
  | 'search_files'
  | 'bash'
  | 'done';

const MAX_BASH_OUTPUT = 64 * 1024;
const DEFAULT_BASH_TIMEOUT_MS = 60_000;
const MAX_BASH_TIMEOUT_MS = 300_000;
const MAX_SEARCH_MATCHES = 200;

export const TOOL_SCHEMAS: AgentTool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file under the repository root.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path relative to repo root.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file. mkdir -p is applied automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path relative to repo root.' },
        content: { type: 'string', description: 'Full file content to write.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'str_replace',
    description: 'Surgical edit: replace a unique string in a file with new_str.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path relative to repo root.' },
        old_str: { type: 'string', description: 'String to replace (must be unique in the file).' },
        new_str: { type: 'string', description: 'Replacement string.' },
      },
      required: ['path', 'old_str', 'new_str'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path relative to repo root.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        source: { type: 'string', description: 'Source path relative to repo root.' },
        destination: { type: 'string', description: 'Destination path relative to repo root.' },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'list_dir',
    description: 'List directory contents as a tree (default depth 1, max 3).',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to repo root. Defaults to root.',
        },
        max_depth: { type: 'number', description: 'Max depth (1–3). Default 1.' },
      },
      required: [],
    },
  },
  {
    name: 'search_files',
    description: 'Grep for a pattern across files. Capped at 200 matches.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Grep regex pattern.' },
        path: {
          type: 'string',
          description: 'Directory to search (relative to repo root). Defaults to root.',
        },
        glob: { type: 'string', description: 'File glob filter, e.g. "*.ts".' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'bash',
    description:
      'Run a shell command (bash -c). Returns exit_code, stdout, stderr. Output capped at 64KB.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Shell command to run.' },
        timeout_ms: {
          type: 'number',
          description: `Timeout in ms (default ${DEFAULT_BASH_TIMEOUT_MS}, max ${MAX_BASH_TIMEOUT_MS}).`,
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'done',
    description: 'Terminate the loop. Call when implementation is complete or cannot be done.',
    input_schema: {
      type: 'object' as const,
      properties: {
        actionable: {
          type: 'boolean',
          description: 'true if changes were made, false if ticket cannot be implemented.',
        },
        summary: { type: 'string', description: 'One sentence describing what was implemented.' },
        commit_message: {
          type: 'string',
          description:
            'Conventional commit message for any remaining uncommitted changes (required when actionable: true).',
        },
        reason_if_not_actionable: {
          type: 'string',
          description: 'Reason the ticket cannot be implemented (required when actionable: false).',
        },
        validation: {
          type: 'array',
          description:
            'Validation commands run during this session and their outcomes (used in the PR body).',
          items: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Command run, e.g. "npm test".' },
              outcome: {
                type: 'string',
                description: 'Result, e.g. "74 files / 371 tests passed".',
              },
            },
            required: ['command', 'outcome'],
          },
        },
        notes: {
          type: 'array',
          description:
            'Noteworthy side-effects, follow-ups, deprecated paths, or config changes (used in the PR body).',
          items: { type: 'string' },
        },
      },
      required: ['actionable', 'summary'],
    },
  },
];

export const COMMIT_PROGRESS_SCHEMA: AgentTool = {
  name: 'commit_progress',
  description:
    'Stage all changes, run a secret scan, commit, and push to the working branch as a checkpoint. Call after completing each logical subtask — if the job fails later, the next run resumes from this commit.',
  input_schema: {
    type: 'object' as const,
    properties: {
      message: { type: 'string', description: 'Commit message in conventional commits format.' },
    },
    required: ['message'],
  },
};

export const SPAWN_SUBAGENT_SCHEMA: AgentTool = {
  name: 'spawn_subagent',
  description:
    'Delegate a self-contained subtask to a sub-agent with a fresh context window. The sub-agent has the same tools (except spawn_subagent) and works on the same branch. Use to keep each chunk of work focused and within token limits.',
  input_schema: {
    type: 'object' as const,
    properties: {
      task: {
        type: 'string',
        description:
          'Full, self-contained description of the subtask. Include all context the sub-agent needs to complete it independently.',
      },
    },
    required: ['task'],
  },
};

function buildTree(
  dirPath: string,
  maxDepth: number,
  currentDepth: number,
  prefix: string,
): string {
  if (currentDepth > maxDepth) return '';
  let result = '';
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return '';
  }
  entries = entries.filter((e) => !e.name.startsWith('.') || e.name === '.ferry');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    result += `${prefix}${connector}${entry.name}\n`;
    if (entry.isDirectory() && currentDepth < maxDepth) {
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      result += buildTree(path.join(dirPath, entry.name), maxDepth, currentDepth + 1, childPrefix);
    }
  }
  return result;
}

export async function executeTool(
  repoRoot: string,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name as ToolName) {
    case 'read_file': {
      const resolved = assertPathUnderRoot(repoRoot, input.path as string);
      try {
        return await fsp.readFile(resolved, 'utf8');
      } catch (e) {
        throw new Error(`read_file failed: ${(e as NodeJS.ErrnoException).message}`);
      }
    }

    case 'write_file': {
      const resolved = assertPathUnderRoot(repoRoot, input.path as string);
      assertWriteAllowed(repoRoot, resolved);
      await fsp.mkdir(path.dirname(resolved), { recursive: true });
      await fsp.writeFile(resolved, input.content as string, 'utf8');
      return `Written: ${path.relative(repoRoot, resolved)}`;
    }

    case 'str_replace': {
      const resolved = assertPathUnderRoot(repoRoot, input.path as string);
      assertWriteAllowed(repoRoot, resolved);
      let content: string;
      try {
        content = await fsp.readFile(resolved, 'utf8');
      } catch (e) {
        throw new Error(`str_replace: cannot read file: ${(e as NodeJS.ErrnoException).message}`);
      }
      const oldStr = input.old_str as string;
      const idx = content.indexOf(oldStr);
      if (idx === -1) throw new Error('str_replace: old_str not found in file');
      const secondIdx = content.indexOf(oldStr, idx + 1);
      if (secondIdx !== -1) throw new Error('str_replace: old_str is not unique in file');
      const newContent =
        content.slice(0, idx) + (input.new_str as string) + content.slice(idx + oldStr.length);
      await fsp.writeFile(resolved, newContent, 'utf8');
      return `Replaced in: ${path.relative(repoRoot, resolved)}`;
    }

    case 'delete_file': {
      const resolved = assertPathUnderRoot(repoRoot, input.path as string);
      assertWriteAllowed(repoRoot, resolved);
      try {
        await fsp.unlink(resolved);
      } catch (e) {
        throw new Error(`delete_file failed: ${(e as NodeJS.ErrnoException).message}`);
      }
      return `Deleted: ${path.relative(repoRoot, resolved)}`;
    }

    case 'move_file': {
      const srcResolved = assertPathUnderRoot(repoRoot, input.source as string);
      const dstResolved = assertPathUnderRoot(repoRoot, input.destination as string);
      assertWriteAllowed(repoRoot, srcResolved);
      assertWriteAllowed(repoRoot, dstResolved);
      await fsp.mkdir(path.dirname(dstResolved), { recursive: true });
      await fsp.rename(srcResolved, dstResolved);
      return `Moved: ${path.relative(repoRoot, srcResolved)} → ${path.relative(repoRoot, dstResolved)}`;
    }

    case 'list_dir': {
      const dirInput = (input.path as string | undefined) ?? '.';
      const resolved = assertPathUnderRoot(repoRoot, dirInput);
      const rawDepth = input.max_depth as number | undefined;
      const maxDepth = rawDepth !== undefined ? Math.min(Math.max(rawDepth, 1), 3) : 1;
      const rel = path.relative(repoRoot, resolved) || '.';
      return `${rel}/\n` + buildTree(resolved, maxDepth, 1, '');
    }

    case 'search_files': {
      const pattern = input.pattern as string;
      const searchPath = (input.path as string | undefined) ?? '.';
      const glob = (input.glob as string | undefined) ?? '';
      const resolved = assertPathUnderRoot(repoRoot, searchPath);

      const args = ['-rn', '--include', glob || '*', pattern, resolved];
      const result = await runProcess('grep', args, repoRoot, 30_000);
      const lines = result.stdout.split('\n').filter(Boolean);
      const truncated = lines.slice(0, MAX_SEARCH_MATCHES);
      const suffix =
        lines.length > MAX_SEARCH_MATCHES
          ? `\n[truncated: ${lines.length - MAX_SEARCH_MATCHES} more matches]`
          : '';
      return truncated.join('\n') + suffix || '(no matches)';
    }

    case 'bash': {
      const command = input.command as string;
      assertBashAllowed(command);
      const timeoutMs = Math.min(
        (input.timeout_ms as number | undefined) ?? DEFAULT_BASH_TIMEOUT_MS,
        MAX_BASH_TIMEOUT_MS,
      );
      const result = await runProcess('bash', ['-c', command], repoRoot, timeoutMs);
      const combined = `exit_code: ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
      return combined.slice(0, MAX_BASH_OUTPUT);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runProcess(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}
