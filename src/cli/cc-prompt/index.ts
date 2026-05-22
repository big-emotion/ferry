#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { BUNDLED_CC_PROMPTS } from './bundled.js';
import { parseArgs, renderPrompt, formatGithubOutput } from './cli.js';

const HELP = `ferry-cc-prompt — resolve the claude-code-path system prompt for a Ferry agent.

Usage:
  ferry-cc-prompt --agent <refiner|dev|review|iterate> --ticket-key <key> --run-id <id> [options]

Resolves prompts/<agent>.claude-code.md from the consumer repo when present,
otherwise Ferry's bundled default; substitutes runtime tokens; writes the result
to $GITHUB_OUTPUT (key: --output-name, default "prompt") or to stdout.

Options:
  --agent                  Agent: refiner | dev | review | iterate (required)
  --ticket-key             Jira ticket key (required)
  --run-id                 Ferry run id (required)
  --review-transition-id   FR18 / FR28 transition id (dev, iterate)
  --approve-transition-id  FR24 approve transition id (review; may be empty)
  --changes-transition-id  FR24 changes transition id (review)
  --repo-root              Consumer repo root (default: $GITHUB_WORKSPACE or cwd)
  --output-name            GITHUB_OUTPUT key (default: prompt)
  -h, --help               Show this help
`;

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const args = parseArgs(argv);
  const { text, source } = renderPrompt(args, BUNDLED_CC_PROMPTS);
  process.stderr.write(`ferry-cc-prompt: ${args.agent} prompt resolved (source: ${source})\n`);

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, formatGithubOutput(args.outputName, text), 'utf8');
  } else {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`ferry-cc-prompt: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
