---
name: ferry-release
description: Prepare and ship a Ferry release. Bumps the semver version, updates CHANGELOG.md (Keep a Changelog format, creates it if missing), refreshes all release-coupled version references (consumer stubs, docs, structural tests), rebuilds .ferry/ bundles, creates an annotated git tag, then asks for explicit confirmation before pushing commit + tag to origin (which triggers release.yml — full CI gate, npm publish with provenance, GitHub Release, floating v1 retag). Use when the user says "release Ferry", "cut a version", "bump version", or invokes /ferry-release.
metadata:
  author: jnk
  version: '1.3.0'
---

# Ferry Release

Prepare a release locally (bump version, update CHANGELOG and docs, create the tag), then ask for explicit confirmation before pushing.

This skill writes to the local repo first. It only runs `git push` after the user explicitly confirms. Without confirmation, the commit + tag stay local.

The release process contract lives in `docs/RELEASING.md` — read it if anything below disagrees with the repo; the doc wins.

## When to Activate

- User asks: "release Ferry", "cut a release", "bump version", "tag a new version".
- User invokes `/ferry-release` (optionally with a bump level: `patch | minor | major | <explicit-version>`).

## Preconditions

Verify before any write:

1. cwd is the Ferry repo root (`package.json` `"name": "@big-emotion/ferry"`).
2. Working tree is clean (`git status --porcelain` empty). If dirty, stop and ask the user to commit or stash.
3. On `main` branch (or ask explicit confirmation if not).
4. Local `main` is up to date with `origin/main` (`git fetch origin && git rev-list --count main..origin/main` == 0). If behind, stop and tell the user to pull.
5. **CI green on HEAD** — the remote gate, not just local:
   ```bash
   HEAD_SHA=$(git rev-parse HEAD)
   gh run list --repo big-emotion/ferry --commit "$HEAD_SHA" \
     --workflow ferry-ci.yml --limit 1 --json conclusion,status,url
   ```
   The latest run must have `conclusion: "success"`. If no run exists for HEAD or it is not green, stop and print the run URL.
6. CI gates pass locally: `npm run typecheck && npm run lint && npm run format:check && npm test -- --reporter=basic`. If any fail, stop.

If any precondition fails, **do not modify anything** — report the blocker and exit.

## Inputs

Argument is the bump level or explicit version:

- `patch` — `0.17.0 → 0.17.1`
- `minor` — `0.17.0 → 0.18.0`
- `major` — `0.17.0 → 1.0.0`
- `<explicit>` — e.g. `1.0.0-rc.1`, `2.3.4`

If no argument is provided, propose a bump based on the commit messages since the last tag (Conventional Commits heuristic: `feat!:` or `BREAKING CHANGE` → major; `feat:` → minor; otherwise patch), cross-checked against the semver policy table in `docs/RELEASING.md` (schema/contract breaks → MAJOR; new agents/providers/actions → MINOR; fixes/docs/prompt tuning → PATCH). Show the proposal and **ask the user to confirm or override** before proceeding.

## Workflow

### Step 1 — Determine current and target versions

- Read current version from `package.json` (`.version`).
- Determine `previous_tag` = `git describe --tags --abbrev=0 --exclude='v[0-9]' 2>/dev/null` (exclude the floating `v1`-style major tags; may be empty if no tag yet).
- Compute `next_version` from the bump level.
- Validate: target must be strictly greater than current (semver-compare). If not, stop.

### Step 2 — Collect changes since last tag

- `git log --pretty=format:"%h %s" <previous_tag>..HEAD` (or `git log --pretty=format:"%h %s"` if no previous tag).
- Group commits by Conventional Commit type: **Added** (feat), **Changed** (refactor, perf, style), **Fixed** (fix), **Security** (security:), **Removed** (revert / removal commits), **Deprecated**.
- Filter out merge commits unless they carry meaningful messages.

### Step 3 — Update or create `CHANGELOG.md`

Use [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format with [Semantic Versioning](https://semver.org/).

If `CHANGELOG.md` does not exist, create it with this skeleton:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [<next_version>] - <YYYY-MM-DD>

### Added

- ...

[Unreleased]: https://github.com/big-emotion/ferry/compare/v<next_version>...HEAD
[<next_version>]: https://github.com/big-emotion/ferry/releases/tag/v<next_version>
```

If it exists:

- Move any items under `[Unreleased]` into the new `[<next_version>] - <YYYY-MM-DD>` section.
- Append the grouped commits from Step 2 under the appropriate subsections (deduplicate).
- Keep an empty `[Unreleased]` section at the top for the next cycle.
- Update the link references at the bottom (`[Unreleased]` → `compare/v<next_version>...HEAD`, add `[<next_version>]` → `releases/tag/v<next_version>`).

### Step 4 — Update `package.json`

Set `.version` to `<next_version>` using a targeted Edit — do not reformat the file.

### Step 5 — Update version references across the repo

Consumer stubs, docs, and structural tests all pin the Ferry release tag; a release that misses one produces a broken consumer install or a stale CI guard. The canonical patterns are `@v<version>` for `uses:` lines and `npx -p @big-emotion/ferry@v<version>` invocations, and `v<version>` (no `@`) for `FERRY_REF` env values and `tags/<value>` API paths.

Use this discovery command first — it is the authority; the category list below is the map:

```bash
git grep -nE "@v[0-9]+(\.[0-9]+){0,2}\b|FERRY_REF:|tags/v[0-9]|@big-emotion/ferry@v" \
  -- ':!package-lock.json' ':!.ferry/' ':!node_modules/' ':!CHANGELOG.md'
```

**Files that MUST be updated (release-coupled):**

1. **`examples/consumer-setup/workflows/ferry-{refine,dev,review,iterate,merge}.yml`** — the 5 agent stubs. Each has several `uses: big-emotion/ferry/.github/actions/ferry-*@v<version>` lines, `npx -y -p @big-emotion/ferry@v<version>` invocations (`ferry-cc-prompt`, and `ferry-jira-mcp` **inside the `--mcp-config` JSON string**), and header comments citing the pinned version.
2. **`examples/consumer-setup/workflows/ferry-{reconcile,cost-daily}.yml`** — the 2 ops stubs. Each has `FERRY_REF: v<version>` (no `@` prefix — it's a checkout ref env value).
3. **`docs/INSTALL.md`** — the SHA-pinning command (`gh api repos/big-emotion/ferry/git/refs/tags/v<version>`) and any `@v<version>` prose.
4. **`docs/RELEASING.md`** — the immutable-tag table cells (`v<version>`) and its SHA-pinning example.
5. **`docs/CONFIGURATION.md`** — `uses: big-emotion/ferry/.github/actions/*@v<version>` example lines.
6. **Structural tests** — these hardcode the current tag and are the CI gate that catches drift:
   - `src/install-guide.test.ts` — test names, assertion messages, and the regex `/@v<version-with-escaped-dots>\b/` (escape dots: `/@v0\.18\.0\b/`, not `/@v0.18.0\b/`).
   - `src/cli/init/templates.test.ts`
   - `src/cli/doctor/checks/claude-code-path.test.ts`
   - `src/cli/doctor/checks/codex-cli-path.test.ts`
   - `src/lib/codex/config-toml.test.ts`

**Files that MUST NOT be touched:**

- `package-lock.json` — refreshed in Step 6.
- `.ferry/` — rebuilt in Step 6.
- `prompts/*.md` — agent system prompts, not release-coupled.
- `src/schemas/event.v1.schema.json` and every `event.v1` / `EventEnvelopeV1` reference — the `v1` here is the **envelope schema version**, not the Ferry release tag.
- `docs/RUNBOOK.md` — its upgrade examples use `${CURRENT}`/`${TARGET}` shell variables and the **floating** `v1` tag (`tags/v1`); both are version-agnostic by design.
- Third-party `uses:` lines (e.g. `actions/checkout@…`, `anthropics/claude-code-action@v1`) — unrelated to the Ferry tag.
- The floating `v1` tag itself — `release.yml` retags it via `scripts/retag-major.sh`; never move it manually.

**After updates, verify with:**

```bash
# 1. No old version refs left (excluding intentional historical mentions in CHANGELOG):
git grep -nE "@v<old_version>\b|FERRY_REF: v<old_version>\b|tags/v<old_version>\b|ferry@v<old_version>" -- ':!CHANGELOG.md'
# 2. The structural tests still pass against the new tag:
npx vitest run src/install-guide.test.ts src/cli/init/templates.test.ts \
  src/cli/doctor/checks/claude-code-path.test.ts src/cli/doctor/checks/codex-cli-path.test.ts \
  src/lib/codex/config-toml.test.ts
```

For each file changed, show the old → new diff for the version line(s) before saving.

### Step 6 — Refresh lockfile and build

- `npm install --package-lock-only` — refresh `package-lock.json` to reflect the new `package.json` version.
- `npm run build:ferry` — rebuild `.ferry/` bundles so the committed action artifacts match `src/` (release.yml fails on `.ferry/` drift).
- `git diff --stat .ferry/` — confirm bundle changes are reasonable (small or expected).

### Step 7 — Re-run CI gates locally

Final verification before commit:

```
npm run typecheck && npm run lint && npm run format:check && npm test -- --reporter=basic
```

If any fail, stop. Do not commit. Tell the user what failed.

### Step 8 — Commit and tag (local only)

Stage exactly the files changed in Steps 3–6 (adjust to what actually changed — never `git add -A`, it can pick up unrelated dirty paths):

```
git add package.json package-lock.json CHANGELOG.md docs/ \
        examples/consumer-setup/workflows/ \
        src/install-guide.test.ts src/cli/init/templates.test.ts \
        src/cli/doctor/checks/ src/lib/codex/config-toml.test.ts \
        .ferry/
```

Commit with the message:

```
release: v<next_version>
```

(One-line subject. No body unless there are breaking changes — then add a `BREAKING CHANGE:` paragraph in the body.)

**No `Co-Authored-By` trailer** (per user's global rule).

Then create an annotated tag:

```
git tag -a v<next_version> -m "Ferry v<next_version>"
```

### Step 9 — Report and ask for push confirmation

Print a summary to the user:

```
Ferry v<next_version> prepared locally.

Files changed:
  - package.json (version: <current> → <next_version>)
  - package-lock.json
  - CHANGELOG.md (new section [<next_version>])
  - <consumer stubs / docs / tests touched>
  - .ferry/ (rebuilt bundles)

Commit:  <short-sha> release: v<next_version>
Tag:     v<next_version> (annotated, local only)

Ready to push `main` + `v<next_version>` to origin?
This triggers release.yml: full CI gate → npm publish (provenance) → GitHub Release → floating v1 retag.

Reply `yes` / `push` to proceed, or `no` / `stop` to keep everything local.
```

**Wait for an explicit confirmation reply.** Do not push without it.

- Affirmative tokens (case-insensitive): `yes`, `y`, `push`, `ship`, `go`, `oui`, `ok`.
- Anything else (including silence, partial answers, "let me check first") → treat as a stop. Skip Step 10.

### Step 10 — Push (only after confirmation)

Run, in order:

```
git push origin main
git push origin v<next_version>
```

Run them as separate commands (not `--follow-tags`) so a failure on the tag push doesn't leave `main` unpushed and ambiguous. If `git push origin main` fails (e.g. branch protection, non-fast-forward), stop immediately — do not push the tag.

After both succeed, print:

```
Pushed.
  - origin/main now at <short-sha>
  - tag v<next_version> published

release.yml has been triggered. It will:
  1. Run the full CI gate (typecheck, lint, format, tests, audit:ci, .ferry drift check)
  2. Build the CLI and publish @big-emotion/ferry to npm with provenance
  3. Create a GitHub Release with notes from CHANGELOG.md [<next_version>]
  4. Advance the floating v1 tag (scripts/retag-major.sh)

Watch it at:
  https://github.com/big-emotion/ferry/actions/workflows/release.yml
```

Do **not** run `gh release create` or `npm publish` manually — both are handled by the workflow. Mentioning them as a fallback is fine; running them automatically is not.

### Step 11 — Verification checklist

- [ ] Version in `package.json` matches the new tag.
- [ ] `CHANGELOG.md` has a `[<next_version>]` section dated today.
- [ ] All version references are consistent (`git grep -n "<old_version>"` shows only intentional historical mentions).
- [ ] `.ferry/` was rebuilt and committed (release.yml fails on drift otherwise).
- [ ] CI gates passed locally after the bump.
- [ ] Exactly one commit was created. Exactly one annotated tag was created.
- [ ] If user confirmed: both `main` and `v<next_version>` are pushed.
- [ ] If user did not confirm: commit + tag remain local only, no `git push` was executed.

## Failure Modes — Stop Without Modifying

- Working tree dirty → ask the user to commit or stash.
- Behind `origin/main` → ask the user to pull.
- CI not green on HEAD (remote) → print the run URL, exit.
- CI gate fails locally → report which one, exit.
- Target version ≤ current → exit, ask for an explicit higher version.
- `.ferry/` rebuild produces unexpected large drift → show the diffstat, ask before committing.

## Out of Scope

- Pushing without explicit user confirmation in Step 9.
- Creating the GitHub Release or publishing to npm manually — both run in release.yml on tag push.
- Moving the floating `v1` tag — `scripts/retag-major.sh` owns it, invoked by release.yml.
- Editing `prompts/*.md` or any agent behavior — that's a code change, not a release task.
- Auditing the project — use `ferry-audit` for that.
