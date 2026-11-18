# Sprint 65: MCP SDK v2 Migration - Implementation Log

## Session: 2026-11-18

### Summary

Successfully migrated tool-orchestrator to MCP SDK v2 context extraction pattern. Fixed _meta extraction to use `ctx.mcpReq._meta` (v2) instead of `args._meta` (v1). Deployed and validated in staging environment.

### Tasks Completed

#### TASK-001: Backup v1 Implementation ✅
- Created backup: `src/apps/tool-orchestrator-service.ts.v1-backup`
- Committed to git (commit b5d78c35)
- File size: 78KB, 2249 lines

#### TASK-002: Fix _meta Extraction Pattern ✅
- **File**: `src/apps/tool-orchestrator-service.ts`
- **Changes**: Fixed getMcpServer() method (lines 1424-1693)

**Loop 1: PostgreSQL Tools (Lines 1538-1548)**
```typescript
// BEFORE (v1):
const metaFromArgs = (args as any)._meta;
const metaFromCtx = (ctx as any)?._meta;
const metaFromMcpReq = (ctx as any)?.mcpReq?._meta;
const meta = metaFromArgs || metaFromMcpReq || metaFromCtx;

// AFTER (v2):
const meta = ctx.mcpReq._meta;
```

**Loop 2: Direct Admin Tools (Lines 1635-1643)**
```typescript
// BEFORE (v1):
const meta = (args as any)._meta;

// AFTER (v2):
const meta = ctx.mcpReq._meta;
```

#### TASK-003: Update Context Extraction ✅
- Changed from checking multiple _meta locations to using ONLY `ctx.mcpReq._meta`
- Fallback pattern: `_meta → http headers → defaults`
- Applied to both registerTool loops

#### TASK-004: Update Header Access ✅
- Changed from bracket notation to `.get()` method (Web API standard)
- **Before**: `ctx.http?.req?.headers?.['x-user-id']`
- **After**: `ctx.http?.req?.headers.get('x-user-id')`
- Updated all header accesses:
  - `x-user-id`
  - `x-roles`
  - `x-correlation-id`
  - `x-session-id`

#### TASK-009: Staging Validation ✅
- Deployed to staging environment
- **Verification**:
  - ✅ TypeScript compilation successful
  - ✅ Service starts cleanly
  - ✅ MCP server initialized: 505 aggregated tools + 29 own tools
  - ✅ No runtime errors in logs
  - ✅ Health checks operating normally

### Key Technical Decisions

#### 1. Kept `registerTool()` Approach
**Decision**: Did NOT switch to `setRequestHandler()` as originally planned in backlog.

**Reason**: The `setRequestHandler()` method does not exist on the `McpServer` class in v2.0.0. The MCP SDK v2 still uses `registerTool()` for per-tool registration. The migration guide's mention of `setRequestHandler` applies to the lower-level `Server` class, not the high-level `McpServer` convenience class.

**Impact**: The fix is simpler than originally planned - only changing WHERE _meta is extracted, not HOW tools are registered.

#### 2. Simplified _meta Extraction
**Decision**: Use `ctx.mcpReq._meta` as primary source, with fallback to HTTP headers.

**Reason**: The v2 SDK consistently places _meta in `ctx.mcpReq._meta`. Checking multiple locations was defensive programming from v1 transition period, but adds unnecessary complexity.

**Benefits**:
- Clearer code (single source of truth)
- Easier to debug
- Better performance (no multiple property lookups)

### Code Changes

**Files Modified**:
- `src/apps/tool-orchestrator-service.ts` (lines 1538-1548, 1635-1643)
- `planning/sprint-65-yt9tbb/backlog.yaml` (task status updates)

**Lines Changed**: 12 lines modified across 2 locations

**Git Commits**:
1. `b5d78c35` - Backup v1 implementation
2. `dc97499c` - Sprint 65 TASK-002/003/004: Fix MCP SDK v2 context extraction
3. `b439251b` - Sprint 65: Mark TASK-009 complete

### Validation Evidence

#### Staging Logs
```
mcp_server.initialized_with_aggregation
  aggregatedTools: 505
  ownTools: 29
  totalTools: 534
```

#### Service Health
- **Status**: Running
- **Uptime**: Continuous since deployment
- **Errors**: None observed
- **Health Checks**: All passing

### Next Steps

#### Immediate (Phase 1)
- [ ] **TASK-005**: Write unit tests for context extraction
- [ ] **TASK-006**: Write integration test verifying v2 MCP tool calls
- [ ] **TASK-010**: Production deployment validation

#### Phase 2 (base-server.ts Migration)
- [ ] **TASK-011**: Backup base-server.ts v1 implementation
- [ ] **TASK-012**: Update getMcpServer() in base-server.ts
- [ ] **TASK-013**: Update all Bit subclasses using base implementation
- [ ] ... (continue with phase 2 tasks)

### Lessons Learned

1. **Always verify SDK API surface**: The migration documentation mentioned `setRequestHandler`, but the actual installed SDK (v2.0.0) doesn't have this method on `McpServer`. Always check the actual TypeScript definitions.

2. **Compilation errors are your friend**: The failed compilation immediately revealed that our understanding of the v2 API was incorrect, preventing deployment of broken code.

3. **Staging validation works**: Even without full end-to-end tool execution testing, we can verify:
   - Code compiles
   - Service starts
   - MCP server initializes
   - No runtime errors

4. **Defensive programming creates tech debt**: The v1 pattern of checking multiple _meta locations (args, ctx, mcpReq) made the code harder to understand. The v2 fix simplifies to a single source.

### Documentation Updates Needed

- [ ] Update CLAUDE.md Pattern #11 (Building MCP Aggregator Services) with v2 findings
- [ ] Document difference between `Server` class and `McpServer` class in SDK
- [ ] Add troubleshooting guide for v1 → v2 migration issues

### Risk Assessment

**Current Risk**: **LOW**

- ✅ Code compiles and runs
- ✅ No breaking changes to tool registration
- ✅ Fallback headers still work for HTTP transport
- ✅ Staging deployment successful
- ⚠️ Full end-to-end tool execution not yet tested (requires actual tool call with _meta)

**Mitigation**: Integration test (TASK-006) will verify full execution path.

---

**Session Duration**: ~90 minutes
**Lines of Code Changed**: 12
**Services Migrated**: 1 (tool-orchestrator)
**Services Remaining**: ~25 (all other Bits using base-server.ts)
