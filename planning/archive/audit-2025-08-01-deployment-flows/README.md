# Deployment Flows Audit: August 1, 2025

This directory contains a comprehensive audit of the `brat bit deploy` command's port assignment mechanisms across single-service and bulk deployment modes.

## Executive Summary

**CRITICAL FINDING:** PortManager is completely bypassed in bulk deployments (`brat bit deploy --all`), creating a port conflict risk that doesn't exist in single-service deployments.

### Key Numbers
- **1 critical gap** identified in orchestrator.ts (lines 71-78)
- **2 deployment paths** with different capabilities
- **3 proposed fix options** (see below)
- **4 test cases** needed for bulk port management
- **1402 lines** of detailed analysis

## Documents in This Audit

### 1. DEPLOYMENT_FLOWS_AUDIT.md (754 lines, 25KB)
**The comprehensive reference** - Use this for complete details and understanding.

**Contains:**
- Executive summary and findings
- Complete current state analysis (single-service flow with code references)
- Gap analysis with code flow diagrams
- Detailed port assignment algorithm explanation
- Integration points and design inconsistencies
- Proposed fix options (3 different approaches)
- Testing impact and recommendations
- Code references for all major sections

**Best for:**
- Understanding the full picture
- Explaining to team members
- Planning implementation
- Reference documentation

### 2. QUICK_REFERENCE.md (169 lines, 5.1KB)
**The executive brief** - Use this for quick understanding and decision-making.

**Contains:**
- Side-by-side comparison of single vs bulk
- Why the gap happens (simplified)
- Impact table showing consequences
- Current workarounds
- High-level fix explanation
- Files to modify
- Test cases needed
- References table

**Best for:**
- Quick understanding
- Presentation to stakeholders
- Decision making
- Communicating to team

### 3. CODE_LOCATIONS.md (479 lines, 14KB)
**The technical reference** - Use this for code navigation and exact locations.

**Contains:**
- Exact file paths and line numbers
- Complete code snippets for all key locations
- Detailed explanations inline with code
- The 3 main gap locations
- PortManager implementation details
- How port discovery works
- Service name to env var conversion
- Docker Compose port usage example
- Test file locations and gaps

**Best for:**
- Finding exact code locations
- Understanding implementation details
- Coding the fix
- Test development

## The Core Problem

### Single-Service Deployment (Works)
```
brat bit deploy llm-bot
  → PortManager.resolvePorts() ✅
  → docker ps query ✅
  → Port assigned automatically ✅
  → Env file includes {SERVICE}_HOST_PORT ✅
```

### Bulk Deployment (Broken)
```
brat bit deploy --all
  → PortManager.resolvePorts([]) ❌ (empty array!)
  → docker ps NOT queried ❌
  → No port assignments ❌
  → Env file has NO overrides ❌
  → Hardcoded ports from compose files used ❌
```

## Root Cause

When bulk deployments call DockerOrchestrator with a merged compose file, they don't pass service names. The orchestrator can't reconstruct which services are being deployed, so PortManager gets an empty array and generates no port assignments.

**Critical code (orchestrator.ts lines 71-78):**
```typescript
const composeFileSet = this.options.composeFile
  ? {
      baseFile: this.options.composeFile,
      serviceFiles: [],              // ← EMPTY for bulk!
      targetService: undefined,
    }
  : this.composeFactory.getComposeFiles(this.options.service, ...);
```

## Proposed Solutions

### Option 1: Simplest (Recommended)
Pass service names from DockerComposeStrategy to DockerOrchestrator

**Files to change:**
- `docker-compose-strategy.ts` (add `allServiceNames` to orchestratorOptions)
- `orchestrator.ts` (use `allServiceNames` if provided, reconstruct service files)

**Effort:** Low (< 50 lines)
**Risk:** Very low (backwards compatible)

### Option 2: Strategy-level Method
Create `resolveBulkPorts()` method in DockerComposeStrategy

**Files to change:**
- `docker-compose-strategy.ts` (new method + call before orchestrator.up())

**Effort:** Medium (100-150 lines)
**Risk:** Low (isolated to strategy)

### Option 3: Enhanced Orchestrator Options
Extend DockerOrchestratorOptions with port management metadata

**Files to change:**
- `orchestrator.ts` (new options + logic)
- `docker-compose-strategy.ts` (pass new options)

**Effort:** Medium (150-200 lines)
**Risk:** Medium (extends orchestrator interface)

## Impact

### Without Fix
- Multiple deployments to same host will conflict
- `--force-recreate` is a workaround, not a solution
- agent-dev contexts can't coexist with same port ranges
- Shared staging/development hosts will have issues
- No live port discovery in bulk mode

### With Fix
- Automatic, conflict-free port assignment like single-service
- Works seamlessly with multiple deployments
- agent-dev contexts can coexist
- Explicit port overrides work consistently
- Remote deployment port discovery enabled

## How to Use This Audit

### For Decision Makers
Read: **QUICK_REFERENCE.md** (5 min)

### For Team Planning
Read: **QUICK_REFERENCE.md** + **DEPLOYMENT_FLOWS_AUDIT.md sections 1-3** (30 min)

### For Developers Implementing the Fix
Read in order:
1. **QUICK_REFERENCE.md** (understand the problem)
2. **CODE_LOCATIONS.md** (find exact locations)
3. **DEPLOYMENT_FLOWS_AUDIT.md sections 4-6** (understand the algorithm and options)

### For Code Reviewers
Reference:
- **CODE_LOCATIONS.md** (verify changes are in right places)
- **DEPLOYMENT_FLOWS_AUDIT.md section 8** (test coverage expectations)

## Next Steps

### Immediate (This Sprint)
- [ ] Review audit findings with team
- [ ] Decide on fix approach (Option 1 recommended)
- [ ] Assign implementation task

### Implementation (Next Sprint)
- [ ] Implement chosen fix
- [ ] Add test cases from section 8.2
- [ ] Update documentation if needed

### Validation
- [ ] Unit tests pass
- [ ] Integration tests with multiple services
- [ ] Manual test: `brat bit deploy --all` with port conflicts
- [ ] Manual test: explicit port env vars in bulk mode
- [ ] Manual test: remote deployment with SSH port discovery

## Files Involved

### Deployment Command
- `tools/brat/src/oclif-commands/bit/deploy.ts` (routes to single vs bulk)

### Strategies
- `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts` (lines 595-1112)
- `tools/brat/src/orchestration/deployment/cloud-run-strategy.ts` (no changes needed)

### Orchestration
- `tools/brat/src/orchestration/docker/orchestrator.ts` (lines 71-78, 315-361)
- `tools/brat/src/orchestration/docker/port-manager.ts` (no changes needed, just needs input)

### Port Utilities
- `tools/brat/src/fleet/docker-ports.ts` (no changes needed)

## Questions?

Refer to specific sections:
- "Why does this happen?" → QUICK_REFERENCE.md, Why It Happens section
- "Where exactly is the gap?" → CODE_LOCATIONS.md, section 1
- "How does PortManager work?" → CODE_LOCATIONS.md, PortManager Implementation
- "What's the full flow?" → DEPLOYMENT_FLOWS_AUDIT.md, section 3 (diagrams)
- "What should I fix?" → CODE_LOCATIONS.md, sections 1-3 + QUICK_REFERENCE.md, The Fix

---

**Audit Date:** August 1, 2025
**Scope:** Complete deployment flow analysis
**Status:** Analysis complete, ready for implementation planning
**Recommendation:** Implement Option 1 (simplest, lowest risk)
