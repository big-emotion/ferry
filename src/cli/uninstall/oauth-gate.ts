/**
 * Pure decision helper that enforces the headline safety invariant of the
 * uninstall OAuth flow (PR #343):
 *
 *  - Under `--yes` (non-interactive) the `CLAUDE_CODE_OAUTH_TOKEN` repo secret
 *    is **never** removed, even if it is present.
 *  - In interactive mode, removal happens **only** when the user explicitly
 *    confirms the dedicated second prompt.
 *  - If the secret is not present, removal is always a no-op.
 *
 * Extracted from `index.ts` so it can be exercised in isolation without
 * triggering the CLI's top-level `main()` invocation.
 */
export function shouldRemoveOAuth(params: {
  yes: boolean;
  oauthSecretPresent: boolean;
  confirmed: boolean;
}): boolean {
  return !params.yes && params.oauthSecretPresent && params.confirmed;
}
