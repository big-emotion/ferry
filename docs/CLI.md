# Ferry — CLI Commands

## Lifecycle commands

| Command                                     | What it does                     |
| ------------------------------------------- | -------------------------------- |
| `npx -p @big-emotion/ferry ferry-init`      | Scaffold Ferry into a new repo   |
| `npx -p @big-emotion/ferry ferry-doctor`    | Diagnose configuration issues    |
| `npx -p @big-emotion/ferry ferry-update`    | Upgrade Ferry to a newer version |
| `npx -p @big-emotion/ferry ferry-uninstall` | Remove Ferry from a repo         |

GitLab CI uses the same four lifecycle commands with `--forge gitlab`:

| Command                                                    | What it does                                              |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `npx -p @big-emotion/ferry ferry-init --forge gitlab`      | Scaffold `ci/ferry/*.gitlab-ci.yml` into a GitLab repo    |
| `npx -p @big-emotion/ferry ferry-doctor --forge gitlab`    | Validate the GitLab project token, trigger, and variables |
| `npx -p @big-emotion/ferry ferry-update --forge gitlab`    | Rewrite pinned Ferry versions in GitLab CI files          |
| `npx -p @big-emotion/ferry ferry-uninstall --forge gitlab` | Plan or remove the local GitLab install                   |

`ferry-doctor` will warn when a newer version is available:

```
! Ferry update available: v0.4.0 → v0.4.1
  Run `npx -p @big-emotion/ferry@0.4.1 ferry-update` to upgrade
```

See [`MIGRATIONS.md`](../MIGRATIONS.md) for consumer-visible changes per release.

---

## Upgrading Ferry

To upgrade the pinned Ferry version in your workflow files without re-entering credentials:

```bash
npx -p @big-emotion/ferry@<new-version> ferry-update
```

Options:

| Flag               | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `--dry-run`        | Print the diff, write nothing                        |
| `--yes`            | Skip confirmation prompt                             |
| `--from <version>` | Override autodetected current version                |
| `--to <version>`   | Target a specific version (default: package version) |

---

## Reviewer-grade tool

A small interactive CLI ships to grade reviewer output and emit a `reviewer_grade` audit line:

```bash
tsx scripts/ferry-grade.ts <pr-number>
```

It prompts for four integers (Substantive / Specific / Correct / Actionable, each 0–2) and prints one JSON audit line. Verdict thresholds and the **Correct=0 cap** rule are defined in [`scripts/grade.ts`](../scripts/grade.ts). This is a contributor utility — not part of the consumer-facing install.
