# Sprint 354: Dev MCP Execution Context Adoption

## Quick Reference

- **Sprint ID**: 354
- **Sprint Name**: Dev MCP Execution Context Adoption
- **Branch**: `feature/dev-mcp-execution-context`
- **Status**: Planning
- **Start Date**: 2026-07-22
- **Estimated Duration**: 2-3 days
- **Lead Implementor**: Claude Code

## Objective

Refactor the Dev MCP server to fully adopt the platform's standardized **Execution Context framework** (Sprint 349), eliminating 143 lines of duplicated code and ensuring consistent environment resolution across all `brat` commands.

## Problem Statement

The Dev MCP server currently maintains a **custom target resolution system** in `TargetConnectionManager` that duplicates logic from the platform's `ContextResolver`. This creates:

1. **Code Duplication**: 143 lines of custom context resolution in `target-manager.ts`
2. **Inconsistent Behavior**: Dev MCP doesn't respect `~/.bratrc` or `BITBRAT_CONTEXT`
3. **Missing Features**: No auto-discovery, env overlays, or context priority resolution
4. **Maintenance Burden**: Changes to Execution Context framework require manual Dev MCP updates

### Current Architecture (Problematic)

```
Dev MCP Server
  ↓
TargetConnectionManager (custom logic)
  ↓
Manually loads architecture.yaml
Manually resolves executionContexts vs deploymentTargets
Manually constructs PostgreSQL connection strings
Manually resolves gateway URLs
  ↓
TargetConnection
```

### Desired Architecture (Sprint 354)

```
Dev MCP Server
  ↓
ContextResolver (shared platform component)
  ↓
ContextAdapter (NEW: converts ResolvedContext → TargetConnection)
  ↓
TargetConnectionManager (simplified, caching only)
  ↓
TargetConnection
```

## Success Criteria

### Quantitative
- ✅ Zero custom context resolution logic in Dev MCP (eliminate 143 lines)
- ✅ Code coverage >90% for new ContextAdapter
- ✅ 100% integration tests passing
- ✅ 100% backward compatibility maintained

### Qualitative
- ✅ Dev MCP respects `~/.bratrc` current context
- ✅ Dev MCP respects `BITBRAT_CONTEXT` env var
- ✅ Dev MCP auto-discovers gateway and PostgreSQL
- ✅ Dev MCP supports env overlays (global.yaml, infra.yaml, service.yaml)
- ✅ No code duplication with ContextResolver

## Key Deliverables

### Critical (P0)
1. **ContextAdapter** - Converts `ResolvedContext` → `TargetConnection`
2. **Refactored TargetConnectionManager** - Uses `ContextResolver` + `ContextAdapter`
3. **Updated DevMcpServer** - Accepts `--context` flag instead of `--target`

### High Priority (P1)
4. **Updated CLI Command** - `brat dev-mcp start --context <name>`
5. **Updated Tool Schemas** - All tools accept `context` parameter
6. **Integration Tests** - Comprehensive context resolution testing

### Medium Priority (P2)
7. **Documentation Updates** - Migration guide, CLAUDE.md, coding guides
8. **Deprecation Warnings** - Mark `--target` as deprecated

## Sprint Artifacts

- **[EXECUTION_PLAN.md](./EXECUTION_PLAN.md)** - Detailed implementation plan with phases, tasks, and architecture
- **[backlog.yaml](./backlog.yaml)** - Trackable YAML backlog with all tasks, priorities, and dependencies
- **[verification-report.md](./verification-report.md)** - *(To be created)* Sprint completion status and test results
- **[retro.md](./retro.md)** - *(To be created)* Retrospective and key learnings

## Timeline

### Day 1: Context Adapter & TargetConnectionManager
- Create `ContextAdapter` class (4 hours)
- Refactor `TargetConnectionManager` to use adapter (3 hours)
- **Deliverables**: Adapter tested, manager refactored

### Day 2: Server Updates & Tool Schemas
- Update `DevMcpServer` constructor (2 hours)
- Update CLI command (1 hour)
- Update all tool schemas (2 hours)
- **Deliverables**: `--context` flag works, all tools updated

### Day 3: Testing & Documentation
- Create integration tests (3 hours)
- Update documentation (2 hours)
- Add deprecation warnings (1 hour)
- **Deliverables**: Tests passing, docs updated

**Total Estimate**: 18 hours (2-3 days)

## Technical Highlights

### New Component: ContextAdapter

**File**: `tools/brat/src/dev-mcp/adapters/context-adapter.ts`

Bridges the gap between platform-standard `ResolvedContext` and Dev MCP's `TargetConnection`:

```typescript
export class ContextAdapter {
  async createConnection(resolved: ResolvedContext): Promise<TargetConnection> {
    // Convert ResolvedContext → TargetConnection
    // Create PostgreSQL DocumentStore (if driver === postgres)
    // Create Firestore connection (if driver === firestore)
    // Set up SSH tunnels (if needed)
    // Return fully-initialized TargetConnection
  }
}
```

### Eliminated Code

**Lines Removed**: 143 lines in `target-manager.ts`

- Custom `architecture.yaml` loading
- Custom `executionContexts` vs `deploymentTargets` resolution
- Custom persistence driver resolution
- Custom PostgreSQL connection string construction
- Custom gateway URL resolution
- Custom SSH details extraction

All replaced by:
```typescript
const resolved = await this.contextResolver.resolve(contextName);
const connection = await this.contextAdapter.createConnection(resolved);
```

## Migration Guide

### For End Users

**Old Command**:
```bash
npm run brat -- dev-mcp start --target staging
```

**New Command**:
```bash
npm run brat -- dev-mcp start --context staging
```

**Backward Compatibility**: `--target` flag still works with deprecation warning for 3 sprints.

### For Tool Authors

**Old Tool Schema**:
```typescript
const InputSchema = z.object({
  target: z.string().optional(),
  // ...
});
```

**New Tool Schema**:
```typescript
const InputSchema = z.object({
  context: z.string().optional(),  // Changed from target
  // ...
});
```

**Backward Compatibility**: Tools accept both `target` and `context` for 3 sprints.

## Risk Management

### High-Risk Changes
1. **Breaking change for existing users**
   - Mitigation: Backward compatibility with `--target`, deprecation warnings
   - Rollback: Keep both flags for 3 sprints before removing `--target`

### Medium-Risk Changes
2. **Context resolution bugs**
   - Mitigation: Reuse proven `ContextResolver`, comprehensive testing
   - Rollback: Restore custom logic if critical bugs found

3. **SSH tunnel issues**
   - Mitigation: Reuse existing `SSHTunnelManager`, thorough testing
   - Rollback: Fall back to direct connection if tunnels fail

## Dependencies

### Prerequisites
- ✅ Sprint 349 (Execution Context framework) - Complete
- ✅ Sprint 353 (PostgreSQL default) - Complete
- ✅ `ContextResolver` API stable

### Blocking Issues
None

### Blocked By
None - ready to start immediately

## Testing Strategy

### Unit Tests
- `context-adapter.test.ts` - Test ResolvedContext → TargetConnection conversion
- `target-manager.test.ts` - Test connection caching and cleanup

### Integration Tests
- `context-integration.test.ts` - Test full context resolution flow
  - Context priority (flag → env → bratrc → default)
  - Auto-discovery (gateway, PostgreSQL)
  - Env overlay loading
  - SSH tunnel setup
  - Backward compatibility (`--target` flag)

### Manual Testing
- [ ] Start Dev MCP with `--context local`
- [ ] Start Dev MCP with `--context staging`
- [ ] Start Dev MCP with `BITBRAT_CONTEXT=staging`
- [ ] Start Dev MCP with `~/.bratrc` set to staging
- [ ] Verify PostgreSQL connection works
- [ ] Verify gateway auto-discovery works
- [ ] Verify fleet tools work
- [ ] Verify backward compatibility (`--target` flag)

## Open Questions

1. **Loki Configuration**: Should `ResolvedContext` include Loki URL/tunnel config?
   - **Recommendation**: Yes, add optional `loki` field for consistency

2. **Firestore Deprecation**: Should we mark Firestore support as deprecated in Dev MCP?
   - **Recommendation**: Yes, aligns with Sprint 353 PostgreSQL default

3. **Auth Token Handling**: Should auth token come from `ResolvedContext.gateway.authToken`?
   - **Recommendation**: Use `ResolvedContext.gateway.authToken` as primary

4. **Backward Compatibility Duration**: How long should we support `--target` flag?
   - **Recommendation**: 3 sprints (standard deprecation policy)

## Notes

- This sprint eliminates **143 lines of duplicated code**
- Dev MCP becomes a **first-class consumer** of Execution Context framework
- Auto-discovery features now available: gateway port, PostgreSQL container
- Env overlay support now available: global.yaml, infra.yaml, service.yaml, .secure.*
- Backward compatibility maintained for **3 sprints** before `--target` removal
- Future benefit: Any improvements to `ContextResolver` automatically benefit Dev MCP

## Quick Start

```bash
# Review sprint artifacts
cat planning/sprint-354-dev-mcp-execution-context/EXECUTION_PLAN.md
cat planning/sprint-354-dev-mcp-execution-context/backlog.yaml

# Create and checkout sprint branch
git checkout -b feature/dev-mcp-execution-context

# Start with Phase 1: Create ContextAdapter
# See EXECUTION_PLAN.md for detailed implementation steps
```

## Contact

**Lead Implementor**: Claude Code
**Sprint Owner**: Product Owner
**Reviewers**: Technical Lead, Senior Engineers

---

**Last Updated**: 2026-07-22
**Status**: Planning → Ready for Implementation
