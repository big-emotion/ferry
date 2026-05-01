#!/usr/bin/env bash
# FR drift detector.
#
# Greps for FR\d+ tags in src/, prompts/, and docs/, then asserts every found
# ID is listed in docs/REQUIREMENTS.md. Exits non-zero if any FR is missing.
#
# Usage: npm run check:fr-drift

set -euo pipefail

REGISTRY="docs/REQUIREMENTS.md"
SEARCH_DIRS=("src" "prompts" "docs")
EXIT_CODE=0

if [[ ! -f "$REGISTRY" ]]; then
  echo "ERROR: $REGISTRY not found." >&2
  exit 1
fi

# Collect all FR\d+ tags from the search directories, excluding the registry
# itself (it's allowed to be the authoritative source).
found_frs=$(
  grep -rh --include="*.ts" --include="*.md" --include="*.js" --include="*.sh" \
    -oP 'FR\d+' "${SEARCH_DIRS[@]}" 2>/dev/null \
    | grep -v "^$" \
    | sort -uV
)

if [[ -z "$found_frs" ]]; then
  echo "No FR tags found in ${SEARCH_DIRS[*]} — nothing to check."
  exit 0
fi

missing=()

while IFS= read -r fr; do
  if ! grep -q "### ${fr} " "$REGISTRY" && ! grep -q "\*\*${fr}\*\*" "$REGISTRY"; then
    missing+=("$fr")
  fi
done <<< "$found_frs"

if [[ ${#missing[@]} -gt 0 ]]; then
  echo ""
  echo "FR drift detected — the following FR tags are referenced in code/docs"
  echo "but are NOT listed in $REGISTRY:"
  echo ""
  for fr in "${missing[@]}"; do
    echo "  • $fr"
  done
  echo ""
  echo "Add an entry for each missing FR to $REGISTRY and re-run this check."
  echo "See the 'Adding a new FR' section at the bottom of that file for instructions."
  echo ""
  EXIT_CODE=1
else
  total=$(echo "$found_frs" | wc -l | tr -d ' ')
  echo "FR drift check passed — all ${total} FR tags are registered in $REGISTRY."
fi

exit $EXIT_CODE
