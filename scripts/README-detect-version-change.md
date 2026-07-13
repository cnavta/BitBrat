# Version Change Detection Script

## Overview

`detect-version-change.sh` is a robust script that detects whether the version in `architecture.yaml` has changed from the last release. It's used by the automated release workflow (`.github/workflows/auto-release.yml`) to trigger GitHub releases.

## Problem Solved

The original script only compared `HEAD` vs `HEAD~1`, which could miss version changes in scenarios like:
- **Merge commits**: Version change was in an earlier commit of a PR
- **Multiple sequential PRs**: One PR without version change followed by one with a change
- **Squash merges**: Version change might be lost in the comparison
- **Rebased branches**: Git history might not have the expected parent relationship

## Multi-Strategy Approach

The improved script uses **5 fallback strategies** (in order of reliability):

### Strategy 1: GitHub Releases API ⭐ (Most Reliable)
```bash
# Compares against the latest published GitHub Release
# Endpoint: https://api.github.com/repos/{owner}/{repo}/releases/latest
```

**Pros:**
- Most reliable—compares against actual production releases
- Works regardless of git history or tags
- Handles all merge strategies (squash, rebase, merge commit)

**Cons:**
- Requires network access (GitHub API)
- Fails if no releases exist yet
- May be rate-limited (60 requests/hour unauthenticated)

**When it's used:**
- Default strategy on GitHub Actions (has network access)
- When `git remote` points to a GitHub repository

---

### Strategy 2: Latest Git Tag (Reliable, Local)
```bash
# Uses the latest git tag (e.g., v0.12.0)
git tag -l 'v*' | sort -V | tail -1
```

**Pros:**
- No network access required
- Fast (local operation)
- Works offline

**Cons:**
- Requires tags to exist
- Assumes tags are created for releases (which our workflow does)

**When it's used:**
- Fallback if GitHub API fails
- Local development environments

---

### Strategy 3: Origin/Main Branch
```bash
# Compares against the main branch on origin
# Tries: origin/main, origin/master, main, master
```

**Pros:**
- Good for PR scenarios where you're comparing feature branch to main
- Works when current branch has multiple commits with version change

**Cons:**
- Requires network access (git fetch)
- May not represent the latest release if main is ahead

**When it's used:**
- Fallback if no tags or GitHub API unavailable
- Useful for testing PRs locally

---

### Strategy 4: HEAD~1 (Original Behavior)
```bash
# Compares HEAD against immediate parent commit
git show HEAD~1:architecture.yaml
```

**Pros:**
- Simple and fast
- Works for straightforward commit histories

**Cons:**
- Can miss version changes in merge commits
- Only looks at immediate parent

**When it's used:**
- Fallback when other strategies fail
- Works well for linear histories with frequent version bumps

---

### Strategy 5: Git History Search
```bash
# Searches back through last 50 commits to find a different version
git rev-list HEAD --max-count=50
```

**Pros:**
- Catches version changes that occurred many commits ago
- Useful for long-running feature branches

**Cons:**
- Slower (iterates through commits)
- Limited to last 50 commits (configurable via `MAX_LOOKBACK`)

**When it's used:**
- Last resort when all other strategies fail
- Can be tuned with `MAX_LOOKBACK` environment variable

---

## Usage

### Basic Usage
```bash
./scripts/detect-version-change.sh
```

**Output (version changed):**
```
0.12.0 0.13.0
```
Exit code: `0` (success)

**Output (version unchanged):**
```
0.12.0 0.12.0
```
Exit code: `1` (failure)

---

### Debug Mode
```bash
DEBUG=true ./scripts/detect-version-change.sh
```

**Output:**
```
DEBUG: Current version (HEAD): 0.13.0
DEBUG: Strategy 1: Checking GitHub Releases API...
DEBUG: Detected repo: cnavta/BitBrat
DEBUG: Latest GitHub Release: 0.12.0
DEBUG: Previous version (determined): 0.12.0
0.12.0 0.13.0
DEBUG: Version changed: 0.12.0 → 0.13.0
```

---

### Custom History Search Depth
```bash
MAX_LOOKBACK=100 ./scripts/detect-version-change.sh
```

Searches last 100 commits instead of default 50.

---

### In CI/CD (GitHub Actions)

The script is used in `.github/workflows/auto-release.yml`:

```yaml
- name: Detect version change
  id: version
  run: |
    chmod +x scripts/detect-version-change.sh

    if bash scripts/detect-version-change.sh; then
      VERSIONS=$(bash scripts/detect-version-change.sh)
      OLD_VERSION=$(echo $VERSIONS | awk '{print $1}')
      NEW_VERSION=$(echo $VERSIONS | awk '{print $2}')

      echo "changed=true" >> $GITHUB_OUTPUT
      echo "old=$OLD_VERSION" >> $GITHUB_OUTPUT
      echo "new=$NEW_VERSION" >> $GITHUB_OUTPUT
    else
      echo "changed=false" >> $GITHUB_OUTPUT
    fi
```

---

## Testing

### Test Version Change Detection
```bash
# Scenario: Current version is 0.13.0, latest release is 0.12.0
./scripts/detect-version-change.sh
# Expected output: 0.12.0 0.13.0
# Expected exit code: 0
```

### Test No Version Change
```bash
# Scenario: Current version matches latest release
# (Manually edit architecture.yaml to match latest release)
./scripts/detect-version-change.sh
# Expected output: 0.12.0 0.12.0
# Expected exit code: 1
```

### Test Offline Mode
```bash
# Disconnect network or block GitHub API
# Should fallback to git tags
./scripts/detect-version-change.sh
# Should still work if tags exist
```

---

## Troubleshooting

### Issue: "Could not determine previous version using any strategy"

**Symptoms:**
```
ERROR: Could not determine previous version using any strategy
Tried: GitHub API, git tags, main branch, HEAD~1, git history
```

**Causes:**
1. No GitHub releases exist yet
2. No git tags exist
3. No git history (initial commit)
4. Network issues preventing GitHub API access

**Solutions:**
- **First release:** This is expected on initial release. Consider manually setting `OLD_VERSION=0.0.0`
- **Missing tags:** Ensure previous releases created tags (workflow does this automatically)
- **Network issues:** Script will fallback to local strategies (tags, git history)

---

### Issue: GitHub API Rate Limiting

**Symptoms:**
```
DEBUG: No response from GitHub API (no releases yet?)
```

**Cause:**
GitHub API limits unauthenticated requests to 60/hour per IP.

**Solutions:**
- Script automatically falls back to Strategy 2 (git tags)
- In CI, rate limits are higher (1000/hour for GitHub Actions)
- For local development, git tags are sufficient

---

### Issue: Wrong Version Detected

**Symptoms:**
Script reports version changed but you expected no change (or vice versa).

**Debugging:**
```bash
# Run with debug mode
DEBUG=true ./scripts/detect-version-change.sh

# Check which strategy was used
# Review the detected versions at each step
```

**Common Causes:**
- **Stale tags:** Local tags don't match remote
  - Solution: `git fetch --tags`
- **Wrong branch:** Not on main/master
  - Solution: `git checkout main && git pull`
- **Uncommitted changes:** `architecture.yaml` has local edits
  - Solution: `git status` and commit or stash changes

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG` | `false` | Enable verbose debug output to stderr |
| `MAX_LOOKBACK` | `50` | Number of commits to search in Strategy 5 |
| `ARCH_FILE` | `architecture.yaml` | Path to architecture file (relative to repo root) |

---

## Exit Codes

| Code | Meaning | Output Format |
|------|---------|---------------|
| `0` | Version changed | `<old-version> <new-version>` |
| `1` | Version unchanged or error | `<current-version> <current-version>` or error message |

---

## Dependencies

- **Required:**
  - `bash` (≥4.0)
  - `git` (≥2.0)
  - `grep`, `awk`, `sed` (standard POSIX tools)

- **Optional:**
  - `curl` or `wget` (for GitHub API access, Strategy 1)

---

## Design Decisions

### Why Multiple Strategies?

**Reliability:** No single strategy works in all scenarios (initial release, offline, no tags, complex git history).

**Graceful Degradation:** If one strategy fails, the next is tried automatically.

**Zero Configuration:** Works out-of-the-box in most environments without user intervention.

---

### Why GitHub API First?

**Accuracy:** GitHub Releases represent the true "published" state, regardless of git history manipulations (rebases, squashes, etc.).

**Consistency:** Multiple developers/machines always compare against the same baseline.

**Robustness:** Handles all git workflows (rebase, squash, merge) without assuming specific commit structures.

---

### Why Not Just Use Tags?

**Timing Issues:** Tags are created *after* version detection in the workflow. We need to know if a version changed *before* creating the tag.

**Local Inconsistency:** Developers may have different tag states locally (stale, ahead, missing).

**Fallback Coverage:** Tags are Strategy 2 (still important), but GitHub API is more authoritative.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Sprint 337 | Initial version (HEAD~1 comparison only) |
| 2.0 | Sprint 339 | Multi-strategy approach (5 strategies) |

---

## Related Documentation

- [Automated Release Workflow](../documentation/guides/automated-releases.md)
- [Version Management](../CLAUDE.md#version-management)
- [Release Process](../documentation/guides/release-process.md) (if exists)

---

## Support

For issues or questions:
1. Run with `DEBUG=true` to see which strategies are tried
2. Check GitHub Issues for known problems
3. Verify dependencies are installed (`git`, `curl` or `wget`)
4. Ensure repository is properly configured (remote, tags, etc.)
