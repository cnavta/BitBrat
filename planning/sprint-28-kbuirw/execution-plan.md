# MCP SDK 2.0 Migration - Execution Plan

**Sprint ID**: sprint-28-kbuirw
**Date**: 2026-08-29
**Role**: Lead Implementor
**Status**: Ready for Execution

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Phase Breakdown](#phase-breakdown)
4. [Task Dependencies](#task-dependencies)
5. [Critical Path](#critical-path)
6. [Validation Gates](#validation-gates)
7. [Rollback Triggers](#rollback-triggers)
8. [Communication Plan](#communication-plan)

---

## Overview

### Objective
Migrate BitBrat platform from MCP SDK 1.x (v1.29.0) to TypeScript MCP SDK 2.0, resolving Sprint-27's StreamableHTTP transport issues through the new stateless architecture.

### Success Criteria
- [ ] All 30 SDK import files updated and compiling
- [ ] All 23 Bit services using v2.0 patterns
- [ ] All tests passing (unit + integration)
- [ ] Agent-dev validation: 100% pass rate
- [ ] Staging smoke tests: 100% pass rate
- [ ] Production deployment: 0 errors in first 24h

### Estimated Duration
5-8 days (1 sprint)

### Team
- Lead Implementor: Claude Code
- Reviewer: christophernavta
- QA: Automated tests + agent-dev validation

---

## Prerequisites

### Environment Requirements

**Development Machine**:
- [ ] Node.js 22.19.0+ installed (`node --version`)
- [ ] Git worktree operational (`.worktrees/sprint-28-kbuirw/`)
- [ ] Docker running (`docker ps`)
- [ ] Access to npm registry

**Build Environment**:
- [ ] TypeScript 5.9.3+ installed
- [ ] Jest test framework configured
- [ ] ESLint running without errors

**Deployment Access**:
- [ ] Agent-dev MCP tools available
- [ ] Staging context accessible
- [ ] Production deployment permissions (for final phase)

### Knowledge Prerequisites

**Required Reading** (30 minutes):
- [x] `planning/sprint-28-kbuirw/technical-architecture.md` (this sprint)
- [ ] `planning/sprint-27-6tp11t/INVESTIGATION-FINDINGS.md` (Sprint 27 context)
- [ ] MCP SDK 2.0 blog post: https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/

**Reference Documentation**:
- MCP SDK 2.0 TypeScript docs (when implementing)
- BitBrat CLAUDE.md (patterns and conventions)
- `src/common/base-server.ts` (current implementation)

---

## Phase Breakdown

### Phase 1: Preparation & Setup (Day 1 - 4 hours)

**Goal**: Update dependencies and environment to support MCP SDK 2.0

#### Tasks
1. **Update Node.js in Docker images** (30 min)
   - File: `Dockerfile.service`
   - Change: `FROM node:20-alpine` → `FROM node:22-alpine`
   - Validation: Build test image, verify version

2. **Install MCP SDK 2.0 packages** (45 min)
   - Remove: `@modelcontextprotocol/sdk@1.29.0`
   - Install: `@modelcontextprotocol/server@^2.0.0`
   - Install: `@modelcontextprotocol/client@alpha` (or wait for 2.0 stable)
   - Install: `@modelcontextprotocol/express@^2.0.0`
   - Install: `@modelcontextprotocol/node@^2.0.0`
   - Update: `zod@^4.2.0`
   - Validation: `npm install` succeeds, no peer dependency warnings

3. **Run official codemod** (30 min)
   - Command: `npx @modelcontextprotocol/codemod@beta v1-to-v2`
   - Review: Scan output for errors or warnings
   - Commit: Save codemod changes separately for review

4. **Update package.json metadata** (15 min)
   - Add: `"engines": { "node": ">=22.19.0" }`
   - Update: Version constraints for new packages
   - Validation: `npm run build` attempt (expect errors, that's OK)

5. **Document baseline metrics** (30 min)
   - Record: Current build time
   - Record: Current test suite time
   - Record: Docker image size
   - Record: Service startup time (from agent-dev)
   - Purpose: Compare post-migration for performance validation

6. **Create validation scripts** (60 min)
   - File: `planning/sprint-28-kbuirw/validate-mcp-v2.sh`
   - Content: Automated agent-dev validation (from architecture doc)
   - File: `planning/sprint-28-kbuirw/rollback.sh`
   - Content: Automated rollback procedure
   - Validation: Dry-run both scripts

**Validation Gate**:
- [ ] Build fails with clear SDK import errors (expected)
- [ ] All new packages installed successfully
- [ ] Validation scripts executable and dry-run clean

---

### Phase 2: Server-Side Migration (Days 2-3 - 12 hours)

**Goal**: Refactor base-server.ts and all Bit services to use MCP SDK 2.0 server patterns

#### Part A: Core Abstraction (base-server.ts) - 6 hours

**Task 2.1: Update imports** (30 min)
- File: `src/common/base-server.ts:1-100`
- Changes:
  ```typescript
  // OLD
  import { Server } from '@modelcontextprotocol/sdk/server/index.js';
  import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
  import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
  import { CallToolResult, ... } from '@modelcontextprotocol/sdk/types.js';

  // NEW
  import { McpServer } from '@modelcontextprotocol/server';
  import { createMcpHandler, requireBearerAuth } from '@modelcontextprotocol/server';
  import { toNodeHandler } from '@modelcontextprotocol/node';
  import type { CallToolResult, ... } from '@modelcontextprotocol/core';
  ```
- Validation: TypeScript compilation (expect errors in usage)

**Task 2.2: Remove session management code** (90 min)
- File: `src/common/base-server.ts`
- Remove:
  - `getMcpServerForConnection()` method (lines 1754-1785)
  - `streamableHttpTransport` property
  - SSE transport map management
  - Session ID tracking
- Lines removed: ~150 lines
- Validation: Code compiles (may have broken references)

**Task 2.3: Implement stateless server factory** (120 min)
- File: `src/common/base-server.ts`
- Location: Replace `initializeMcp()` method
- New pattern:
  ```typescript
  private getMcpServer(): McpServer {
    const server = new McpServer(
      { name: this.serviceName, version: this.version },
      { capabilities: { tools: {}, resources: {}, prompts: {} } }
    );

    // Re-register all tools from registeredTools Map
    for (const [name, { description, schema, handler, scopes }] of this.registeredTools) {
      server.tool(name, schema, async (args, ctx) => {
        return await this.wrapToolHandler(name, handler, args, ctx);
      }, { description, scopes });
    }

    // Re-register resources and prompts similarly...

    return server;
  }
  ```
- Key: Create fresh server instance per request (stateless)
- Validation: Method compiles, returns McpServer

**Task 2.4: Update MCP endpoint** (90 min)
- File: `src/common/base-server.ts:2123-2177`
- Replace:
  ```typescript
  protected initializeMcp() {
    let handler = createMcpHandler(() => this.getMcpServer());

    // Optional: Bearer auth
    if (process.env.MCP_AUTH_TOKEN) {
      handler = requireBearerAuth(handler, {
        secret: process.env.MCP_AUTH_TOKEN
      });
    }

    const node = toNodeHandler(handler);
    this.onHTTPRequest("/mcp", (req: Request, res: Response) => {
      void node(req, res, req.body);
    });
  }
  ```
- Remove: Custom auth middleware (lines 2100-2121)
- Validation: Endpoint compiles, no TypeScript errors

**Task 2.5: Update context extraction** (120 min)
- File: `src/common/base-server.ts` (registerTool method area)
- Create wrapper method:
  ```typescript
  private async wrapToolHandler<T>(
    name: string,
    handler: (args: T, extra?: any) => Promise<CallToolResult>,
    args: T,
    ctx: McpContext
  ): Promise<CallToolResult> {
    // Extract userId and userRoles from new _meta structure
    const userId = ctx.mcpReq._meta?.['io.modelcontextprotocol/userId']
      || ctx.http?.authInfo?.userId;
    const userRoles = ctx.mcpReq._meta?.['io.modelcontextprotocol/userRoles']
      || [];

    // Build extra object for backward compatibility
    const extra = { userId, userRoles, sessionId: ctx.sessionId };

    // Trace and invoke
    return await this.traceMcpOperation(`tool:${name}`, () =>
      handler(args, extra)
    );
  }
  ```
- Purpose: Bridge new `ctx` to existing `extra` pattern (minimize service changes)
- Validation: Context extraction tested with mock tool

**Task 2.6: Update registerTool method** (60 min)
- File: `src/common/base-server.ts:1790-1813`
- Modify:
  ```typescript
  public registerTool<T extends z.ZodType>(
    name: string,
    description: string,
    schema: T,
    handler: (args: z.infer<T>, extra?: any) => Promise<CallToolResult>,
    options?: { scopes?: string[] }
  ) {
    // Validate schema is z.object() (v2.0 requirement)
    if (!(schema instanceof z.ZodObject)) {
      throw new Error(
        `Tool '${name}': MCP SDK 2.0 requires schema to be z.object(). ` +
        `Wrap primitive types: z.object({ value: ${schema.constructor.name} })`
      );
    }

    // Store in Map (will be registered in getMcpServer())
    this.registeredTools.set(name, { description, schema, handler, scopes: options?.scopes });
    this.getLogger().info("mcp_server.tool_registered", { name });
  }
  ```
- Validation: Throws clear error if non-object schema passed

#### Part B: Schema Audit & Fixes (4 hours)

**Task 2.7: Audit all tool schemas** (60 min)
- Command:
  ```bash
  grep -rn "registerTool.*z\\.string\\|z\\.number\\|z\\.boolean\\|z\\.array" src/ \
    > planning/sprint-28-kbuirw/schema-audit.txt
  ```
- Review: `schema-audit.txt` for primitive schemas
- Document: List of tools requiring schema wrapping

**Task 2.8: Fix primitive schemas** (180 min)
- Scope: ~5-10 tools estimated (most already use z.object())
- Pattern:
  ```typescript
  // BEFORE
  registerTool('increment', '...', z.string(), handler);

  // AFTER
  registerTool('increment', '...', z.object({ name: z.string() }), (args) => {
    const name = args.name;  // Update handler to destructure
    // ... rest of handler
  });
  ```
- Files: Various `src/apps/*.ts` (as identified in audit)
- Validation: Each fix compiles, test passes

#### Part C: Resource & Prompt Updates (2 hours)

**Task 2.9: Update registerResource** (60 min)
- File: `src/common/base-server.ts:1818-1839`
- Similar pattern to registerTool: store in Map, register in getMcpServer()
- Validation: Resources compile

**Task 2.10: Update registerPrompt** (60 min)
- File: `src/common/base-server.ts:1915-1942`
- Similar pattern: store in Map, register in getMcpServer()
- Validation: Prompts compile

**Validation Gate**:
- [ ] `npm run build` succeeds (clean compilation)
- [ ] No TypeScript errors in src/common/ or src/apps/
- [ ] All 23 Bit services compile
- [ ] registerTool throws error on primitive schemas (test manually)

---

### Phase 3: Client-Side Migration (Day 4 - 6 hours)

**Goal**: Update MCP client management to use v2.0 client patterns

#### Task 3.1: Update client-manager.ts imports (30 min)
- File: `src/common/mcp/client-manager.ts:1-50`
- Changes:
  ```typescript
  // OLD
  import { Client } from '@modelcontextprotocol/sdk/client/index.js';
  import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
  import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

  // NEW
  import { McpClient } from '@modelcontextprotocol/client';
  import { createHttpTransport } from '@modelcontextprotocol/client/transports/http';
  import { createStdioTransport } from '@modelcontextprotocol/client/transports/stdio';
  ```
- Validation: Imports resolve

#### Task 3.2: Refactor transport creation (120 min)
- File: `src/common/mcp/client-manager.ts:236-261`
- Replace SSE transport:
  ```typescript
  // OLD
  transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: resolved.env }
  });

  // NEW
  const transport = createHttpTransport({
    url: new URL(config.url),
    headers: {
      Authorization: `Bearer ${resolved.env.MCP_AUTH_TOKEN}`,
      ...Object.fromEntries(
        Object.entries(resolved.env)
          .filter(([k]) => k !== 'MCP_AUTH_TOKEN')
      )
    }
  });
  ```
- Replace stdio transport:
  ```typescript
  // OLD
  transport = new StdioClientTransport({
    command: config.command,
    args: resolved.args || [],
    env: { ...process.env, ...resolved.env }
  });

  // NEW
  const transport = createStdioTransport({
    command: config.command,
    args: resolved.args || [],
    env: { ...process.env, ...resolved.env }
  });
  ```
- Validation: Transports compile

#### Task 3.3: Update client instantiation (90 min)
- File: `src/common/mcp/client-manager.ts:263-270`
- Replace:
  ```typescript
  // OLD
  const client = new Client(
    { name: 'bitbrat-llm-bot', version: '1.0.0' },
    { capabilities: {} }
  );
  await client.connect(transport);

  // NEW
  const client = new McpClient(
    { name: 'bitbrat-llm-bot', version: '1.0.0' },
    { transport }
  );
  await client.connect();  // No transport arg
  ```
- Validation: Client compiles

#### Task 3.4: Update tool invocation API (60 min)
- File: `src/common/mcp/client-manager.ts` (various methods)
- Note: v2.0 maintains same API (`client.callTool()`, `client.readResource()`)
- Changes: Minimal (verify _meta propagation)
- Validation: Tool calls compile

#### Task 3.5: Update fleet transports (60 min)
- Files:
  - `tools/brat/src/fleet/transports/direct-transport.ts`
  - `tools/brat/src/fleet/transports/gateway-transport.ts`
- Pattern: Same as client-manager.ts changes
- Validation: Fleet commands compile

#### Task 3.6: Update dev-mcp server (60 min)
- File: `tools/brat/src/dev-mcp/server.ts`
- Pattern: Same as base-server.ts changes (stateless factory)
- Validation: Dev MCP server compiles

**Validation Gate**:
- [ ] `npm run build` succeeds (all client code compiles)
- [ ] No TypeScript errors in src/common/mcp/
- [ ] No TypeScript errors in tools/brat/src/fleet/
- [ ] Dev MCP server compiles

---

### Phase 4: Test Updates (Day 5 - 6 hours)

**Goal**: Update all test files to use v2.0 mocks and expectations

#### Task 4.1: Update test imports (60 min)
- Scope: 13 test files with MCP SDK imports
- Pattern:
  ```typescript
  // OLD
  jest.mock('@modelcontextprotocol/sdk/server/index.js');

  // NEW
  jest.mock('@modelcontextprotocol/server');
  ```
- Files: See grep output from Phase 1
- Validation: Each test file compiles

#### Task 4.2: Remove initialize handshake expectations (90 min)
- Files:
  - `tests/integration/mcp-notifications.spec.ts`
  - `tests/integration/mcp-discovery.test.ts`
- Remove: Expectations for `initialize` method calls
- Remove: Session ID assertions
- Add: Assertions for `_meta` envelope
- Validation: Tests compile (may fail runtime, that's Phase 5)

#### Task 4.3: Update mock structures (120 min)
- Scope: All test files with Server/Client mocks
- Changes:
  - `Server` → `McpServer`
  - `Client` → `McpClient`
  - Mock methods: `setRequestHandler` → `tool` / `resource` / `prompt`
- Example:
  ```typescript
  // OLD
  const mockServer = {
    setRequestHandler: jest.fn()
  };

  // NEW
  const mockServer = {
    tool: jest.fn(),
    resource: jest.fn(),
    prompt: jest.fn()
  };
  ```
- Validation: Mocks compile

#### Task 4.4: Update context assertions (90 min)
- Scope: Tests that assert on `extra` parameter
- Changes: Update to expect `ctx` structure
- Pattern:
  ```typescript
  // OLD
  expect(handler).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ userId: 'user-123' })
  );

  // NEW
  expect(handler).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      mcpReq: expect.objectContaining({
        _meta: expect.objectContaining({
          'io.modelcontextprotocol/userId': 'user-123'
        })
      })
    })
  );
  ```
- Validation: Assertions compile

#### Task 4.5: Run test suite (60 min)
- Command: `npm test`
- Expected: Some failures (integration tests need runtime validation)
- Goal: Identify specific test failures
- Document: Failures in `planning/sprint-28-kbuirw/test-failures.txt`

#### Task 4.6: Fix unit test failures (60 min)
- Scope: Unit tests only (fast, isolated)
- Strategy: Fix mocks, update assertions
- Goal: 100% unit tests passing
- Validation: `npm test -- --testPathPattern="(?<!integration)" ` passes

**Validation Gate**:
- [ ] All unit tests passing
- [ ] Integration tests compile (may fail runtime)
- [ ] No TypeScript errors in tests/
- [ ] Test coverage maintained (>80%)

---

### Phase 5: Agent-Dev Validation (Day 6 - 8 hours)

**Goal**: Deploy and validate full migration in isolated agent-dev environment

#### Task 5.1: Provision agent-dev context (15 min)
- Command: `agent_dev.provision({ name: "agent-dev-mcp-v2" })`
- Validation: Context created, PostgreSQL accessible
- Note: Uses local Docker, isolated from staging/prod

#### Task 5.2: Build and deploy all services (60 min)
- Command: `npm run build && bit deploy --all --context agent-dev-mcp-v2`
- Expected: 23 Bit services deploy
- Monitor: Build logs for errors
- Validation: All services report healthy

#### Task 5.3: Verify service startup (30 min)
- Command: `fleet.info({ context: "agent-dev-mcp-v2" })`
- Check: All services respond to `bit.info` tool
- Check: MCP endpoints accessible (`/mcp` returns 401 without auth)
- Validation: 23/23 services healthy

#### Task 5.4: Validate tool discovery (45 min)
- Test: Tool-gateway discovers tools from all services
- Command: Call `tools/list` via tool-gateway
- Expected: 150+ tools discovered (compare to baseline)
- Validation: Tool count matches or exceeds v1.x baseline

#### Task 5.5: Test tool invocation (90 min)
- Test 1: Simple tool (bit.info)
  - Call: `bit.info` via MCP client
  - Validate: Response structure matches v1.x
- Test 2: Tool with args (counter.increment)
  - Call: With arguments
  - Validate: Args parsed correctly
- Test 3: RBAC tool (requires scopes)
  - Call: With/without proper roles
  - Validate: 403 when unauthorized
- Test 4: Cross-service tool (llm → auth → utility chain)
  - Call: LLM tool that invokes auth check
  - Validate: Chaining works
- Test 5: Resource read
  - Call: Read MCP resource
  - Validate: Resource content returned

**Validation: All 5 tests pass**

#### Task 5.6: Test auth enforcement (30 min)
- Test: Call `/mcp` without Authorization header
- Expected: 401 Unauthorized
- Expected: `WWW-Authenticate: Bearer` header present
- Test: Call with invalid token
- Expected: 401 Unauthorized
- Test: Call with valid token
- Expected: 200 OK
- Validation: Auth properly enforced

#### Task 5.7: Run automated validation script (30 min)
- Script: `planning/sprint-28-kbuirw/validate-mcp-v2.sh`
- Execution: `bash validate-mcp-v2.sh`
- Monitors:
  1. Service health checks
  2. Tool discovery count
  3. Tool invocation success
  4. Auth enforcement
  5. Latency measurements (10 runs)
- Validation: Script exits 0 (all checks pass)

#### Task 5.8: Load testing (60 min)
- Tool: Apache Bench or k6
- Scenario: 100 concurrent tool calls over 60 seconds
- Command:
  ```bash
  ab -n 6000 -c 100 -p tool-call.json -T 'application/json' \
    -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
    http://tool-gateway:3000/mcp
  ```
- Metrics:
  - 99th percentile latency
  - Error rate
  - Throughput (req/s)
- Validation:
  - [ ] p99 latency < 200ms
  - [ ] Error rate < 0.1%
  - [ ] Throughput > 50 req/s

#### Task 5.9: Compare performance metrics (30 min)
- Compare to baseline (from Phase 1):
  - Service startup time
  - Tool invocation latency
  - Memory usage
  - Docker image size
- Expected: Improvements in latency and memory
- Document: Results in `planning/sprint-28-kbuirw/performance-comparison.md`

#### Task 5.10: Integration test fixes (120 min)
- Run: Integration tests against agent-dev
- Command: `npm test -- --testPathPattern="integration"`
- Fix: Any failures (likely _meta structure issues)
- Goal: 100% integration tests passing
- Validation: All integration tests green

#### Task 5.11: Clean up agent-dev (15 min)
- Command: `agent_dev.destroy({ name: "agent-dev-mcp-v2", confirm: true })`
- Purpose: Free resources
- Note: Can re-provision if needed

**Validation Gate**:
- [ ] All services deployed and healthy
- [ ] 150+ tools discovered
- [ ] All 5 manual tests passed
- [ ] Automated validation script passed
- [ ] Load test passed (p99 < 200ms, errors < 0.1%)
- [ ] All integration tests passing
- [ ] Performance equal or better than baseline

---

### Phase 6: Staging Deployment (Day 7 - 4 hours)

**Goal**: Deploy to staging environment and run comprehensive smoke tests

#### Task 6.1: Pre-deployment checklist (30 min)
- [ ] All agent-dev tests passed
- [ ] Code reviewed and approved
- [ ] Rollback script tested (dry-run)
- [ ] Staging context accessible
- [ ] Team notified of deployment window

#### Task 6.2: Deploy to staging (45 min)
- Command: `bit deploy --all --context staging`
- Monitor: Deployment logs in real-time
- Fallback: Rollback script ready (`planning/sprint-28-kbuirw/rollback.sh`)
- Validation: All services healthy in staging

#### Task 6.3: Smoke test: Service health (15 min)
- Check: `/healthz` on all services
- Check: `/readyz` on all services
- Command: `fleet.info({ context: "staging" })`
- Validation: 23/23 services respond

#### Task 6.4: Smoke test: Tool discovery (15 min)
- Call: `tools/list` via tool-gateway
- Compare: Tool count vs. agent-dev
- Validation: Same tool count (150+)

#### Task 6.5: Smoke test: Real chat session (45 min)
- Trigger: Real chat message via Discord/Slack
- Expected: Full routing slip execution
- Steps:
  1. Ingress (Discord → internal.ingress.v1)
  2. Auth enrichment (internal.contextualization.v1)
  3. LLM analysis (internal.analysis.v1)
  4. Tool invocation (10+ tool calls)
  5. Egress (internal.egress.v1 → Discord)
- Validation: End-to-end flow succeeds, response posted

#### Task 6.6: Smoke test: Error handling (30 min)
- Test 1: Invalid tool name
  - Expected: Clear error message
- Test 2: Invalid arguments
  - Expected: Zod validation error
- Test 3: Missing auth
  - Expected: 401 Unauthorized
- Test 4: RBAC violation
  - Expected: 403 Forbidden
- Validation: All error cases handled gracefully

#### Task 6.7: Monitor staging for 2 hours (120 min)
- Monitor: Logs for errors (`fleet.logs({ context: "staging" })`)
- Monitor: Error rates (expect 0%)
- Monitor: Latency (expect < 200ms p99)
- Monitor: Memory usage (expect stable)
- Action: If errors > 0.1%, investigate immediately
- Validation: 2h of stable operation, 0 errors

**Validation Gate**:
- [ ] Staging deployment successful
- [ ] All smoke tests passed
- [ ] Real chat session succeeded (end-to-end)
- [ ] Error handling verified
- [ ] 2h monitoring: 0 errors, stable latency

---

### Phase 7: Production Deployment (Day 8 - 4 hours + 24h monitoring)

**Goal**: Deploy to production with monitored rollout and 24h observation

#### Task 7.1: Pre-production checklist (30 min)
- [ ] Staging validated (2h+ stable operation)
- [ ] Rollback plan tested and ready
- [ ] Team on-call for 24h monitoring
- [ ] User notification drafted (if needed)
- [ ] Production deployment permissions verified

#### Task 7.2: Create deployment PR (60 min)
- Branch: `feature/sprint-28-kbuirw-mcp-sdk-2-0-migration`
- Title: "Sprint 28: Migrate to MCP SDK 2.0"
- Description:
  - Summary of changes
  - Link to technical-architecture.md
  - Link to test results
  - Link to staging validation
  - Breaking changes: None (internal SDK upgrade)
  - Rollback: Available via `planning/sprint-28-kbuirw/rollback.sh`
- Artifacts: Include all sprint planning docs
- Request: Review from christophernavta

#### Task 7.3: PR review and approval (60 min)
- Reviewer: christophernavta
- Focus:
  - Code quality
  - Test coverage
  - Performance metrics
  - Rollback plan
- Action: Address any feedback
- Outcome: PR approved

#### Task 7.4: Merge to main (15 min)
- Action: Merge PR to `main` branch
- Trigger: Automated deployment (if configured)
- OR Manual: `bit deploy --all --context production`
- Monitor: Deployment progress

#### Task 7.5: Post-deployment validation (30 min)
- Check: All services healthy (`fleet.info({ context: "production" })`)
- Check: Tool discovery (150+ tools)
- Test: Single tool call (bit.info)
- Validation: Production operational

#### Task 7.6: 24-hour monitoring (passive)
- Hour 1: Active monitoring (every 15 min)
- Hours 2-4: Check every hour
- Hours 5-24: Check every 4 hours
- Metrics:
  - Error rate (expect < 0.01%)
  - Latency (expect < 200ms p99)
  - Tool invocation success rate (expect > 99.9%)
  - Memory usage (expect stable)
- Alerts: Set up for errors, latency spikes, memory leaks
- Action: If any metric degrades, investigate + rollback if needed

#### Task 7.7: Document lessons learned (60 min)
- File: `planning/sprint-28-kbuirw/retrospective.md`
- Sections:
  - What went well
  - What went poorly
  - What we learned
  - What we'd do differently
- Capture: Performance improvements, unexpected issues, time estimates vs. actual

#### Task 7.8: Complete sprint (15 min)
- Update: `sprint-manifest.yaml` (status: complete)
- Artifacts:
  - Technical architecture ✓
  - Execution plan ✓
  - Backlog YAML ✓
  - Test report (create from validation results)
  - Performance comparison ✓
  - Retrospective (from Task 7.7)
- Command: `complete-sprint({ sprintId: "sprint-28-kbuirw", completionMode: "normal" })`

**Validation Gate**:
- [ ] PR merged to main
- [ ] Production deployment successful
- [ ] 24h monitoring: 0 critical issues
- [ ] Error rate < 0.01%
- [ ] Latency maintained or improved
- [ ] Sprint artifacts complete

---

## Task Dependencies

### Dependency Graph

```
Phase 1 (Preparation)
  ├─> Phase 2 (Server-Side)
  │     ├─> Phase 3 (Client-Side)
  │     └─> Phase 4 (Tests)
  │
  Phase 2 + Phase 3 + Phase 4
  ├─> Phase 5 (Agent-Dev)
  │     └─> Phase 6 (Staging)
  │           └─> Phase 7 (Production)
```

### Blocking Dependencies

**Cannot start Phase 2 until**:
- Phase 1 complete (all packages installed)
- Codemod run and reviewed

**Cannot start Phase 3 until**:
- Phase 2.1-2.4 complete (imports and core patterns updated)
- Can parallelize with Phase 2.7-2.10 (schema fixes)

**Cannot start Phase 4 until**:
- Phase 2 and 3 complete (code compiles)

**Cannot start Phase 5 until**:
- Phase 2, 3, 4 complete (all code and tests updated)
- `npm run build` succeeds
- Unit tests passing

**Cannot start Phase 6 until**:
- Phase 5 complete (agent-dev validation passed)

**Cannot start Phase 7 until**:
- Phase 6 complete (staging validated)
- PR approved

---

## Critical Path

**Longest path through dependencies** (determines minimum sprint duration):

1. Phase 1: Preparation (4h)
2. Phase 2: Server-Side (12h)
3. Phase 4: Tests (6h) - can partially overlap with Phase 3
4. Phase 5: Agent-Dev (8h)
5. Phase 6: Staging (4h)
6. Phase 7: Production (4h + 24h monitoring)

**Total critical path**: 38 hours of active work + 24h passive monitoring

**Calendar time**: 5-6 days (assuming 6-8h work per day)

### Optimization Opportunities

**Parallel work**:
- Phase 2.7-2.10 (schema audit) can run parallel to Phase 3.1-3.3 (client imports)
- Phase 4.1-4.3 (test imports) can start as soon as Phase 2.1 completes

**Potential time savings**: 2-3 hours if parallelized effectively

---

## Validation Gates

### Gate 1: Post-Preparation
**Location**: End of Phase 1
**Criteria**:
- [ ] All packages installed successfully
- [ ] Codemod run without errors
- [ ] Node.js 22.19+ verified in Docker
- [ ] Validation scripts created and tested

**Decision**: Proceed to Phase 2 or stop and fix issues

### Gate 2: Post-Server-Migration
**Location**: End of Phase 2
**Criteria**:
- [ ] `npm run build` succeeds (clean compilation)
- [ ] All 23 Bit services compile
- [ ] No TypeScript errors in src/
- [ ] All tool schemas validated (z.object() only)

**Decision**: Proceed to Phase 3 or revert changes and investigate

### Gate 3: Post-Client-Migration
**Location**: End of Phase 3
**Criteria**:
- [ ] All client code compiles
- [ ] No TypeScript errors in src/common/mcp/
- [ ] Fleet transports compile

**Decision**: Proceed to Phase 4 or fix client issues

### Gate 4: Post-Test-Updates
**Location**: End of Phase 4
**Criteria**:
- [ ] All unit tests passing (100%)
- [ ] Integration tests compile
- [ ] Test coverage maintained (>80%)

**Decision**: Proceed to Phase 5 or fix test failures

### Gate 5: Post-Agent-Dev
**Location**: End of Phase 5
**Criteria**:
- [ ] All services deployed and healthy
- [ ] 150+ tools discovered
- [ ] 5 manual tests passed
- [ ] Automated validation passed
- [ ] Load test passed (p99 < 200ms)
- [ ] All integration tests passing

**Decision**: Proceed to Phase 6 or investigate failures (may need to revisit Phase 2/3)

### Gate 6: Post-Staging
**Location**: End of Phase 6
**Criteria**:
- [ ] Staging deployment successful
- [ ] All smoke tests passed
- [ ] End-to-end chat session succeeded
- [ ] 2h monitoring: 0 errors

**Decision**: Proceed to Phase 7 or rollback staging and investigate

### Gate 7: Post-Production
**Location**: 24h after Phase 7 deployment
**Criteria**:
- [ ] Production deployment successful
- [ ] 24h monitoring: error rate < 0.01%
- [ ] Latency maintained or improved
- [ ] No rollback triggered

**Decision**: Sprint complete or rollback and investigate

---

## Rollback Triggers

### Automatic Rollback Conditions

**Agent-Dev (Phase 5)**:
- Any service fails to start after 3 attempts
- Tool discovery < 90% of baseline count
- Load test error rate > 1%
- Load test p99 latency > 500ms

**Staging (Phase 6)**:
- Error rate > 0.5% in first hour
- Critical service unavailable
- End-to-end chat session fails

**Production (Phase 7)**:
- Error rate > 0.1% in first hour
- Error rate > 0.01% after 24h
- Critical bug reported by user
- Data loss or corruption detected

### Manual Rollback Decision Points

**Consider rollback if**:
- Latency degrades > 50% from baseline
- Memory usage increases > 30% from baseline
- Unexpected behavior in core functionality
- User-facing errors (even if rate is low)

### Rollback Procedure

**Script**: `planning/sprint-28-kbuirw/rollback.sh`

**Steps**:
1. Revert PR merge (git revert)
2. Deploy previous version (`git checkout <previous-tag>`)
3. Verify services healthy
4. Monitor for stability
5. Post-mortem: Document what went wrong

**Time to rollback**: < 15 minutes (automated)

---

## Communication Plan

### Internal Communication

**Daily Standup** (during active development):
- Format: Written update
- Audience: christophernavta
- Content:
  - Yesterday's progress (phases completed)
  - Today's plan (current phase)
  - Blockers (if any)
  - Risks identified

**Phase Completions**:
- Notify when each validation gate passed
- Share metrics (latency, test coverage, etc.)

**Issues/Blockers**:
- Immediate notification if critical issue found
- Include: Description, impact, proposed resolution

### External Communication (if needed)

**User Notification** (only if user-facing impact):
- Timing: Before production deployment
- Content: "System upgrade in progress, brief service interruption possible"
- Channel: Discord/Slack announcement

**Post-Deployment**:
- Summary: "Migration to MCP SDK 2.0 complete, performance improved"
- Metrics: Latency improvements, new capabilities (MRTR)

---

## Risk Mitigation Strategies

### Technical Risks

**Risk**: Context extraction breaks RBAC
- **Mitigation**: Comprehensive unit tests for `wrapToolHandler()`
- **Fallback**: Fail-closed (deny access if context missing)

**Risk**: Performance regression
- **Mitigation**: Load testing in agent-dev before staging
- **Fallback**: Optimize server factory (caching, pooling)

**Risk**: Client compatibility issues
- **Mitigation**: Version detection in client-manager
- **Fallback**: Hybrid mode (v1 + v2 coexistence)

### Process Risks

**Risk**: Time estimate too optimistic
- **Mitigation**: 5-8 day range, daily progress tracking
- **Fallback**: Extend sprint if needed (up to 2 weeks)

**Risk**: Unforeseen breaking changes
- **Mitigation**: Codemod handles mechanical changes
- **Fallback**: Manual review of codemod output

**Risk**: Validation gaps
- **Mitigation**: Multi-stage validation (agent-dev → staging → prod)
- **Fallback**: 24h monitoring with rollback ready

---

## Success Metrics

### Functional Metrics

- [ ] Build success: `npm run build` exits 0
- [ ] Test success: `npm test` exits 0, coverage > 80%
- [ ] Tool discovery: 150+ tools (100% of baseline)
- [ ] Tool invocation: Success rate > 99.9%
- [ ] Auth enforcement: 401 on missing token, 403 on RBAC violation

### Performance Metrics

- [ ] Latency: p99 < 200ms (target: -20% from baseline)
- [ ] Throughput: > 50 req/s (target: +50% from baseline)
- [ ] Memory: Stable over 24h (target: -30% from baseline)
- [ ] Error rate: < 0.01% in production (target: 0%)

### Code Quality Metrics

- [ ] Lines removed: ~150 (session management)
- [ ] TypeScript errors: 0
- [ ] ESLint warnings: 0 new warnings
- [ ] Test coverage: > 80% (maintained or improved)

### Operational Metrics

- [ ] Deployment time: < 30 min (baseline: ~30 min)
- [ ] Rollback time: < 15 min (if needed)
- [ ] Downtime: 0 seconds (zero-downtime deployment)
- [ ] Monitoring alerts: 0 critical alerts in first 24h

---

**Document Version**: 1.0
**Last Updated**: 2026-08-29
**Status**: Ready for execution
