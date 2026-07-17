#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { loadFerryConfig } from '../../lib/config.js';
import { createTrackerFromEnv } from '../../lib/io/tracker/factory.js';
import { parseArgs, resolveTransition, formatGithubOutput } from './cli.js';

const HELP = `ferry-resolve-transition — resolve a Jira workflow transition id from ferry.config.json.

Resolves the target status name configured in workflow.agents.<agent>.auto_transition*
to the numeric transition id available on the ticket, so consumers no longer set
FERRY_*_TRANSITION_ID secrets by hand. Writes the id to $GITHUB_OUTPUT (key:
--output-name, default "transition_id") or to stdout.

Usage:
  ferry-resolve-transition --ticket-key <key> --agent <dev|iterate|review|merge> --kind <review|approve|changes|done> [options]

Options:
  --ticket-key    Jira ticket key (required)
  --agent         dev | iterate | review | merge (required)
  --kind          review (dev/iterate) | approve | changes (review) | done (merge) (required)
  --fallback-id   Explicit transition id to use verbatim (FERRY_*_TRANSITION_ID override)
  --repo-root     Consumer repo root (default: $GITHUB_WORKSPACE or cwd)
  --output-name   GITHUB_OUTPUT key (default: transition_id)
  -h, --help      Show this help

Jira credentials (FERRY_JIRA_BASE_URL / FERRY_JIRA_EMAIL / FERRY_JIRA_API_TOKEN) are
read from the environment, and only when a lookup is actually needed.
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const args = parseArgs(argv);
  const cfg = loadFerryConfig(args.repoRoot);
  // The tracker is built lazily inside the fetch callback so a disabled
  // transition (or an explicit --fallback-id) never requires Jira credentials.
  const id = await resolveTransition(args, cfg, (key) =>
    createTrackerFromEnv().getTransitions(key),
  );

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, formatGithubOutput(args.outputName, id), 'utf8');
  } else {
    process.stdout.write(`${id}\n`);
  }
  process.stderr.write(
    `ferry-resolve-transition: ${args.agent}/${args.kind} -> ${id === '' ? '(disabled)' : id}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `ferry-resolve-transition: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
