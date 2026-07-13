#!/usr/bin/env bash
#
# detect-version-change.sh
#
# Detects if the version in architecture.yaml has changed from the last release.
# Uses multiple strategies for robustness:
#   1. Compare against latest GitHub Release (via API)
#   2. Compare against latest git tag (local fallback)
#   3. Compare against main branch (merge scenario)
#   4. Compare against HEAD~1 (last resort)
#
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
# Updated: Sprint 339 - Made more robust

set -euo pipefail

ARCH_FILE="architecture.yaml"
DEBUG="${DEBUG:-false}"

debug() {
  if [[ "$DEBUG" == "true" ]]; then
    echo "DEBUG: $*" >&2
  fi
}

# Extract version from architecture.yaml
extract_version() {
  local file="$1"
  grep -E '^\s+version:\s+' "$file" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '"' | xargs || echo ""
}

# Extract version from git blob
extract_version_from_git() {
  local ref="$1"
  git show "$ref:$ARCH_FILE" 2>/dev/null | grep -E '^\s+version:\s+' | head -1 | awk '{print $2}' | tr -d '"' | xargs || echo ""
}

# Strategy 1: Get latest version from GitHub Releases API
get_github_release_version() {
  debug "Strategy 1: Checking GitHub Releases API..."

  # Try to extract owner/repo from git remote
  local remote_url
  remote_url=$(git config --get remote.origin.url 2>/dev/null || echo "")

  if [[ -z "$remote_url" ]]; then
    debug "No git remote found"
    return 1
  fi

  # Parse owner/repo from various git URL formats
  local owner_repo
  if [[ "$remote_url" =~ github\.com[:/]([^/]+)/([^/.]+) ]]; then
    owner_repo="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  else
    debug "Could not parse GitHub owner/repo from: $remote_url"
    return 1
  fi

  debug "Detected repo: $owner_repo"

  # Call GitHub API to get latest release
  local api_url="https://api.github.com/repos/$owner_repo/releases/latest"
  local response

  if command -v curl >/dev/null 2>&1; then
    response=$(curl -s -f "$api_url" 2>/dev/null || echo "")
  elif command -v wget >/dev/null 2>&1; then
    response=$(wget -q -O - "$api_url" 2>/dev/null || echo "")
  else
    debug "Neither curl nor wget available"
    return 1
  fi

  if [[ -z "$response" ]]; then
    debug "No response from GitHub API (no releases yet?)"
    return 1
  fi

  # Extract tag_name (should be like "v1.2.3")
  local tag_name
  tag_name=$(echo "$response" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

  if [[ -z "$tag_name" ]]; then
    debug "Could not extract tag_name from API response"
    return 1
  fi

  # Strip leading 'v' if present
  local version="${tag_name#v}"
  debug "Latest GitHub Release: $version"
  echo "$version"
}

# Strategy 2: Get latest version from git tags
get_latest_tag_version() {
  debug "Strategy 2: Checking git tags..."

  # Get all tags, sort by version, get the latest
  local latest_tag
  latest_tag=$(git tag -l 'v*' 2>/dev/null | sort -V | tail -1 || echo "")

  if [[ -z "$latest_tag" ]]; then
    debug "No git tags found"
    return 1
  fi

  # Strip leading 'v'
  local version="${latest_tag#v}"
  debug "Latest git tag: $version"
  echo "$version"
}

# Strategy 3: Get version from origin/main branch
get_main_branch_version() {
  debug "Strategy 3: Checking origin/main branch..."

  # Fetch main branch (non-fatal if fails)
  git fetch origin main --quiet 2>/dev/null || true

  # Try different common main branch names
  for branch in origin/main origin/master main master; do
    if git rev-parse "$branch" >/dev/null 2>&1; then
      local version
      version=$(extract_version_from_git "$branch")
      if [[ -n "$version" ]]; then
        debug "Version from $branch: $version"
        echo "$version"
        return 0
      fi
    fi
  done

  debug "Could not get version from main branch"
  return 1
}

# Strategy 4: Get version from HEAD~1 (last resort)
get_previous_commit_version() {
  debug "Strategy 4: Checking HEAD~1..."

  if ! git rev-parse HEAD~1 >/dev/null 2>&1; then
    debug "No previous commit (initial commit?)"
    return 1
  fi

  local version
  version=$(extract_version_from_git "HEAD~1")

  if [[ -n "$version" ]]; then
    debug "Version from HEAD~1: $version"
    echo "$version"
    return 0
  fi

  return 1
}

# Strategy 5: Search back through git history to find a different version
get_version_from_history() {
  debug "Strategy 5: Searching through git history..."

  local current_version="$1"
  local max_lookback="${MAX_LOOKBACK:-50}"  # Search last 50 commits

  # Get list of commits
  local commits
  commits=$(git rev-list HEAD --max-count="$max_lookback" 2>/dev/null || echo "")

  if [[ -z "$commits" ]]; then
    debug "No commit history available"
    return 1
  fi

  # Iterate through commits to find a different version
  while IFS= read -r commit; do
    local version
    version=$(extract_version_from_git "$commit")

    if [[ -n "$version" && "$version" != "$current_version" ]]; then
      debug "Found different version at $commit: $version"
      echo "$version"
      return 0
    fi
  done <<< "$commits"

  debug "All commits in history have version $current_version"
  return 1
}

# Main logic
main() {
  # Check if architecture.yaml exists in current commit
  if [[ ! -f "$ARCH_FILE" ]]; then
    echo "ERROR: $ARCH_FILE not found in working directory" >&2
    exit 1
  fi

  # Extract current version (HEAD)
  CURRENT_VERSION=$(extract_version "$ARCH_FILE")

  if [[ -z "$CURRENT_VERSION" ]]; then
    echo "ERROR: Could not extract version from $ARCH_FILE (current)" >&2
    exit 1
  fi

  debug "Current version (HEAD): $CURRENT_VERSION"

  # Try strategies in order of reliability
  PREVIOUS_VERSION=""

  # Strategy 1: GitHub Releases (most reliable)
  if [[ -z "$PREVIOUS_VERSION" ]]; then
    PREVIOUS_VERSION=$(get_github_release_version || echo "")
  fi

  # Strategy 2: Latest git tag (reliable, local)
  if [[ -z "$PREVIOUS_VERSION" ]]; then
    PREVIOUS_VERSION=$(get_latest_tag_version || echo "")
  fi

  # Strategy 3: Origin/main branch (good for PR scenarios)
  if [[ -z "$PREVIOUS_VERSION" ]]; then
    PREVIOUS_VERSION=$(get_main_branch_version || echo "")
  fi

  # Strategy 4: HEAD~1 (original behavior)
  if [[ -z "$PREVIOUS_VERSION" ]]; then
    PREVIOUS_VERSION=$(get_previous_commit_version || echo "")
  fi

  # Strategy 5: Search through history
  if [[ -z "$PREVIOUS_VERSION" ]]; then
    PREVIOUS_VERSION=$(get_version_from_history "$CURRENT_VERSION" || echo "")
  fi

  # If still no previous version found, error out
  if [[ -z "$PREVIOUS_VERSION" ]]; then
    echo "ERROR: Could not determine previous version using any strategy" >&2
    echo "Tried: GitHub API, git tags, main branch, HEAD~1, git history" >&2
    exit 1
  fi

  debug "Previous version (determined): $PREVIOUS_VERSION"

  # Compare versions
  if [[ "$CURRENT_VERSION" == "$PREVIOUS_VERSION" ]]; then
    echo "$CURRENT_VERSION $CURRENT_VERSION"
    debug "Version unchanged: $CURRENT_VERSION"
    exit 1
  else
    echo "$PREVIOUS_VERSION $CURRENT_VERSION"
    debug "Version changed: $PREVIOUS_VERSION → $CURRENT_VERSION"
    exit 0
  fi
}

main "$@"
