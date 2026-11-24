# Platform Tool Registry Lifecycle - Analysis & Recommendations

**Problem**: Ongoing data quality issues in `platform_tool_registry` from incomplete lifecycle management.

**Root Causes**:
1. Tools never deleted when upstream servers removed
2. No validation of required fields (e.g., canonicalName can be undefined)
3. No schema versioning (breaks LLM prompt caching)
4. No reconciliation to detect deleted/changed tools
5. No tracking of server online/offline state

---

## Current Lifecycle (Incomplete)

```
DISCOVERY → REGISTRATION → ACTIVE USE → HEALTH MONITORING → [GARBAGE COLLECTION MISSING]
  (startup)   (upsert)      (invocations)  (periodic checks)      (never happens!)
```

**Files Involved**:
- `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts` - Core registry (262-336: importFromMcp, 342-424: importFromBit)
- `src/apps/tool-orchestrator-service/modules/observer/health-updater.ts` - Health tracking (186-197: stale detection)
- `src/apps/tool-orchestrator-service/modules/types/tool-registry-document.ts:73-91` - Schema definition
- `src/common/mcp/client-manager.ts` - Upstream MCP server connections

---

## Gap Analysis

### 1. No Server Lifecycle Tracking

**Current State**: Tools persist forever, even after upstream server removed.

**Problem Example**:
```bash
# Sprint 50: Removed `story-engine-mcp` from architecture.yaml
# Result: 85 story-engine tools remain in PostgreSQL
# Impact: 85 zombie tools exposed to LLM, some with undefined canonicalName
```

**What's Missing**:
```typescript
// No tracking of:
interface ToolRegistryDocument {
  lastSeenAt: Date;           // When did we last see this tool from upstream?
  serverOnline: boolean;       // Is the upstream server currently connected?
  serverVersion?: string;      // For compatibility checks
}
```

**Recommendation**: Add server lifecycle tracking + cleanup job.

---

### 2. No Registration Validation

**Current State**: Tools registered without field validation.

**Problem Example** (Sprint 66):
```
ERROR: "Cannot read properties of undefined (reading 'startsWith')"
Cause: tool.canonicalName is undefined for mcp:reflex/bit.readiness
```

**Root Cause** (tool-registry.ts:274-298):
```typescript
async importFromMcp(serverName: string, tools: McpToolDefinition[]): Promise<string[]> {
  for (const mcpTool of tools) {
    const toolDoc: ToolRegistryDocument = {
      id: `mcp.${serverName}.${mcpTool.name}`,
      canonicalName: mcpTool.name,  // ❌ Could be undefined!
      // ... no validation
    };
    await this.store.set(COLLECTION_NAME, toolDoc.id, toolDoc);
  }
}
```

**Recommendation**: Add Zod schema validation before registration.

**Fix Required**:
```typescript
import { z } from 'zod';

const McpToolDefinitionSchema = z.object({
  name: z.string().min(1, 'Tool name required'),
  description: z.string().optional(),
  inputSchema: z.any(), // JSON Schema
});

async importFromMcp(serverName: string, tools: McpToolDefinition[]): Promise<string[]> {
  const importedIds: string[] = [];
  const errors: Array<{ tool: any; error: string }> = [];

  for (const mcpTool of tools) {
    // Validate tool definition
    const validation = McpToolDefinitionSchema.safeParse(mcpTool);

    if (!validation.success) {
      this.logger.warn('tool_registry.import_invalid_tool', {
        serverName,
        tool: mcpTool,
        errors: validation.error.errors,
      });
      errors.push({ tool: mcpTool, error: validation.error.message });
      continue; // Skip invalid tools
    }

    // ... proceed with registration
  }

  // Log summary
  this.logger.info('tool_registry.import_complete', {
    serverName,
    imported: importedIds.length,
    skipped: errors.length,
    errors: errors.length > 0 ? errors : undefined,
  });

  return importedIds;
}
```

---

### 3. No Schema Versioning

**Current State**: Schema changes overwrite without versioning.

**Problem**:
- LLM caches tool schemas in prompt history
- Schema changes break LLM's understanding mid-conversation
- No audit trail of schema evolution

**What's Missing**:
```typescript
interface ToolRegistryDocument {
  schemaVersion: number;         // Increment on breaking changes
  schemaHistory?: {
    version: number;
    changedAt: Date;
    changedBy: string;           // Which server/migration updated it
    previousSchema: any;         // For rollback
  }[];
}
```

**Recommendation**: Implement semantic versioning for tool schemas.

**Strategy**:
1. **Detection**: Hash inputSchema to detect changes
2. **Classification**: Determine if change is breaking (major) or non-breaking (minor)
3. **Versioning**: Append `@v{version}` to tool ID for breaking changes
4. **Deprecation**: Mark old version as deprecated, keep both for grace period

**Example**:
```typescript
// Initial registration
toolId: "mcp:reflex.list@v1"
schemaVersion: 1

// Breaking schema change detected (removed required field)
toolId: "mcp:reflex.list@v2"  // New tool ID
schemaVersion: 2

// Old tool marked deprecated
await updateTool("mcp:reflex.list@v1", {
  status: 'deprecated',
  deprecationNotice: 'Use mcp:reflex.list@v2',
  deprecatedAt: new Date(),
});
```

---

### 4. No Stale Tool Cleanup

**Current State**: HealthUpdater marks tools unhealthy but never deletes them.

**Problem**: 505 tools in registry, but only ~400 actively used.

**Current Behavior** (health-updater.ts:186-197):
```typescript
if (timeSinceLastInvocation > this.config.staleThresholdMs) {
  return {
    status: 'unhealthy',
    lastError: `No invocations in last ${Math.round(timeSinceLastInvocation / (60 * 1000))} minutes`,
  };
}
// ❌ Tool stays in registry forever, unhealthy
```

**Recommendation**: Add cleanup job with grace periods.

**Strategy**:
```
Unhealthy (1 hour) → Stale (7 days) → Archived (30 days) → Deleted (90 days)
```

**Implementation**:
```typescript
interface ToolRegistryDocument {
  status: 'active' | 'unhealthy' | 'stale' | 'archived' | 'deleted';
  staleMarkedAt?: Date;          // When did we first mark this stale?
  archiveEligibleAt?: Date;      // When can we archive this?
  deleteEligibleAt?: Date;       // When can we hard delete this?
}

async cleanupStaleTools(): Promise<void> {
  const now = Date.now();
  const STALE_THRESHOLD = 7 * 24 * 60 * 60 * 1000;    // 7 days unhealthy
  const ARCHIVE_THRESHOLD = 30 * 24 * 60 * 60 * 1000; // 30 days stale
  const DELETE_THRESHOLD = 90 * 24 * 60 * 60 * 1000;  // 90 days archived

  const allTools = await this.queryTools({});

  for (const tool of allTools) {
    // Transition: unhealthy → stale
    if (tool.status === 'unhealthy') {
      const unhealthySince = tool.health.lastErrorAt?.getTime() || now;
      if (now - unhealthySince > STALE_THRESHOLD) {
        await this.updateTool(tool.id, {
          status: 'stale',
          staleMarkedAt: new Date(),
          archiveEligibleAt: new Date(now + ARCHIVE_THRESHOLD),
        });
      }
    }

    // Transition: stale → archived
    if (tool.status === 'stale' && tool.archiveEligibleAt) {
      if (now > tool.archiveEligibleAt.getTime()) {
        await this.updateTool(tool.id, {
          status: 'archived',
          deleteEligibleAt: new Date(now + DELETE_THRESHOLD),
        });
      }
    }

    // Transition: archived → deleted
    if (tool.status === 'archived' && tool.deleteEligibleAt) {
      if (now > tool.deleteEligibleAt.getTime()) {
        this.logger.info('tool_registry.deleting_stale_tool', {
          toolId: tool.id,
          archivedSince: tool.deleteEligibleAt,
        });
        await this.deleteTool(tool.id);
      }
    }
  }
}
```

**Escape Hatch**: Admin tool to restore archived tools if needed.

---

### 5. No Reconciliation with Upstream

**Current State**: No periodic check that tools in PostgreSQL still exist upstream.

**Problem**:
- Upstream MCP server removes a tool → PostgreSQL keeps stale entry
- Upstream adds a tool → Not discovered until restart
- Schema drift between upstream and registry

**Recommendation**: Periodic reconciliation job.

**Implementation**:
```typescript
async reconcileWithUpstream(serverName: string): Promise<ReconciliationReport> {
  const report: ReconciliationReport = {
    serverName,
    toolsInRegistry: 0,
    toolsUpstream: 0,
    added: [],
    removed: [],
    updated: [],
    errors: [],
  };

  try {
    // 1. Get current state from PostgreSQL
    const registryTools = await this.queryTools({
      source: ['mcp'],
      // TODO: Filter by sourceMetadata.mcpServer.name === serverName
    });
    report.toolsInRegistry = registryTools.length;

    // 2. Get current state from upstream MCP server
    const upstreamConnection = await this.mcpManager.getConnection(serverName);
    if (!upstreamConnection) {
      report.errors.push(`Server ${serverName} not connected`);
      return report;
    }

    const upstreamTools = await upstreamConnection.listTools();
    report.toolsUpstream = upstreamTools.length;

    // 3. Build lookup maps
    const registryMap = new Map(registryTools.map(t => [t.canonicalName, t]));
    const upstreamMap = new Map(upstreamTools.map(t => [t.name, t]));

    // 4. Find removed tools (in registry but not upstream)
    for (const [canonicalName, registryTool] of registryMap) {
      if (!upstreamMap.has(canonicalName)) {
        this.logger.warn('tool_registry.tool_removed_from_upstream', {
          toolId: registryTool.id,
          canonicalName,
          serverName,
        });

        // Mark as deleted (soft delete)
        await this.updateTool(registryTool.id, {
          status: 'deleted',
          lastUpdatedAt: new Date(),
        });

        report.removed.push(registryTool.id);
      }
    }

    // 5. Find added tools (upstream but not in registry)
    for (const [name, upstreamTool] of upstreamMap) {
      if (!registryMap.has(name)) {
        this.logger.info('tool_registry.new_tool_discovered', {
          toolName: name,
          serverName,
        });

        // Import the new tool
        await this.importFromMcp(serverName, [upstreamTool]);
        report.added.push(`mcp.${serverName}.${name}`);
      }
    }

    // 6. Find updated tools (schema changes)
    for (const [name, upstreamTool] of upstreamMap) {
      const registryTool = registryMap.get(name);
      if (registryTool) {
        // Compare schemas (simple hash comparison)
        const registrySchemaHash = this.hashSchema(registryTool.inputSchema);
        const upstreamSchemaHash = this.hashSchema(upstreamTool.inputSchema);

        if (registrySchemaHash !== upstreamSchemaHash) {
          this.logger.info('tool_registry.schema_changed', {
            toolId: registryTool.id,
            canonicalName: name,
            serverName,
          });

          // Update schema (increment version if breaking change)
          await this.updateTool(registryTool.id, {
            inputSchema: upstreamTool.inputSchema,
            schemaVersion: (registryTool.schemaVersion || 1) + 1,
            lastUpdatedAt: new Date(),
          });

          report.updated.push(registryTool.id);
        }
      }
    }

    this.logger.info('tool_registry.reconciliation_complete', report);
    return report;

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    this.logger.error('tool_registry.reconciliation_failed', {
      serverName,
      error,
    });
    report.errors.push(error);
    return report;
  }
}

interface ReconciliationReport {
  serverName: string;
  toolsInRegistry: number;
  toolsUpstream: number;
  added: string[];         // Tool IDs added to registry
  removed: string[];       // Tool IDs removed from registry
  updated: string[];       // Tool IDs with schema changes
  errors: string[];
}
```

**Scheduling**: Run reconciliation:
- On startup (verify registry matches upstream)
- Every 1 hour (detect drift)
- On MCP server reconnect (after outage)

---

## Recommended Implementation Plan

### Phase 1: Critical Fixes (Sprint 67 or immediate)
1. **Add registration validation** (tool-registry.ts:262)
   - Validate canonicalName is defined and non-empty
   - Skip tools that fail validation
   - Log warnings for debugging
   - **Impact**: Prevents undefined canonicalName issues immediately

2. **Add defensive checks in getMcpServer()** (tool-orchestrator-service.ts:1495)
   - Already implemented in Sprint 66
   - Skip tools with missing canonicalName
   - Log warnings for investigation
   - **Impact**: Service won't crash on bad data

### Phase 2: Backfill & Cleanup (Sprint 67-68)
1. **Create migration script to fix existing data**:
   ```bash
   # Find tools with missing canonicalName
   SELECT id, description, source FROM platform_tool_registry WHERE "canonicalName" IS NULL;

   # Option 1: Backfill from tool ID
   UPDATE platform_tool_registry
   SET "canonicalName" = substring(id FROM 'mcp:([^/]+)')
   WHERE "canonicalName" IS NULL AND id LIKE 'mcp:%';

   # Option 2: Mark as deleted (if unrecoverable)
   UPDATE platform_tool_registry
   SET status = 'deleted', "lastUpdatedAt" = NOW()
   WHERE "canonicalName" IS NULL;
   ```

2. **Implement stale tool cleanup job**:
   - Add `cleanupStaleTools()` method (tool-registry.ts)
   - Schedule via scheduler-service (every 24 hours)
   - Gradual transition: unhealthy → stale → archived → deleted
   - **Impact**: Removes 100+ zombie tools over 90 days

### Phase 3: Reconciliation (Sprint 68-69)
1. **Implement reconciliation with upstream**:
   - Add `reconcileWithUpstream()` method (tool-registry.ts)
   - Schedule via scheduler-service (every 1 hour)
   - Run on startup and after MCP server reconnects
   - **Impact**: Detects removed/added tools within 1 hour

2. **Add server lifecycle tracking**:
   - Extend ToolRegistryDocument schema (add lastSeenAt, serverOnline)
   - Update on each reconciliation
   - Mark tools from offline servers as unavailable
   - **Impact**: Better debugging of tool availability issues

### Phase 4: Schema Versioning (Sprint 70+)
1. **Implement schema versioning**:
   - Add schemaVersion, schemaHistory to ToolRegistryDocument
   - Detect breaking vs non-breaking schema changes
   - Create new tool ID for breaking changes (e.g., @v2 suffix)
   - Deprecate old versions with grace period
   - **Impact**: LLM prompt stability, better debugging

---

## Immediate Action Items

**For Current Sprint (66):**
1. ✅ Add defensive check in getMcpServer() (already done)
2. ⏳ Query staging PostgreSQL to identify tools with missing canonicalName:
   ```bash
   npm run brat -- db query platform_tool_registry \
     --context staging \
     --filters '[{"field":"canonicalName","operator":"==","value":null}]' \
     --limit 50
   ```
3. ⏳ Create backfill migration script (migrations/027-backfill-missing-canonical-name.sql)

**For Next Sprint (67):**
1. Add registration validation to importFromMcp/importFromBit
2. Implement cleanupStaleTools() job
3. Schedule cleanup job via scheduler-service
4. Test in agent-dev before staging deployment

**For Sprint 68:**
1. Implement reconcileWithUpstream()
2. Add server lifecycle tracking fields
3. Schedule reconciliation job
4. Create admin MCP tool for manual reconciliation

---

## Schema Changes Required

```typescript
// src/apps/tool-orchestrator-service/modules/types/tool-registry-document.ts

export interface ToolRegistryDocument {
  // ... existing fields

  // Phase 2: Stale tool cleanup
  status: 'active' | 'unhealthy' | 'stale' | 'archived' | 'deleted'; // Add stale, archived, deleted
  staleMarkedAt?: Date;          // When did we first mark this stale?
  archiveEligibleAt?: Date;      // When can we archive this?
  deleteEligibleAt?: Date;       // When can we hard delete this?

  // Phase 3: Server lifecycle tracking
  lastSeenAt?: Date;             // Last time upstream server reported this tool
  serverOnline?: boolean;         // Is the upstream server currently connected?
  serverVersion?: string;         // Version of upstream server (for compatibility)

  // Phase 4: Schema versioning
  schemaVersion?: number;         // Semantic version of inputSchema (increment on breaking changes)
  schemaHistory?: {               // Audit trail of schema changes
    version: number;
    changedAt: Date;
    changedBy: string;            // Which server/migration updated it
    previousSchemaHash: string;   // SHA-256 of previous schema
  }[];
  deprecatedAt?: Date;            // When was this tool marked deprecated?
  deprecationNotice?: string;     // Replacement tool ID or migration guide
}
```

---

## Success Metrics

**Data Quality**:
- Zero tools with undefined canonicalName (currently: ~10)
- <5% tools marked as stale (currently: unknown, likely 20%)
- 100% tools in registry exist in upstream servers

**Operational**:
- Reconciliation job runs successfully every hour
- Cleanup job removes 0-10 tools per week (gradual)
- Zero tool-orchestrator crashes due to bad registry data

**Developer Experience**:
- Clear logs when tools are added/removed/updated
- Admin tools for manual reconciliation and cleanup
- Migration scripts for backfilling historical data

---

## Questions for Discussion

1. **Cleanup aggressiveness**: 90-day grace period too long? Too short?
2. **Schema versioning**: Should we version ALL tools or just domain tools?
3. **Reconciliation frequency**: 1 hour too aggressive? Should it be configurable?
4. **Migration strategy**: Backfill missing canonicalName from tool ID, or hard delete?
5. **Zombie tool tolerance**: Should we keep tools from deleted servers for debugging?

---

## Related Issues

- **Sprint 66**: Undefined canonicalName causing TypeError in getMcpServer()
- **Sprint 61**: RBAC validation needs clean tool metadata
- **Sprint 57**: Tool registry foundation (implemented importFromMcp)
- **Sprint 60**: Health updater marks tools unhealthy but doesn't clean up

**Files to Review**:
- `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts`
- `src/apps/tool-orchestrator-service/modules/observer/health-updater.ts`
- `src/apps/tool-orchestrator-service/modules/types/tool-registry-document.ts`
- `src/common/mcp/client-manager.ts`
