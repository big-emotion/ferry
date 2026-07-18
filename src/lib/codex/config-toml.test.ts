import { describe, it, expect } from 'vitest';
import { renderCodexConfigToml } from './config-toml.js';

describe('renderCodexConfigToml', () => {
  it('renders a jira MCP server that launches ferry-jira-mcp through npx', () => {
    const toml = renderCodexConfigToml({ version: 'v0.19.0' });
    expect(toml).toContain('[mcp_servers.jira]');
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain('"@big-emotion/ferry@v0.19.0"');
    expect(toml).toContain('"ferry-jira-mcp"');
  });

  it('contains no embedded Jira secret values', () => {
    const toml = renderCodexConfigToml({ version: 'v0.19.0' });
    expect(toml).not.toContain('FERRY_JIRA_BASE_URL=');
    expect(toml).not.toContain('FERRY_JIRA_EMAIL=');
    expect(toml).not.toContain('FERRY_JIRA_API_TOKEN=');
  });
});
