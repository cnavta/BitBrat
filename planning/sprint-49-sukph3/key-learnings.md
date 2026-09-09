# Sprint 49 Key Learnings

**Sprint ID**: sprint-49-sukph3
**Title**: Platform Cleanup & Bug Fixes
**Date**: 2026-09-09

---

## Critical Patterns & Insights

### 1. MCP Tool Result Format is Universal 🎯

**Pattern**: ALL MCP tools return the same standard format
```typescript
{
  content: [
    {
      type: 'text' | 'image' | 'resource',
      text?: string,      // For type: 'text'
      data?: string,      // For type: 'image' (base64)
      uri?: string,       // For type: 'resource'
    }
  ],
  isError?: boolean      // Optional error flag
}
```

**Why This Matters**:
- Universal across ALL MCP tools (platform and external)
- Defined by MCP specification (not BitBrat-specific)
- Compositions MUST reference this structure
- No automatic unwrapping by executor

**Application**:
```yaml
# ✅ CORRECT - Reference MCP standard format
$ref:
  namespace: steps
  pointer: /tool_name/content/0/text

# ❌ WRONG - Custom properties don't exist
$ref:
  namespace: steps
  pointer: /tool_name/url
```

**Impact**: Understanding this pattern **prevents entire classes of composition bugs**

---

### 2. JSON Pointer Syntax (RFC 6901) 📍

**Pattern**: JSON Pointers use `/` separators with numeric array indices

**Examples**:
```yaml
# Array access
/content/0/text          # ✅ First element of content array
/content[0]/text         # ❌ Wrong - no brackets
/content.0.text          # ❌ Wrong - no dots

# Object property access
/retrieve_notes/content  # ✅ Object property
/retrieve_notes.content  # ❌ Wrong - no dots

# Nested access
/steps/generate_image/content/0/text  # ✅ Nested path
```

**Common Mistakes**:
- Using bracket notation for arrays: `[0]` ❌
- Using dot notation for objects: `.property` ❌
- Forgetting leading slash: `content/0/text` ❌

**Reference**: [RFC 6901](https://tools.ietf.org/html/rfc6901)

---

### 3. Test Isolation with Temp Directories 🧪

**Pattern**: Use temp directories + mocking for CLI tests that create files

**Implementation**:
```typescript
it('should create config in project root', async () => {
  // 1. Create temp directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));

  // 2. Mock process.cwd()
  const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tempDir);

  try {
    // 3. Run test
    await testFunction();

    // 4. Verify in temp dir
    const configPath = path.join(tempDir, '.config.json');
    expect(fs.existsSync(configPath)).toBe(true);
  } finally {
    // 5. Restore and cleanup
    cwdSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
```

**Why It Works**:
- Prevents side effects on project files
- Each test run is isolated
- No manual cleanup needed after test failures
- Mocking ensures test uses temp location

**Application**: Use this pattern for **all tests that create files in `process.cwd()`**

---

### 4. Minimal Docker Compose for Single-Service Deploys 🐳

**Pattern**: Create minimal compose file instead of including full base file

**Problem**: Including base compose file restarts infrastructure services

**Solution**:
```typescript
// Read base compose ONLY to extract network name
const baseCompose = yaml.load(await fs.readFile(baseComposeFilePath));
const networkName = Object.keys(baseCompose.networks)[0];

// Create minimal compose with ONLY service + external network
const minimalCompose = {
  version: baseCompose.version,
  services: serviceCompose.services,  // Only this service
  networks: {
    [networkName]: {
      external: true,  // Connect to existing network
      name: networkName,
    },
  },
};

// Write to temp file (don't overwrite base)
await fs.writeFile(tempPath, yaml.dump(minimalCompose));
```

**Key Points**:
- External network prevents recreation
- Temp file prevents pollution of base files
- Only service definition included (no infrastructure)
- Cleanup in finally block

**Impact**: Enables safe single-service deployments without platform disruption

---

### 5. Fail-Open Pattern for Startup Operations 🔓

**Pattern**: Non-critical startup operations should fail gracefully

**Implementation**:
```typescript
// Execute immediate poll on startup
poll().catch((error) => {
  logger.error('initial_poll_error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  // Fail-open: Continue startup despite error
});

// Setup interval (starts regardless of initial poll result)
setInterval(poll, pollInterval);
```

**Why It Works**:
- Service starts even if initial operation fails
- Degraded operation better than no operation
- Error logged for debugging
- System self-heals on next interval

**Application**: Use for:
- ✅ Initial data loads (polling, cache warming)
- ✅ Optional feature initialization
- ✅ External service health checks
- ❌ NOT for critical dependencies (database, required config)

---

### 6. Composition Executor Stores Raw Tool Results 📦

**Insight**: The executor does NOT unwrap or transform tool results

**Implication**:
```typescript
// Tool returns this
const result = {
  content: [{ type: 'text', text: 'Hello' }]
};

// Executor stores exactly this
stepState['tool_name'] = result;

// NOT this (no automatic unwrapping)
stepState['tool_name'] = 'Hello';  // ❌
```

**Why This Matters**:
- Compositions must reference full structure
- No "magic" transformation of results
- Consistent, predictable behavior
- Enables future format extensions

**Pattern**: Always reference `/content/0/text` explicitly

---

### 7. JSON String Results Require Parsing 🔍

**Problem**: Some tools return JSON strings, not parsed objects

**Example**:
```typescript
// get_state returns
{
  content: [{
    type: 'text',
    text: '{"user.fact.key": {"value": "data", "version": 1}}'
  }]
}
```

**Current Limitation**: mcp-compose doesn't auto-parse JSON strings

**Workarounds**:
1. **Accept the string** - Use full string if acceptable for use case
2. **Tool enhancement** - Modify tool to return structured data
3. **Spec enhancement** - Add JSON parsing directive to mcp-compose

**Example Use Case**: Grockle combines the full JSON string with description, so parsing not needed

**Future**: Consider adding `jsonPath` or `parse` directive to composition spec

---

### 8. TypeScript Compilation is Fast Validation ⚡

**Pattern**: Run `npm run build` after every change for instant feedback

**Benefits**:
- Catches type errors immediately
- Validates syntax correctness
- Faster than running full test suite
- Zero runtime needed

**Workflow**:
1. Make code change
2. `npm run build` (~2-3 seconds)
3. Fix any errors
4. Run specific tests
5. Commit

**Impact**: Reduced debugging time, caught errors before runtime

---

### 9. External Network References in Docker Compose 🌐

**Pattern**: Use `external: true` to connect to existing networks

**Syntax**:
```yaml
networks:
  bitbrat-network:
    external: true
    name: bitbrat-network
```

**Why It Works**:
- Docker doesn't recreate the network
- Services join existing network
- Infrastructure services already on network
- No restart of existing containers

**Alternative (Wrong)**:
```yaml
networks:
  bitbrat-network:
    driver: bridge  # ❌ Creates new network
```

**Application**: Essential for incremental deployments

---

### 10. Backlog-Driven Development Increases Focus 📋

**Pattern**: Maintain detailed YAML backlog with task dependencies

**Structure**:
```yaml
- id: TASK-001
  priority: P0
  title: Short description
  description: Detailed requirements
  estimatedHours: 2
  status: pending
  dependencies: [OTHER-001]
  files: [path/to/file.ts]
  acceptance:
    - Criterion 1
    - Criterion 2
```

**Benefits**:
- Clear task dependencies visible
- Easy to track progress
- Facilitates parallel work
- Documents decisions

**Sprint 49 Result**: 21 tracked tasks, clear completion criteria, easy status updates

---

## Tools & Techniques That Worked

### Investigation
1. **Grep tool** - Fast codebase search for patterns
2. **Read tool** - Detailed file inspection with line numbers
3. **Code review** - Logic validation without runtime
4. **Pattern recognition** - Identified MCP format universality

### Implementation
1. **Minimal changes** - Targeted fixes, avoid scope creep
2. **Inline documentation** - Comments explain Sprint 49 changes
3. **Test-first validation** - Run tests before integration
4. **Temp files** - Clean approach for transient data

### Documentation
1. **Backlog YAML** - Structured, trackable task list
2. **Inline comments** - Explain why, not just what
3. **Verification report** - Comprehensive test results
4. **Retrospective** - Capture lessons learned

---

## Anti-Patterns to Avoid

### 1. Guessing Tool Return Formats ❌
**Wrong**: Assume tools return custom properties like `url`, `value`, `result`
**Right**: Always use MCP standard format `/content/0/text`

### 2. Running Tests from Dirty Working Directory ❌
**Wrong**: Run tests with uncommitted changes or wrong directory
**Right**: Clean working directory, run from correct location

### 3. Including Infrastructure in Service Deploys ❌
**Wrong**: Use full base compose file for single-service deploy
**Right**: Create minimal compose with external network

### 4. Blocking Startup on Optional Operations ❌
**Wrong**: Crash if initial poll/load fails
**Right**: Log error and continue with degraded operation

### 5. Not Documenting Root Causes ❌
**Wrong**: Fix bug without explaining why it happened
**Right**: Add comments, update backlog, write retrospective

---

## Reusable Code Snippets

### 1. Test Isolation Template
```typescript
it('should handle file operations', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
  const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tempDir);

  try {
    // Test code here
  } finally {
    cwdSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
```

### 2. Fail-Open Startup Template
```typescript
async start() {
  // Immediate execution with fail-open
  criticalOperation().catch((error) => {
    this.logger.error('startup_operation_failed', { error });
    // Continue anyway
  });

  // Setup regular interval
  setInterval(criticalOperation, interval);
}
```

### 3. Minimal Docker Compose Template
```typescript
const minimalCompose = {
  version: baseCompose.version || '3.8',
  services: { [serviceName]: serviceDefinition },
  networks: {
    [networkName]: {
      external: true,
      name: networkName,
    },
  },
};
```

---

## Application to Future Work

### Composition Development
- **Always use** `/content/0/text` for MCP tool results
- **Reference** JSON Pointer RFC 6901 for syntax
- **Test** compositions with real tool execution
- **Document** expected tool return formats

### Test Writing
- **Isolate** tests that create files
- **Mock** system functions like `process.cwd()`
- **Cleanup** in finally blocks
- **Validate** side effects don't affect project

### Deployment Infrastructure
- **Use** external networks for incremental deploys
- **Avoid** including infrastructure in service-specific files
- **Cleanup** temp files automatically
- **Validate** with dry-run before execution

### Service Design
- **Implement** fail-open for non-critical startup
- **Log** errors comprehensively
- **Allow** degraded operation when possible
- **Test** startup failure scenarios

---

## Knowledge Base Updates

### Documentation to Create/Update
1. ✅ **MCP Tool Format Guide** - Document standard return format
2. ✅ **JSON Pointer Reference** - Composition authoring guide
3. ✅ **Test Isolation Patterns** - Best practices for CLI tests
4. ✅ **Deployment Patterns** - Single-service vs bulk deploys
5. 📝 **Composition Examples** - Add more working examples

### Training Materials
1. **MCP Format Workshop** - Team training on tool result structure
2. **Composition Authoring Guide** - Step-by-step composition creation
3. **Test Isolation Tutorial** - How to isolate file-based tests

---

## Metrics & Benchmarks

### Performance
- **Test execution**: 13 tests in <5 seconds
- **Build time**: TypeScript compilation ~2-3 seconds
- **Investigation time**: 1 hour for 3 bugs (20 min avg)
- **Implementation time**: 3.5 hours for 4 fixes (52 min avg)

### Code Quality
- **Lines changed**: 165 total
- **Files modified**: 5
- **Test coverage**: All fixes validated
- **Documentation ratio**: ~3:1 (docs:code)

### Efficiency
- **Estimated time**: 8-12 hours
- **Actual time**: 4.5 hours
- **Efficiency gain**: 62% under budget

---

## References

1. **MCP Specification**: [Model Context Protocol](https://modelcontextprotocol.io/)
2. **JSON Pointer RFC**: [RFC 6901](https://tools.ietf.org/html/rfc6901)
3. **Docker Compose**: [External Networks](https://docs.docker.com/compose/networking/#use-a-pre-existing-network)
4. **Jest Mocking**: [Spy Functions](https://jestjs.io/docs/jest-object#jestspyonobject-methodname)

---

## Next Steps

### Immediate Application
- [x] Apply MCP format pattern to all compositions
- [x] Use test isolation pattern for CLI tests
- [x] Implement fail-open for startup operations
- [x] Document patterns in team knowledge base

### Future Enhancements
- [ ] Add JSON parsing support to mcp-compose spec
- [ ] Create composition validation tool
- [ ] Build integration test suite
- [ ] Enhance deployment orchestrator logging

---

**Key Learnings Documented**: 2026-09-09
**Documented By**: Claude (Lead Implementor)
**Status**: ✅ Complete and ready for team reference
