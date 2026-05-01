# Ferry Release Guide

This document covers how Ferry is versioned, tagged, and released.

---

## Versioning policy

Ferry follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (`MAJOR.MINOR.PATCH`):

| Increment | When |
|-----------|------|
| **MAJOR** | Breaking changes to the `EventEnvelopeV1` schema, agent output contracts, or composite-action interfaces that require consumer changes |
| **MINOR** | New agents, new LLM providers, new composite actions, or backward-compatible feature additions |
| **PATCH** | Bug fixes, documentation updates, prompt tuning, internal refactors |

---

## Tag strategy — floating `v0` and immutable `v0.x.y`

Ferry maintains **two tag types per major release**:

| Tag | Type | Moves? | Purpose |
|-----|------|--------|---------|
| `v0` | Floating | Yes — updated on every `0.x.y` release | Default reference in consumer workflow stubs (`uses: big-emotion/ferry/.github/workflows/...@v0`) |
| `v0.1.0` | Immutable | Never | SHA-pinned reference for consumers who want reproducibility |

**Consumer recommendation:** Start with `@v0` for easy upgrades. Move to a pinned SHA for production workloads (see `docs/CONSUMER-SETUP.md` §3.2).

### Why a floating major tag?

GitHub Actions convention (e.g., `actions/checkout@v4`) uses a floating major tag so consumers receive patch and minor updates automatically without changing their workflow files. Ferry follows the same convention.

The floating tag is always safe to follow because:
- Patch releases fix bugs and never break the API
- Minor releases are backward-compatible
- MAJOR bumps increment the tag (`v1`, `v2`, …) and leave `v0` frozen at the last `0.x.y`

---

## SHA pinning (recommended for production)

Replace `@v1` with the exact commit SHA the tag points to:

```bash
LATEST_SHA=$(gh api repos/big-emotion/ferry/git/refs/tags/v0 --jq '.object.sha')
sed -i.bak "s|@v0|@${LATEST_SHA}|g" .github/workflows/ferry-*.yml
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

Releases are automated by `.github/workflows/release.yml`. The workflow:

1. Runs on a push to `main` that bumps `version` in `package.json`
2. Builds `.ferry/` action bundles (`npm run build:ferry`)
3. Commits the updated bundles if they changed
4. Creates an immutable tag (`v<version>`, e.g., `v0.1.0`)
5. Force-updates the floating major tag (`v0`)
6. Publishes a GitHub Release with auto-generated release notes

To cut a release manually (e.g., for hotfixes):

```bash
# 1. Bump version in package.json
npm version patch   # or minor / major

# 2. Build bundles
npm run build:ferry

# 3. Commit
git add package.json package-lock.json .ferry/
git commit -m "chore: release v$(node -p "require('./package.json').version")"

# 4. Push — the release workflow fires automatically
git push origin main
```

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

## npm publishing (future)

`private: true` has been removed from `package.json`. To publish to npm once the package is ready:

```bash
npm publish --access public
```

Ferry is not yet published to npm as of v0.1.0. The primary distribution mechanism is GitHub Actions reusable workflows referenced via `@v1` or a pinned SHA.
