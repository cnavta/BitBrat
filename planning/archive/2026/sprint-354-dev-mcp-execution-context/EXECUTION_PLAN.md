# Sprint 354: Dev MCP Execution Context Adoption - Execution Plan

## Executive Summary

The Dev MCP server currently implements a **custom target resolution system** (`TargetConnectionManager`) that partially duplicates the platform's standardized **Execution Context framework** (Sprint 349). This sprint will refactor the Dev MCP server to fully adopt the Execution Context framework, eliminating duplication and ensuring consistent environment resolution across all `brat` commands.

**Key Goal**: Replace custom `target-manager.ts` logic with `ContextResolver` from `context/context-resolver.ts`, making Dev MCP a first-class consumer of the Execution Context framework.

---

## Problem Statement

### Current State (Problematic)

The Dev MCP server (`tools/brat/src/dev-mcp/`) maintains its own target resolution:

**`target-manager.ts` (lines 88-231)**:
- Manually loads `architecture.yaml`
- Implements custom logic to resolve `executionContexts` vs `deploymentTargets` (old vs new structure)
- Duplicates persistence driver resolution (lines 122-131)
- Duplicates gateway URL resolution (lines 134-158)
- Duplicates PostgreSQL connection string construction (lines 184-214)
- Manually constructs `TargetConnection` objects
- No integration with `ContextResolver` or `~/.bratrc`

**Problems:**
1. **Code Duplication**: Logic in `target-manager.ts` duplicates `ContextResolver`, `EnvironmentResolver`, and persistence discovery
2. **Inconsistent Behavior**: Dev MCP doesn't respect `~/.bratrc` current context or `BITBRAT_CONTEXT` env var
3. **Fragile Maintenance**: Changes to Execution Context framework require manual updates to Dev MCP
4. **Missing Features**: No support for env overlays, auto-discovery, or gateway fallback logic
5. **Type Mismatch**: `TargetConnection` interface doesn't align with `ResolvedContext`

### Desired State (Sprint 354 Goal)

Dev MCP becomes a **first-class consumer** of the Execution Context framework:

**New Architecture:**
```
Dev MCP Server
  ↓
ContextResolver (tools/brat/src/context/context-resolver.ts)
  ↓
TargetConnectionAdapter (NEW: tools/brat/src/dev-mcp/adapters/context-adapter.ts)
  ↓
TargetConnection (Dev MCP tools)
```

**Benefits:**
- ✅ Single source of truth for context resolution
- ✅ Automatic support for `~/.bratrc`, `BITBRAT_CONTEXT`, `--context` flag
- ✅ Env overlay support (global.yaml, infra.yaml, service.yaml, .secure)
- ✅ Auto-discovery for gateway ports and PostgreSQL containers
- ✅ Consistent behavior with `brat docker`, `brat fleet`, `brat chat`
- ✅ Reduced maintenance burden (one less place to update)

---

## Gap Analysis

### 1. Context Resolution

| Feature | `ContextResolver` | `TargetConnectionManager` | Status |
|---------|-------------------|---------------------------|--------|
| Load from `architecture.yaml` | ✅ | ✅ | Duplicate |
| Support `executionContexts` | ✅ | ✅ (manual) | Duplicate |
| Support legacy `deploymentTargets` | ✅ | ✅ (manual) | Duplicate |
| Respect `~/.bratrc` current_context | ✅ | ❌ | **Missing in Dev MCP** |
| Respect `BITBRAT_CONTEXT` env var | ✅ | ❌ | **Missing in Dev MCP** |
| Priority resolution (flag → env → bratrc → default) | ✅ | ❌ | **Missing in Dev MCP** |
| Cache resolved contexts | ✅ | ✅ | Duplicate |

### 2. Persistence Resolution

| Feature | `ContextResolver` + Discovery | `TargetConnectionManager` | Status |
|---------|-------------------------------|---------------------------|--------|
| Detect persistence driver | ✅ | ✅ | Duplicate |
| Default to `postgres` | ✅ | ✅ | Duplicate |
| Construct `DATABASE_URL` from config | ✅ | ✅ | Duplicate |
| Auto-discover PostgreSQL container | ✅ (`discoverPostgresContainer`) | ❌ | **Missing in Dev MCP** |
| Create PostgreSQL DocumentStore | Partial | ✅ | **Dev MCP implements** |
| Create Firestore connection | Partial | ✅ | **Dev MCP implements** |

### 3. Gateway Resolution

| Feature | `ContextResolver` + Discovery | `TargetConnectionManager` | Status |
|---------|-------------------------------|---------------------------|--------|
| Load gateway URL from config | ✅ | ✅ | Duplicate |
| Auto-discover gateway port | ✅ (`discoverGatewayPort`) | ❌ | **Missing in Dev MCP** |
| Fallback to default gateway URL | ✅ | ✅ | Duplicate |
| Include auth token | ✅ | ✅ | Duplicate |

### 4. SSH and Loki Support

| Feature | `ContextResolver` | `TargetConnectionManager` | Status |
|---------|-------------------|---------------------------|--------|
| SSH connection details | ✅ | ✅ | Duplicate |
| Loki URL resolution | ❌ | ✅ | **Dev MCP implements** |
| SSH tunnel management | ❌ | ✅ (`SSHTunnelManager`) | **Dev MCP implements** |

### 5. Environment Overlay

| Feature | `ContextResolver` + `EnvironmentResolver` | `TargetConnectionManager` | Status |
|---------|-------------------------------------------|---------------------------|--------|
| Load env overlay files | ✅ | ❌ | **Missing in Dev MCP** |
| Merge global.yaml + infra.yaml + service.yaml | ✅ | ❌ | **Missing in Dev MCP** |
| Load .secure.* secrets | ✅ | ❌ | **Missing in Dev MCP** |
| Interpolate `${ENV_VAR}` | ✅ | ❌ | **Missing in Dev MCP** |

---

## Proposed Solution

### Architecture

**New Component: `ContextAdapter`**

Create an adapter that bridges `ResolvedContext` (from `ContextResolver`) to `TargetConnection` (used by Dev MCP tools).

```
┌─────────────────────────────────────────────────────────────┐
│ Dev MCP Server (server.ts)                                  │
│  - Initializes ContextResolver                              │
│  - Passes resolved context to TargetConnectionManager       │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│ ContextResolver (context/context-resolver.ts)               │
│  - Resolves context name (--context → env → bratrc → local) │
│  - Loads executionContexts from architecture.yaml           │
│  - Resolves gateway, persistence, env overlays              │
│  - Returns ResolvedContext                                  │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│ ContextAdapter (dev-mcp/adapters/context-adapter.ts)        │
│  - Converts ResolvedContext → TargetConnection              │
│  - Creates PostgreSQL DocumentStore (if postgres)           │
│  - Creates Firestore connection (if firestore)              │
│  - Sets up SSH tunnels (if needed)                          │
│  - Returns TargetConnection                                 │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│ TargetConnectionManager (target-manager.ts)                 │
│  - Caches TargetConnection objects                          │
│  - Delegates resolution to ContextAdapter                   │
│  - Manages cleanup (close connections, SSH tunnels)         │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│ Dev MCP Tools (tools/config.ts, tools/fleet.ts, etc.)       │
│  - Receive TargetConnection from TargetConnectionManager    │
│  - Use connection.store, connection.firestore, etc.         │
└─────────────────────────────────────────────────────────────┘
```

### Key Changes

#### 1. Create `ContextAdapter`

**File**: `tools/brat/src/dev-mcp/adapters/context-adapter.ts`

```typescript
import { ResolvedContext } from '../../context/types';
import { TargetConnection } from '../types';
import { PostgresDocumentStore } from '../../../../src/common/persistence/postgres-store';
import { getBackupFirestore } from '../../providers/gcp/firestore';
import { SSHTunnelManager } from '../ssh-tunnel';

export class ContextAdapter {
  private sshTunnelManager: SSHTunnelManager;

  constructor(private logger: Logger) {
    this.sshTunnelManager = new SSHTunnelManager(logger);
  }

  /**
   * Convert ResolvedContext to TargetConnection
   */
  async createConnection(resolved: ResolvedContext): Promise<TargetConnection> {
    const connection: TargetConnection = {
      name: resolved.name,
      type: this.mapDeploymentType(resolved.deployment.type),
      persistenceDriver: resolved.persistence.driver,
      gateway: resolved.gateway,
      ssh: resolved.ssh,
      loki: resolved.loki,
      cleanup: async () => {
        await this.cleanup(connection);
      }
    };

    // Initialize persistence backend
    if (resolved.persistence.driver === 'postgres') {
      connection.store = await this.createPostgresStore(resolved.persistence);
    } else if (resolved.persistence.driver === 'firestore') {
      connection.firestore = await this.createFirestoreConnection(resolved.persistence);
    }

    // Set up SSH tunnel if needed
    if (resolved.loki?.tunnel && resolved.ssh) {
      const tunnel = await this.sshTunnelManager.ensureTunnel(
        resolved.ssh.target,
        resolved.loki.tunnel.localPort,
        resolved.loki.tunnel.remotePort
      );
      connection.lokiTunnel = tunnel;
    }

    return connection;
  }

  private mapDeploymentType(type: string): TargetConnection['type'] {
    switch (type) {
      case 'docker-compose':
      case 'docker-engine':
        return 'local';
      case 'cloud-run':
      case 'gcp':
        return 'gcp';
      default:
        return 'local';
    }
  }

  private async createPostgresStore(persistence: ResolvedPersistence): Promise<any> {
    if (!persistence.connectionString) {
      throw new Error('PostgreSQL connection string not available');
    }

    const store = new PostgresDocumentStore(persistence.connectionString);
    await store.init();
    return store;
  }

  private async createFirestoreConnection(persistence: ResolvedPersistence): Promise<any> {
    if (!persistence.gcpProjectId) {
      throw new Error('GCP project ID required for Firestore');
    }

    const firestore = getBackupFirestore(persistence.gcpProjectId, persistence.databaseId);
    return {
      db: firestore,
      projectId: persistence.gcpProjectId,
      databaseId: persistence.databaseId
    };
  }

  private async cleanup(connection: TargetConnection): Promise<void> {
    if (connection.store) {
      await connection.store.close();
    }
    if (connection.lokiTunnel) {
      await this.sshTunnelManager.closeTunnel(connection.lokiTunnel.localPort);
    }
  }
}
```

#### 2. Refactor `TargetConnectionManager`

**File**: `tools/brat/src/dev-mcp/target-manager.ts`

**Changes:**
- Remove custom `connect()` logic (lines 88-231)
- Add dependency on `ContextResolver`
- Use `ContextAdapter` to create connections

```typescript
import { ContextResolver } from '../context/context-resolver';
import { ContextAdapter } from './adapters/context-adapter';

export class TargetConnectionManager {
  private connections: Map<string, TargetConnection> = new Map();
  private contextResolver: ContextResolver;
  private contextAdapter: ContextAdapter;
  private logger: Logger;

  constructor(
    repoRoot: string,
    defaultContext: string | undefined,
    defaultAuthToken: string | undefined,
    logger: Logger
  ) {
    this.logger = logger;
    this.contextResolver = new ContextResolver(repoRoot);
    this.contextAdapter = new ContextAdapter(logger);
  }

  /**
   * Get active connection for a context (creates if needed, caches for reuse)
   */
  async getActiveConnection(contextName?: string): Promise<TargetConnection> {
    // Resolve context using ContextResolver
    const resolved = await this.contextResolver.resolve(contextName);

    // Check cache
    if (this.connections.has(resolved.name)) {
      this.logger.debug({ context: resolved.name }, 'Reusing cached connection');
      return this.connections.get(resolved.name)!;
    }

    // Create new connection via adapter
    this.logger.info({ context: resolved.name }, 'Establishing new connection');
    const connection = await this.contextAdapter.createConnection(resolved);

    // Cache it
    this.connections.set(resolved.name, connection);

    return connection;
  }

  async disconnectAll(): Promise<void> {
    for (const [name, connection] of this.connections.entries()) {
      this.logger.debug({ context: name }, 'Disconnecting');
      await connection.cleanup();
    }
    this.connections.clear();
  }
}
```

#### 3. Update `DevMcpServer` Constructor

**File**: `tools/brat/src/dev-mcp/server.ts`

**Changes:**
- Pass `repoRoot` to `TargetConnectionManager`
- Remove `target` option (use `context` instead)

```typescript
constructor(options: DevMcpServerOptions = {}) {
  this.logger = createLogger({
    base: { component: 'dev-mcp-server' },
    level: options.logLevel || 'info'
  });

  // Store auth token
  this.authToken = options.authToken;

  // Initialize MCP server
  this.server = new Server(/* ... */);

  // Initialize components
  const repoRoot = this.findRootDir();
  this.targetManager = new TargetConnectionManager(
    repoRoot,
    options.context,  // Changed from options.target
    this.authToken,
    this.logger
  );

  this.toolRouter = new ToolRouter(this.targetManager, this.logger);
  this.auditLogger = new AuditLogger(options.auditLogPath, this.logger);

  // Register tools and handlers
  this.registerTools();
  this.registerHandlers();

  this.logger.info({
    defaultContext: options.context,
    logLevel: options.logLevel,
  }, 'Dev MCP server initialized');
}
```

#### 4. Update `DevMcpServerOptions`

**File**: `tools/brat/src/dev-mcp/types.ts`

```typescript
export interface DevMcpServerOptions {
  /** Default execution context name */
  context?: string;  // Changed from target

  /** @deprecated Use context instead */
  target?: string;

  /** Log level */
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  /** Audit log path */
  auditLogPath?: string;
  /** Authentication token */
  authToken?: string;
}
```

#### 5. Update CLI Command

**File**: `tools/brat/src/cli/dev-mcp.ts`

```typescript
export interface DevMcpFlags {
  context?: string;  // Changed from target
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  auditLog?: string;
}

export async function cmdDevMcp(
  action: string,
  flags: DevMcpFlags
): Promise<void> {
  // ... validation ...

  // Create and start server
  const server = new DevMcpServer({
    context: flags.context,  // Changed from target
    logLevel: flags.logLevel,
    auditLogPath: flags.auditLog,
    authToken,
  });

  // ... rest ...
}
```

#### 6. Update Tool Argument Schema

**Files**: All tool definitions in `tools/brat/src/dev-mcp/tools/*.ts`

**Change**: Replace `target` with `context` in input schemas:

```typescript
// Before
const LogsInputSchema = z.object({
  target: z.string().optional(),
  // ... other fields
});

// After
const LogsInputSchema = z.object({
  context: z.string().optional(),  // Changed from target
  // ... other fields
});
```

---

## Implementation Phases

### Phase 1: Create Context Adapter (P0 - Critical)

**Tasks:**
1. Create `tools/brat/src/dev-mcp/adapters/context-adapter.ts`
2. Implement `createConnection()` method
3. Implement PostgreSQL store creation
4. Implement Firestore connection creation
5. Implement SSH tunnel setup
6. Implement cleanup logic
7. Add unit tests

**Duration**: 4 hours

### Phase 2: Refactor TargetConnectionManager (P0 - Critical)

**Tasks:**
1. Add `ContextResolver` dependency
2. Add `ContextAdapter` dependency
3. Refactor `getActiveConnection()` to use resolver + adapter
4. Remove custom `connect()` method (lines 88-231)
5. Remove `findRootDir()` helper (no longer needed)
6. Update cleanup logic
7. Add integration tests

**Duration**: 3 hours

### Phase 3: Update Dev MCP Server (P0 - Critical)

**Tasks:**
1. Update `DevMcpServerOptions` interface
2. Update constructor to pass `repoRoot` to `TargetConnectionManager`
3. Update constructor to use `options.context` instead of `options.target`
4. Add deprecation warning for `options.target`
5. Update tests

**Duration**: 2 hours

### Phase 4: Update CLI Command (P1 - High Priority)

**Tasks:**
1. Update `DevMcpFlags` interface
2. Update `cmdDevMcp()` to use `context` flag
3. Add deprecation warning for `--target` flag
4. Update usage documentation
5. Update tests

**Duration**: 1 hour

### Phase 5: Update Tool Schemas (P1 - High Priority)

**Tasks:**
1. Update `config.ts` tools (change `target` → `context`)
2. Update `persistence.ts` tools (change `target` → `context`)
3. Update `fleet.ts` tools (change `target` → `context`)
4. Add backward compatibility (accept both `target` and `context`)
5. Update tool documentation
6. Update tests

**Duration**: 2 hours

### Phase 6: Integration Testing (P1 - High Priority)

**Tasks:**
1. Test with `--context local`
2. Test with `--context staging`
3. Test with `BITBRAT_CONTEXT` env var
4. Test with `~/.bratrc` current_context
5. Test auto-discovery (gateway port, PostgreSQL container)
6. Test env overlay loading
7. Test SSH tunnels (if applicable)
8. Test backward compatibility (`--target` flag)

**Duration**: 3 hours

### Phase 7: Documentation Updates (P2 - Medium Priority)

**Tasks:**
1. Update `documentation/guides/coding-with-brat-code.md`
2. Update `CLAUDE.md` Dev MCP section
3. Update `tools/brat/README.md` (if exists)
4. Create migration guide for `--target` → `--context`
5. Update inline code comments

**Duration**: 2 hours

### Phase 8: Cleanup and Deprecation (P2 - Medium Priority)

**Tasks:**
1. Mark `target` parameter as deprecated in types
2. Add deprecation warnings to CLI
3. Add deprecation warnings to tool schemas
4. Plan removal timeline (3 sprints from now)
5. Update backlog with removal task

**Duration**: 1 hour

---

## Testing Strategy

### Unit Tests

**New Files:**
- `tools/brat/src/dev-mcp/adapters/context-adapter.test.ts`
  - Test `createConnection()` with PostgreSQL config
  - Test `createConnection()` with Firestore config
  - Test SSH tunnel setup
  - Test cleanup logic

**Updated Files:**
- `tools/brat/src/dev-mcp/target-manager.test.ts`
  - Test context resolution delegation
  - Test connection caching
  - Test cleanup

### Integration Tests

**New Files:**
- `tools/brat/src/dev-mcp/__tests__/context-integration.test.ts`
  - Test full context resolution flow
  - Test with different execution contexts (local, staging)
  - Test with `~/.bratrc`
  - Test with `BITBRAT_CONTEXT` env var
  - Test auto-discovery features

### Manual Testing

**Checklist:**
- [ ] Start Dev MCP server with `--context local`
- [ ] Start Dev MCP server with `--context staging`
- [ ] Start Dev MCP server with `BITBRAT_CONTEXT=staging`
- [ ] Start Dev MCP server with `~/.bratrc` set to staging
- [ ] Verify PostgreSQL connection works
- [ ] Verify Firestore connection works (if legacy context)
- [ ] Verify SSH tunnel works (if remote context)
- [ ] Verify gateway auto-discovery works
- [ ] Verify fleet tools work
- [ ] Verify config tools work
- [ ] Verify persistence tools work
- [ ] Verify backward compatibility (`--target` flag)

---

## Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| Breaking change for existing users | High | High | Add backward compatibility, deprecation warnings, migration guide |
| Context resolution bugs | High | Medium | Comprehensive testing, reuse proven `ContextResolver` |
| Performance regression | Low | Low | Cache connections as before, minimal overhead from adapter |
| SSH tunnel issues | Medium | Low | Reuse existing `SSHTunnelManager`, thorough testing |
| Missing Loki support in ContextResolver | Medium | High | Add Loki config to `ResolvedContext` if needed (see open question) |

---

## Success Criteria

### Functional
- ✅ Dev MCP server uses `ContextResolver` for all context resolution
- ✅ `--context` flag works for all tools
- ✅ `BITBRAT_CONTEXT` env var works
- ✅ `~/.bratrc` current_context works
- ✅ Auto-discovery works (gateway port, PostgreSQL container)
- ✅ Env overlay loading works (global.yaml, infra.yaml, service.yaml, .secure)
- ✅ Backward compatibility maintained (`--target` → `--context` migration)

### Code Quality
- ✅ No code duplication between Dev MCP and Execution Context framework
- ✅ All new code has unit tests (>90% coverage)
- ✅ Integration tests pass
- ✅ No regressions in existing functionality

### Documentation
- ✅ Migration guide created
- ✅ CLAUDE.md updated
- ✅ Coding guides updated
- ✅ Deprecation notices added

---

## Open Questions

1. **Loki Configuration**: Should `ResolvedContext` include Loki URL/tunnel config, or should this remain Dev MCP-specific?
   - **Recommendation**: Add optional `loki` field to `ResolvedContext` for consistency
   - **Rationale**: Other commands may need Loki access in the future (e.g., `brat logs`)

2. **Firestore Deprecation**: Should we mark Firestore support as deprecated in Dev MCP?
   - **Recommendation**: Yes, add deprecation warning when Firestore driver is used
   - **Rationale**: Aligns with Sprint 353 (PostgreSQL default)

3. **Auth Token Handling**: Should auth token come from `ResolvedContext.gateway.authToken` or remain a separate option?
   - **Recommendation**: Use `ResolvedContext.gateway.authToken` as primary, fall back to option
   - **Rationale**: Single source of truth for gateway config

4. **Backward Compatibility Duration**: How long should we support `--target` flag?
   - **Recommendation**: 3 sprints (deprecation warning → removal)
   - **Rationale**: Matches platform deprecation policy

---

## Dependencies

### Prerequisites
- Sprint 349 (Execution Context framework) ✅ Complete
- Sprint 353 (PostgreSQL default) ✅ Complete
- `ContextResolver` API stable ✅ Yes

### Blocking Issues
None

### Related Work
- Sprint 349: Execution Context unification
- Sprint 353: PostgreSQL default persistence
- Environment overlay refactor (planning/environment-overlay-refactor.md)

---

## Timeline

**Total Estimated Effort**: 18 hours (2-3 days)

**Breakdown:**
- Phase 1 (Context Adapter): 4 hours
- Phase 2 (TargetConnectionManager): 3 hours
- Phase 3 (Dev MCP Server): 2 hours
- Phase 4 (CLI Command): 1 hour
- Phase 5 (Tool Schemas): 2 hours
- Phase 6 (Integration Testing): 3 hours
- Phase 7 (Documentation): 2 hours
- Phase 8 (Cleanup): 1 hour

**Sprint Duration**: 2-3 days

---

## Next Steps

1. **Review and Approval**: Get stakeholder sign-off on execution plan
2. **Create Sprint Branch**: `feature/dev-mcp-execution-context`
3. **Implement Phase 1**: Create `ContextAdapter`
4. **Implement Phase 2**: Refactor `TargetConnectionManager`
5. **Implement Phase 3**: Update `DevMcpServer`
6. **Continue phases 4-8**: CLI, tools, testing, docs, cleanup
7. **Create PR**: Merge to main after validation

---

**Document Status**: Draft
**Created**: 2026-07-22
**Lead Implementor**: Claude Code
