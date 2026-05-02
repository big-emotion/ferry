#!/usr/bin/env bash
# Force-update the moving Actions-style major tag (e.g. v1) to the commit
# pointed to by the semver tag passed as $1.
#
# Usage: scripts/retag-major.sh v0.4.0
#
# Wire this into .github/workflows/release.yml after "Create GitHub Release":
#
#   - name: Update moving major tag
#     run: bash scripts/retag-major.sh "${{ github.ref_name }}"
#
# Mapping convention: v0.x.x releases move the v1 tag (pre-1.0 line).
# v1.x.x releases move v1, v2.x.x move v2, and so on.
set -euo pipefail

TAG="${1:?Usage: retag-major.sh <semver-tag> (e.g. v0.4.0)}"
COMMIT=$(git rev-list -n1 "$TAG")

VERSION_CORE="${TAG#v}"
MAJOR="${VERSION_CORE%%.*}"

if [ "$MAJOR" -eq 0 ]; then
  MAJOR_TAG="v1"
else
  MAJOR_TAG="v${MAJOR}"
fi

git tag --force "$MAJOR_TAG" "$COMMIT"
git push --force origin "refs/tags/${MAJOR_TAG}"
echo "Moved ${MAJOR_TAG} → ${COMMIT} (released as ${TAG})"
