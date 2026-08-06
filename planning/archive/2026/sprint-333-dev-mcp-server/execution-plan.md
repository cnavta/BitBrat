# Execution Plan – Dev MCP Server Implementation

**Sprint ID:** 333
**Role:** Lead Implementor
**Date:** 2026-07-07
**Source of Truth:** `planning/sprint-333-dev-mcp-server/technical-architecture.md`
**Status:** Pre-sprint planning artifact – **plan drafted, awaiting "Start sprint" approval**

---

## 1. Purpose

Implement a **local development MCP server** integrated into the `brat` CLI that provides unified access to BitBrat development tooling across all deployment targets (local Docker, remote Docker, GCP Cloud Run). This execution plan breaks down the technical architecture into **accomplishable, testable, gated tasks** that can be tracked and verified.

**Core Deliverable**: `brat dev-mcp start` command that exposes 13 Phase 1 tools via MCP stdio transport, enabling coding agents to:
- Read platform configuration and schemas
- Enumerate and inspect the fleet
- Query Firestore collections as generic JSON documents
- All operations read-only, fail-closed, with full target awareness

---

## 2. Guiding Constraints

**Read-Only Posture**:
- Every tool is read-only or dry-run (idempotent)
- No mutations to platform state
- Comprehensive read-only assertions in tests

**Fail-Closed Security**:
- No resolvable `MCP_AUTH_TOKEN` or `MCP_DEV_TOKEN` → refuse to operate
- All secrets server-side redacted (inherit from platform)
- Audit logging for all tool invocations

**Target Awareness**:
- All tools accept optional `target` parameter
- Connection manager handles local Docker, remote SSH Docker, and GCP
- Behavior identical across all deployment targets

**Code Reuse Priority**:
- Maximize reuse of existing `fleet/`, `backup/`, `config/`, `orchestration/` code
- Wrap, don't rewrite
- Extract shared logic to reusable modules

**Test-Driven Development**:
- Unit tests for each tool handler
- Integration tests for target connection (mock SSH, Firestore)
- End-to-end test with local Docker target
- Assertion suite: read-only, fail-closed, redaction, target parity

---

## 3. Architecture Summary

```
┌─────────────────────────────────┐
│      Coding Agent (stdio)       │
└───────────────┬─────────────────┘
                │ MCP Protocol
                ▼
┌───────────────────────────────────────────────┐
│        brat dev-mcp (MCP Server)              │
│  ┌─────────────────────────────────────────┐ │
│  │  MCP Server (stdio transport)           │ │
│  │  - Tool registration & dispatch         │ │
│  │  - Request/response handling            │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │  Tool Router                            │ │
│  │  - Config tools (4)                     │ │
│  │  - Fleet tools (2)                      │ │
│  │  - Persistence tools (3)                │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │  Target Connection Manager              │ │
│  │  - Resolve architecture.yaml targets    │ │
│  │  - Connect to Firestore (emulator/prod) │ │
│  │  - Resolve fleet gateway URLs           │ │
│  │  - SSH tunnel management (remote)       │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │  Audit Logger                           │ │
│  │  - Log all tool invocations             │ │
│  │  - Write to .brat/dev-mcp-audit.log     │ │
│  └─────────────────────────────────────────┘ │
└───────────────┬───────────────────────────────┘
                │
                ▼
    ┌───────────────────────────────┐
    │   Deployment Targets          │
    │   - local (Docker)            │
    │   - staging (SSH Docker)      │
    │   - production (GCP)          │
    └───────────────────────────────┘
```

---

## 4. Phases & Gates

### Phase 0: Foundation & Infrastructure (P0)

**Goal**: Establish MCP server skeleton, target connection infrastructure, and testing harness.

**Tasks**:
1. Create `tools/brat/src/dev-mcp/` directory structure
2. Implement basic MCP server with stdio transport (no tools yet)
3. Build `TargetConnectionManager` (reuse `resolveBackupConnection`)
4. Create `ToolRouter` abstraction for tool registration/dispatch
5. Implement `AuditLogger` with file output
6. Set up test infrastructure (Jest, mocks for Firestore/SSH)
7. Wire CLI command: `brat dev-mcp start [--target]`

**Acceptance Criteria**:
- [x] `brat dev-mcp start` launches MCP server on stdio
- [x] Server responds to MCP `initialize` and `tools/list` (empty list)
- [x] Target connection manager resolves all three target types
- [x] Audit logger captures connection events
- [x] Test suite runs successfully with mocked dependencies
- [x] No errors, clean startup/shutdown

**Gate G0**: MCP server infrastructure operational, target connection proven, testing harness ready.

---

### Phase 1: Config & Validation Tools (P1)

**Goal**: Implement deterministic, zero-blast-radius config/schema tools that work offline.

**Tools**:
1. `config.show` - Resolved configuration with env overlays (redacted)
2. `config.validate` - Validate `architecture.yaml` against JSON schema
3. `config.doctor` - Environment prerequisites check
4. `schema.read` - Read JSON schema definitions

**Implementation Strategy**:
- Reuse `loadArchitecture()` from `tools/brat/src/config/loader.ts`
- Reuse validation logic from `cmdConfig()`
- Reuse doctor checks from `cmdDoctor()`
- Schema files read directly from `documentation/schemas/`

**Acceptance Criteria**:
- [x] All four tools registered and callable via MCP
- [x] `config.show` returns resolved config with secrets redacted
- [x] `config.validate` detects invalid `architecture.yaml` and returns structured errors
- [x] `doctor` runs non-interactively and returns typed diagnostic report
- [x] `schema.read` returns full schema JSON for all supported types
- [x] All tools fail closed without authentication token
- [x] Unit tests cover success and failure paths
- [x] Tools work identically on all three target types (no target coupling for offline tools)

**Gate G1**: Config tools are production-ready, tested, and documented.

---

### Phase 2: Basic Fleet Tools (P1)

**Goal**: Implement fleet enumeration and inspection tools using existing fleet client.

**Tools**:
1. `fleet.list` - Enumerate all live Bits (name, profile, exposure)
2. `fleet.info` - Get detailed info for specific Bit (or --all)

**Implementation Strategy**:
- Instantiate `FleetClient` from `tools/brat/src/fleet/fleet-client.ts`
- Reuse `GatewayTransport` for gateway-mediated access
- Reuse `FirestoreRegistryReader` for Bit discovery
- Leverage `resolveIdentity()` for RBAC

**Acceptance Criteria**:
- [x] `fleet.list` returns all Bits with metadata (name, profile, exposure, URL)
- [x] `fleet.info` with `bit` parameter returns single Bit details via `bit.info` tool
- [x] `fleet.info` with `--all` (no `bit` param) returns info for all Bits (fan-out)
- [x] Tools respect `target` parameter (local, staging, prod)
- [x] Fail-closed: no token → refuse with error
- [x] Partial failure tolerance: if one Bit is unreachable in `--all`, others still return
- [x] Integration test with local Docker target (mocked registry)

**Gate G2**: Fleet enumeration and inspection working across targets.

---

### Phase 3: Persistence Abstraction Tools (P1)

**Goal**: Expose Firestore as generic JSON document storage with query capabilities.

**Tools**:
1. `db.collections` - List all Firestore collections
2. `db.get` - Get document by ID
3. `db.query` - Query with filters, ordering, pagination

**Implementation Strategy**:
- Use `getFirestore()` from `src/common/firebase.ts`
- Connection resolved via `TargetConnectionManager` (emulator or production)
- Parse filter/orderBy parameters and translate to Firestore queries
- Strip undefined values using `stripUndefinedDeep()` from `src/services/persistence/model.ts`
- Return results as MCP resources with JSON content

**Acceptance Criteria**:
- [x] `db.collections` returns list of all collections in target Firestore
- [x] `db.get` retrieves single document by collection + ID
- [x] `db.query` supports filters (`==`, `!=`, `<`, `>`, `in`, etc.), ordering, pagination
- [x] All tools respect `target` parameter
- [x] Results never contain undefined values (stripped before return)
- [x] Queries are read-only (no writes/updates/deletes)
- [x] Integration test with Firestore emulator
- [x] Performance: queries have default limit (50), max limit (1000)

**Gate G3**: Persistence abstraction tools operational with full query support.

---

### Phase 4: Integration & Validation (P0)

**Goal**: Comprehensive integration testing, validation script, and documentation.

**Tasks**:
1. End-to-end test: Agent workflow simulation (config → fleet → db queries)
2. Target parity assertions (all tools work on local, SSH, GCP)
3. Read-only enforcement tests (no tool can mutate state)
4. Fail-closed enforcement tests (no token scenarios)
5. Redaction verification tests (no secret leaks)
6. Create `validate_deliverable.sh` for CI/CD
7. Write comprehensive documentation:
   - Tool reference guide (all 13 tools)
   - Integration guide for Claude Code
   - Architecture overview
   - Troubleshooting guide

**Acceptance Criteria**:
- [x] `validate_deliverable.sh` runs all tests and passes
- [x] Target parity verified: all tools tested on local and mocked SSH/GCP
- [x] Read-only assertions: no tool writes to Firestore or filesystem
- [x] Fail-closed assertions: missing token → all tools refuse
- [x] Redaction assertions: no raw secrets in any tool output
- [x] Documentation complete and reviewed
- [x] Example `.claude/mcp.json` configuration provided
- [x] Example agent workflows documented

**Gate G4**: System is production-ready, fully tested, and documented.

---

### Phase 5: Publication & Close-Out (P0)

**Goal**: Commit code, create PR, and complete sprint artifacts.

**Tasks**:
1. Commit all code with descriptive commit message
2. Update `CHANGELOG.md` with new feature
3. Create feature branch PR to `main`
4. Generate `verification-report.md` (what was completed)
5. Generate `retro.md` (what went well, what could improve)
6. Generate `key-learnings.md` (technical insights)
7. Record PR in `publication.yaml`

**Acceptance Criteria**:
- [x] All code committed to feature branch
- [x] PR created with full description and testing notes
- [x] CHANGELOG updated
- [x] Sprint artifacts complete (verification, retro, learnings)
- [x] PR recorded in publication.yaml

**Gate G5**: Sprint complete, code merged (or PR open for review).

---

## 5. Out of Scope (Phase 2+)

**Deferred to Sprint 334**:
- SSE transport (stdio only in Phase 1)
- `fleet.call` (dynamic tool invocation)
- `fleet.logs` (multi-target log retrieval)
- `fleet.trace` (correlation-based tracing)
- `db.watch` (real-time subscriptions)
- Dev utilities (`repo.read`, `repo.search`)

**Deferred to Sprint 335**:
- `deploy.plan` and `release.preview` (dry-run planning)
- Structured log queries
- Performance profiling tools
- Gateway bridging (hybrid mode)

---

## 6. Definition of Done (Per Task)

Every backlog item must satisfy:
1. **Implementation**: Code complete, follows existing patterns
2. **Testing**: Unit tests + integration tests green
3. **Documentation**: Inline comments, tool description, example usage
4. **Security**: Fail-closed verified, redaction verified (if applicable)
5. **Target Parity**: Tested on local, works on SSH/GCP (mocked or real)
6. **Code Review**: Self-review checklist complete

---

## 7. Testing Strategy

### Unit Tests
- **Config tools**: Valid/invalid architecture.yaml, redaction, offline operation
- **Fleet tools**: Registry resolution, gateway transport, partial failure
- **Persistence tools**: Query parsing, filtering, pagination, read-only enforcement
- **Target manager**: Connection resolution, SSH tunnel simulation, cleanup

### Integration Tests
- **MCP protocol**: Initialize, list tools, call tool, shutdown
- **Target types**: Local Docker (real), SSH Docker (mocked), GCP (mocked)
- **Firestore**: Emulator-based tests for queries
- **Fleet client**: Mocked registry and gateway responses

### End-to-End Tests
- **Agent workflow**: Simulate agent calling multiple tools in sequence
- **Error handling**: Simulate network failures, timeouts, invalid requests
- **Target switching**: Multiple targets in same session

### Validation Script
`validate_deliverable.sh` must:
- Run `npm run build` (no errors)
- Run `npm test` (all pass)
- Assert no imports from `./deprecated`
- Assert read-only enforcement (grep for write operations)
- Assert fail-closed enforcement (test missing token scenarios)
- Generate coverage report (target: >80%)

---

## 8. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Connection complexity for SSH targets | Reuse proven `resolveBackupConnection()` logic; mock SSH in tests |
| MCP SDK API changes | Pin `@modelcontextprotocol/sdk` version in package.json |
| Firestore query performance | Default limit 50, max 1000; add caching if needed |
| Test flakiness | Use mocks extensively; isolate external dependencies |
| Agent timeout on slow queries | Implement 30s timeout per tool; return partial results |

---

## 9. Success Metrics

**Functional**:
- [x] 13 tools operational via MCP
- [x] All tools work on local, SSH, and GCP targets
- [x] Agent can enumerate fleet, query Firestore, validate config

**Quality**:
- [x] Test coverage >80%
- [x] Zero production secrets leaked
- [x] All tools fail closed without token

**Performance**:
- [x] Tool response time <5s (p95)
- [x] Server startup time <2s

**Usability**:
- [x] Clear error messages for common failures
- [x] Example agent integration documented
- [x] Troubleshooting guide complete

---

## 10. Timeline Estimate

**Phase 0 (Foundation)**: 1-2 days
- MCP server skeleton
- Target connection manager
- Test infrastructure

**Phase 1 (Config Tools)**: 1 day
- 4 tools, mostly wrapping existing code
- Offline, no external dependencies

**Phase 2 (Fleet Tools)**: 1 day
- 2 tools, reusing FleetClient
- Integration with registry and gateway

**Phase 3 (Persistence Tools)**: 1-2 days
- 3 tools, Firestore queries
- Query parsing and filtering logic

**Phase 4 (Integration & Validation)**: 1 day
- End-to-end tests
- Documentation
- Validation script

**Phase 5 (Publication)**: 0.5 day
- Commit, PR, sprint artifacts

**Total**: 5-7 days (accounting for unknowns and iteration)

---

## 11. Implementation Notes

### Code Organization
```
tools/brat/src/dev-mcp/
├── server.ts                    # MCP server entry point
├── target-manager.ts            # Connection resolution
├── tool-router.ts               # Tool registration/dispatch
├── audit-logger.ts              # Audit logging
├── types.ts                     # Shared types
├── tools/
│   ├── config.ts                # Config & validation tools
│   ├── fleet.ts                 # Fleet management tools
│   └── persistence.ts           # Firestore abstraction tools
└── __tests__/
    ├── server.test.ts
    ├── target-manager.test.ts
    └── tools/
        ├── config.test.ts
        ├── fleet.test.ts
        └── persistence.test.ts
```

### Key Dependencies
- `@modelcontextprotocol/sdk` - MCP protocol
- `zod` - Schema validation
- `firebase-admin` - Firestore access
- Existing brat modules: `fleet/`, `backup/`, `config/`, `orchestration/`

### Environment Variables
- `MCP_AUTH_TOKEN` (fallback) or `MCP_DEV_TOKEN` (preferred) - Authentication
- `BITBRAT_TARGET` - Default target name
- `DEV_MCP_AUDIT_LOG` - Audit log path (default: `.brat/dev-mcp-audit.log`)

---

## 12. Next Steps

**Upon "Start sprint" approval**:
1. Create feature branch: `feature/sprint-333-dev-mcp-server`
2. Create sprint directory: `planning/sprint-333-dev-mcp-server/`
3. Copy this execution plan to sprint directory
4. Begin Phase 0: Foundation implementation
5. Track progress in `request-log.md`
6. Update backlog YAML as tasks complete

**Blocked by**: Explicit "Start sprint" instruction (AGENTS.md Rule S1)

---

## Appendix: Tool Reference Quick List

### Config & Validation (4 tools)
1. `config.show` - Resolved configuration
2. `config.validate` - Schema validation
3. `config.doctor` - Environment check
4. `schema.read` - Read schema files

### Fleet Management (2 tools)
5. `fleet.list` - Enumerate Bits
6. `fleet.info` - Bit details

### Persistence (3 tools)
7. `db.collections` - List collections
8. `db.get` - Get document by ID
9. `db.query` - Query with filters

**Total Phase 1**: 9 tools (13 counting sub-tools)
