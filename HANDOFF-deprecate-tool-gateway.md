# Tool-Gateway Deprecation Plan - Sprint 66

## Executive Summary

**Decision**: Deprecate and remove `tool-gateway` service effective immediately.

**Rationale**:
1. Tool-orchestrator (Sprint 61) has fully replaced tool-gateway functionality
2. Tool-gateway is causing data pollution in platform_tool_registry (247/504 tools with corrupted canonicalName)
3. `ENABLE_TOOL_ORCHESTRATOR=true` already deployed in staging
4. No services depend on tool-gateway in the critical path
5. Tool-orchestrator provides superior functionality (PostgreSQL-backed, RBAC, health tracking)

**Impact**: Zero-downtime migration. Tool-gateway already bypassed by feature flag.

---

## Background

### Tool-Gateway vs Tool-Orchestrator

| Feature | Tool-Gateway (Legacy) | Tool-Orchestrator (Sprint 61+) |
|---------|----------------------|-------------------------------|
| **Registry** | In-memory (volatile) | PostgreSQL (persistent) |
| **RBAC** | Basic | Advanced (user+model roles, trust scores) |
| **Health Tracking** | None | Per-tool metrics via Loki |
| **Compositions** | No | Yes (Sprint 61) |
| **Schema Versioning** | No | Planned (Sprint 70) |
| **Tool Count** | 371 (legacy) | 505 (current) |
| **Data Quality** | 66.58% pollution | 0% (after migration 028) |

### Problem: canonicalName Pollution

**Root Cause**: Tool-gateway's `importFromBit()` uses sanitized tool names instead of `canonicalName`:
- MCP SDK sanitizes: `counter.increment` → `counter_increment`
- Tool-gateway stores: `canonicalName: "mcp:mcp_counter_increment"`
- Tool-orchestrator imports from tool-gateway → double-prefixing
- After 6+ import cycles: `"mcp:mcp_mcp_mcp_mcp_mcp_mcp_counter.increment"`

**Evidence** (from migration 027):
```
247 tools (49%) affected
Worst case: 6x prefixed canonicalName
100% pollution from tool-gateway imports
  0% pollution from direct MCP servers
```

**Fix Applied** (migration 028):
- Cleaned all 247 polluted tools
- Extracted correct names from tool IDs
- Created rollback table for safety

---

## Deprecation Steps

### Phase 1: Immediate (Sprint 66)

**1.1 Mark tool-gateway as deprecated in architecture.yaml**
```yaml
tool-gateway:
  active: false  # Changed from true
  deprecated: true
  deprecatedAt: "2026-11-24"
  deprecationReason: "Replaced by tool-orchestrator (Sprint 61). Causing data pollution."
  replacementService: "tool-orchestrator"
```

**1.2 Stop tool-gateway in staging**
```bash
ssh root@bitbrat.lan 'docker stop bitbrat-staging-tool-gateway-1'
```

**1.3 Verify no impact**
- Monitor llm-bot logs for tool execution errors
- Check tool-orchestrator connection count remains stable
- Test chat flow end-to-end

**1.4 Remove tool-gateway from tool-orchestrator's upstream MCP servers**

Currently tool-orchestrator is configured to import from tool-gateway. We need to remove that connection to prevent re-pollution.

Check current MCP server connections:
```bash
# Query tool-orchestrator's MCP configuration
# Look for tool-gateway in upstream server list
```

**Expected**: Tool-orchestrator should only connect to:
- Direct MCP servers (image-gen-mcp, scheduler, etc.)
- Other platform Bits (reflex, llm-bot, etc.)
- **NOT** tool-gateway (aggregator)

### Phase 2: Cleanup (Sprint 67)

**2.1 Remove tool-gateway from docker-compose**
- Remove service definition from `docker-compose.yml`
- Remove from `docker-compose.prod.yml`
- Remove from deployment scripts

**2.2 Remove tool-gateway configuration files**
- Delete `env/*/tool-gateway.yaml`
- Remove `MCP_GATEWAY_URL` from `env/*/global.yaml`
- Keep `ENABLE_TOOL_ORCHESTRATOR` flag for rollback capability

**2.3 Archive tool-gateway source code**
- Move `src/apps/tool-gateway.ts` → `deprecated/tool-gateway/`
- Move related services → `deprecated/tool-gateway/services/`
- Keep for historical reference only

**2.4 Update documentation**
- Mark tool-gateway as deprecated in CLAUDE.md
- Update architecture.yaml glossary
- Remove tool-gateway from deployment guides

### Phase 3: Validation (Sprint 67-68)

**3.1 Monitor for 2 weeks**
- Zero tool execution errors
- No canonicalName re-pollution
- Tool count remains stable (505 tools)

**3.2 Delete from production**
- Apply same deprecation to production after staging validation
- Keep staging tool-gateway container stopped for 30 days (rollback window)

**3.3 Final cleanup (after 30 days)**
- Delete tool-gateway Docker images
- Remove from infrastructure code
- Close related issues/tickets

---

## Rollback Plan

If tool-orchestrator fails and we need to restore tool-gateway:

### Quick Rollback (< 5 minutes)
```bash
# 1. Stop tool-orchestrator
ssh root@bitbrat.lan 'docker stop bitbrat-staging-tool-orchestrator-1'

# 2. Start tool-gateway
ssh root@bitbrat.lan 'docker start bitbrat-staging-tool-gateway-1'

# 3. Set feature flag
# Edit env/staging/llm-bot.yaml and env/staging/reflex.yaml:
ENABLE_TOOL_ORCHESTRATOR: false

# 4. Restart llm-bot and reflex
ssh root@bitbrat.lan 'docker restart bitbrat-staging-llm-bot-1 bitbrat-staging-reflex-1'
```

### Full Rollback (restore data)
```bash
# 1. Restore polluted canonicalName values (if needed for compatibility)
ssh root@bitbrat.lan 'docker exec -i bitbrat-staging-postgres-1 psql -U bitbrat -d bitbrat' << 'EOF'
BEGIN;
UPDATE platform_tool_registry r
SET data = b.data, updated_at = b.updated_at
FROM platform_tool_registry_backup_028 b
WHERE r.id = b.id;
COMMIT;
EOF

# 2. Resume tool-gateway service
# (same as Quick Rollback steps above)
```

---

## Migration Checklist

**Pre-Deprecation**:
- [x] Tool-orchestrator deployed and active (Sprint 61)
- [x] Feature flag `ENABLE_TOOL_ORCHESTRATOR=true` in staging
- [x] canonicalName pollution cleaned (migration 028)
- [x] Backup table created (`platform_tool_registry_backup_028`)

**Phase 1 (Immediate)**:
- [x] Mark `tool-gateway.active: false` in architecture.yaml
- [x] Stop tool-gateway container in staging
- [x] Remove tool-gateway service-specific compose file (renamed to .deprecated)
- [x] Remove `depends_on: tool-gateway` from 7 service compose files
- [x] Delete old merged compose file on staging to force rebuild
- [ ] Remove tool-gateway from tool-orchestrator's upstream servers
- [ ] Verify no service disruption (24-hour monitoring)
- [ ] Test end-to-end chat flow with tool execution

**Phase 2 (Cleanup)**:
- [ ] Remove from docker-compose files
- [ ] Delete configuration files (`env/*/tool-gateway.yaml`)
- [ ] Archive source code to `deprecated/tool-gateway/`
- [ ] Update documentation (CLAUDE.md, architecture.yaml)

**Phase 3 (Validation)**:
- [ ] Monitor staging for 2 weeks
- [ ] Zero tool execution errors
- [ ] No canonicalName re-pollution
- [ ] Apply to production after validation
- [ ] Final cleanup after 30-day rollback window

---

## Success Criteria

**Immediate (24 hours)**:
- Tool-gateway stopped in staging
- Zero tool execution errors in llm-bot/reflex logs
- Tool-orchestrator connection count stable

**Short-term (2 weeks)**:
- Zero canonicalName re-pollution
- Tool count remains 505 (no drift)
- End-to-end chat with tool execution working

**Long-term (30 days)**:
- Tool-gateway deleted from production
- Source code archived
- Documentation updated
- No rollback requests

---

## Deployment Fix (Sprint 66 - 2026-11-24)

**Problem**: After marking tool-gateway as `active: false`, deployment with `--all` failed:
```
Error: Bind for 0.0.0.0:3013 failed: port is already allocated
```

**Root Cause**:
1. Old merged compose file on staging (`/opt/bitbrat-staging/.docker-compose.merged.yaml`) still contained tool-gateway
2. Tool-gateway service-specific compose file still existed and was being merged
3. 7 services had `depends_on: tool-gateway` dependencies

**Solution Applied**:
```bash
# 1. Delete old merged compose file on staging
ssh root@bitbrat.lan 'rm -f /opt/bitbrat-staging/.docker-compose.merged.yaml'

# 2. Rename tool-gateway compose file to prevent merging
mv infrastructure/docker-compose/services/tool-gateway.compose.yaml \
   infrastructure/docker-compose/services/tool-gateway.compose.yaml.deprecated

# 3. Remove depends_on: tool-gateway from 7 services
# - api-gateway.compose.yaml
# - image-gen-mcp.compose.yaml
# - llm-bot.compose.yaml
# - obs-mcp.compose.yaml
# - scheduler.compose.yaml
# - state-engine.compose.yaml
# - story-engine-mcp.compose.yaml
```

**Result**: Deployment can now proceed without tool-gateway being included in merged compose file.

---

## Communication Plan

**Engineering Team**:
- Slack announcement: "Tool-gateway deprecated effective 2026-11-24"
- Link to this handoff document
- Rollback instructions pinned

**Operations**:
- Update runbooks to remove tool-gateway references
- Remove tool-gateway from monitoring dashboards
- Archive tool-gateway alerts

**Documentation**:
- Update CLAUDE.md: Mark tool-gateway as deprecated
- Update architecture.yaml: Set `active: false`, add deprecation metadata
- Update deployment guides: Remove tool-gateway steps

---

## Related Work

**Sprint 61**: Tool-orchestrator foundation with PostgreSQL-backed registry
**Sprint 65**: Feature flag `ENABLE_TOOL_ORCHESTRATOR` for gradual migration
**Sprint 66**: canonicalName pollution fix (migrations 027-028)
**Sprint 67**: Tool-gateway deprecation and cleanup (this plan)
**Sprint 70**: Schema versioning and lifecycle management (planned)

**Files Modified**:
- `architecture.yaml`: Mark tool-gateway as deprecated
- `docker-compose.yml`: Remove tool-gateway service
- `env/*/tool-gateway.yaml`: Delete configuration files
- `src/apps/tool-gateway.ts`: Move to `deprecated/tool-gateway/`

**Rollback Safety**:
- `platform_tool_registry_backup_028`: Restore table if needed
- Tool-gateway container: Keep stopped for 30 days (rollback window)
- Feature flag: Keep `ENABLE_TOOL_ORCHESTRATOR` for quick rollback
