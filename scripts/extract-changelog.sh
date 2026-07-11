#!/usr/bin/env bash
#
# extract-changelog.sh
#
# Extracts release notes for a specific version from CHANGELOG.md.
# Returns the content between ## [VERSION] and the next ## heading.
#
# Exit codes:
#   0 - Successfully extracted changelog content
#   1 - Version not found or CHANGELOG.md missing
#
# Usage:
#   ./extract-changelog.sh <version>
#
# Example:
#   ./extract-changelog.sh 0.9.0
#
# Sprint: 337-abb8c02
# Task: BL-337-101

set -euo pipefail

VERSION="${1:-}"
CHANGELOG_FILE="CHANGELOG.md"

if [[ -z "$VERSION" ]]; then
  echo "ERROR: Version argument required" >&2
  echo "Usage: $0 <version>" >&2
  exit 1
fi

if [[ ! -f "$CHANGELOG_FILE" ]]; then
  echo "ERROR: $CHANGELOG_FILE not found" >&2
  exit 1
fi

# Normalize version (remove 'v' prefix if present)
VERSION="${VERSION#v}"

# Extract the section using awk (simpler, more portable)
CONTENT=$(awk -v version="$VERSION" '
  /^## \[/ {
    # Check if this line matches our version
    if ($0 ~ "\\[v?" version "\\]") {
      in_section = 1
      found = 1
      next
    } else if (in_section) {
      # Hit the next version section, stop
      exit
    }
  }

  in_section { print }

  END { if (!found) exit 1 }
' "$CHANGELOG_FILE")

EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]] || [[ -z "$CONTENT" ]]; then
  echo "" # Return empty string if not found
  exit 1
fi

echo "$CONTENT"
exit 0
