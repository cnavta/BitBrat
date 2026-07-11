#!/usr/bin/env bash
#
# detect-version-change.sh
#
# Detects if the version in architecture.yaml has changed between HEAD and HEAD~1.
# Exit codes:
#   0 - Version changed (outputs: OLD_VERSION NEW_VERSION)
#   1 - Version unchanged or error
#
# Usage:
#   ./detect-version-change.sh
#
# Outputs to stdout:
#   <old-version> <new-version>
#
# Sprint: 337-abb8c02
# Task: BL-337-100

set -euo pipefail

ARCH_FILE="architecture.yaml"

# Check if architecture.yaml exists in current commit
if [[ ! -f "$ARCH_FILE" ]]; then
  echo "ERROR: $ARCH_FILE not found in working directory" >&2
  exit 1
fi

# Extract current version (HEAD)
CURRENT_VERSION=$(grep -E '^\s+version:\s+' "$ARCH_FILE" | head -1 | awk '{print $2}' | tr -d '"' | xargs)

if [[ -z "$CURRENT_VERSION" ]]; then
  echo "ERROR: Could not extract version from $ARCH_FILE (current)" >&2
  exit 1
fi

# Check if we have a previous commit
if ! git rev-parse HEAD~1 >/dev/null 2>&1; then
  echo "ERROR: No previous commit found (initial commit?)" >&2
  exit 1
fi

# Extract previous version (HEAD~1)
PREVIOUS_VERSION=$(git show HEAD~1:"$ARCH_FILE" 2>/dev/null | grep -E '^\s+version:\s+' | head -1 | awk '{print $2}' | tr -d '"' | xargs)

if [[ -z "$PREVIOUS_VERSION" ]]; then
  echo "ERROR: Could not extract version from $ARCH_FILE (previous)" >&2
  exit 1
fi

# Compare versions
if [[ "$CURRENT_VERSION" == "$PREVIOUS_VERSION" ]]; then
  echo "$CURRENT_VERSION $CURRENT_VERSION"
  exit 1
else
  echo "$PREVIOUS_VERSION $CURRENT_VERSION"
  exit 0
fi
