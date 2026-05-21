#!/usr/bin/env node
/**
 * `ferry-jira-mcp` — stdio MCP server entrypoint.
 *
 * Published as the `ferry-jira-mcp` bin of the `@big-emotion/ferry` package so
 * a consumer's claude-code workflow can launch it via
 * `npx -p @big-emotion/ferry ferry-jira-mcp`. Authenticates to Jira with the
 * existing `FERRY_JIRA_BASE_URL` / `FERRY_JIRA_EMAIL` / `FERRY_JIRA_API_TOKEN`
 * environment variables.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createJiraRestClientFromEnv } from '../lib/io/jira-rest.js';
import { JiraTracker } from '../lib/io/tracker/jira/tracker.js';
import { createJiraMcpServer } from './server.js';

async function main(): Promise<void> {
  const client = createJiraRestClientFromEnv();
  const tracker = new JiraTracker(client);

  const server = createJiraMcpServer({
    tracker,
    getTransitions: async (key) => (await client.getTransitions(key)).transitions,
  });

  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  // stderr only — stdout is the MCP stdio channel and must stay protocol-clean.
  console.error(`ferry-jira-mcp: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
