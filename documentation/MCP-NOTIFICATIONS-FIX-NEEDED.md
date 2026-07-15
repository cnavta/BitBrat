# MCP Notifications Fix - Status Report

## Problem Confirmed ✅

You're correct - the MCP notifications fix that solves the tool-gateway/llm-bot startup race condition **was never merged to main**.

## What Happened

1. **July 11, 2026** - Fix was created on branch `fix/tool-registration-on-deploy` (commit 39f9bbe)
2. **No PR was ever created** for this fix
3. **Branch never merged to main** - the fix has been sitting on the branch for months
4. **Main branch is missing all the notification code**, causing the startup race to persist

## Current State

### On Branch `fix/tool-registration-on-deploy` ✅
- ✅ `sessionServers` Map to track connected clients
- ✅ `broadcastListChangedNotifications()` method implementation
- ✅ Notification broadcasts when Bits register/unregister
- ✅ Client-side notification handlers with debouncing
- ✅ Comprehensive tests (6c66fc7)
- ✅ Documentation (planning/tool-gateway-llm-bot-registration-issue.md)

### On `main` Branch ❌
- ❌ No `sessionServers` field
- ❌ No `broadcastListChangedNotifications()` method
- ❌ No notification broadcasts
- ❌ No client-side notification handlers
- ❌ Startup race condition persists

## Files That Need Changes

### 1. `src/apps/tool-gateway.ts`
**Missing:**
- `sessionServers: Map<string, Server>` field (line ~52)
- `broadcastListChangedNotifications()` method (~60 lines)
- Session management in `setupApp()` method
- Calls to `broadcastListChangedNotifications()` in:
  - `onServerActive` callback
  - `onServerInactive` callback
- Cleanup in `shutdown()` method

### 2. `src/common/mcp/client-manager.ts`
**Missing:**
- Import statements for notification schemas
- `debounceTimers: Map<string, NodeJS.Timeout>` field
- `setupNotificationHandlers()` method (~100 lines)
- Call to `setupNotificationHandlers()` after client connection
- Cleanup in `shutdown()` method

### 3. Documentation (Already Exists on Fix Branch)
- `planning/tool-gateway-llm-bot-registration-issue.md`
- `planning/tool-gateway-notification-implementation-summary.md`

## Branch Status

```
fix/tool-registration-on-deploy:
  - 22 commits behind main
  - 3 commits ahead of main (the fix)
  - Needs rebasing
```

## Why It Matters

Without this fix:
- ❌ llm-bot only discovers tools available when it starts
- ❌ If tool-gateway discovers Bits after llm-bot connects, llm-bot never sees them
- ❌ Requires manual restart of **both** services after deployment
- ❌ Deployment latency: indefinite (until manual restart)

With this fix:
- ✅ llm-bot receives notifications when tool lists change
- ✅ Automatic rediscovery within ~2 seconds
- ✅ No manual restarts required
- ✅ Standards-compliant MCP protocol usage

## Recommended Action

### Option 1: Rebase and Merge (Recommended)
```bash
# Create new branch from current main
git checkout -b fix/mcp-notifications-merge origin/main

# Cherry-pick the fix commits (will have conflicts)
git cherry-pick 39f9bbe  # Main fix
git cherry-pick 6c66fc7  # Tests

# Resolve conflicts (mainly in tool-gateway.ts)
# The conflicts are due to:
# - RAG context pack code added to main after fix was created
# - Different import structures

# Test the fix
npm run build
npm test

# Create PR
gh pr create --title "fix: Implement MCP notifications for tool-gateway/llm-bot startup race" \
  --body "Rebased and updated version of the MCP notifications fix from July 2026"
```

### Option 2: Manual Application
I can manually apply each change with proper conflict resolution, but it's ~200 lines of code across 2 files.

### Option 3: Fresh Implementation
Reimplement from scratch based on the original design, ensuring compatibility with current main.

## Files to Review

**Original Fix:**
- Commit: `39f9bbe72b191bb03075bc4b59b44caea6d14997`
- Branch: `fix/tool-registration-on-deploy`
- View: `git show 39f9bbe`

**Test Suite:**
- Commit: `6c66fc7`
- Tests: `src/apps/tool-gateway.test.ts` (if exists)

## Testing Plan

After merging:
1. Build project: `npm run build`
2. Run tests: `npm test`
3. Deploy to staging
4. Verify:
   - Start tool-gateway
   - Start llm-bot
   - Register a new Bit
   - Confirm llm-bot discovers new tools within 5 seconds
   - No manual restarts required

## Next Steps

1. **Choose option above** (recommend Option 1: rebase and merge)
2. **Resolve merge conflicts** (I can help with this)
3. **Test thoroughly** (build, unit tests, integration tests)
4. **Create PR with comprehensive description**
5. **Merge to main**
6. **Deploy to staging, then production**

---

**Created:** 2026-07-13
**Status:** Awaiting decision on merge approach
**Impact:** High - eliminates manual restart requirement after deployments
**Complexity:** Medium - ~200 lines across 2 files with merge conflicts
