export function renderCodexConfigToml(opts: { version: string }): string {
  const { version } = opts;

  return [
    '[mcp_servers.jira]',
    'command = "npx"',
    `args = ["-y", "-p", "@big-emotion/ferry@${version}", "ferry-jira-mcp"]`,
    '',
  ].join('\n');
}
