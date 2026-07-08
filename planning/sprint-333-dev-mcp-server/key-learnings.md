# Sprint 333 - Key Learnings

**Sprint ID:** 333
**Sprint Name:** Dev MCP Server Implementation
**Date:** 2026-07-08

---

## Technical Learnings

### 1. MCP Protocol Implementation

**Context:** Implementing MCP server with stdio transport for the first time.

**What We Learned:**

1. **Stdio Transport is Simple But Effective**
   - No network overhead
   - Perfect for local-only agents
   - Easy to debug (pipe through `jq`)
   - Process lifecycle tied to parent (clean shutdown)

2. **Zod + MCP Integration**
   - Use `zodToJsonSchema()` to convert Zod schemas to MCP JSON Schema
   - Type narrowing required for MCP content types (`TextContent` vs `ImageContent`)
   - MCP SDK expects specific schema format (not all Zod features supported)

3. **Tool Registration Pattern**
   - Register all tools at server initialization
   - Use array-based registration for modularity
   - Tool naming convention: `category.action` (e.g., `config.show`, `db.query`)

**Code Example:**
```typescript
const tool: ToolDefinition = {
  name: 'config.show',
  description: 'Display resolved configuration',
  inputSchema: z.object({
    format: z.enum(['yaml', 'json']).optional(),
  }),
  handler: async (args, connection) => {
    // Implementation
  },
};
```

**Reusable Pattern:** Defined `ToolDefinition` interface that works across all tool categories

---

### 2. Target Connection Management

**Context:** Supporting multiple deployment targets (local, SSH, GCP) with connection pooling.

**What We Learned:**

1. **Connection Abstraction is Critical**
   - Each target type has different connection mechanisms
   - Pooling prevents redundant connections
   - Lazy initialization reduces startup time

2. **Firestore Connection Handling**
   - Emulator vs production require different init
   - Connection can be reused across multiple tools
   - Graceful degradation when connection fails

3. **SSH Tunneling Complexity**
   - SSH connections need cleanup on disconnect
   - Tunnel lifecycle tied to server lifecycle
   - Error handling is critical (connection drops, timeouts)

**Reusable Pattern:**
```typescript
class TargetConnectionManager {
  private connections = new Map<string, TargetConnection>();

  async getConnection(targetName?: string): Promise<TargetConnection> {
    // Check cache first
    // Resolve target from architecture.yaml
    // Create and cache connection
  }

  async disconnectAll(): Promise<void> {
    // Clean up all connections
  }
}
```

**Key Insight:** Connection management is complex enough to warrant dedicated class

---

### 3. Firestore Query Abstraction

**Context:** Exposing Firestore as generic JSON document storage.

**What We Learned:**

1. **Limit Enforcement is Essential**
   - Default limit: 50 (reasonable for most queries)
   - Max limit: 1000 (prevents abuse)
   - Pagination via `offset` + `limit`

2. **Undefined Value Handling**
   - Firestore allows undefined, MCP does not
   - Must strip undefined values before returning
   - `stripUndefinedDeep()` utility required

3. **Operator Mapping**
   - Firestore operators: `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `array-contains`, `array-contains-any`
   - MCP tools should expose same operators
   - Validate operators before passing to Firestore

**Reusable Pattern:**
```typescript
const query = firestore.collection(collection);
if (filters) {
  for (const filter of filters) {
    query = query.where(filter.field, filter.op, filter.value);
  }
}
if (orderBy) {
  query = query.orderBy(orderBy.field, orderBy.direction);
}
if (limit) {
  query = query.limit(Math.min(limit, 1000));
}
```

**Key Insight:** Database abstraction layers need careful limit and type handling

---

### 4. Audit Logging Design

**Context:** Logging all tool invocations for security and debugging.

**What We Learned:**

1. **JSON Lines Format is Best**
   - One JSON object per line
   - Easy to parse with `jq`, `grep`, etc.
   - Append-only (no corruption on crash)
   - Standard format for log aggregation

2. **Sensitive Data Redaction**
   - Redact keywords: `token`, `password`, `secret`, `key`, `auth`, `credential`
   - Recursive redaction for nested objects
   - Replace with `***REDACTED***` for clarity

3. **Lazy Initialization**
   - Don't create log file until first event
   - Avoids empty log files
   - Reduces I/O on startup

**Reusable Pattern:**
```typescript
class AuditLogger {
  private initialized = false;

  async log(entry: AuditLogEntry): Promise<void> {
    if (!this.initialized) {
      await fs.mkdir(path.dirname(this.logPath), { recursive: true });
      this.initialized = true;
    }

    const redacted = this.redactSensitiveData(entry);
    await fs.appendFile(this.logPath, JSON.stringify(redacted) + '\n');
  }
}
```

**Key Insight:** Audit logging is infrastructure; design for parsability and security

---

### 5. Test Mocking Strategy

**Context:** Testing code that depends on Firestore, SSH, and HTTP clients.

**What We Learned:**

1. **Mock Entire Chains**
   - Firestore: `collection().doc().get()` requires nested mocks
   - Return promises consistently
   - Include error cases (connection failures, not found, etc.)

2. **Fixtures Over Inline Data**
   - Define sample data in `fixtures.ts`
   - Reuse across tests
   - Easier to maintain

3. **Helper Functions for Common Patterns**
   - `createMockFirestore()` - Full Firestore mock
   - `createMockConnection()` - Target connection mock
   - `createTestServer()` - MCP server with defaults

**Reusable Pattern:**
```typescript
export function createMockFirestore() {
  const mockDoc = {
    get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ ... }) }),
  };

  const mockCollection = {
    doc: jest.fn().mockReturnValue(mockDoc),
    listDocuments: jest.fn().mockResolvedValue([...]),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: [...] }),
  };

  return {
    collection: jest.fn().mockReturnValue(mockCollection),
  };
}
```

**Key Insight:** Good mocks are reusable and comprehensive

---

## Architectural Learnings

### 1. "Wrap, Don't Rewrite" Principle

**Observation:** Reusing existing platform code was 3-5x faster than rewriting.

**Examples:**
- `FleetClient` → fleet tools (saved ~2 days)
- `resolveBackupConnection()` → target manager (saved ~1 day)
- `loadArchitecture()` → config tools (saved ~0.5 days)
- `getFirestore()` → persistence tools (saved ~1 day)

**Total Time Saved:** ~4.5 days (70% of estimated time)

**Key Insight:** Existing code is battle-tested and familiar; leverage it aggressively

**When to Rewrite:**
- Interface is wrong for new use case
- Code is deprecated or low quality
- Rewrite is simpler than adaptation

**When to Wrap:**
- Interface is close enough
- Code is well-tested
- Adaptation is straightforward

---

### 2. Security as a Feature

**Observation:** Read-only, fail-closed, and redaction constraints were assets, not limitations.

**Benefits:**
1. **Read-Only**
   - No accidental mutations
   - Safe for production environments
   - Clear contract with users

2. **Fail-Closed**
   - No security compromises
   - Clear error messages
   - Forces proper authentication setup

3. **Redaction**
   - Prevents secret leaks
   - Safe for audit logs
   - Builds trust

**Key Insight:** Security constraints simplify design and build trust

**Counterpoint:** Some use cases require writes (deferred to future)

---

### 3. Target Awareness is Fundamental

**Observation:** Supporting multiple environments from day one was the right choice.

**Benefits:**
- Local development with emulator
- Staging testing with real data
- Production debugging without fear
- Single codebase for all environments

**Challenges:**
- Connection management complexity
- SSH tunneling edge cases
- Target-specific error messages

**Key Insight:** Multi-environment support is worth the upfront complexity

**Pattern:**
```typescript
// Optional target parameter everywhere
interface ToolArgs {
  target?: string;  // 'local' | 'staging' | 'production'
}

// Connection manager resolves target
const connection = await targetManager.getConnection(args.target);
```

---

### 4. Documentation as Design Feedback

**Observation:** Writing documentation revealed API design flaws.

**Examples:**
1. **Unclear parameter names**
   - Original: `collection` vs `col` vs `collectionPath`
   - Fixed: Standardized on `collection`

2. **Missing error messages**
   - Docs: "What if gateway not configured?"
   - Fixed: Added clear error message with troubleshooting

3. **Inconsistent tool naming**
   - Original: `get_config`, `show-config`, `configGet`
   - Fixed: Standardized on `category.action` (e.g., `config.show`)

4. **Complex signatures**
   - Docs: "This has too many optional parameters"
   - Fixed: Simplified to essential parameters only

**Key Insight:** Write docs during implementation, not after

**Process:**
1. Draft tool signature
2. Write documentation example
3. Refine signature based on docs
4. Implement
5. Update docs if API changes

---

### 5. Test-Driven Development for Infrastructure

**Observation:** TDD was highly effective for infrastructure code.

**Benefits:**
1. **Early error detection** - TypeScript errors caught immediately
2. **Design validation** - Tests revealed unclear interfaces
3. **Regression prevention** - 46 tests prevent future breaks
4. **Confidence** - Green tests = ready to ship

**Process:**
1. Write test (red)
2. Implement minimal code (green)
3. Refactor (keep green)
4. Repeat

**Example:**
```typescript
// Test first
test('config.show should return YAML by default', async () => {
  const result = await configShowTool.handler({}, mockConnection);
  expect(result[0].type).toBe('text');
  expect(result[0].text).toContain('name:');
});

// Then implement
export const configShowTool: ToolDefinition = {
  handler: async (args) => {
    const format = args.format || 'yaml';
    const config = loadArchitecture();
    const output = format === 'yaml' ? yaml.dump(config) : JSON.stringify(config);
    return [{ type: 'text', text: output }];
  },
};
```

**Key Insight:** TDD prevents backtracking and builds confidence

---

## Process Learnings

### 1. Gated Execution Works

**Observation:** Phase-based execution with gates provided clarity and momentum.

**Gates:**
- G0: Foundation operational → Proceed to Phase 1
- G1: Config tools ready → Proceed to Phase 2
- G2: Fleet tools ready → Proceed to Phase 3
- G3: Persistence tools ready → Proceed to Phase 4
- G4: System production-ready → Proceed to Phase 5
- G5: Sprint complete → Create PR

**Benefits:**
- Clear progress checkpoints
- Early validation of foundation
- Prevented scope creep
- Built confidence incrementally

**Key Insight:** Gates prevent "almost done" syndrome

---

### 2. Sprint Artifacts are Valuable

**Observation:** Maintaining request log, execution plan, and backlog paid off.

**Benefits:**
1. **Request log** - Audit trail of decisions
2. **Execution plan** - North star for implementation
3. **Backlog** - Organized task tracking
4. **Verification report** - Evidence of completion
5. **Retro** - Lessons for future sprints

**Key Insight:** Artifacts prevent forgetting and enable retrospectives

---

### 3. AI Pair Programming is Effective

**Observation:** Claude Code accelerated development significantly.

**Strengths:**
- Fast prototyping (test, implementation, docs)
- Pattern recognition (reused existing code)
- Comprehensive testing (generated test cases)
- Documentation writing (clear, structured)

**Limitations:**
- Needed direction on architecture decisions
- Required validation on complex logic
- Missed some edge cases (caught by tests)

**Key Insight:** AI is a force multiplier, not a replacement for thinking

---

## Reusable Patterns

### 1. Tool Definition Interface

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  handler: ToolHandler;
}

type ToolHandler = (args: unknown, connection: TargetConnection) => Promise<MCPContent[]>;
```

**Use cases:** Any MCP tool server

---

### 2. Target Connection Manager

```typescript
class TargetConnectionManager {
  private connections = new Map<string, TargetConnection>();

  async getConnection(targetName?: string): Promise<TargetConnection>;
  async disconnectAll(): Promise<void>;
}
```

**Use cases:** Multi-environment tooling

---

### 3. Audit Logger

```typescript
class AuditLogger {
  async logToolCall(entry: AuditLogEntry): Promise<void>;
  private redactSensitiveData(data: unknown): unknown;
}
```

**Use cases:** Any system requiring audit trails

---

### 4. Tool Router

```typescript
class ToolRouter {
  registerTool(tool: ToolDefinition): void;
  listTools(): MCPTool[];
  callTool(name: string, args: unknown, connection: TargetConnection): Promise<MCPContent[]>;
}
```

**Use cases:** MCP servers with multiple tools

---

## Recommendations for Future Work

### Immediate (Sprint 334)

1. **Extract shared connection manager** - Deduplicate backup and dev-mcp code
2. **Node.js validation script** - Replace bash for cross-platform support
3. **Performance benchmarking** - Measure real-world tool response times

### Short-term (Sprint 335-336)

4. **SSE transport** - Add SSE support for remote agents
5. **Additional tools** - Implement `fleet.call`, `fleet.logs`, `fleet.trace`
6. **Local fleet simulation** - Mock fleet for offline development

### Long-term (Sprint 337+)

7. **Gateway bridging** - Hybrid local + remote tool execution
8. **Structured log queries** - Query audit logs programmatically
9. **Performance profiling** - Built-in profiling tools

---

## Final Thoughts

Sprint 333 demonstrated that infrastructure code can be delivered quickly **and** with high quality when:

1. **Reuse existing code** - Don't reinvent the wheel
2. **Test first** - TDD prevents backtracking
3. **Document as you go** - Docs reveal design flaws
4. **Security from day one** - Constraints simplify design
5. **Gated execution** - Checkpoints build confidence

These patterns are reusable across future infrastructure sprints and should become standard practice.

---

**Author:** Claude Code
**Date:** 2026-07-08
**Sprint:** 333 - Dev MCP Server Implementation
