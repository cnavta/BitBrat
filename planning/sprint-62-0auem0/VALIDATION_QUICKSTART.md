# Sprint 62 Validation - Quick Start Guide

**Goal**: Validate tool-orchestrator MCP aggregation is working in staging

---

## 🚀 Quick Validation (5 minutes)

### Option 1: Automated Script

```bash
cd planning/sprint-62-0auem0
./validate-staging.sh http://tool-orchestrator:3000/mcp staging
```

This script will:
- ✓ Check service health
- ✓ Verify tool cache loaded
- ✓ Confirm MCP server initialized
- ✓ Check for schema errors
- ✓ Run integration tests (5 tests)

**Expected Output**:
```
✓ Service is running
✓ Tool loading log found
ℹ Tool count: XX
✓ Tool count > 20 (aggregation confirmed)
✓ No tool loading errors
✓ MCP server initialized with aggregation
✓ No INVALID_RESULT errors
✓ All integration tests passed (5/5)
✓ Validation script complete!
```

---

### Option 2: Manual Quick Check

```bash
# 1. Check service is running
npm run brat -- fleet health tool-orchestrator --context staging

# 2. Check logs for tool loading
npm run brat -- fleet logs tool-orchestrator --context staging | grep "tool_orchestrator.tools_loaded"
# Should show: { "count": XX, "sources": [...] }

# 3. Run integration tests
RUN_MCP_INTEGRATION_TESTS=true \
TEST_TOOL_ORCHESTRATOR_URL=http://tool-orchestrator:3000/mcp \
npm test tool-orchestrator-mcp-aggregation
# Should show: Tests: 5 passed, 5 total

# 4. Check for errors
npm run brat -- fleet logs tool-orchestrator --context staging | grep -i "INVALID_RESULT"
# Should return: (empty - no errors)
```

---

## 📋 Full Validation (30 minutes)

For comprehensive validation, follow the detailed checklist:

```bash
# Open the full validation checklist
cat planning/sprint-62-0auem0/VALIDATION_CHECKLIST.md
```

**9 Validation Steps**:
1. Service Health Check
2. Tool Cache Loading
3. MCP Server Initialization
4. Periodic Cache Refresh
5. Integration Test Execution
6. PostgreSQL Tool Count Validation
7. Schema Compliance Validation
8. Feature Flag Cutover Testing
9. End-to-End Functionality Test

---

## ✅ Success Criteria

### Minimum (Quick Validation)
- [ ] Service is running and healthy
- [ ] Tool count > 20 (aggregation working)
- [ ] Integration tests pass (5/5)
- [ ] No INVALID_RESULT errors in logs

### Complete (Full Validation)
- [ ] All quick validation checks pass
- [ ] PostgreSQL count matches MCP count
- [ ] Feature flag switches connections correctly
- [ ] Tools executable end-to-end through orchestrator

---

## 🔍 What to Look For

### Good Signs ✅
```
tool_orchestrator.tools_loaded: { count: 85, sources: ["mcp", "internal", "composition"] }
mcp_server.initialized_with_aggregation: { aggregatedTools: 85 }
Tests: 5 passed, 5 total
No INVALID_RESULT errors
```

### Warning Signs ⚠️
```
tool_orchestrator.tools_loaded: { count: 18 }  # Too low - only admin tools
tool_orchestrator.tools_load_failed  # Loading errors
INVALID_RESULT  # Schema validation failures
Tests: X failed  # Integration test failures
```

---

## 🐛 Troubleshooting

### Issue: Tool count <= 20
**Cause**: Aggregation not working, only admin tools loaded

**Check**:
```bash
# Verify ToolRegistry initialized
npm run brat -- fleet logs tool-orchestrator --context staging | grep "ToolRegistry"

# Check PostgreSQL connection
npm run brat -- fleet logs tool-orchestrator --context staging | grep "database"
```

**Fix**: Ensure ToolRegistry module is initialized in setup()

---

### Issue: INVALID_RESULT errors
**Cause**: Input schemas not cleaned properly

**Check**:
```bash
# Find which tools have schema issues
npm run brat -- fleet logs tool-orchestrator --context staging | grep -A5 "INVALID_RESULT"
```

**Fix**: Verify cleanInputSchema() is removing $schema, definitions, $defs

---

### Issue: Integration tests timeout
**Cause**: MCP endpoint not accessible

**Check**:
```bash
# Verify endpoint is accessible
curl -v http://tool-orchestrator:3000/mcp

# Check firewall/network
npm run brat -- fleet info tool-orchestrator --context staging | grep -i port
```

**Fix**: Ensure port 3000 is exposed and accessible from test machine

---

### Issue: Feature flag not switching connections
**Cause**: llm-bot not reading ENABLE_TOOL_ORCHESTRATOR env var

**Check**:
```bash
# Verify env var is set
npm run brat -- fleet config llm-bot --context staging | grep ENABLE_TOOL_ORCHESTRATOR

# Check llm-bot logs for tool provider selection
npm run brat -- fleet logs llm-bot --context staging | grep "tool_provider_selected"
```

**Fix**: Ensure env var set correctly and llm-bot restarted

---

## 📊 PostgreSQL Validation Queries

### Tool Count Comparison
```sql
-- Count all active tools
SELECT COUNT(*) as active_tool_count
FROM tool_registry.tools
WHERE status = 'active';

-- Expected: Should match MCP exposed count from integration tests
```

### Source Breakdown
```sql
-- Tools by source
SELECT source, COUNT(*) as count
FROM tool_registry.tools
WHERE status = 'active'
GROUP BY source
ORDER BY count DESC;

-- Expected sources: mcp, internal, composition
```

### Sample Tool Details
```sql
-- View some example tools
SELECT id, source, description
FROM tool_registry.tools
WHERE status = 'active'
LIMIT 10;

-- Verify these tools appear in MCP tool list
```

---

## 📝 Reporting Results

### Create Validation Report
```bash
# Save validation results
./validate-staging.sh > validation-results-$(date +%Y%m%d-%H%M%S).txt 2>&1

# Review and mark checklist items
vim VALIDATION_CHECKLIST.md
# Update ⏳ to ✅ for completed items
```

### Update Progress Documentation
```bash
# Update PROGRESS.md with validation results
vim PROGRESS.md
# Add validation completion date and results
```

---

## 🎯 Next Steps After Validation

### If All Checks Pass ✅
1. Mark validation tasks complete in backlog
2. Update PROGRESS.md status to "VALIDATED"
3. Optional: Implement Phase 2 (Session & RBAC)
4. Prepare for production deployment

### If Issues Found ⚠️
1. Document issues in VALIDATION_CHECKLIST.md
2. Create bug fix tasks
3. Re-run validation after fixes
4. Do not proceed to production

---

## 📞 Support

**Documentation**:
- Full Checklist: `VALIDATION_CHECKLIST.md`
- Implementation Summary: `IMPLEMENTATION_SUMMARY.md`
- Progress Report: `PROGRESS.md`

**Key Files**:
- Implementation: `src/apps/tool-orchestrator-service.ts`
- Integration Tests: `src/apps/__tests__/tool-orchestrator-mcp-aggregation.integration.test.ts`
- Validation Script: `validate-staging.sh`
