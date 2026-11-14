# Sprint 61 Key Learnings

**Sprint ID**: sprint-61-s03uws
**Date**: 2026-11-13
**Theme**: Composition RBAC + MCP Aggregation

---

## Critical Learnings

### 1. Base Class getMcpServer() is NOT for Aggregators

**Context**: Building tool-gateway as MCP aggregator service

**Problem**: Assumed base class `Bit.getMcpServer()` would automatically serve tools from `this.registry.getTools()` (aggregated tools from upstream services).

**Reality**: Base class only serves `this.registeredTools` (the service's own direct tools).

**Impact**: llm-bot connected to tool-gateway but only saw 18 direct tools instead of 100+ aggregated tools.

**Solution**: Override `getMcpServer()` in aggregator services to explicitly serve aggregated tools.

**Code Pattern**:
```typescript
protected getMcpServer(): McpServer {
  const logger = this.getLogger();

  // Get aggregated tools from registry (NOT this.registeredTools)
  const allTools = Object.values(this.registry.getTools());

  const server = new McpServer(
    { name: 'tool-gateway', version: '1.0.0' },
    { capabilities: { tools: allTools.length > 0 ? {} : undefined } }
  );

  // Register aggregated tools
  for (const tool of allTools) {
    server.registerTool(tool.id, {
      description: tool.description,
      inputSchema: tool.inputSchema,
    }, async (args: any, ctx: ServerContext) => {
      return await tool.execute!(args, ctx);
    });
  }

  return server;
}
```

**When to Apply**: ANY service that aggregates tools from multiple sources (tool-gateway, tool-orchestrator, composition services).

**Added to CLAUDE.md**: Yes, Pattern #11: "Building MCP Aggregator Services"

---

### 2. MCP Protocol Enforces STRICT Schema Validation

**Context**: MCP SDK v2.0 upgraded with Zod-based schema validation

**Problem**: Zod to JSON Schema conversion produces objects with extra fields (`$schema`, `definitions`, `$defs`) that violate MCP protocol.

**Reality**: MCP protocol requires `inputSchema` to EXACTLY match:
```typescript
{
  type: "object",        // MUST be literal "object"
  properties?: {...},    // Optional
  required?: string[],   // Optional
}
```

**Impact**: MCP SDK rejected tools/list response with `INVALID_RESULT` error, preventing tool discovery.

**Solution**: Strip non-compliant fields before returning tools/list response.

**Code Pattern**:
```typescript
function cleanInputSchema(inputSchema: any): any {
  const clean: any = { type: 'object' };

  if (inputSchema.properties) {
    clean.properties = inputSchema.properties;
  }
  if (inputSchema.required) {
    clean.required = inputSchema.required;
  }
  if ('additionalProperties' in inputSchema) {
    clean.additionalProperties = inputSchema.additionalProperties;
  }

  return clean;
}
```

**When to Apply**: ANY service serving MCP tools/list endpoint, especially when using Zod schemas.

**Testing**: Create integration test that uses real MCP Client SDK to validate responses.

---

### 3. Omit Optional Fields, Don't Set to undefined

**Context**: MCP protocol optional fields (e.g., `description`)

**Problem**: Including `description: undefined` in tool object violates MCP protocol.

**Reality**: MCP protocol requires optional fields to be OMITTED if not present, not set to `undefined`.

**Impact**: Contributed to INVALID_RESULT errors.

**Solution**: Use spread operator with conditional to omit undefined fields.

**Code Pattern**:
```typescript
// ❌ Wrong
return {
  name: tool.id,
  description: tool.description,  // undefined included
  inputSchema: {...}
};

// ✅ Correct
return {
  name: tool.id,
  ...(tool.description && { description: tool.description }),  // Omitted if falsy
  inputSchema: {...}
};
```

**When to Apply**: All MCP response objects with optional fields.

---

### 4. Feature Flags Must Be USED, Not Just Logged

**Context**: ENABLE_TOOL_ORCHESTRATOR feature flag for cutover

**Problem**: Code logged flag value but didn't use it to change connection URL.

**Reality**: Logs showed `enabled: true` but llm-bot still connected to tool-gateway.

**Impact**: Misleading logs, incorrect behavior.

**Solution**: Trace flag value from env var → usage point. Test BOTH flag states.

**Code Pattern**:
```typescript
// ❌ Wrong
const useToolOrchestrator = process.env.ENABLE_TOOL_ORCHESTRATOR === 'true';
logger.info('Feature flag', { enabled: useToolOrchestrator });
// ... but never use the flag value

// ✅ Correct
const useToolOrchestrator = process.env.ENABLE_TOOL_ORCHESTRATOR === 'true';
const gatewayUrl = useToolOrchestrator
  ? process.env.TOOL_ORCHESTRATOR_URL
  : process.env.MCP_GATEWAY_URL;
logger.info('Connecting', { provider: useToolOrchestrator ? 'orchestrator' : 'gateway', url: gatewayUrl });
```

**Testing**: Integration test that sets flag to true/false and verifies different behavior.

---

### 5. Staging Deployment is NOT Optional

**Context**: "Confident" code after 100% unit test pass rate

**Problem**: Assumed staging deployment was pro-forma validation.

**Reality**: Staging caught 3 critical bugs that unit tests missed:
1. Base class getMcpServer() issue
2. MCP schema violations
3. Feature flag not used

**Impact**: Production deployment would have FAILED without staging validation.

**Solution**: ALWAYS deploy to staging before production, even when "confident".

**When to Apply**: Every sprint, every feature, every bug fix.

**Process**:
1. Run all unit tests locally (must pass)
2. Deploy to staging via `npm run brat -- bit deploy --all --context staging`
3. Manually test critical paths (don't just check "is it running?")
4. Check logs for errors (grep for ERROR, WARN, INVALID_RESULT)
5. Validate metrics (tool count, latency, error rate)

---

### 6. Integration Tests Require Infrastructure Fixtures

**Context**: Created `mcp-aggregation.integration.test.ts` but marked as `it.skip()`

**Problem**: Test requires running infrastructure (NATS, PostgreSQL, tool-gateway) not available in CI.

**Reality**: Integration test provides zero value if always skipped.

**Impact**: Bugs not caught until manual staging deployment.

**Solution**: Create docker-compose fixtures or agent-dev context for CI.

**Future Work**:
```bash
# Run integration tests in CI with fixtures
npm run test:integration

# Internally:
# 1. Start docker-compose with minimal services
# 2. Run integration tests
# 3. Tear down fixtures
```

**When to Apply**: Any integration test that requires external services.

---

### 7. RBAC Inheritance Must Be Most-Restrictive

**Context**: Calculating RBAC for compositions from constituent tools

**Problem**: Union vs Intersection logic for model tiers.

**Reality**: Compositions should be AT LEAST as restrictive as most restrictive constituent tool.

**Solution**: Use INTERSECTION for allowed tiers, UNION for denied tiers, MAXIMUM for trust thresholds.

**Code Pattern**:
```typescript
{
  modelTiers: {
    allowed: intersect(tools.map(t => t.rbac.modelTiers.allowed)),  // Most restrictive
    denied: union(tools.map(t => t.rbac.modelTiers.denied)),        // Any denial applies
  },
  minTrustThresholds: maximum(tools.map(t => t.rbac.minTrustThresholds)),  // Highest bar
}
```

**Why**: Security-first approach prevents compositions from being more permissive than individual tools.

**Testing**: Created 9 specific tests for RBAC inheritance algorithm.

---

### 8. Dual-Layer Validation for Security

**Context**: Composition RBAC validation

**Problem**: Single validation layer (either registration OR runtime) insufficient.

**Reality**: Need TWO layers for defense in depth:
1. **Registration-time**: Prevent malicious compositions from being created
2. **Runtime**: Prevent privilege escalation at execution time

**Example Attack**: Premium model registers composition with premium tools, then basic model tries to execute it.

**Defense**: Runtime re-validation against INVOKING model (not registering model) denies execution.

**Code Pattern**:
```typescript
// Layer 1: Registration-time (validate against REGISTERING model)
async registerComposition(definition, registeringModelId, userRoles) {
  for (const toolId of toolIds) {
    const rbacResult = this.rbac.validateToolAccess(tool, userRoles, registeringModel);
    if (!rbacResult.allowed) {
      throw new Error(`Model ${registeringModelId} lacks access to ${toolId}`);
    }
  }
}

// Layer 2: Runtime (re-validate against INVOKING model)
async executeComposition(compositionId, context) {
  for (const toolId of constituentToolIds) {
    const rbacResult = await this.validateToolAccess(toolId, context.userId, context.modelId, context.userRoles);
    if (!rbacResult.allowed) {
      throw new Error(`Composition denied: ${toolId} not allowed for invoking model`);
    }
  }
}
```

**When to Apply**: Any system with user-generated content that aggregates privileged operations.

---

### 9. Document Lessons IMMEDIATELY After Discovery

**Context**: Debugging MCP protocol issues

**Problem**: Complex, nuanced issues with multiple contributing factors.

**Reality**: Details fade quickly. Documenting immediately captures nuance.

**Solution**: Create requirements/lessons document DURING debugging, not after completion.

**Artifacts Created**:
1. IMPLEMENTATION_SUMMARY.md (comprehensive work log)
2. tool-orchestrator-mcp-aggregation-requirements.md (prevent repeating mistakes)
3. verification-report.md (staging validation results)
4. retro.md (what went well/poorly)
5. key-learnings.md (this document)

**When to Apply**: Any non-trivial debugging session or architectural decision.

---

### 10. Test Schema Compliance with Real SDK

**Context**: Validating MCP protocol compliance

**Problem**: Manual testing with curl/HTTP requests doesn't catch schema violations.

**Reality**: MCP SDK uses Zod schemas for validation. Only way to catch violations is to use the SDK.

**Solution**: Integration test that creates real MCP Client and validates responses.

**Code Pattern**:
```typescript
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

it('should return MCP-compliant tool schemas', async () => {
  const transport = new StreamableHTTPClientTransport(new URL(gatewayUrl));
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });

  await client.connect(transport);
  const result = await client.listTools();  // SDK validates response schema

  expect(result.tools.length).toBeGreaterThan(0);
  // If we get here without error, schema is valid
});
```

**When to Apply**: Any service implementing MCP protocol endpoints.

---

## Patterns Added to CLAUDE.md

### Pattern #11: Building MCP Aggregator Services

**Location**: CLAUDE.md, Common Development Patterns section

**Content**:
- Override getMcpServer() for aggregation
- Serve tools from aggregated registry, not this.registeredTools
- Implement cleanInputSchema() for MCP compliance
- Session-based MCP endpoint setup
- RBAC-filtered tools/list handler
- Integration testing requirements

**Purpose**: Ensure future aggregator services (tool-orchestrator, composition services) don't repeat tool-gateway mistakes.

---

## Metrics

### Bugs Discovered in Staging
**Count**: 3 critical bugs
**Time to Fix**: ~4 hours
**Impact if Reached Production**: High (service non-functional)

### Documentation Created
**Documents**: 5 comprehensive documents
**Total Lines**: ~2500 lines of documentation
**Quality**: Detailed, actionable, includes code examples

### Test Coverage
**New Tests**: 26 tests
**Pass Rate**: 100% (4736/4736 total tests)
**Regressions**: 0

---

## Recommendations for Future Sprints

### For Tool-Orchestrator Implementation
1. Read tool-orchestrator-mcp-aggregation-requirements.md FIRST
2. Override getMcpServer() from the start (don't rely on base class)
3. Implement cleanInputSchema() from the start
4. Create integration test BEFORE staging deployment
5. Test with BOTH feature flag states

### For All Aggregator Services
1. Override getMcpServer() to serve aggregated tools
2. Validate schemas against MCP SDK (not just HTTP tests)
3. Omit optional fields when undefined
4. Create integration test with real MCP Client
5. Deploy to staging BEFORE production

### For CI/CD Pipeline
1. Create docker-compose fixtures for integration tests
2. Run integration tests on every PR for aggregator services
3. Add schema validation linter (pre-commit hook)
4. Automate staging deployment validation

---

## Knowledge Transfer

### For Future Developers

**If you're building an MCP aggregator service**:
1. Read this document
2. Read tool-orchestrator-mcp-aggregation-requirements.md
3. Study tool-gateway implementation (src/apps/tool-gateway.ts:2602+)
4. Follow checklist in requirements doc
5. Test with real MCP Client SDK

**If you're modifying MCP endpoints**:
1. Validate schemas against MCP SDK Zod schemas
2. Test with real MCP Client (not just curl)
3. Check for INVALID_RESULT errors in logs
4. Deploy to staging and validate tool discovery

**If you're implementing feature flags**:
1. Trace flag value from env var → usage point
2. Test BOTH flag states
3. Log provider selection at startup AND per-request
4. Verify different behavior for different flag values

---

## References

### Internal Documents
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
- [tool-orchestrator-mcp-aggregation-requirements.md](./tool-orchestrator-mcp-aggregation-requirements.md)
- [verification-report.md](./verification-report.md)
- [retro.md](./retro.md)

### Code References
- tool-gateway.ts:2602+ (overridden getMcpServer)
- tool-gateway.ts:2446-2465 (cleanInputSchema)
- mcp-client-profile.ts:58-68 (feature flag integration)
- mcp-aggregation.integration.test.ts (integration test example)

### External References
- [MCP Protocol Specification](https://modelcontextprotocol.io/docs)
- [MCP SDK v2.0 Source](https://github.com/modelcontextprotocol/typescript-sdk)

---

**Document Version**: 1.0
**Last Updated**: 2026-11-13
**Author**: Claude Code (Anthropic)
