# Sprint 365: MCP/Agent Tools - Shared Logic Analysis

**Sprint ID**: Sprint 365
**Focus**: MCP and coding agent integration commands
**Analysis Date**: 2026-07-25

---

## Overview

This document analyzes the business logic separation for the 3 remaining MCP/Agent commands to determine which migration pattern to use:
- **Pattern 1 (Simple Delegation)**: Business logic already well-separated
- **Pattern 2 (Business Logic Module)**: Requires extraction before migration

---

## Commands Analysis

### 1. `code` - Launch Coding Agent

**Location**: `tools/brat/src/cli/code/code-command.ts`
**LOC**: 152 lines
**Export**: `cmdCode(cmd: string[], rest: string[])`

**Current Architecture**:
```typescript
// Main command handler
export async function cmdCode(cmd: string[], rest: string[]): Promise<void> {
  // 1. Register plugins (AgentRegistry)
  registerPlugins();

  // 2. Parse flags
  const flags = parseKeyValueFlags(rest);

  // 3. Discover agents
  const detected = await discoverAgents();  // From discovery/detector.ts

  // 4. Resolve agent selection
  const { agentId } = await resolveAgent(detected, agent);  // From ui/selection.ts

  // 5. Extract project context
  const projectContext = await extractProjectContext(root);  // From context/project-context.ts

  // 6. Prepare agent config
  const config = await plugin.prepareConfig(projectContext);

  // 7. Launch agent
  const child = await launchAgent(config, passThrough);  // From launcher/agent-launcher.ts

  // 8. Wait for exit
  const exitCode = await waitForAgentExit(child);
  process.exit(exitCode || 0);
}
```

**Dependencies** (well-separated modules):
- `agent-registry.ts` - Plugin registry
- `plugins/*` - Agent-specific plugins (claude-code, aider, continue, openhands)
- `discovery/detector.ts` - Agent discovery
- `ui/selection.ts` - Interactive agent selection
- `context/project-context.ts` - Project context extraction
- `launcher/agent-launcher.ts` - Agent process launcher
- `utils/bitbrat-config.ts` - First-run detection

**Pattern**: **Pattern 1 (Simple Delegation)**
**Rationale**: All business logic already well-separated into dedicated modules. The command is just an orchestrator.

**Migration Approach**:
- Create oclif command that delegates to `cmdCode()`
- No extraction needed - logic already in `cli/code/` module
- Pass flags through to legacy handler

---

### 2. `mcp setup` - Configure MCP Server

**Location**: `tools/brat/src/cli/mcp-setup.ts`
**LOC**: 189 lines
**Export**: `cmdMcpSetup(flags: McpSetupFlags)`

**Current Architecture**:
```typescript
export async function cmdMcpSetup(flags: McpSetupFlags): Promise<void> {
  // 1. Resolve config path (user/local/project)
  const configPath = getConfigPath(scope, projectRoot);

  // 2. Read existing config
  const config = readConfig(configPath);

  // 3. Build server config
  const serverConfig = buildServerConfig(flags, projectRoot);

  // 4. Update config
  config.mcpServers[serverName] = serverConfig;

  // 5. Write config (unless dry-run)
  if (!flags.dryRun) {
    writeConfig(configPath, config);
  }

  // 6. Output result
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(instructions.join('\n'));
  }
}
```

**Helper Functions** (in same file):
- `getConfigPath()` - Resolve config file path by scope
- `readConfig()` - Read and parse JSON config
- `writeConfig()` - Write JSON config
- `buildServerConfig()` - Build MCP server configuration object

**Pattern**: **Pattern 1 (Simple Delegation)**
**Rationale**: All logic is self-contained in a single file with clear separation. No extraction needed.

**Migration Approach**:
- Create oclif command that delegates to `cmdMcpSetup()`
- Map oclif flags to McpSetupFlags interface
- No extraction needed

---

### 3. `dev-mcp` - MCP Development Server

**Location**: `tools/brat/src/cli/dev-mcp.ts`
**LOC**: 88 lines
**Export**: `cmdDevMcp(action: string, flags: DevMcpFlags)`

**Current Architecture**:
```typescript
export async function cmdDevMcp(action: string, flags: DevMcpFlags): Promise<void> {
  // 1. Validate action
  if (action !== 'start') {
    logger.error(`Unknown dev-mcp action: ${action}`);
    process.exit(1);
  }

  // 2. Check auth token
  const authToken = process.env.MCP_DEV_TOKEN || process.env.MCP_AUTH_TOKEN;
  if (!authToken) {
    logger.error('No authentication token found');
    process.exit(1);
  }

  // 3. Create server
  const server = new DevMcpServer({
    context: contextName,
    logLevel: flags.logLevel,
    auditLogPath: flags.auditLog,
    authToken,
  });

  // 4. Handle shutdown
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 5. Start server
  await server.start();
}
```

**Dependencies**:
- `DevMcpServer` from `dev-mcp/server.ts` - Main MCP server implementation

**Pattern**: **Pattern 1 (Simple Delegation)**
**Rationale**: Minimal orchestration logic. Delegates to DevMcpServer class.

**Migration Approach**:
- Create oclif command with Args (action) and Flags
- Delegate to `cmdDevMcp()`
- No extraction needed

---

## Summary

| Command | LOC | Pattern | Extraction Required | Complexity |
|---------|-----|---------|---------------------|------------|
| `code` | 152 | Pattern 1 | ❌ No | Medium |
| `mcp setup` | 189 | Pattern 1 | ❌ No | Low |
| `dev-mcp` | 88 | Pattern 1 | ❌ No | Low |

**Overall Sprint Assessment**: 100% Pattern 1 (Simple Delegation)

---

## Key Findings

1. **All commands are Pattern 1**: No business logic extraction required
2. **Well-architected legacy code**: The `cli/code/` module is exceptionally well-separated
3. **Self-contained logic**: `mcp-setup.ts` and `dev-mcp.ts` are simple, focused modules
4. **Expected efficiency**: Should match Sprint 364's 80% efficiency gain (2h vs 4-6h estimated)

---

## Migration Strategy

### Phase 1: Create oclif commands
- Create `tools/brat/src/oclif-commands/code.ts`
- Create `tools/brat/src/oclif-commands/mcp/setup.ts`
- Create `tools/brat/src/oclif-commands/dev-mcp/start.ts`

### Phase 2: Test coverage
- Create `code.test.ts` (smoke tests)
- Create `mcp/setup.test.ts` (smoke tests)
- Create `dev-mcp/start.test.ts` (smoke tests)

### Phase 3: Validation
- Build validation (npm run build)
- Test suite (npm test)
- Manual testing (verify commands work)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking agent integrations | Low | High | Extensive manual testing with all 4 agents |
| MCP config corruption | Low | Medium | Dry-run mode testing, config backup |
| Dev MCP server startup issues | Low | Medium | Test with multiple contexts |
| First-run detection regression | Low | Low | Test first-run flow manually |

**Overall Risk**: **Low** (Pattern 1 with well-tested business logic)

---

## Estimated Effort

| Phase | Tasks | Estimated Hours |
|-------|-------|-----------------|
| Phase 1: Commands | 3 commands | 1.5h |
| Phase 2: Tests | 3 test files | 0.5h |
| Phase 3: Validation | Manual testing | 1.0h |
| **Total** | | **3.0h** |

**Note**: This is optimistic based on Pattern 1 efficiency gains. Realistic estimate: 3-4h (vs 4-6h originally planned).

---

**Analysis Complete**: Ready for implementation planning.
