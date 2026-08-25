# Execution Plan: Claim Check Bit Implementation
## Sprint 24 (sprint-24-jxvb9x)

**Role**: Lead Implementor
**Owner**: claude
**Created**: 2026-08-23
**Status**: Planning

---

## Executive Summary

This execution plan breaks down the Claim Check Bit implementation into **4 phases** with **18 total tasks** across **3 priority levels**. The implementation follows a bottom-up approach: infrastructure first, then event claim check, then blob storage, and finally integration with existing services.

**Estimated Effort**: 16-20 hours total
- Phase 1 (Core Infrastructure): 4-5 hours
- Phase 2 (Event Claim Check): 4-5 hours
- Phase 3 (Blob Storage): 3-4 hours
- Phase 4 (Integration & Validation): 5-6 hours

**Critical Path**: Phase 1 → Phase 2 → Phase 4 (Phases 3 and parts of 4 can run in parallel)

**Success Criteria**:
- All 18 tasks completed
- 95%+ test coverage (unit + integration)
- Successful agent-dev deployment
- Tool-gateway can retrieve claimed events for progress messages
- Documentation complete

---

## Table of Contents

1. [Implementation Strategy](#1-implementation-strategy)
2. [Phase Breakdown](#2-phase-breakdown)
3. [Task Dependencies](#3-task-dependencies)
4. [Risk Assessment](#4-risk-assessment)
5. [Testing Strategy](#5-testing-strategy)
6. [Deployment Plan](#6-deployment-plan)
7. [Acceptance Criteria](#7-acceptance-criteria)

---

## 1. Implementation Strategy

### 1.1 Approach

**Bottom-Up Implementation**:
1. Build core ClaimCheckService logic (Redis operations, key management)
2. Create ClaimCheckBit wrapper (MCP tools, message subscriptions)
3. Add Base Bit helper methods
4. Integration testing with real services
5. Agent-dev validation
6. Documentation

**Rationale**:
- Core logic can be unit tested in isolation
- MCP tools built on top of tested service
- Base Bit helpers built on top of tested MCP tools
- Integration tests validate end-to-end flow
- Agent-dev deployment validates real-world scenarios

### 1.2 Parallel Work Opportunities

**Can be done in parallel** (after Phase 1 complete):
- Phase 2 (Event Claim Check) + Phase 3 (Blob Storage) - independent features
- Unit tests + Integration tests - different developers
- Documentation + Implementation - technical writer + developer

**Sequential dependencies**:
- Phase 1 must complete before Phase 2 or 3
- Phase 4 requires Phase 2 complete (agent-dev validation needs event claim check working)
- Base Bit helpers require MCP tools working

### 1.3 Validation Gates

**Gate 1** (After Phase 1): Core service unit tests passing
- ClaimCheckService methods work correctly
- Redis integration validated
- Error handling confirmed

**Gate 2** (After Phase 2): Event claim check working
- Subscribes to persistence snapshots
- Stores events in Redis
- MCP tools retrieve events correctly

**Gate 3** (After Phase 3): Blob storage working
- Store/retrieve blobs via MCP
- Base Bit helpers functional
- Size limits enforced

**Gate 4** (After Phase 4): Production ready
- Agent-dev deployment successful
- Tool-gateway integration validated
- All tests passing
- Documentation complete

---

## 2. Phase Breakdown

### Phase 1: Core Infrastructure (P0 - Critical)

**Goal**: Implement Redis-backed ClaimCheckService with complete error handling

**Duration**: 4-5 hours

**Tasks**:
1. **T1.1**: Create ClaimCheckService class skeleton
   - File: `src/services/claim-check/claim-check-service.ts`
   - Constructor with config, Redis client, logger
   - Placeholder methods for all operations
   - Key generation methods (eventKey, blobDataKey, blobMetaKey)

2. **T1.2**: Implement event claim check operations
   - `storeEventClaim(correlationId, event, ttl)`
   - `retrieveEventClaim(correlationId)`
   - `eventClaimExists(correlationId)`
   - Size validation (max 1MB)
   - Error handling (Redis failures, JSON parse errors)

3. **T1.3**: Implement blob storage operations
   - `storeBlobClaim(data, options)` with UUID generation
   - `retrieveBlobClaim(blobId)`
   - `blobClaimExists(blobId)`
   - `deleteBlobClaim(blobId)`
   - Size validation (max 10MB)
   - Metadata management

4. **T1.4**: Implement TTL normalization
   - `normalizeTtl(ttl?)` method
   - Default: 300 seconds
   - Max: 3600 seconds
   - Configuration-driven defaults

5. **T1.5**: Unit tests for ClaimCheckService
   - File: `src/services/claim-check/claim-check-service.test.ts`
   - Mock Redis client with jest
   - Test all methods (store, retrieve, exists, delete)
   - Test size limits and validation
   - Test TTL normalization
   - Test error scenarios (Redis down, parse errors)
   - Target: 90%+ coverage

**Acceptance Criteria**:
- ✅ All ClaimCheckService methods implemented
- ✅ Unit tests passing (90%+ coverage)
- ✅ Redis operations atomic and correct
- ✅ Error handling comprehensive
- ✅ Size limits enforced
- ✅ TTL normalization working

**Risks**:
- Redis mock may not perfectly match real behavior (mitigation: integration tests in Phase 4)
- Buffer serialization edge cases (mitigation: test with various data types)

---

### Phase 2: Event Claim Check Integration (P0 - Critical)

**Goal**: Create ClaimCheckBit, subscribe to snapshots, expose event MCP tools

**Duration**: 4-5 hours

**Tasks**:
6. **T2.1**: Create ClaimCheckBit using brat bit create
   - Command: `npm run brat -- bit create claim-check --profile core --kind pipeline-service --exposure platform-only --port 3008 --register --active`
   - Generates: `src/apps/claim-check-service.ts`, test file, Dockerfile, docker-compose service
   - Automatically registers in architecture.yaml
   - Customize generated setup() method to initialize ClaimCheckService
   - Handle Redis unavailable gracefully (log warning, continue)

7. **T2.2**: Subscribe to persistence snapshots
   - Subscribe to `internal.persistence.snapshot.v1`
   - Filter for `kind: 'final'` snapshots only
   - Extract correlationId and event from snapshot
   - Call `claimService.storeEventClaim()`
   - Handle errors gracefully (log, continue)
   - Always ack message (no retries on store failures)

8. **T2.3**: Register event MCP tools
   - Tool: `claim.event.retrieve`
   - Tool: `claim.event.exists`
   - Zod schemas for input validation
   - Call ClaimCheckService methods
   - Format responses (JSON stringify events)
   - Error handling (not found, Redis errors)

9. **T2.4**: Unit tests for ClaimCheckBit
   - File: `src/apps/claim-check-service.test.ts`
   - Mock ClaimCheckService
   - Test snapshot filtering (only 'final' kind stored)
   - Test MCP tool registration
   - Test tool input validation
   - Test error scenarios

**Acceptance Criteria**:
- ✅ ClaimCheckBit subscribes to persistence snapshots
- ✅ Only 'final' snapshots stored
- ✅ MCP tools registered correctly
- ✅ Tool input validation working
- ✅ Error handling comprehensive
- ✅ Unit tests passing

**Risks**:
- Persistence snapshot format may change (mitigation: use TypeScript types)
- High snapshot volume may overwhelm Redis (mitigation: monitoring in Phase 4)

---

### Phase 3: Blob Storage & Base Bit Integration (P1 - High)

**Goal**: Add blob MCP tools and Base Bit helper methods

**Duration**: 3-4 hours

**Tasks**:
10. **T3.1**: Register blob MCP tools
    - Tool: `claim.blob.store`
    - Tool: `claim.blob.retrieve`
    - Tool: `claim.blob.exists`
    - Zod schemas (base64 data, contentType, ttl)
    - Base64 encoding/decoding
    - Call ClaimCheckService methods

11. **T3.2**: Add Base Bit helper methods
    - File: `src/common/base-server.ts`
    - Method: `getClaimedEvent(correlationId): Promise<InternalEventV2 | null>`
    - Method: `storeBlob(data, options): Promise<string | null>`
    - Method: `retrieveBlob(blobId): Promise<Buffer | null>`
    - Requires McpClientProfile (check and warn if missing)
    - Error handling (MCP call failures, parse errors)

12. **T3.3**: Unit tests for Base Bit helpers
    - File: `src/common/base-server.test.ts` (add to existing tests)
    - Mock MCP client
    - Test getClaimedEvent (success, not found, error)
    - Test storeBlob (success, error)
    - Test retrieveBlob (success, not found, error)
    - Test missing McpClientProfile warning

**Acceptance Criteria**:
- ✅ Blob MCP tools registered
- ✅ Base64 encoding/decoding working
- ✅ Base Bit helpers functional
- ✅ McpClientProfile check working
- ✅ Unit tests passing

**Risks**:
- Base64 encoding overhead for large blobs (mitigation: document size limits)
- MCP client integration complexity (mitigation: use existing patterns from tool-gateway)

---

### Phase 4: Integration, Validation & Documentation (P1 - High)

**Goal**: End-to-end testing, agent-dev deployment, documentation

**Duration**: 5-6 hours

**Tasks**:
13. **T4.1**: Create integration tests
    - File: `src/apps/__tests__/claim-check.integration.test.ts`
    - Test: Event claim check flow (publish snapshot → retrieve via MCP)
    - Test: Blob storage flow (store → retrieve via MCP)
    - Test: Base Bit helpers (call from test Bit)
    - Test: TTL expiration (verify cleanup)
    - Test: Failure scenarios (Redis down, expired claims)
    - Use real Redis (test containers or local instance)

14. **T4.2**: Enhance architecture.yaml configuration
    - Basic service definition already created by brat bit create in T2.1
    - Add topics.consumes (internal.persistence.snapshot.v1)
    - Add stage: persist
    - Add resources: [redis]
    - Configure claim-check-specific env vars (TTL settings, size limits)
    - Verify REDIS_URL configured

15. **T4.3**: Agent-dev deployment validation
    - Provision agent-dev context
    - Deploy claim-check Bit
    - Deploy full stack (ingress-egress, persistence, tool-gateway, etc.)
    - Send test message through system
    - Verify event appears in Redis (`redis-cli GET bitbrat:claim:event:*`)
    - Call claim.event.retrieve from tool-gateway
    - Verify event retrieval works
    - Monitor Redis memory usage
    - Test TTL expiration

16. **T4.4**: Tool-gateway integration validation
    - Update tool-gateway to use claimed events for progress messages
    - Test: Send message → llm-bot calls tool → tool-gateway retrieves source event
    - Verify progress message delivered to user
    - This validates the primary use case from Sprint 22

17. **T4.5**: Create user documentation
    - File: `documentation/guides/claim-check.md`
    - Overview of claim check pattern
    - MCP tools reference (all 5 tools)
    - Usage examples (tool-gateway, multi-modal)
    - Base Bit helper examples
    - Configuration reference
    - Troubleshooting guide

18. **T4.6**: Update CLAUDE.md
    - Add claim check section to Common Development Patterns
    - Document Base Bit helper methods
    - Add examples of getClaimedEvent, storeBlob, retrieveBlob
    - Link to documentation/guides/claim-check.md

**Acceptance Criteria**:
- ✅ Integration tests passing (all scenarios)
- ✅ Architecture.yaml updated and valid
- ✅ Agent-dev deployment successful
- ✅ Tool-gateway integration working
- ✅ Documentation complete
- ✅ CLAUDE.md updated

**Risks**:
- Agent-dev deployment may reveal unexpected issues (mitigation: comprehensive integration tests)
- Tool-gateway changes may require coordination (mitigation: minimize changes, use existing patterns)
- Documentation may lag implementation (mitigation: write docs alongside code)

---

## 3. Task Dependencies

### Dependency Graph

```
Phase 1: Core Infrastructure (Sequential)
T1.1 (Service Skeleton)
  └─▶ T1.2 (Event Operations)
  └─▶ T1.3 (Blob Operations)
  └─▶ T1.4 (TTL Normalization)
        └─▶ T1.5 (Unit Tests)

Phase 2: Event Claim Check (Sequential, depends on Phase 1)
T1.5 (Phase 1 Complete)
  └─▶ T2.1 (ClaimCheckBit Skeleton)
        └─▶ T2.2 (Snapshot Subscription)
        └─▶ T2.3 (Event MCP Tools)
              └─▶ T2.4 (Unit Tests)

Phase 3: Blob Storage (Parallel with Phase 2 after T1.5)
T1.5 (Phase 1 Complete)
  └─▶ T3.1 (Blob MCP Tools)
        └─▶ T3.2 (Base Bit Helpers)
              └─▶ T3.3 (Unit Tests)

Phase 4: Integration (Depends on Phase 2 & 3)
T2.4 (Event Claim Check Complete)
T3.3 (Blob Storage Complete)
  └─▶ T4.1 (Integration Tests)
  └─▶ T4.2 (Architecture.yaml)
        └─▶ T4.3 (Agent-Dev Deployment)
              └─▶ T4.4 (Tool-Gateway Integration)
  └─▶ T4.5 (User Documentation)
  └─▶ T4.6 (CLAUDE.md Update)
```

### Critical Path

**Longest dependency chain** (must be done sequentially):

```
T1.1 → T1.2 → T1.5 → T2.1 → T2.2 → T2.3 → T2.4 → T4.1 → T4.2 → T4.3 → T4.4
```

**Estimated Critical Path Duration**: 13-15 hours

**Parallelizable Work**:
- T1.3 + T1.4 can be done while T1.2 is being tested
- T3.1 → T3.2 → T3.3 can start after T1.5 (parallel to Phase 2)
- T4.5 + T4.6 can be done while T4.3 is running

---

## 4. Risk Assessment

### High-Risk Items

#### R1: Redis Connection Failures in Production
**Risk**: Redis unavailable causes claim check to fail
**Probability**: Low
**Impact**: Medium (features degrade but don't crash)
**Mitigation**:
- Fail-open pattern (log warning, return null)
- Comprehensive error handling
- Test Redis unavailable scenarios
- Monitor Redis health in production

#### R2: Memory Pressure from Large Events/Blobs
**Risk**: Large events/blobs consume too much Redis memory
**Probability**: Medium
**Impact**: High (Redis OOM, eviction, service degradation)
**Mitigation**:
- Enforce size limits (1MB events, 10MB blobs)
- Aggressive TTL (5-min default)
- allkeys-lru eviction policy (already configured)
- Monitor Redis memory usage in agent-dev
- Alert on >80% memory usage

#### R3: Snapshot Subscription Backpressure
**Risk**: High snapshot volume overwhelms claim-check service
**Probability**: Low
**Impact**: Medium (lag in claim availability)
**Mitigation**:
- Fast Redis operations (<10ms)
- No synchronous processing in subscriber
- Ack immediately after store (don't retry on failure)
- Monitor subscription lag in production

### Medium-Risk Items

#### R4: Base Bit Helper Integration Complexity
**Risk**: MCP client integration more complex than expected
**Probability**: Low
**Impact**: Low (delay Phase 3, but doesn't block Phase 2)
**Mitigation**:
- Follow existing McpClientProfile patterns (from tool-gateway)
- Comprehensive unit tests with mocked MCP client
- Integration tests validate real MCP calls

#### R5: Tool-Gateway Integration Requires Major Changes
**Risk**: Tool-gateway changes are more complex than anticipated
**Probability**: Low
**Impact**: Medium (delays Sprint 22 progress message feature)
**Mitigation**:
- Minimize tool-gateway changes (just add getClaimedEvent call)
- Keep backwards compatible (fail gracefully if event not found)
- Test thoroughly in agent-dev before production

### Low-Risk Items

#### R6: Performance Not Meeting <50ms Target
**Risk**: Store/retrieve operations slower than expected
**Probability**: Very Low
**Impact**: Low (still functional, just slower)
**Mitigation**:
- Redis is typically <10ms for GET/SET
- Benchmark in integration tests
- Profile slow operations if detected

---

## 5. Testing Strategy

### 5.1 Unit Test Coverage

**Target**: 90%+ line coverage

**Files**:
- `src/services/claim-check/claim-check-service.test.ts` (T1.5)
- `src/apps/claim-check-service.test.ts` (T2.4)
- `src/common/base-server.test.ts` (additions in T3.3)

**Scenarios**:
- ✅ Happy path (store → retrieve → success)
- ✅ Not found (retrieve non-existent key → null)
- ✅ Size limits (oversized data → error)
- ✅ TTL normalization (various TTL inputs)
- ✅ Redis errors (connection failures, timeouts)
- ✅ Parse errors (invalid JSON, corrupted data)
- ✅ MCP tool validation (invalid inputs rejected)

### 5.2 Integration Test Coverage

**File**: `src/apps/__tests__/claim-check.integration.test.ts` (T4.1)

**Scenarios**:
1. **Event claim check flow**
   - Publish persistence.snapshot.v1 (kind: final)
   - Wait for processing
   - Verify key exists in Redis
   - Call claim.event.retrieve MCP tool
   - Verify returned event matches original
   - Verify TTL set correctly

2. **Blob storage flow**
   - Call claim.blob.store with test data
   - Verify data and metadata keys in Redis
   - Call claim.blob.retrieve
   - Verify data integrity (base64 round-trip)
   - Verify metadata (contentType, size, timestamps)

3. **Base Bit helpers**
   - Create test Bit with McpClientProfile
   - Call getClaimedEvent(correlationId)
   - Call storeBlob(buffer, options)
   - Call retrieveBlob(blobId)
   - Verify all work correctly

4. **TTL expiration**
   - Store claim with short TTL (e.g., 2 seconds)
   - Verify key exists immediately
   - Wait for TTL + 1 second
   - Verify key expired (retrieve returns null)

5. **Failure scenarios**
   - Stop Redis container
   - Verify fail-open behavior (operations return null, no crashes)
   - Restart Redis
   - Verify recovery

### 5.3 Agent-Dev Validation

**Context**: `agent-dev-claim-check-validation` (T4.3)

**Test Plan**:
1. **Setup**
   - Provision agent-dev context
   - Deploy full stack with claim-check Bit
   - Verify all services healthy

2. **End-to-end event flow**
   - Send message via ingress-egress
   - Verify persistence snapshot published
   - Check Redis for event: `redis-cli GET bitbrat:claim:event:{id}`
   - Call claim.event.retrieve from tool-gateway MCP
   - Verify event retrieval successful

3. **Blob storage test**
   - Create test Bit that stores blob
   - Verify blob appears in Redis
   - Retrieve blob from different Bit
   - Verify data integrity

4. **Memory monitoring**
   - Check Redis memory: `redis-cli INFO memory`
   - Store 100 events and 10 blobs
   - Verify memory usage < 50MB
   - Wait for TTL expiration
   - Verify memory released

5. **Failure testing**
   - Stop Redis container
   - Send message through system
   - Verify claim-check logs warning but doesn't crash
   - Verify other services continue working
   - Restart Redis
   - Verify recovery

### 5.4 Tool-Gateway Integration Test

**Goal**: Validate Sprint 22 use case (T4.4)

**Test Plan**:
1. Deploy tool-gateway with getClaimedEvent integration
2. Send user message: "What is the status?"
3. LLM-bot decides to call agent.sendProgressUpdate
4. Tool-gateway retrieves source event from claim check
5. Tool-gateway publishes progress message to user
6. Verify user receives progress message
7. Verify message delivered to correct platform/channel

**Success Criteria**:
- ✅ Progress message sent successfully
- ✅ Message delivered to correct user
- ✅ Event metadata (ingress/egress) preserved
- ✅ No errors in logs

---

## 6. Deployment Plan

### 6.1 Development Environment

**Step 1**: Local development with npm run local
- Add claim-check to Docker Compose
- Configure REDIS_URL
- Test locally with full stack

**Step 2**: Unit tests in CI
- Run all unit tests on PR
- Enforce 90% coverage threshold
- Block merge if tests fail

### 6.2 Agent-Dev Environment

**Step 3**: Deploy to agent-dev-claim-check-validation
- Provision isolated agent-dev context
- Deploy claim-check + full stack
- Run integration tests
- Validate Redis memory usage
- Monitor for 24 hours (verify TTL cleanup)

**Step 4**: Tool-gateway integration test
- Update tool-gateway in agent-dev
- Test progress message flow
- Verify end-to-end functionality

### 6.3 Production Deployment

**Step 5**: Production deployment
- Deploy claim-check Bit to all environments
- Monitor Redis memory usage
- Monitor claim check logs
- Verify persistence snapshot consumption
- Verify MCP tool discovery

**Step 6**: Rollout validation
- Test event claim check working
- Test blob storage working
- Monitor error rates
- Monitor performance (latency, throughput)

### 6.4 Rollback Plan

**If claim-check fails**:
1. Mark claim-check as `active: false` in architecture.yaml
2. Redeploy stack
3. Services gracefully degrade (getClaimedEvent returns null)
4. Investigate logs and fix issues
5. Re-enable when resolved

**Impact of rollback**:
- No impact on core event flow (claim check is passive)
- Tool-gateway progress messages won't work (acceptable degradation)
- Multi-modal content won't be stored (feature not yet used)

---

## 7. Acceptance Criteria

### Phase 1 Complete

- [ ] ClaimCheckService class created with all methods
- [ ] Event operations (store, retrieve, exists) implemented
- [ ] Blob operations (store, retrieve, exists, delete) implemented
- [ ] TTL normalization working correctly
- [ ] Unit tests passing with 90%+ coverage
- [ ] Code reviewed and approved

### Phase 2 Complete

- [ ] ClaimCheckBit created and extends Bit
- [ ] Subscribes to internal.persistence.snapshot.v1
- [ ] Only 'final' snapshots stored in Redis
- [ ] Event MCP tools registered (retrieve, exists)
- [ ] Tool input validation working
- [ ] Unit tests passing
- [ ] Code reviewed and approved

### Phase 3 Complete

- [ ] Blob MCP tools registered (store, retrieve, exists)
- [ ] Base Bit helper methods added (getClaimedEvent, storeBlob, retrieveBlob)
- [ ] McpClientProfile check working
- [ ] Base64 encoding/decoding correct
- [ ] Unit tests passing
- [ ] Code reviewed and approved

### Phase 4 Complete

- [ ] Integration tests passing (all scenarios)
- [ ] Architecture.yaml updated correctly
- [ ] Agent-dev deployment successful
- [ ] Redis memory usage acceptable (<50% of 512MB)
- [ ] Tool-gateway integration validated
- [ ] Progress message flow working end-to-end
- [ ] User documentation complete
- [ ] CLAUDE.md updated
- [ ] All tests passing (unit + integration)
- [ ] Code reviewed and approved

### Sprint 24 Complete

- [ ] All 18 tasks completed
- [ ] All 4 phases validated
- [ ] Test coverage >90%
- [ ] Agent-dev validation successful
- [ ] Tool-gateway integration working
- [ ] Documentation complete
- [ ] Production deployment successful
- [ ] No critical bugs in production after 48 hours
- [ ] Sprint retrospective completed

---

## Appendix A: Task Checklist

### Phase 1: Core Infrastructure
- [ ] T1.1: Create ClaimCheckService skeleton
- [ ] T1.2: Implement event claim check operations
- [ ] T1.3: Implement blob storage operations
- [ ] T1.4: Implement TTL normalization
- [ ] T1.5: Unit tests for ClaimCheckService

### Phase 2: Event Claim Check
- [ ] T2.1: Create ClaimCheckBit skeleton
- [ ] T2.2: Subscribe to persistence snapshots
- [ ] T2.3: Register event MCP tools
- [ ] T2.4: Unit tests for ClaimCheckBit

### Phase 3: Blob Storage
- [ ] T3.1: Register blob MCP tools
- [ ] T3.2: Add Base Bit helper methods
- [ ] T3.3: Unit tests for Base Bit helpers

### Phase 4: Integration & Validation
- [ ] T4.1: Create integration tests
- [ ] T4.2: Update architecture.yaml
- [ ] T4.3: Agent-dev deployment validation
- [ ] T4.4: Tool-gateway integration validation
- [ ] T4.5: Create user documentation
- [ ] T4.6: Update CLAUDE.md

---

## Appendix B: Time Estimates by Task

| Task | Estimate | Notes |
|------|----------|-------|
| T1.1 | 45 min | Skeleton is straightforward |
| T1.2 | 60 min | Event operations + error handling |
| T1.3 | 60 min | Blob operations + metadata |
| T1.4 | 15 min | Simple validation logic |
| T1.5 | 90 min | Comprehensive unit tests |
| **Phase 1 Total** | **4.5 hrs** | |
| T2.1 | 30 min | Bit skeleton + Redis setup |
| T2.2 | 60 min | Snapshot subscription + filtering |
| T2.3 | 60 min | MCP tool registration |
| T2.4 | 90 min | Unit tests for Bit |
| **Phase 2 Total** | **4 hrs** | |
| T3.1 | 45 min | Blob MCP tools |
| T3.2 | 60 min | Base Bit helpers |
| T3.3 | 60 min | Unit tests |
| **Phase 3 Total** | **3 hrs** | |
| T4.1 | 120 min | Integration tests (comprehensive) |
| T4.2 | 30 min | Architecture.yaml update |
| T4.3 | 90 min | Agent-dev deployment + validation |
| T4.4 | 60 min | Tool-gateway integration |
| T4.5 | 60 min | User documentation |
| T4.6 | 30 min | CLAUDE.md update |
| **Phase 4 Total** | **6.5 hrs** | |
| **TOTAL** | **18 hrs** | Add buffer for unknowns → 20 hrs |

---

**End of Execution Plan**

Next: Create backlog.yaml with full task breakdown and dependencies.
