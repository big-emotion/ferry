/**
 * GitLab project detector. Extracts `{host, path}` from a `git remote get-url
 * origin` string. Path may be nested (subgroups), e.g. `acme/team/widgets`.
 *
 * Lives next to the wizard so the GitLab init path stays self-contained;
 * `src/cli/lib/forge.ts` only classifies the host, not the project path.
 */

export interface GitLabProject {
  host: string;
  path: string;
}

const REMOTE_PREFIX = String.raw`^(?:https?:\/\/|git@|ssh:\/\/[^@]+@)`;
const HTTPS_GITLAB = new RegExp(
  `${REMOTE_PREFIX}(?<host>[^/]*gitlab[^/]*)\\/(?<path>.+?)(?:\\.git)?$`,
);
const SSH_GITLAB = new RegExp(`${REMOTE_PREFIX}(?<host>[^:]*gitlab[^:]*):(?<path>.+?)(?:\\.git)?$`);
// Anchored to the host segment so it can't be bypassed by github.com appearing
// inside a path or query — only matches when the URL's host is (or ends with) github.com.
const GITHUB_HOST = new RegExp(`${REMOTE_PREFIX}[^/:]*github\\.com[/:]`);

export function detectGitLabProject(remote: string): GitLabProject | undefined {
  if (!remote) return undefined;
  // Reject github explicitly so a misclassified remote can't pass.
  if (GITHUB_HOST.test(remote)) return undefined;

  const ssh = SSH_GITLAB.exec(remote);
  if (ssh?.groups) {
    return { host: ssh.groups.host, path: stripTrailingSlash(ssh.groups.path) };
  }
  const https = HTTPS_GITLAB.exec(remote);
  if (https?.groups) {
    return { host: https.groups.host, path: stripTrailingSlash(https.groups.path) };
  }
  return undefined;
}

function stripTrailingSlash(p: string): string {
  return p.endsWith('/') ? p.slice(0, -1) : p;
}
