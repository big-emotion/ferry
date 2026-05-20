<p align="center">
  <img src="logos/ferry-lockup-stacked.svg" alt="Ferry" width="240">
</p>

# Ferry

> **GitHub Actions–native agent pipeline for Jira-driven automated development.**

[![CI](https://github.com/big-emotion/ferry/actions/workflows/ferry-ci.yml/badge.svg)](https://github.com/big-emotion/ferry/actions/workflows/ferry-ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

```
Jira board  ──▶  repository_dispatch  ──▶  GitHub Actions  ──▶  draft PR
   (you)              (automatic)           (autonomous)        (you merge)
```

Ferry connects your Jira board to a fully autonomous dev loop — Refiner, Developer, Reviewer, and Iterator agents run as GitHub Actions workflows, triggered by column transitions on your Jira tickets.

**Learn more in the [Ferry documentation](docs/).**

---

## Get started

> Requires Node ≥ 20, a Jira Cloud project, and a GitHub App. See the [install guide](docs/INSTALL.md) for prerequisites and the four follow-up steps after the wizard.

```bash
npx -p @big-emotion/ferry ferry-init
```

Then move a Jira ticket into your **Refinement** column and Ferry takes over.

---

## CLI commands

See [docs/CLI.md](docs/CLI.md) — `ferry-init`, `ferry-doctor`, `ferry-update`, `ferry-uninstall`.

---

## Documentation

- [Install guide](docs/INSTALL.md) — prerequisites, wizard walkthrough, Jira automation setup
- [How Ferry works](docs/OVERVIEW.md) — what it is and isn't, agent phases, auto-transitions
- [Configuration reference](docs/CONFIGURATION.md) — includes the [Session log artifact](docs/CONFIGURATION.md#session-log-artifact) reference (artifact naming, 7-day retention, secret-exposure risk, and download instructions for `claude-code-action` runs)
- [MCP servers](docs/MCP.md)
- [Cost governance](docs/COST.md)
- [Runbook](docs/RUNBOOK.md)

---

## Privacy

Ferry sends Jira and repo content to your configured LLM provider. See [docs/PRIVACY.md](docs/PRIVACY.md) before pointing it at confidential code.

---

## Reporting bugs

File a [GitHub issue](https://github.com/big-emotion/ferry/issues).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=big-emotion/ferry&type=date)](https://star-history.com/#big-emotion/ferry&Date)

---

## License

MIT
