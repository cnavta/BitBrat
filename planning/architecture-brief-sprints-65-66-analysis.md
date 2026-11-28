# Architecture Brief: Sprints 65-66 Analysis & Recommendations

**Date**: 2026-11-25
**Author**: Claude (Architect Role)
**Sprints Analyzed**: Sprint 65 (Tool Execution Migration), Sprint 66 (Schema Injection via LlmProfile)
**Status**: Findings & Recommendations
**Version**: 1.0

---

## Executive Summary

This architecture brief analyzes the results and findings from **Sprint 65** (MCP SDK v2 Migration & Tool Execution Validation) and **Sprint 66** (Schema Injection via LlmProfile Integration), identifying common issues, architectural patterns, and systemic challenges that require attention to ensure platform stability and developer productivity.

**Key Findings**:
1. **Tool Schema Management Crisis**: Fundamental mismatch between PostgreSQL storage (JSON Schema) and MCP SDK v2 requirements (Zod schemas) affecting 323 tools
2. **SDK Runtime vs Type Signature Divergence**: MCP SDK v2 runtime behavior differs significantly from TypeScript signatures
3. **Service Creation Template Degradation**: `brat bit create` generates outdated infrastructure patterns
4. **Agent-Dev Environment Instability**: Recurring deployment and provisioning issues
5. **Tool Name Mapping Ambiguity**: Sanitization transforms create irreversible information loss

**Recommended Actions**:
- **IMMEDIATE**: Complete Sprint 66 schema injection implementation to restore LLM tool-calling functionality
- **SHORT-TERM**: Update service creation templates, improve diagnostic tooling
- **MEDIUM-TERM**: Address agent-dev reliability, standardize schema management
- **LONG-TERM**: Evaluate MCP SDK alternatives, implement comprehensive SDK abstraction layer

---

## 1. Sprint Summaries

### 1.1 Sprint 65: Tool Execution Migration & Validation

**Goal**: Migrate tool-orchestrator and llm-bot from MCP SDK v1.0.3 to v2.0.0

**Status**: ✅ COMPLETE (Production-ready with 8 hotfixes applied)

**Key Achievements**:
- Successfully migrated both services to MCP SDK v2.0.0
- Discovered and resolved 8 critical runtime issues through iterative staging validation
- Established comprehensive diagnostic logging patterns
- Designed elegant schema injection architecture (Option 0: Base Class Integration)

**Critical Discovery - MCP SDK v2 Parameter Passing**:
```typescript
// Expected (per TypeScript signature):
server.registerTool(name, { description, inputSchema }, async (args, ctx) => {
  const meta = ctx.mcpReq._meta;  // ❌ WRONG - ctx is empty!
});

// Actual (runtime behavior):
server.registerTool(name, { description, inputSchema }, async (args, ctx) => {
  const serverContext = args;  // ✅ CORRECT - args IS ServerContext
  const meta = serverContext.mcpReq._meta;
});
```

**Impact**: This divergence between TypeScript types and runtime behavior required 3 hotfixes and diagnostic logging to discover. Without comprehensive logging, this would have been nearly impossible to debug.

**Schema Issue Discovered**:
- 323 PostgreSQL tools registered without inputSchema (MCP SDK v2 limitation)
- LLM sends empty arguments `{}` to tools, causing validation errors
- System remains functional (fail-open design) but suboptimal user experience

---

### 1.2 Sprint 66: Schema Injection via LlmProfile Integration

**Goal**: Implement seamless schema injection for PostgreSQL-registered tools

**Status**: 🟡 PLANNING (Ready for implementation, not yet started)

**Proposed Solution**: Extend `LlmProfile` with `prepareToolsForLlm()` capability method
- **Approach**: Query PostgreSQL for missing schemas at llm-bot level (not tool-orchestrator)
- **Performance**: Parallel execution via Promise.all() (~50-100ms vs ~1-2s sequential)
- **Design Philosophy**: Fail-open (missing schemas don't block execution)
- **Developer Experience**: One-line integration (`await this.llm.prepareToolsForLlm(tools)`)

**Why This Matters**:
- Restores full LLM tool-calling functionality for 323 PostgreSQL tools
- Uses `jsonSchema()` helper in correct context (AI SDK, not MCP SDK)
- Aligns with BitBrat's composable profile architecture
- Zero boilerplate for future services

**Estimated Effort**: 7-12 hours across 4 phases

---

## 2. Common Issues Identified

### 2.1 Issue Category: Tool Schema Management

**Severity**: 🔴 **CRITICAL** (System functional but degraded)

#### Problem Statement

The BitBrat platform has a **fundamental architectural mismatch** in how tool schemas are stored, transported, and consumed:

```
PostgreSQL Storage      →  MCP Transport       →  LLM Consumption
(JSON Schema format)       (Zod schemas)          (AI SDK format)
     ✅ Works                  ❌ BROKEN              ⚠️ Degraded
```

**Data Flow Analysis**:

1. **tool-orchestrator** stores tools in PostgreSQL with full JSON Schema:
   ```json
   {
     "id": "mcp:generate_image",
     "inputSchema": {
       "jsonSchema": {
         "type": "object",
         "required": ["prompt"],
         "properties": {
           "prompt": { "type": "string", "description": "..." }
         }
       }
     }
   }
   ```

2. **tool-orchestrator** registers tools via MCP SDK v2 **WITHOUT schemas**:
   ```typescript
   server.registerTool(sanitizedToolName, {
     description: tool.description,
     // inputSchema deliberately omitted - MCP SDK v2 limitation
   }, handler);
   ```
   **Why omitted?** MCP SDK v2 requires Zod schemas. PostgreSQL stores JSON Schema. No conversion implemented.

3. **llm-bot** receives tools with `inputSchema: undefined`:
   ```typescript
   const tools = registry.getTools();
   // tools[0].inputSchema === undefined
   ```

4. **AI SDK** (OpenAI/Anthropic) receives tools without parameter schemas:
   ```typescript
   await generateText({
     model,
     messages,
     tools  // Tools without schemas - LLM cannot determine arguments!
   });
   ```

5. **LLM** sends empty arguments (best guess):
   ```json
   {
     "tool_calls": [
       {
         "name": "generate_image",
         "arguments": {}  // ❌ Empty! Should be { "prompt": "sunset over ocean" }
       }
     ]
   }
   ```

6. **Upstream MCP server** validates and rejects:
   ```
   Error: Input validation error: prompt: Invalid input: expected string, received undefined
   ```

#### Root Causes

1. **Format Incompatibility**: JSON Schema (PostgreSQL) ≠ Zod schemas (MCP SDK v2)
2. **Transport Limitation**: MCP SDK v2 tool transport doesn't preserve JSON Schema
3. **No Conversion Layer**: No automatic JSON Schema → Zod conversion implemented
4. **Separation of Concerns Broken**: Storage layer (PostgreSQL) decoupled from transport layer (MCP)

#### Impact Assessment

**Affected Components**:
- ✅ **tool-orchestrator**: Stores schemas correctly in PostgreSQL
- ❌ **MCP transport layer**: Loses schemas during tool registration
- ❌ **llm-bot**: Receives tools without schemas
- ❌ **LLM tool calling**: Cannot generate correct arguments
- ❌ **End-user experience**: Tool calls fail with validation errors

**Scale**:
- **323 PostgreSQL tools** affected (all MCP-imported tools)
- **~90% of tool catalog** (only direct Bit tools have schemas)

**Severity Justification**:
- System remains functional (fail-open validation)
- No crashes or data loss
- BUT: Severely degraded user experience (most tool calls fail)
- Future services (reflex, query-analyzer) will hit same issue

#### Failed Solution Attempt

**Approach**: Use `jsonSchema()` helper from AI SDK for MCP registration

**Implementation** (Sprint 65, commit 70ea81de - REVERTED):
```typescript
import { jsonSchema } from 'ai';

const schemaData = tool.inputSchema.jsonSchema || tool.inputSchema;
const inputSchemaForRegistration = jsonSchema(schemaData);

server.registerTool(sanitizedToolName, {
  description: tool.description,
  inputSchema: inputSchemaForRegistration,  // ❌ Type mismatch!
}, handler);
```

**Why It Failed**:
```
Error: inputSchema must be a Standard Schema (e.g. z.object({...}))
```

**Lesson Learned**: `jsonSchema()` returns AI SDK wrapper format, incompatible with MCP SDK v2 which expects Zod schemas. **Context matters** - same helper works in different API contexts.

**Result**:
- MCP server crash in staging
- Hundreds of schema validation errors
- llm-bot unable to connect to tool-orchestrator
- **Immediate revert required**

#### Recommended Solution (Sprint 66 - In Planning)

**Approach**: Inject schemas at llm-bot level, NOT tool-orchestrator level

**Why This Works**:
- Uses `jsonSchema()` in **correct context** (AI SDK tool registration)
- Direct access to PostgreSQL tool metadata
- No type conversion needed (JSON Schema → AI SDK is compatible)
- Aligns with separation of concerns (MCP transport stays schema-less, AI SDK gets schemas)

**Implementation Pattern**:
```typescript
// In llm-bot processor.ts
const allTools = registry.getTools();  // Tools without schemas
const filteredTools = applyFiltering(allTools);

// ✅ Schema injection via LlmProfile capability
const enrichedTools = await this.llm.prepareToolsForLlm(filteredTools);

// ✅ Tools now have schemas in AI SDK format
await generateText({ model, messages, tools: enrichedTools });
```

**Performance**:
- Parallel schema lookups: 323 tools in ~50-100ms (vs ~1-2s sequential)
- Lazy initialization: PostgreSQL connection only when first needed
- Fail-open: Missing schemas don't block execution

**Developer Experience**:
- Zero boilerplate: Single method call
- Consistent across services: All LLM-using services inherit capability
- IntelliSense discoverable: `bit.llm.prepareToolsForLlm()`

#### Immediate Actions Required

**Priority**: 🔴 **HIGHEST**

1. **Complete Sprint 66 Implementation** (7-12 hours)
   - Extend LlmProfile with `prepareToolsForLlm()`
   - Migrate llm-bot to use new pattern
   - Validate in agent-dev (if available) or staging
   - Deploy to production

2. **Validate Impact** (2-3 hours)
   - Test tool calls with real user scenarios
   - Monitor staging logs for schema injection success/failure rates
   - Measure performance overhead
   - Verify fail-open behavior

3. **Document Pattern** (2-3 hours)
   - Update CLAUDE.md with schema injection pattern
   - Create integration guide for future services
   - Document known limitations (tool name mapping ambiguity)

**Success Criteria**:
- LLM tool calls succeed with correct arguments
- Schema injection logs show 90%+ success rate
- Performance overhead <100ms
- Zero regressions in existing functionality

---

### 2.2 Issue Category: SDK Runtime vs Type Signature Divergence

**Severity**: 🟡 **HIGH** (Causes debugging delays, requires defensive programming)

#### Problem Statement

MCP SDK v2's **runtime behavior differs significantly from TypeScript signatures**, creating a debugging challenge that requires diagnostic logging and iterative validation to uncover.

#### Evidence

**Case Study: Sprint 65 HOTFIX 7 (Breakthrough Discovery)**

**TypeScript Signature**:
```typescript
server.registerTool(
  name: string,
  definition: { description?: string; inputSchema?: any },
  handler: (args: any, ctx: any) => Promise<CallToolResult>
);
```

**Expected Behavior** (based on signature):
- `args` = Tool invocation arguments
- `ctx` = ServerContext with metadata

**Actual Runtime Behavior**:
- `args` = **ServerContext** (entire context object!)
- `ctx` = **Empty/undefined**

**Discovery Process**:
1. Initial assumption based on types: `ctx.mcpReq._meta` to access metadata
2. Runtime error: `ctx` is undefined
3. HOTFIX 6: Add diagnostic logging to understand parameter structure
4. Logs reveal: `args` contains `sessionId`, `mcpReq`, `http` fields (ServerContext fields!)
5. HOTFIX 7: `const serverContext = args;` - Breakthrough!

**Code Comparison**:
```typescript
// ❌ WRONG (based on TypeScript signature)
server.registerTool(toolName, { description, inputSchema }, async (args, ctx) => {
  const meta = ctx?.mcpReq?._meta;  // Always undefined!
  const userId = meta?.userId;      // Cannot access
});

// ✅ CORRECT (based on runtime behavior)
server.registerTool(toolName, { description, inputSchema }, async (args, ctx) => {
  const serverContext = args;  // args IS ServerContext at runtime
  const meta = serverContext?.mcpReq?._meta;
  const userId = meta?.userId;  // Now accessible
});
```

#### Impact Assessment

**Sprint 65 Hotfixes Related to This Issue**: 3 out of 8 (37.5%)
- HOTFIX 5: ProxyInvoker modelId bug (conditional property inclusion)
- HOTFIX 6: Diagnostic logging to reveal parameter structure
- HOTFIX 7: ServerContext parameter fix (breakthrough)

**Time Investment**:
- 2 deployment cycles to discover
- Multiple staging trace analyses
- Diagnostic logging implementation
- **~4-6 hours total debugging time**

**Future Risk**:
- Any future MCP SDK upgrades may have similar issues
- New developers unfamiliar with this quirk will waste time debugging
- TypeScript provides false confidence (types are misleading)

#### Root Causes

1. **SDK Wrapper Layer**: MCP SDK v2 uses dynamic invocation, TypeScript signatures don't reflect runtime behavior
2. **Undocumented Behavior**: MCP SDK v2 documentation doesn't clearly explain parameter passing semantics
3. **Type System Limitations**: TypeScript cannot express "args is actually ServerContext at runtime"

#### Lessons Learned (Sprint 65 Key Learnings)

**Key Takeaway**: "Runtime behavior can differ from TypeScript signatures. Trust runtime evidence (logs) over TypeScript types when debugging SDK integrations."

**Best Practice Established**:
1. **Instrument First, Fix Second**: Add diagnostic logging BEFORE attempting fixes
2. **Trust Logs Over Types**: Runtime evidence trumps TypeScript signatures
3. **Validate in Staging**: User-provided trace IDs enable rapid feedback loops

**Diagnostic Logging Pattern** (HOTFIX 6):
```typescript
logger.debug('mcp_server.tool_call.raw_params', {
  toolId: tool.id,
  argsKeys: args ? Object.keys(args) : [],       // ['sessionId', 'mcpReq', 'http']
  ctxKeys: ctx ? Object.keys(ctx) : [],           // []
  argsHasMcpReq: !!(args as any)?.mcpReq,        // true
  ctxMeta: (ctx as any)?._meta,                  // undefined
  ctxMcpReqMeta: (ctx as any)?.mcpReq?._meta,    // undefined
});
```

**Impact**: This logging directly led to HOTFIX 7 breakthrough. Without it, debugging would have taken days instead of hours.

#### Recommendations

**SHORT-TERM** (Next Sprint):

1. **Document MCP SDK Quirks** (2 hours)
   - Create `documentation/reference/mcp-sdk-v2-quirks.md`
   - Document parameter passing behavior
   - Include code examples (correct vs incorrect)
   - Add to onboarding materials

2. **Create MCP SDK Test Harness** (4-6 hours)
   - Build runtime validation tests for MCP SDK interactions
   - Validate parameter passing semantics
   - Test context extraction patterns
   - Run as part of CI/CD

3. **Add Defensive Logging to All MCP Handlers** (2-3 hours)
   - Standardize diagnostic logging pattern
   - Add to base handler template
   - Include in `brat bit create` templates

**MEDIUM-TERM** (2-3 Sprints):

4. **Create MCP SDK Abstraction Layer** (1-2 weeks)
   - Wrap MCP SDK v2 with BitBrat-specific interface
   - Normalize parameter passing
   - Provide consistent API across all Bits
   - Isolate future SDK upgrade impacts

5. **Contribute to MCP SDK Documentation** (2-4 hours)
   - Submit documentation PR to MCP SDK project
   - Clarify parameter passing behavior
   - Add runtime behavior examples
   - Help future developers avoid this pitfall

**LONG-TERM** (Future):

6. **Evaluate MCP SDK Alternatives**
   - Monitor MCP SDK v2 maturity
   - Evaluate alternative transport layers
   - Consider building custom MCP implementation
   - Assess cost/benefit of SDK abstraction vs SDK dependency

---

### 2.3 Issue Category: Tool Name Mapping Ambiguity

**Severity**: 🟡 **MEDIUM** (Affects 10% of tools, graceful degradation)

#### Problem Statement

Tool names undergo **lossy transformations** during sanitization for MCP compatibility, creating ambiguity when reverse-mapping to query PostgreSQL schemas.

#### Transformation Chain

```
PostgreSQL Registry ID → Sanitization → MCP Tool Name → Reverse Mapping → Query
mcp:generate-image    →   mcp_generate_image   →  mcp:generate-image  ✅
mcp:claim-check/bit.readiness → mcp_claim_check_bit_readiness → mcp:claim-check/bit.readiness ✅
mcp:a-b/c.d.e         →   mcp_a_b_c_d_e        →  mcp:a-b/c.d.e ??? ⚠️
```

**Sanitization Rules**:
- `:` → `_`
- `/` → `_`
- `.` → `_`
- `-` → unchanged (sometimes → `_` for consistency?)

**Problem**: All transformations use `_`, creating **information loss**.

#### Ambiguity Examples

**Case 1: Simple Tool (90% of tools) - Works ✅**
```
Registry:    mcp:generate_image
Sanitized:   mcp_generate_image
Reverse:     mcp:generate-image (heuristic: replace first _ with :, rest with -)
Result:      ✅ Correct match
```

**Case 2: Qualified Tool (10% of tools) - Ambiguous ⚠️**
```
Registry:    mcp:claim-check/bit.readiness
Sanitized:   mcp_claim_check_bit_readiness
Reverse:     Could be:
             - mcp:claim-check/bit.readiness (correct)
             - mcp:claim/check-bit.readiness (wrong)
             - mcp:claim.check/bit-readiness (wrong)
Result:      ⚠️ Heuristic guess (usually works, but not guaranteed)
```

**Case 3: Complex Qualified Tool (rare, but exists) - Fails ❌**
```
Registry:    mcp:a-b/c.d.e
Sanitized:   mcp_a_b_c_d_e
Reverse:     Impossible to determine original without additional context
Result:      ❌ Fail-open (tool works without schema)
```

#### Current Implementation (Sprint 66 Execution Plan)

**Heuristic Mapping Strategy**:
```typescript
function mapToolNameToRegistryId(toolId: string): string {
  if (toolId.startsWith('mcp:')) return toolId;  // Already correct

  // Pattern 1: mcp_namespace_tool → mcp:namespace/tool
  const withSlashMatch = toolId.match(/^mcp_([a-z0-9_]+?)_([a-z0-9_]+)$/);
  if (withSlashMatch) {
    return `mcp:${withSlashMatch[1].replace(/_/g, '-')}/${withSlashMatch[2].replace(/_/g, '.')}`;
  }

  // Pattern 2: mcp_tool → mcp:tool
  const simpleMatch = toolId.match(/^mcp_([a-z0-9_]+)$/);
  if (simpleMatch) {
    return `mcp:${simpleMatch[1].replace(/_/g, '-')}`;
  }

  // Fallback: Return as-is and log warning
  logger.warn('bit.llm.prepareToolsForLlm.name_mapping_fallback', {
    toolId,
    message: 'Could not map tool name to registry ID'
  });
  return toolId;
}
```

**Success Rate**: ~90% (based on Sprint 66 estimation)

**Failure Mode**: Fail-open (unmapped tools still usable, just without schema)

#### Impact Assessment

**Affected Tools**: ~10% of PostgreSQL tool catalog (~32 out of 323 tools)

**User Impact**:
- Most tools work correctly (90% success rate)
- Complex qualified tools may not get schemas
- System remains functional (fail-open design)
- LLM can still attempt tool calls (may fail validation)

**Example Affected Tools**:
- Namespace/qualified tools: `mcp:story-engine-mcp/bit.info`
- Nested namespaces: `mcp:complex-namespace/sub.tool.name`
- Hyphenated + dotted combinations: `mcp:my-service/my.tool.v2`

#### Recommendations

**SHORT-TERM** (Sprint 66 - Current):

1. **Accept Heuristic Mapping** ✅ (Already planned)
   - 90% success rate is acceptable for MVP
   - Fail-open design ensures unmapped tools still work
   - Logging captures failures for future improvement

2. **Document Known Limitation** ✅ (Already planned)
   - Add to Sprint 66 integration guide
   - Clarify which tool name patterns may fail
   - Provide workaround (manual schema registration if needed)

**MEDIUM-TERM** (Future Sprint - Phase 5):

3. **Add Sanitized Name Column to PostgreSQL** (1-2 hours)
   ```sql
   ALTER TABLE platform_tool_registry ADD COLUMN sanitized_name TEXT;
   CREATE INDEX idx_tool_registry_sanitized ON platform_tool_registry(sanitized_name);
   ```
   - Store both original ID and sanitized name
   - Backfill existing tools
   - Use sanitized_name as primary lookup key
   - **Eliminates heuristic mapping entirely**

4. **Fallback LIKE Query** (1 hour)
   ```typescript
   // If exact match fails, try fuzzy match
   const tools = await toolStore.query('platform_tool_registry', {
     where: [['id', 'LIKE', `%${toolNameFragment}%`]],
     limit: 1
   });
   ```
   - Slower but more robust
   - Only used when heuristic fails
   - Logs warning for manual review

**LONG-TERM** (Architecture Review):

5. **Reconsider Sanitization Strategy**
   - Use different separators for different transformations:
     - `:` → `__` (double underscore)
     - `/` → `_slash_`
     - `.` → `_dot_`
   - Lossless transformation (can reverse unambiguously)
   - Breaks backward compatibility (requires migration)

6. **Tool ID Format Standardization**
   - Establish naming conventions for new tools
   - Deprecate complex qualified names
   - Encourage flat namespace (e.g., `mcp:claim_check_bit_readiness` as canonical ID)

---

### 2.4 Issue Category: Agent-Dev Environment Instability

**Severity**: 🟡 **MEDIUM** (Blocks validation, workarounds available)

#### Problem Statement

Agent-dev execution contexts are **unreliable** for service validation, forcing sprints to use alternative validation methods or skip deployment testing entirely.

#### Evidence Across Sprints

**Sprint 57** (Tool Orchestrator):
```
Issue 2: Single-Service Deployment Fails for tool-orchestrator (KNOWN LIMITATION)
Status: Documented for future resolution
Priority: Medium

Problem: tool-orchestrator cannot be deployed in isolation
Error: service "tool-orchestrator" depends on undefined service "nats": invalid compose project

Attempted Solutions:
1. ✗ Deploy to agent-dev context - Agent-dev provisioning has known issues
2. ✗ Deploy to local context - Fails with missing NATS dependency
```

**Sprint 65** (MCP SDK v2 Migration):
- **Workaround**: Used staging environment instead of agent-dev
- Validation via user-provided staging trace IDs
- No agent-dev mentioned (avoided due to known issues)

**Sprint 66** (Schema Injection - Planning):
- **Phase 3**: "Validate in agent-dev context" (planned)
- **Risk Assessment**: "documentStore not available in some contexts"
- Anticipates potential agent-dev unavailability

**Historical References**:
- Sprint 18: `KNOWN_ISSUES.md` exists (agent-dev mentioned)
- Sprint 25: `issues-found.md` exists
- Sprint 42: `mcp-notification-issue.md` exists
- Sprint 55: `technical-architecture-issues-backlog.md` exists

#### Root Causes (Hypothesized - Needs Investigation)

1. **Provisioning Complexity**: Agent-dev requires coordinating multiple infrastructure services (PostgreSQL, NATS, Redis)
2. **Dependency Resolution**: Single-service deployment doesn't auto-provision dependencies
3. **State Persistence**: Agent-dev contexts may not preserve state correctly between sessions
4. **Network Isolation**: Docker networking issues preventing inter-service communication
5. **Resource Constraints**: Insufficient resources for full stack in agent-dev environment

#### Impact Assessment

**Affects**:
- Sprint validation workflows (can't test in isolated environment)
- Developer productivity (must use staging or local for testing)
- CI/CD pipelines (can't automate agent-dev validation)
- Sprint completion (deployment validation often skipped or delayed)

**Workarounds Currently Used**:
1. **Staging Environment**: Deploy to shared staging, validate with trace IDs (Sprint 65)
2. **Full Local Stack**: `npm run local` to start entire platform (Sprint 57)
3. **Unit Tests Only**: Skip integration testing, rely on unit test coverage (Sprint 57)
4. **Manual Testing**: Run migrations and seed scripts manually

**Cost**:
- **Time**: 2-4 hours per sprint attempting agent-dev before giving up
- **Risk**: Lower confidence in deployments (untested integration)
- **Quality**: Integration bugs discovered in staging instead of dev environment

#### Recommendations

**IMMEDIATE** (Next Sprint):

1. **Diagnostic Investigation** (4-8 hours)
   - Create debug script to diagnose agent-dev provisioning
   - Log all provisioning steps
   - Identify failure points
   - Document root cause

2. **Document Agent-Dev Architecture** (2-3 hours)
   - Create `documentation/guides/agent-dev-troubleshooting.md`
   - Explain provisioning flow
   - List common issues and solutions
   - Provide diagnostic commands

**SHORT-TERM** (1-2 Sprints):

3. **Fix Single-Service Deployment with Dependencies** (1-2 weeks)
   - Update deployment orchestrator to auto-provision dependencies
   - Add `--with-dependencies` flag to `brat bit deploy`
   - Support dependency graph resolution
   - Example: `brat bit deploy tool-orchestrator --with-dependencies` auto-starts NATS, PostgreSQL

4. **Improve Agent-Dev Reliability** (1-2 weeks)
   - Fix provisioning race conditions
   - Improve health check reliability
   - Add retry logic for transient failures
   - Validate agent-dev in CI/CD

**MEDIUM-TERM** (2-3 Sprints):

5. **Alternative Validation Strategy** (1 week)
   - Create lightweight "mini-stack" for single-service testing
   - Use test doubles for infrastructure dependencies
   - Support local Docker Compose with minimal dependencies
   - Provide fast feedback without full agent-dev provisioning

6. **Agent-Dev Observability** (1 week)
   - Add comprehensive logging to provisioning process
   - Create dashboard for agent-dev health
   - Monitor provisioning success/failure rates
   - Alert on provisioning failures

---

### 2.5 Issue Category: Service Creation Template Degradation

**Severity**: 🟡 **MEDIUM** (Causes deployment failures, requires manual remediation)

#### Problem Statement

The `brat bit create` command generates service configuration using **outdated infrastructure patterns** (pre-Sprint 375), causing immediate deployment failures and requiring manual remediation.

#### Evidence (Sprint 57)

**Issue 1b: Outdated Infrastructure Pattern (RESOLVED)**

**Problem**: After creating `tool-orchestrator` service, deployment failed with:
```
failed to solve: failed to read dockerfile: open Dockerfile.tool-orchestrator: no such file or directory
```

**Root Cause**: Generated docker-compose configuration referenced service-specific Dockerfile instead of modern shared `Dockerfile.service`.

**Generated (Incorrect) Pattern**:
```yaml
# infrastructure/docker-compose/services/tool-orchestrator.compose.yaml
build:
  context: .                              # ❌ Wrong: Current directory
  dockerfile: Dockerfile.tool-orchestrator # ❌ Wrong: Doesn't exist
ports:
  - "${TOOL_ORCHESTRATOR_HOST_PORT:-3000}:3000"  # ❌ Hardcoded port
```

**Modern (Sprint 375+) Pattern**:
```yaml
build:
  context: ../..  # ✅ Repository root
  dockerfile: Dockerfile.service  # ✅ Shared Dockerfile
  args:
    BASE_IMAGE: bitbrat-base:${BITBRAT_VERSION:-latest}  # ✅ Shared base
    SERVICE_NAME: tool-orchestrator
    SERVICE_ENTRY: dist/apps/tool-orchestrator-service.js
    SERVICE_PORT: "3000"
ports:
  - "${TOOL_ORCHESTRATOR_HOST_PORT:-3001}:${SERVICE_PORT:-3000}"  # ✅ Uses build arg
```

**Manual Remediation Required**: Sprint 57 created `tool-orchestrator-infra-remediation.md` and filed bug report `BUG-2026-11-09-003`.

#### Impact Assessment

**Affects**:
- All new services created with `brat bit create` (tool-orchestrator, any future services)
- Developer experience (immediate deployment failure, debugging required)
- Sprint velocity (1-2 hours lost per new service to diagnose and fix)

**Root Cause**: `brat bit create` templates not updated after Sprint 375 infrastructure standardization.

#### Related Issues

**Other Template Issues Found**:
1. **Hardcoded ports**: New services default to 3000 instead of auto-assigned ports
2. **Missing network aliases**: Generated compose files don't include `.bitbrat.local` aliases
3. **Healthcheck intervals**: Too slow (30s) instead of fast (5s)
4. **Build args**: Missing `BASE_IMAGE` arg for shared base image

#### Recommendations

**IMMEDIATE** (Next Sprint):

1. **Update `brat bit create` Templates** (4-6 hours)
   - Review all templates in `tools/brat/src/templates/`
   - Update docker-compose templates to Sprint 375+ patterns
   - Add network aliases
   - Update healthcheck configuration
   - Use auto-assigned ports via PortManager
   - Include `BASE_IMAGE` build arg

2. **Validation Testing** (2 hours)
   - Create test service with updated templates
   - Verify deployment succeeds without manual intervention
   - Validate all docker-compose features work
   - Test with both local and staging contexts

3. **Document Template Updates** (1 hour)
   - Update `documentation/guides/adding-new-service.md`
   - Document Sprint 375+ patterns
   - Add troubleshooting section
   - Include migration guide for existing services

**SHORT-TERM** (1-2 Sprints):

4. **Template Versioning** (1 week)
   - Add version field to templates
   - Support multiple template versions
   - Allow selecting template version during service creation
   - Warn when using outdated templates

5. **Automated Template Testing** (1 week)
   - Add CI/CD test that creates service from templates
   - Validate generated service deploys successfully
   - Run after any template changes
   - Prevent template degradation in future

**MEDIUM-TERM** (2-3 Sprints):

6. **Template Maintenance Process** (Ongoing)
   - Establish template review process
   - Update templates when infrastructure changes
   - Document template changelog
   - Notify developers of template updates

---

## 3. Systemic Patterns Identified

### 3.1 Positive Patterns (Reinforce These)

#### 3.1.1 Fail-Open Design Philosophy ✅

**Pattern**: BitBrat consistently chooses **graceful degradation over hard failures**.

**Examples**:
- **Tool registration without schemas**: Succeeds, tools remain usable (Sprint 65)
- **Schema injection failures**: Logged as warnings, execution continues (Sprint 66)
- **Progress middleware unavailable**: Logs warning, skips progress messages (Sprint 36)
- **Missing environment variables**: Services start with defaults where possible

**Benefits**:
- System remains functional during partial outages
- Gradual migrations possible (old + new code coexist)
- Reduces cascading failures
- Production uptime prioritized over strict validation

**Recommendation**: **Continue this philosophy**, but add comprehensive logging to make degradation visible.

---

#### 3.1.2 Profile Composition Architecture ✅

**Pattern**: Capabilities extend via **composable profiles**, not external utilities.

**Example** (Sprint 66):
```typescript
// ❌ Manual Utility Approach (rejected)
const injector = new McpSchemaInjector();
const tools = await injector.injectSchemas(mcpTools);

// ✅ Profile Capability Approach (adopted)
const tools = await this.llm.prepareToolsForLlm(mcpTools);
```

**Benefits**:
- Seamless integration (one method call)
- Consistent across services (all LLM-using services inherit)
- Discoverable via IntelliSense
- Single source of truth (capability logic in one place)
- No manual lifecycle management

**Recommendation**: **Continue extending profiles** for new capabilities. Update CLAUDE.md with this pattern.

---

#### 3.1.3 Diagnostic Logging Before Fixing ✅

**Pattern**: Add **comprehensive logging BEFORE attempting fixes** when facing opaque runtime behavior.

**Example** (Sprint 65 HOTFIX 6):
```typescript
logger.debug('mcp_server.tool_call.raw_params', {
  argsKeys: args ? Object.keys(args) : [],
  ctxKeys: ctx ? Object.keys(ctx) : [],
  argsHasMcpReq: !!(args as any)?.mcpReq,
  // ... detailed parameter inspection
});
```

**Impact**: This logging directly led to HOTFIX 7 breakthrough (ServerContext in first parameter).

**Recommendation**:
- **Standardize diagnostic logging patterns**
- Add to base handler templates
- Include in `brat bit create` generated code
- Create logging best practices guide

---

#### 3.1.4 Iterative Validation with Trace IDs ✅

**Pattern**: User provides **staging trace IDs** after each deployment for rapid feedback.

**Example** (Sprint 65):
- 5 trace IDs analyzed
- 8 hotfixes discovered and validated
- Each trace revealed new insights
- Incremental confidence building

**Benefits**:
- Real usage patterns (not synthetic tests)
- Full system context (all services, real data)
- Immediate feedback (not waiting for user reports)
- Catches issues early (before production)

**Recommendation**: **Formalize this process**:
- Document trace ID validation workflow
- Add to sprint templates
- Create trace analysis tooling
- Train developers on trace-driven debugging

---

#### 3.1.5 Documentation of Failures ✅

**Pattern**: **Failed approaches documented comprehensively**, not just successes.

**Example** (Sprint 65):
- `schema-problem-analysis.md` documents jsonSchema() failure
- Explains why it failed
- Documents what NOT to do
- Prevents future teams from repeating mistake

**Recommendation**: **Continue documenting failures**. Create template for "failure analysis" documents.

---

### 3.2 Negative Patterns (Need Remediation)

#### 3.2.1 SDK Upgrade Fragility ⚠️

**Pattern**: SDK upgrades cause **multiple runtime issues** not caught by TypeScript compilation.

**Evidence**: Sprint 65 required 8 hotfixes, most related to MCP SDK v2 runtime semantics.

**Root Cause**: TypeScript type checking doesn't validate runtime behavior for SDK wrappers.

**Recommendation**:
- Create SDK abstraction layers
- Build runtime test harnesses
- Add defensive logging to all SDK interactions
- Document known SDK quirks

---

#### 3.2.2 Template Maintenance Lag ⚠️

**Pattern**: Service creation templates **fall out of sync** with infrastructure evolution.

**Evidence**: Sprint 57 found pre-Sprint 375 patterns in `brat bit create` templates.

**Root Cause**: No formal template review process when infrastructure changes.

**Recommendation**:
- Establish template review checklist
- Update templates during infrastructure sprints
- Add automated template testing
- Version templates explicitly

---

#### 3.2.3 Agent-Dev Environment Avoidance ⚠️

**Pattern**: Sprints **avoid using agent-dev** due to reliability issues, using staging or local instead.

**Evidence**: Sprint 57 documented "Known Limitation", Sprint 65 used staging, Sprint 66 plans agent-dev but acknowledges risk.

**Root Cause**: Agent-dev provisioning has undiagnosed reliability issues.

**Recommendation**:
- Prioritize agent-dev investigation
- Fix provisioning issues
- Provide alternative lightweight validation
- Document known issues and workarounds

---

## 4. Prioritized Recommendations

### 4.1 Immediate Actions (This Sprint)

| ID | Action | Owner | Effort | Impact | Dependency |
|----|--------|-------|--------|--------|------------|
| **I-1** | **Complete Sprint 66 Implementation** | Dev Team | 7-12h | 🔴 Critical | None |
| **I-2** | **Document MCP SDK v2 Quirks** | Architect | 2h | 🟡 High | None |
| **I-3** | **Update `brat bit create` Templates** | Platform Team | 4-6h | 🟡 High | None |

**Rationale**:
- **I-1**: Restores full LLM tool-calling functionality (323 tools affected)
- **I-2**: Prevents future debugging delays (documents known issues)
- **I-3**: Prevents deployment failures for new services

---

### 4.2 Short-Term Actions (Next 1-2 Sprints)

| ID | Action | Owner | Effort | Impact | Dependency |
|----|--------|-------|--------|--------|------------|
| **ST-1** | **Fix Single-Service Deployment with Dependencies** | Platform Team | 1-2w | 🟡 High | None |
| **ST-2** | **Add Sanitized Name Column to PostgreSQL** | Backend Team | 1-2h | 🟡 Medium | I-1 |
| **ST-3** | **Create MCP SDK Test Harness** | Dev Team | 4-6h | 🟡 Medium | I-2 |
| **ST-4** | **Investigate Agent-Dev Provisioning Issues** | Platform Team | 4-8h | 🟡 Medium | None |
| **ST-5** | **Template Versioning & Testing** | Platform Team | 1w | 🟡 Medium | I-3 |

---

### 4.3 Medium-Term Actions (2-3 Sprints)

| ID | Action | Owner | Effort | Impact | Dependency |
|----|--------|-------|--------|--------|------------|
| **MT-1** | **Create MCP SDK Abstraction Layer** | Architect + Dev Team | 1-2w | 🟡 High | ST-3 |
| **MT-2** | **Improve Agent-Dev Reliability** | Platform Team | 1-2w | 🟡 High | ST-4 |
| **MT-3** | **Alternative Lightweight Validation Strategy** | Platform Team | 1w | 🟡 Medium | MT-2 |
| **MT-4** | **Schema Performance Optimization (Caching)** | Backend Team | 1w | 🔵 Low | I-1, ST-2 |

---

### 4.4 Long-Term Actions (Future)

| ID | Action | Owner | Effort | Impact | Dependency |
|----|--------|-------|--------|--------|------------|
| **LT-1** | **Evaluate MCP SDK Alternatives** | Architect | 2-4w | 🟡 Medium | MT-1 |
| **LT-2** | **Tool ID Format Standardization** | Architect + Product | 1-2w | 🔵 Low | ST-2 |
| **LT-3** | **Contribute to MCP SDK Documentation** | Dev Team | 2-4h | 🔵 Low | I-2 |

---

## 5. Success Metrics

### 5.1 Issue Resolution Metrics

| Issue Category | Current State | Target State | Measurement |
|----------------|---------------|--------------|-------------|
| **Tool Schema Management** | 323 tools without schemas | 90%+ tools with schemas | Schema injection success rate logs |
| **SDK Runtime Divergence** | 3 hotfixes per migration | <1 hotfix per migration | Hotfix count per SDK upgrade sprint |
| **Tool Name Mapping** | ~10% failure rate (estimated) | <5% failure rate | Schema injection fallback count |
| **Agent-Dev Reliability** | Avoided due to issues | Used in 80%+ sprints | Sprint validation method tracking |
| **Service Creation** | Manual remediation required | Zero manual fixes needed | New service deployment success rate |

### 5.2 Platform Health Metrics

| Metric | Current | Target | Timeline |
|--------|---------|--------|----------|
| **LLM Tool Call Success Rate** | ~10-20% (without schemas) | >90% | After I-1 |
| **Sprint Validation Method** | Staging (workaround) | Agent-dev | After MT-2 |
| **New Service Creation Time** | 2-4h (with debugging) | <30min | After I-3 |
| **SDK Upgrade Hotfixes** | 8 (Sprint 65) | <2 | After ST-3 |
| **Agent-Dev Uptime** | Unknown | >95% | After MT-2 |

### 5.3 Developer Experience Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| **Time to First Successful Deployment** | 2-4h (new service) | <30min | Deployment telemetry |
| **SDK Debugging Time** | 4-6h (Sprint 65) | <1h | Developer survey |
| **Schema Injection Integration Time** | N/A | <15min | CLAUDE.md pattern adoption |
| **Agent-Dev Provisioning Success** | <50% (estimated) | >90% | Provisioning telemetry |

---

## 6. Risk Assessment

### 6.1 High-Risk Items

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Sprint 66 implementation blocked by agent-dev issues** | Medium | High | Use staging validation instead (like Sprint 65) |
| **Schema injection performance degrades production** | Low | High | Parallel execution + performance testing before prod |
| **MCP SDK v3 upgrade causes similar issues** | Medium | High | Build SDK abstraction layer (MT-1) |

### 6.2 Medium-Risk Items

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Tool name mapping fails for critical tools** | Medium | Medium | Fail-open design + manual override capability |
| **Agent-dev investigation reveals unfixable architecture issue** | Low | Medium | Provide alternative validation strategy (MT-3) |
| **Template updates break existing services** | Low | Medium | Test updates with new service creation first |

### 6.3 Low-Risk Items

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Documentation lag during rapid implementation** | High | Low | Use documentation templates, enforce in PR review |
| **Developer resistance to new patterns** | Low | Low | Demonstrate benefits in CLAUDE.md examples |

---

## 7. Conclusion

Sprints 65 and 66 have revealed **critical architectural challenges** in BitBrat's tool execution and schema management systems, while also demonstrating **strong engineering practices** in diagnostic logging, fail-open design, and iterative validation.

**Key Accomplishments**:
- ✅ Successful MCP SDK v2 migration (Sprint 65)
- ✅ Elegant schema injection architecture designed (Sprint 66)
- ✅ Comprehensive documentation of failures and learnings
- ✅ Proactive identification of systemic issues

**Critical Path Forward**:
1. **Complete Sprint 66** (schema injection) to restore LLM tool-calling functionality
2. **Fix service creation templates** to prevent deployment failures
3. **Document MCP SDK quirks** to prevent future debugging delays
4. **Investigate agent-dev reliability** to restore validation confidence

**Long-Term Vision**:
- **Robust SDK abstraction** protecting against future upgrade fragility
- **Reliable agent-dev environments** enabling fast validation feedback
- **Lossless tool name mapping** via sanitized name storage
- **Comprehensive diagnostic tooling** for rapid issue diagnosis

The platform is **fundamentally sound** with strong architectural patterns. These recommendations address **tactical issues** that have emerged during rapid evolution, ensuring continued developer productivity and system reliability.

---

**Document Status**: ✅ COMPLETE
**Next Action**: Review with platform team, prioritize recommendations, assign owners
**Follow-up**: Create tracking issues for each recommendation in GitHub/planning system

---

**Appendix A: Related Documentation**

- Sprint 65 Retrospective: `planning/sprint-65-yt9tbb/retro.md`
- Sprint 65 Key Learnings: `planning/sprint-65-yt9tbb/key-learnings.md`
- Sprint 65 Verification Report: `planning/sprint-65-yt9tbb/verification-report.md`
- Schema Problem Analysis: `planning/sprint-65-yt9tbb/schema-problem-analysis.md`
- Schema Injection Architecture: `planning/sprint-65-yt9tbb/schema-injection-architecture.md`
- Sprint 66 Execution Plan: `planning/sprint-66-pshifz/execution-plan.md`
- Sprint 66 README: `planning/sprint-66-pshifz/README.md`
- Sprint 57 Deployment Issues: `planning/sprint-57-54vza9/deployment-issues.md`
- Sprint 55 Architecture Issues: `planning/sprint-55-h17jpp/technical-architecture-issues-backlog.md`

**Appendix B: Terminology**

- **MCP SDK**: Model Context Protocol Software Development Kit
- **Schema Injection**: Process of adding missing schemas to tools at runtime
- **Fail-Open**: Design pattern where failures don't block execution (graceful degradation)
- **Tool Name Mapping**: Reverse transformation from sanitized names to original registry IDs
- **Agent-Dev**: Ephemeral execution context for coding agents (isolated environment)
- **LlmProfile**: Composable capability profile providing LLM-related methods to Bits
- **Diagnostic Logging**: Detailed logging added specifically to understand runtime behavior
- **Trace ID**: Correlation ID used to track requests across distributed system

**Appendix C: Metric Baselines (Sprint 65)**

- **Hotfixes Required**: 8
- **Failed Approaches**: 1 (jsonSchema() revert)
- **Traces Analyzed**: 5
- **System Uptime During Migration**: 100%
- **Tool Execution Success (with schemas)**: 100%
- **Tool Execution Success (without schemas)**: Variable (validation errors)
- **Deployment Cycles**: 5+
- **Time to Discover Parameter Passing Issue**: 2 deployment cycles
