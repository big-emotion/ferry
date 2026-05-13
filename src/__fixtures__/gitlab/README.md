# GitLab HTTP fixtures

Recorded shapes of the GitLab REST API v4 responses Ferry's `GitLabRunner` (`src/lib/dispatch/runner/gitlab/index.ts`) consumes. These are **not** captured from a live instance — they are minimal, hand-crafted samples designed to exercise every code path through the adapter without depending on a real GitLab account.

## File naming

`<verb>-<entity>[-<status>].json` — matches the convention used in `src/__fixtures__/jira/`.

| File                             | Endpoint                                                        | Used by                                                                   |
| -------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `get-project.json`               | `GET /projects/:id`                                             | `getRepoDefaultBranch`                                                    |
| `get-merge-request.json`         | `GET /projects/:id/merge_requests/:iid`                         | `getPR`, `markPRReadyForReview` (read step)                               |
| `list-merge-requests.json`       | `GET /projects/:id/merge_requests?state=opened&source_branch=…` | `listPRsForBranch`, `createPR` idempotency lookup                         |
| `get-changes.json`               | `GET /projects/:id/merge_requests/:iid/changes`                 | `listPRFiles`                                                             |
| `list-commits.json`              | `GET /projects/:id/merge_requests/:iid/commits`                 | `listPRCommits`                                                           |
| `list-pipelines-success.json`    | `GET /projects/:id/pipelines?sha=…`                             | `getCommitStatus` (green)                                                 |
| `list-pipelines-failed.json`     | same                                                            | `getCommitStatus` (red)                                                   |
| `post-note-201.json`             | `POST /projects/:id/merge_requests/:iid/notes`                  | `commentOnPR`                                                             |
| `put-merge-request-200.json`     | `PUT /projects/:id/merge_requests/:iid`                         | `addLabelsToPR`, `removeLabelFromPR`, `markPRReadyForReview` (write step) |
| `post-trigger-pipeline-201.json` | `POST /projects/:id/trigger/pipeline`                           | `dispatch`                                                                |
| `get-raw-file.txt`               | `GET /projects/:id/repository/files/:path/raw`                  | `getFileContent`                                                          |

## How to refresh

When the GitLab REST contract changes — usually a field rename or a new optional field on `merge_requests` — re-record the affected fixture:

1. Spin up a throwaway GitLab project (gitlab.com or a self-managed instance).
2. Hit the matching endpoint with `curl -H "PRIVATE-TOKEN: <pat>" …`.
3. Strip any personally-identifying fields (commit author emails, user IDs) and replace them with sentinel values:
   - Owners / namespaces → `acme`
   - Project / repo → `widgets`
   - Author email → `dev@example.com`
   - Web URLs → `https://gitlab.example/…`
4. Re-format with `npx prettier --write src/__fixtures__/gitlab/<file>`.
5. Run `npx vitest run src/lib/dispatch/runner/gitlab/` to confirm the adapter still parses.

> The `gitlab-adapter` job in `.github/workflows/ferry-ci.yml` runs these tests on every PR so contract drift is caught at review time.
