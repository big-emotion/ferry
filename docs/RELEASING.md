# Ferry Release Guide

This document covers how Ferry is versioned, tagged, and released.

---

## Versioning policy

Ferry follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (`MAJOR.MINOR.PATCH`):

| Increment | When                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **MAJOR** | Breaking changes to the `EventEnvelopeV1` schema, agent output contracts, or composite-action interfaces that require consumer changes |
| **MINOR** | New agents, new LLM providers, new composite actions, or backward-compatible feature additions                                         |
| **PATCH** | Bug fixes, documentation updates, prompt tuning, internal refactors                                                                    |

---

## Tag strategy — floating `v0` and immutable `v0.x.y`

Ferry maintains **two tag types per major release**:

| Tag      | Type      | Moves?                                 | Purpose                                                                                                                           |
| -------- | --------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `v0`     | Floating  | Yes — updated on every `0.x.y` release | Optional reference for consumers who want patch/minor updates automatically                                                       |
| `v0.2.0` | Immutable | Never                                  | Default reference in consumer workflow stubs (`uses: big-emotion/ferry/.github/workflows/...@v0.2.0`); recommended for production |

**Consumer recommendation:** Stay on the pinned `@v0.2.0` tag (or a SHA pin) for production. The floating `@v0` tag is available for consumers who prefer automatic minor/patch upgrades — see `docs/CONSUMER-SETUP.md` §3.2.

### Why a floating major tag?

GitHub Actions convention (e.g., `actions/checkout@v4`) uses a floating major tag so consumers receive patch and minor updates automatically without changing their workflow files. Ferry follows the same convention.

The floating tag is always safe to follow because:

- Patch releases fix bugs and never break the API
- Minor releases are backward-compatible
- MAJOR bumps increment the tag (`v1`, `v2`, …) and leave `v0` frozen at the last `0.x.y`

---

## SHA pinning (recommended for production)

Replace `@v0.2.0` with the exact commit SHA the tag points to:

```bash
LATEST_SHA=$(gh api repos/big-emotion/ferry/git/refs/tags/v0.2.0 --jq '.object.sha')
sed -i.bak "s|@v0.2.0|@${LATEST_SHA}|g" .github/workflows/ferry-*.yml
rm .github/workflows/ferry-*.yml.bak
```

**Renewal cadence:** Refresh pinned SHAs every 1–2 months, or configure [Dependabot for GitHub Actions](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/keeping-your-actions-up-to-date-with-dependabot):

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
```

---

## Release workflow

Releases are cut by a maintainer using the `ferry-release` skill (recommended) or the manual flow below. The `version` lifecycle hook in `package.json` (`"version": "npm run build:ferry && git add .ferry/"`) ensures `.ferry/` bundles are rebuilt and staged automatically when `npm version` runs.

The `.github/workflows/release.yml` workflow is triggered by any `v*.*.*` tag push and **automatically**:

1. Runs the full CI gate (typecheck, lint, format, tests, npm audit, `.ferry/` bundle drift check)
2. Builds CLI bundles (`npm run build:cli`)
3. Publishes the `ferry-init` package to npm with provenance (requires the `NPM_TOKEN` repo secret)
4. Extracts the matching `## [X.Y.Z]` section from `CHANGELOG.md` and creates a GitHub Release with those notes (falls back to GitHub's auto-generated notes if the section is missing)

The maintainer's only manual responsibilities are bumping the version, updating the CHANGELOG, and pushing the tag.

### Recommended (skill-driven)

```bash
# Run the skill — it bumps package.json, updates CHANGELOG.md and docs,
# rebuilds .ferry/, runs CI gates locally, creates the commit + annotated tag,
# and asks for explicit confirmation before pushing main + tag.
/ferry-release patch   # or minor / major / <explicit-version>
```

### Manual

```bash
# 1. Bump version — auto-rebuilds .ferry/ via the version hook,
#    creates the version commit, and tags v<version>.
npm version patch   # or minor / major

# 2. Update CHANGELOG.md with a new [<version>] section before pushing.

# 3. Push the commit and the new tag (this triggers release.yml).
git push origin main
git push origin "v$(node -p "require('./package.json').version")"

# 4. Force-update the floating major tag.
git tag -f v0
git push origin v0 --force
```

The GitHub Release and npm publish are created automatically by `release.yml` — no manual `gh release create` or `npm publish` step is needed.

---

## Cutting the initial v0 / v0.1.0 tags

After this PR is merged into `main`, a maintainer with `contents: write` permission must run:

```bash
# Clone / pull the latest main
git checkout main && git pull

# Build bundles (must be committed first)
npm ci && npm run build:ferry
git add .ferry/ && git commit -m "chore: build .ferry bundles for v0.1.0" || true
git push origin main

# Create the immutable tag
git tag -a v0.1.0 -m "Ferry v0.1.0 — initial release"
git push origin v0.1.0

# Create (or force-update) the floating major tag
git tag -f v0
git push origin v0 --force
```

> **Why `--force` for the floating tag?** The floating `v0` must always point to the latest `0.x.y` commit. Force-push is intentional and safe here — it only moves a tag pointer, not history.

---

## Pre-release checklist

Before tagging any release:

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run format:check` passes
- [ ] `npm test` passes
- [ ] `npm run build:ferry` succeeds and `.ferry/` is committed
- [ ] `CHANGELOG.md` updated with the new version section
- [ ] `package.json` `version` bumped
- [ ] `docs/CONSUMER-SETUP.md` verified end-to-end on a clean test repo (P0 for MAJOR releases)

---

## npm publishing

The `ferry-init` package is published to npm automatically by `release.yml` on every `v*.*.*` tag push, using `npm publish --provenance --access public`. The primary distribution mechanism for the GitHub Actions side remains the reusable workflows referenced via `@v0.2.0` (or a pinned SHA).

Required repository secret:

- `NPM_TOKEN` — an npm Automation token (or Granular Access Token with `publish` scope on the `ferry-init` package).

Manual publish (only as a fallback if the workflow is unavailable):

```bash
npm run build:cli
npm publish --access public
```
