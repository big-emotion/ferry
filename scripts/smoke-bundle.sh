#!/usr/bin/env bash
# scripts/smoke-bundle.sh — boot each .ferry/ agent bundle and assert the v0.5.1
# failure class is absent from stderr.
#
# What this catches:
#   "Dynamic require of"  — esbuild CJS shim fires on a transitive dep that uses
#                           dynamic require() (e.g. google-auth-library in v0.5.1)
#   "Cannot find module"  — broken relative or external import in the bundle
#   "is not a function"   — module shape mismatch when a bundled export is consumed
#
# What it does NOT test:
#   Full agent business logic, LLM output, or Jira/GitHub integration.
#   Those are covered by Vitest unit tests.
#
# Exit codes:
#   0 — all bundles loaded and started without a banned module-loading error
#   1 — at least one bundle emitted a banned pattern (DOA bundle class)
#
# Usage:
#   npm run smoke:bundle          (from repo root, after npm ci + build:ferry)
#   bash scripts/smoke-bundle.sh

set -euo pipefail

ENVELOPE='{"version":"v1","event_id":"smoke0001","ticket_key":"SMOKE-1","phase":"refine","source":"jira-column","ts":"2026-01-01T00:00:00Z"}'

# Bundles under .ferry/ — ESM files built by npm run build:ferry.
BUNDLES=(
  refiner-action.js
  dev-action.js
  review-action.js
  iterate-action.js
)

# These patterns are signatures of bundle-loading failures from the v0.5.1 DOA
# incident. Their presence in stderr means a transitive dep broke esbuild's
# bundling assumptions and the action will crash on every dispatch.
BANNED_PATTERNS=(
  'Dynamic require of'
  'Cannot find module'
  'is not a function'
)

# Stub credentials so bundles get past env-var guards into real execution before
# failing on network (ECONNREFUSED / NXDOMAIN). We only care that stderr is free
# of the banned patterns — a connection error is intentional and expected.
SMOKE_ENV=(
  FERRY_DRY_RUN=1
  "FERRY_ENVELOPE_PAYLOAD=$ENVELOPE"
  ANTHROPIC_API_KEY=smoke-key
  FERRY_JIRA_BASE_URL=https://smoke.invalid
  FERRY_JIRA_EMAIL=smoke@example.com
  FERRY_JIRA_API_TOKEN=smoke-token
  GITHUB_TOKEN=smoke-token
  GITHUB_REPO=smoke/smoke
)

PASS=0
FAIL=0
FAIL_DETAILS=()

for bundle in "${BUNDLES[@]}"; do
  bundle_path=".ferry/${bundle}"
  if [[ ! -f "$bundle_path" ]]; then
    echo "SKIP: ${bundle_path} not found — run 'npm run build:ferry' first" >&2
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("  ${bundle_path}: file not found")
    continue
  fi

  printf 'smoke: %-36s ... ' "${bundle_path}"
  stderr_file=$(mktemp)

  # Accept any exit code — only the stderr patterns matter.
  env "${SMOKE_ENV[@]}" timeout 10 node "$bundle_path" 2>"$stderr_file" || true

  stderr=$(<"$stderr_file")
  rm -f "$stderr_file"

  found_banned=false
  for pattern in "${BANNED_PATTERNS[@]}"; do
    if [[ "$stderr" == *"$pattern"* ]]; then
      found_banned=true
      FAIL_DETAILS+=("  ${bundle_path}: banned pattern found → '${pattern}'")
      break
    fi
  done

  if $found_banned; then
    echo 'FAIL'
    FAIL=$((FAIL + 1))
  else
    echo 'ok'
    PASS=$((PASS + 1))
  fi
done

echo ""
echo "smoke-bundle: ${PASS} passed, ${FAIL} failed"

if (( FAIL > 0 )); then
  echo ""
  echo "Failures:"
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "$detail"
  done
  exit 1
fi
