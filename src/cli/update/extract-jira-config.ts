import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ExtractedJiraConfig {
  owner: string;
  repo: string;
}

/**
 * Extract GitHub owner/repo from the existing ferry-jira-automation-setup.md file.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export function extractJiraConfigFromSetupFile(repoRoot: string): ExtractedJiraConfig | null {
  const setupPath = join(repoRoot, 'ferry-jira-automation-setup.md');

  try {
    const content = readFileSync(setupPath, 'utf8');

    // Look for the dispatch URL pattern in the markdown:
    // https://api.github.com/repos/OWNER/REPO/dispatches
    const urlMatch = content.match(
      /https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/\s`]+)\/dispatches/,
    );
    if (!urlMatch || !urlMatch[1] || !urlMatch[2]) {
      return null;
    }

    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
    };
  } catch {
    // File doesn't exist or can't be read
    return null;
  }
}
