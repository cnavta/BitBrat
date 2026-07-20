# Sprint 349: Environment Unification - Execution Plan

**Sprint ID**: sprint-349-environment-unification
**Start Date**: 2026-07-19
**Lead Implementor**: Claude Code
**Status**: Planning

---

## Executive Summary

This sprint implements the Environment Unification proposal (documentation/architecture/environment-unification-proposal.md), which addresses critical user experience and architectural issues in BitBrat's environment management:

**Core Problems Being Solved:**
1. **Flag Confusion**: `--env` vs `--target` inconsistency across commands
2. **Discovery Fragmentation**: Gateway URLs, ports, persistence config scattered across codebase
3. **Manual Environment Setup**: Error-prone YAML editing to add new environments
4. **Redundant Configuration**: `deploymentTargets.*.env` duplicates key names
5. **Inconsistent Resolution**: Each command implements its own environment discovery logic

**Solution: Execution Contexts**
- Single source of truth: `architecture.yaml` → `executionContexts`
- Unified CLI flag: `--context` (replaces `--env` and `--target`)
- Primary workflow: `brat use <context>` sets current context in `~/.bratrc`
- Auto-discovery: Gateway URLs, ports, persistence automatically resolved
- Self-service: `brat context create` for new environments
- Comprehensive validation: `brat context validate/ping` for health checks

**Scope**: Full implementation (Phases 1-5 from proposal)

---

## Architecture Overview

### Current State (Before Sprint 349)

```
architecture.yaml:
  deploymentTargets:
    staging:
      env: staging    # ← REDUNDANT
      type: docker-engine
      host: ssh://root@bitbrat.lan
      gateway:
        url: http://bitbrat.lan:3017

CLI Commands:
  brat deploy --env staging        # Uses --env
  brat docker up --target staging  # Uses --target
  brat chat --env staging          # Accepts both --env and --target (confusing!)

Resolution Logic:
  Each command has custom discovery:
  - docker commands → read host from deploymentTargets
  - fleet commands → read gateway.url from deploymentTargets
  - chat command → reads gateway.url (recently fixed)
  - deploy commands → hardcoded GCP project/region
```

### Target State (After Sprint 349)

```
architecture.yaml:
  executionContexts:
    staging:
      description: "Remote staging on bitbrat.lan"
      deployment:
        type: docker-compose
        docker:
          host: ssh://root@bitbrat.lan
      runtime:
        gateway:
          url: http://bitbrat.lan:3017
        persistence:
          driver: postgres
          connection: { ... }
        envOverlay:
          path: env/staging
          files: [global.yaml, infra.yaml, "{service}.yaml"]
          secure: .secure.staging

~/.bratrc:
  current_context: staging    # Set by 'brat use staging'

CLI Commands (Primary Workflow):
  brat use staging              # Set current context (persists in ~/.bratrc)
  brat deploy service llm-bot   # Uses staging (from ~/.bratrc)
  brat docker up                # Uses staging
  brat chat --message "!ping"   # Uses staging
  brat fleet list               # Uses staging

CLI Commands (Explicit Override):
  brat fleet list --context prod  # Temporarily override to prod

Resolution Logic (Centralized):
  ContextResolver.resolve(contextName):
    1. Load executionContexts[contextName] from architecture.yaml
    2. Auto-discover gateway URL (if autoDiscover: true)
    3. Resolve persistence config
    4. Load environment overlays from runtime.envOverlay
    5. Return ResolvedContext object

  Context Resolution Priority:
    1. --context flag (explicit)
    2. BITBRAT_CONTEXT env var
    3. ~/.bratrc current_context
    4. Default: 'local'
```

---

## Technical Architecture

### New Components

#### 1. ExecutionContext Schema (Zod)

**File**: `tools/brat/src/config/execution-context-schema.ts`

```typescript
import { z } from 'zod';

export const DockerDeploymentSchema = z.object({
  host: z.string().describe('Docker host (unix:// or ssh://)'),
  remoteDir: z.string().optional(),
  maxConcurrent: z.number().optional(),
});

export const GcpDeploymentSchema = z.object({
  project: z.string(),
  region: z.string(),
});

export const K8sDeploymentSchema = z.object({
  cluster: z.string(),
  namespace: z.string(),
});

export const DeploymentSchema = z.object({
  type: z.enum(['docker-compose', 'cloud-run', 'k8s']),
  docker: DockerDeploymentSchema.optional(),
  gcp: GcpDeploymentSchema.optional(),
  k8s: K8sDeploymentSchema.optional(),
});

export const GatewayConfigSchema = z.object({
  url: z.string().optional(),
  authToken: z.string().optional(),
  autoDiscover: z.boolean().optional(),
  fallbackPort: z.number().optional(),
});

export const PersistenceConnectionSchema = z.object({
  host: z.string(),
  port: z.number(),
  database: z.string(),
  username: z.string(),
  password: z.string(),
});

export const PersistenceConfigSchema = z.object({
  driver: z.enum(['postgres', 'firestore']),
  autoDiscover: z.boolean().optional(),
  connection: PersistenceConnectionSchema.optional(),
});

export const EnvOverlayConfigSchema = z.object({
  path: z.string().describe('Directory path (e.g., env/local)'),
  files: z.array(z.string()).describe('Load order (global.yaml, {service}.yaml)'),
  secure: z.string().optional().describe('Optional secrets file (.secure.local)'),
});

export const RuntimeConfigSchema = z.object({
  gateway: GatewayConfigSchema.optional(),
  persistence: PersistenceConfigSchema,
  envOverlay: EnvOverlayConfigSchema.optional(),
});

export const ExecutionContextSchema = z.object({
  description: z.string().optional(),
  deployment: DeploymentSchema,
  runtime: RuntimeConfigSchema,
  tags: z.array(z.string()).optional(),
});

export const ExecutionContextsSchema = z.record(ExecutionContextSchema);

export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;
export type ExecutionContexts = z.infer<typeof ExecutionContextsSchema>;
```

#### 2. ContextResolver

**File**: `tools/brat/src/context/context-resolver.ts`

```typescript
export interface ResolvedContext {
  name: string;
  description?: string;
  deployment: {
    type: 'docker-compose' | 'cloud-run' | 'k8s';
    docker?: { host: string; remoteDir?: string; maxConcurrent?: number };
    gcp?: { project: string; region: string };
    k8s?: { cluster: string; namespace: string };
  };
  runtime: {
    gateway: {
      url: string;              // Always resolved (auto-discovered or explicit)
      authToken?: string;
    };
    persistence: {
      driver: 'postgres' | 'firestore';
      connection?: PersistenceConnection;
    };
    envVars: Record<string, string>;  // Merged environment overlays
  };
  tags?: string[];
}

export class ContextResolver {
  constructor(private readonly repoRoot: string) {}

  /**
   * Resolve an execution context by name
   * Priority: --context flag > BITBRAT_CONTEXT > ~/.bratrc > 'local'
   */
  async resolve(contextName?: string): Promise<ResolvedContext> {
    const name = this.resolveContextName(contextName);
    const contexts = await this.loadExecutionContexts();
    const context = contexts[name];

    if (!context) {
      throw new Error(`Unknown execution context: '${name}'`);
    }

    return {
      name,
      description: context.description,
      deployment: context.deployment,
      runtime: {
        gateway: await this.resolveGateway(context, name),
        persistence: await this.resolvePersistence(context, name),
        envVars: await this.resolveEnvironmentVars(context, name),
      },
      tags: context.tags,
    };
  }

  /**
   * Resolve context name from CLI flags, env vars, ~/.bratrc, or default
   */
  private resolveContextName(explicitContext?: string): string {
    // Priority 1: Explicit --context flag
    if (explicitContext) return explicitContext;

    // Priority 2: BITBRAT_CONTEXT env var
    if (process.env.BITBRAT_CONTEXT) return process.env.BITBRAT_CONTEXT;

    // Priority 3: ~/.bratrc current_context
    const bratrc = this.loadBratrc();
    if (bratrc?.current_context) return bratrc.current_context;

    // Priority 4: Default to 'local'
    return 'local';
  }

  /**
   * Resolve gateway URL (auto-discover or explicit)
   */
  private async resolveGateway(context: ExecutionContext, name: string) {
    const gatewayConfig = context.runtime.gateway;

    // Explicit URL
    if (gatewayConfig?.url) {
      return {
        url: gatewayConfig.url,
        authToken: gatewayConfig.authToken,
      };
    }

    // Auto-discover (Docker contexts only)
    if (gatewayConfig?.autoDiscover && context.deployment.type === 'docker-compose') {
      const discoveredPort = await this.discoverGatewayPort(context.deployment.docker!.host);
      if (discoveredPort) {
        const isLocal = context.deployment.docker!.host.includes('unix://');
        const host = isLocal ? 'localhost' : this.extractHostFromSSH(context.deployment.docker!.host);
        return {
          url: `ws://${host}:${discoveredPort}/ws/v1`,
          authToken: gatewayConfig.authToken,
        };
      }
    }

    // Fallback port
    if (gatewayConfig?.fallbackPort) {
      const host = this.extractHost(context.deployment.docker!.host);
      return {
        url: `ws://${host}:${gatewayConfig.fallbackPort}/ws/v1`,
        authToken: gatewayConfig.authToken,
      };
    }

    throw new Error(`Cannot resolve gateway URL for context '${name}'`);
  }

  /**
   * Discover api-gateway port from Docker
   */
  private async discoverGatewayPort(dockerHost: string): Promise<string | null> {
    // Implementation: SSH into remote host or use local docker ps
    // Parse output: 0.0.0.0:3004->3000/tcp → return '3004'
    // See documentation/architecture/environment-unification-proposal.md lines 528-541
  }

  /**
   * Resolve persistence config
   */
  private async resolvePersistence(context: ExecutionContext, name: string) {
    const persistence = context.runtime.persistence;

    if (persistence.driver === 'postgres' && persistence.connection) {
      return {
        driver: 'postgres' as const,
        connection: persistence.connection,
      };
    }

    if (persistence.autoDiscover && context.deployment.type === 'docker-compose') {
      // Auto-discover postgres container in same stack
      const pgConfig = await this.discoverPostgresContainer(context.deployment.docker!.host);
      if (pgConfig) return pgConfig;
    }

    if (persistence.driver === 'firestore') {
      return { driver: 'firestore' as const };
    }

    throw new Error(`Cannot resolve persistence for context '${name}'`);
  }

  /**
   * Resolve environment variables from overlays
   */
  private async resolveEnvironmentVars(context: ExecutionContext, serviceName?: string): Promise<Record<string, string>> {
    const overlayConfig = context.runtime.envOverlay;
    if (!overlayConfig) return {};

    // Reuse existing EnvironmentResolver
    const envResolver = new EnvironmentResolver(this.repoRoot);
    const merged: Record<string, string> = {};

    for (const file of overlayConfig.files) {
      const fileName = serviceName ? file.replace('{service}', serviceName) : file;
      const filePath = path.join(this.repoRoot, overlayConfig.path, fileName);
      const vars = await envResolver.loadYamlIfExists(filePath);
      Object.assign(merged, vars);
    }

    // Load secure file last (highest priority)
    if (overlayConfig.secure) {
      const secureVars = await envResolver.loadSecureLocal(overlayConfig.secure);
      Object.assign(merged, secureVars);
    }

    return merged;
  }

  private loadBratrc(): BratrcConfig | null {
    // Load ~/.bratrc (YAML format)
    // See documentation/architecture/environment-unification-proposal.md lines 717-728
  }

  private async loadExecutionContexts(): Promise<ExecutionContexts> {
    // Load architecture.yaml and extract executionContexts
    // Validate with ExecutionContextsSchema
  }
}
```

#### 3. ~/.bratrc Support

**File**: `~/.bratrc` (user home directory)

```yaml
# BitBrat user configuration
current_context: staging

preferences:
  auto_confirm_deploys: false
  default_log_level: info

history:
  last_contexts:
    - staging
    - local
    - prod
```

**Managed by**:
- `brat use <context>` - Sets current_context
- `brat current` - Reads current_context
- `tools/brat/src/config/bratrc.ts` - Load/save utilities

#### 4. Updated architecture.yaml

**Changes**:
1. Add `executionContexts` section
2. Deprecate `deploymentTargets` (warn on use, remove in Sprint 353)
3. Migrate existing `local`, `staging` configs to new schema

**Migration Command**: `brat migrate-contexts`

---

## Implementation Phases

### Phase 1: Schema & Core Infrastructure (Days 1-2)

**Goal**: Establish foundational types, schemas, and migration tooling

**Tasks**:

1. **Create ExecutionContext Zod Schema**
   - File: `tools/brat/src/config/execution-context-schema.ts`
   - Define all schemas (Deployment, Runtime, Gateway, Persistence, EnvOverlay)
   - Export TypeScript types
   - Unit tests for schema validation

2. **Update architecture.yaml Schema**
   - Add `executionContexts` to `ArchitectureSchema` (tools/brat/src/config/schema.ts)
   - Keep `deploymentTargets` optional (backward compatibility)
   - Add validation: error if both are missing, warn if deploymentTargets used

3. **Migrate Current Environments**
   - Update `architecture.yaml` with `executionContexts` section
   - Convert existing `deploymentTargets.local` → `executionContexts.local`
   - Convert existing `deploymentTargets.staging` → `executionContexts.staging`
   - Preserve all existing functionality

4. **Create Migration Tool**
   - Command: `brat migrate-contexts`
   - Reads `deploymentTargets`, converts to `executionContexts`
   - Writes updated `architecture.yaml`
   - Validates migrated config
   - Dry-run mode: `--dry-run` (show changes without writing)

**Deliverables**:
- ✅ ExecutionContextSchema.ts with comprehensive types
- ✅ Updated architecture.yaml with executionContexts
- ✅ Migration command working
- ✅ Backward compatibility layer (deploymentTargets still works)
- ✅ Unit tests passing

**Success Criteria**:
- Existing commands still work with deploymentTargets
- New executionContexts pass schema validation
- Migration tool converts all existing configs correctly

---

### Phase 2: ContextResolver Library (Days 3-4)

**Goal**: Centralized context resolution with auto-discovery

**Tasks**:

1. **Create ContextResolver Class**
   - File: `tools/brat/src/context/context-resolver.ts`
   - Implement `resolve(contextName?)` → `ResolvedContext`
   - Context name resolution priority (--context > $BITBRAT_CONTEXT > ~/.bratrc > 'local')
   - Load executionContexts from architecture.yaml
   - Validate context exists

2. **Implement Gateway URL Discovery**
   - Explicit URL (highest priority)
   - Auto-discover from Docker ps (local/remote)
   - Fallback to default port
   - Error handling for unreachable gateways

3. **Implement Persistence Resolution**
   - Explicit connection config
   - Auto-discover postgres container (Docker contexts)
   - Firestore config resolution
   - Validation: test database connectivity

4. **Integrate Environment Overlay Resolution**
   - Reuse existing `EnvironmentResolver` class
   - Load files in order (global.yaml → infra.yaml → {service}.yaml → .secure.*)
   - Merge overlays correctly (later overrides earlier)
   - Handle {service} placeholder replacement

5. **Add ~/.bratrc Support**
   - File: `tools/brat/src/config/bratrc.ts`
   - `loadBratrc()` - Read ~/.bratrc (YAML format)
   - `saveBratrc(config)` - Write ~/.bratrc atomically
   - `getCurrentContext()` - Read current_context from ~/.bratrc
   - `setCurrentContext(name)` - Update current_context

6. **Caching & Performance**
   - Cache resolved contexts per CLI invocation
   - Invalidate cache on architecture.yaml changes
   - Avoid repeated SSH/Docker calls

**Deliverables**:
- ✅ ContextResolver class fully implemented
- ✅ Auto-discovery working for local + remote Docker
- ✅ Environment overlays loaded correctly
- ✅ ~/.bratrc load/save utilities
- ✅ Integration tests (mock Docker/SSH)

**Success Criteria**:
- `ContextResolver.resolve('staging')` returns complete ResolvedContext
- Gateway URL auto-discovered from Docker ps
- Environment overlays merged in correct order
- ~/.bratrc current_context used when no --context flag provided

---

### Phase 3: CLI Unification (Days 5-7)

**Goal**: Update all commands to use ContextResolver and --context flag

**Tasks**:

1. **Update Global Argument Parser**
   - File: `tools/brat/src/cli/parse-args.ts`
   - Add `--context <name>` global flag
   - Deprecate `--env` and `--target` (warn on use)
   - Resolve context early: `const context = await ContextResolver.resolve(flags.context)`
   - Pass `context` to command handlers

2. **Create Backward Compatibility Layer**
   - Detect `--env` or `--target` usage
   - Warn: "⚠️  --env is deprecated, use --context or 'brat use <context>'"
   - Map to `--context` internally (transparent redirect)
   - Set deprecation timeline in warning message

3. **Implement Top-Level Context Commands**
   - **`brat use <context>`** (MOST IMPORTANT)
     - Set current context in ~/.bratrc
     - Validate context exists
     - Print confirmation: "Switched to context 'staging'"

   - **`brat current`**
     - Print current context (from ~/.bratrc or default)
     - Show source: "staging (from ~/.bratrc)" or "local (default)"

4. **Update Existing Commands to Use ContextResolver**

   **Affected Commands** (update signature: `(context, flags, rest)`):

   - **`deploy service`** (tools/brat/src/commands/deploy/service.ts)
     - Use `context.deployment.gcp` or `context.deployment.docker`
     - Use `context.runtime.envVars` for service environment variables
     - Remove hardcoded GCP project/region

   - **`docker up/down/logs/ps`** (tools/brat/src/commands/docker/*.ts)
     - Use `context.deployment.docker.host`
     - Use `context.deployment.docker.remoteDir`
     - Use `context.deployment.docker.maxConcurrent`

   - **`chat`** (tools/brat/src/commands/chat.ts)
     - Use `context.runtime.gateway.url`
     - Use `context.runtime.gateway.authToken`
     - Remove manual URL construction

   - **`fleet *`** (tools/brat/src/commands/fleet/*.ts)
     - Use `context.runtime.gateway.url`
     - Use `context.runtime.gateway.authToken`

   - **`backup`** (tools/brat/src/commands/backup.ts)
     - Use `context.runtime.persistence`

   - **`dev-mcp`** (tools/brat/src/commands/dev-mcp.ts)
     - Use `context.runtime.gateway.url`
     - Use `context.runtime.gateway.authToken`

5. **Update Help Text**
   - All commands: Add `--context <name>` to usage
   - Add deprecation notice for `--env` and `--target`
   - Document context resolution priority
   - Add examples using `brat use` workflow

**Deliverables**:
- ✅ All commands support `--context` flag
- ✅ `brat use` and `brat current` implemented
- ✅ Backward compatibility warnings active
- ✅ All commands use ContextResolver (no custom discovery logic)
- ✅ Help text updated

**Success Criteria**:
- `brat use staging && brat docker up` uses staging context
- `brat deploy service llm-bot --context prod` overrides current context
- `brat chat --env staging` shows deprecation warning but works
- All commands resolve gateway URL, persistence, env vars from context

---

### Phase 4: Context Management Commands (Days 8-10)

**Goal**: Full CRUD for execution contexts + validation/health checks

**Tasks**:

1. **Implement `brat context list`**
   - List all execution contexts from architecture.yaml
   - Table format: NAME | TYPE | DESCRIPTION | TAGS
   - Highlight current context (from ~/.bratrc)
   - Sort by name

2. **Implement `brat context show <name>`**
   - Display full YAML dump of executionContexts[name]
   - Redact sensitive values (passwords, tokens)
   - Show resolved values (interpolated env vars)
   - Option: `--raw` (show exact YAML, no redaction)

3. **Implement `brat context create <name>`**
   - Interactive wizard mode (default)
   - Non-interactive mode (all flags provided)
   - Prompts:
     - Description
     - Deployment type (docker-compose, cloud-run, k8s)
     - Docker host (if docker-compose)
     - Gateway URL or auto-discover
     - Persistence driver (postgres, firestore)
     - Database connection (if postgres)
     - Tags
   - Validation: check context name doesn't exist
   - Write to architecture.yaml
   - Create `env/<context>/` directory structure
   - Template files: global.yaml, infra.yaml, .secure.<context>

4. **Implement `brat context delete <name>`**
   - Safety prompt: "Delete context 'llm-test'? This cannot be undone. [y/N]"
   - Remove from architecture.yaml
   - Optionally delete env/<context>/ directory (prompt)
   - Update ~/.bratrc if deleted context was current

5. **Implement `brat context validate <name>`**
   - Schema validation (executionContexts[name] matches schema)
   - Required secrets check (MCP_AUTH_TOKEN, DB_PASSWORD present in env)
   - Gateway URL reachable (HTTP GET /healthz)
   - Database connection test
   - Migration version check (database up-to-date)
   - Output: ✓/✗ for each check

6. **Implement `brat context ping <name>`**
   - Test connectivity to all components:
     - Docker host (if docker-compose): `docker ps` succeeds
     - Gateway: HTTP GET /healthz returns 200
     - Database: connection test
   - Output:
     ```
     ✓ Docker host: ssh://root@bitbrat.lan (reachable)
     ✓ Gateway: http://bitbrat.lan:3017 (200 OK, version 0.14.4)
     ✓ Database: bitbrat.lan:5432/bitbrat (connected, 147 tables)
     ```

**Deliverables**:
- ✅ `brat context list/show/create/delete` working
- ✅ `brat context validate/ping` with comprehensive checks
- ✅ Interactive wizard for `create` command
- ✅ Safety prompts for destructive operations
- ✅ ~/.bratrc updated when deleting current context

**Success Criteria**:
- `brat context create llm-test` walks through wizard successfully
- `brat context list` shows all contexts with current highlighted
- `brat context validate staging` catches missing secrets
- `brat context ping prod` confirms connectivity

---

### Phase 5: Documentation & Polish (Days 11-12)

**Goal**: Comprehensive documentation, migration guide, examples

**Tasks**:

1. **Update CLAUDE.md**
   - Add "Environment Management" section
   - Document `brat use` workflow (primary)
   - Document `--context` flag (explicit override)
   - Document context resolution priority
   - Add examples

2. **Create Migration Guide**
   - File: `documentation/guides/context-migration.md`
   - Step-by-step migration from deploymentTargets
   - Before/after examples
   - Troubleshooting common issues
   - Deprecation timeline

3. **Update Command Help Text**
   - All commands: Complete `--context` documentation
   - Add examples using `brat use` workflow
   - Deprecation notices for `--env`/`--target`

4. **Update README.md**
   - Add "Managing Environments" section
   - Quick examples: `brat use`, `brat context create`
   - Link to full documentation

5. **Create Tutorial**
   - File: `documentation/tutorials/creating-execution-context.md`
   - Step-by-step: Create new LLM testing environment
   - Deploy to new context
   - Validate and test
   - Screenshots (optional)

6. **Update Architecture Documentation**
   - File: `documentation/architecture/execution-contexts.md`
   - Technical deep-dive: schema, resolution logic, auto-discovery
   - Design decisions
   - Extension points (new deployment types)

7. **Add CHANGELOG Entry**
   - Section: "Environment Unification (Sprint 349)"
   - Breaking changes
   - Migration guide link
   - Deprecation timeline

**Deliverables**:
- ✅ CLAUDE.md updated with new patterns
- ✅ Migration guide complete
- ✅ All help text updated
- ✅ Tutorial written
- ✅ Architecture docs updated
- ✅ CHANGELOG entry added

**Success Criteria**:
- New users can follow tutorial to create first context
- Existing users can migrate with migration guide
- All documentation accurate and complete

---

## Testing Strategy

### Unit Tests

**Coverage**:
- ExecutionContextSchema validation (all fields, required/optional)
- ContextResolver.resolve() with various inputs
- Gateway URL discovery (auto, explicit, fallback)
- Persistence resolution (postgres, firestore, auto-discover)
- Environment overlay merging
- ~/.bratrc load/save
- Context name resolution priority

**Files**:
- `tools/brat/src/config/execution-context-schema.test.ts`
- `tools/brat/src/context/context-resolver.test.ts`
- `tools/brat/src/config/bratrc.test.ts`

### Integration Tests

**Scenarios**:
1. **Full workflow**: `brat use staging && brat docker up`
2. **Override**: Current context = local, `--context staging` overrides
3. **Auto-discovery**: Gateway URL discovered from Docker ps
4. **Environment overlays**: Correct merge order (global → infra → service → secure)
5. **Migration**: `brat migrate-contexts` converts deploymentTargets correctly
6. **Context CRUD**: Create → validate → ping → delete context

**Files**:
- `tools/brat/src/__tests__/integration/context-resolution.test.ts`
- `tools/brat/src/__tests__/integration/context-management.test.ts`

### Manual Testing

**Test Cases**:

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Set current context | `brat use staging` | ~/.bratrc updated, confirmation printed |
| Use implicit context | `brat use local && brat docker up` | Docker stack deployed to local |
| Override context | `brat use staging && brat fleet list --context prod` | Fleet list shows prod, next command reverts to staging |
| Auto-discover gateway | `brat chat --message "!ping"` (local context) | Gateway URL auto-discovered from docker ps |
| Create new context | `brat context create llm-test` (interactive) | New context added to architecture.yaml, env/ dirs created |
| Validate context | `brat context validate staging` | All checks pass (schema, secrets, connectivity) |
| Migration | `brat migrate-contexts --dry-run` | Shows correct conversion from deploymentTargets |
| Backward compat | `brat docker up --target staging` | Works, shows deprecation warning |

### Regression Testing

**Ensure existing functionality preserved**:
- All existing commands work with current context resolution
- Deployment to GCP Cloud Run still works
- Docker commands to remote hosts still work
- Fleet commands still discover gateway URLs
- Backup/restore uses correct persistence config

---

## Migration Strategy

### Backward Compatibility

**Timeline**:
- **Sprint 349** (this sprint): Both `executionContexts` and `deploymentTargets` work
- **Sprint 350-352**: Deprecation warnings increase, encourage migration
- **Sprint 353**: Remove `deploymentTargets`, `--env`, `--target` flags

**Compatibility Layer**:
1. If `executionContexts` exists: use it (new path)
2. If only `deploymentTargets` exists: map to executionContexts in-memory (legacy path)
3. If both exist: error (ambiguous config)

**Flag Mapping**:
- `--env <name>` → `--context <name>` (warn)
- `--target <name>` → `--context <name>` (warn)
- Warning message: "⚠️  --env is deprecated and will be removed in Sprint 353. Use --context or 'brat use <context>'"

### Migration Tool

**Command**: `brat migrate-contexts`

**Behavior**:
1. Read `deploymentTargets` from architecture.yaml
2. Convert each target to executionContext format
3. Write `executionContexts` section to architecture.yaml
4. Comment out `deploymentTargets` (preserve for rollback)
5. Validate new config
6. Print summary

**Dry-Run Mode**:
```bash
brat migrate-contexts --dry-run
# Output: Shows diff (before/after) without writing
```

**Example Migration**:

```yaml
# Before
deploymentTargets:
  staging:
    type: docker-engine
    host: ssh://root@bitbrat.lan
    env: staging
    gateway:
      url: http://bitbrat.lan:3017

# After
executionContexts:
  staging:
    description: "Migrated from deploymentTargets"
    deployment:
      type: docker-compose
      docker:
        host: ssh://root@bitbrat.lan
    runtime:
      gateway:
        url: http://bitbrat.lan:3017
      persistence:
        driver: firestore  # Preserve existing default
      envOverlay:
        path: env/staging
        files: [global.yaml, infra.yaml, "{service}.yaml"]

# deploymentTargets:  # Commented for rollback
#   staging:
#     type: docker-engine
#     ...
```

### User Communication

**Announcement** (Sprint 349 completion):
1. Post to team chat: "Environment unification landed in Sprint 349"
2. Link to migration guide
3. Demo video: `brat use` workflow
4. Office hours: Q&A session

**Deprecation Warnings** (Sprint 350-352):
- Increase warning verbosity over sprints
- Add link to migration guide in warnings
- Track usage metrics (how many users still use old flags)

**Removal** (Sprint 353):
- Remove `deploymentTargets` from schema
- Remove `--env` and `--target` flags
- Error message: "Use --context instead. See migration guide: [link]"

---

## Risk Assessment

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Breaking existing deployments** | High | Medium | Backward compatibility layer (3-sprint deprecation period), migration tool, extensive testing |
| **Auto-discovery fails edge cases** | Medium | Medium | Explicit `gateway.url` always overrides, fallback logic, clear error messages |
| **Performance regression** (repeated context resolution) | Low | Low | Cache resolved contexts per CLI invocation, benchmark against current implementation |
| **Schema complexity** | Medium | Low | Comprehensive Zod validation, unit tests, clear error messages |
| **Migration tool bugs** | High | Medium | Dry-run mode, extensive testing, preserve original config (comment out), rollback plan |
| **User adoption resistance** | Medium | Medium | Clear documentation, migration guide, demo video, office hours |
| **~/.bratrc conflicts** (multi-user systems) | Low | Low | Per-user file (~/.bratrc), clear docs on BITBRAT_CONTEXT for CI/CD |
| **Environment variable interpolation failures** | Medium | Low | Validate required env vars before resolution, clear error messages |

**Rollback Plan**:
1. Keep `deploymentTargets` commented in architecture.yaml (Sprint 349)
2. If critical issues: uncomment `deploymentTargets`, rollback code
3. Hotfix branch: revert context-related changes
4. Post-mortem: analyze failure, fix, retry in next sprint

---

## Success Metrics

### Sprint 349 Completion Criteria

**Must Have** (blocking release):
- ✅ ExecutionContextSchema validated by architecture.yaml parser
- ✅ ContextResolver.resolve() working for all contexts
- ✅ `brat use` and `brat current` implemented
- ✅ All existing commands use ContextResolver (no custom discovery)
- ✅ `brat context list/show/create` working
- ✅ Backward compatibility layer active (deploymentTargets still works)
- ✅ Migration tool: `brat migrate-contexts` functional
- ✅ Documentation: CLAUDE.md, migration guide, tutorial
- ✅ All tests passing (unit + integration)

**Should Have** (not blocking, but important):
- ✅ `brat context validate/ping` working
- ✅ Auto-discovery working for local + remote Docker
- ✅ Environment overlays loaded correctly
- ✅ ~/.bratrc support complete

**Nice to Have** (can defer to Sprint 350):
- Interactive wizard for `brat context create` (can start with flags-only)
- Video tutorial
- Advanced validation checks (migration version, etc.)

### Adoption Metrics (Sprint 350+)

**Track**:
- % of commands using `--context` vs `--env`/`--target`
- Number of times `brat use` called per week
- Number of custom contexts created (via `brat context create`)
- User feedback: confusion reduction, satisfaction

**Targets** (by Sprint 353):
- 90%+ of team using `brat use` workflow
- 0 usage of `--env`/`--target` flags
- 3+ custom contexts created (llm-test, demo, etc.)
- Zero confusion-related support tickets

---

## Dependencies

### External Dependencies
- **None** - All changes internal to BitBrat codebase

### Internal Dependencies
- **architecture.yaml schema** - Must support executionContexts
- **EnvironmentResolver** - Reuse for env overlay resolution (already exists)
- **Docker/SSH access** - Auto-discovery requires docker ps access

### Blocked By
- **None** - Can start immediately

### Blocks
- **None** - Other work can proceed in parallel

---

## Timeline

**Total Duration**: 12 days (2.4 weeks)

| Phase | Days | Start | End | Deliverables |
|-------|------|-------|-----|--------------|
| Phase 1: Schema & Core | 2 | Day 1 | Day 2 | ExecutionContextSchema, migration tool, updated architecture.yaml |
| Phase 2: ContextResolver | 2 | Day 3 | Day 4 | ContextResolver class, auto-discovery, ~/.bratrc support |
| Phase 3: CLI Unification | 3 | Day 5 | Day 7 | All commands use --context, brat use/current implemented |
| Phase 4: Context Management | 3 | Day 8 | Day 10 | brat context CRUD, validate/ping commands |
| Phase 5: Documentation | 2 | Day 11 | Day 12 | CLAUDE.md, migration guide, tutorial, CHANGELOG |

**Critical Path**: Phase 1 → Phase 2 → Phase 3 (must be sequential)
**Parallel Work**: Phase 4 can start during Phase 3 (context management commands)

---

## Open Questions & Decisions

### Q1: Should we support context inheritance?

**Proposal**:
```yaml
executionContexts:
  base-docker:
    deployment:
      type: docker-compose
    runtime:
      persistence:
        driver: postgres

  staging:
    extends: base-docker
    deployment:
      docker:
        host: ssh://root@bitbrat.lan
```

**Decision**: **Defer to Sprint 350+**
- Adds complexity to Phase 1 (schema + resolution logic)
- Use case: Reduce duplication for similar contexts
- Can add later without breaking changes

### Q2: Should we validate contexts at startup or on-demand?

**Options**:
- **Startup validation**: Load all contexts, validate schemas, catch errors early
  - Pro: Fail fast
  - Con: Slower CLI startup (load architecture.yaml every command)
- **On-demand validation**: Only validate when context is used
  - Pro: Faster startup
  - Con: Errors discovered late (when command runs)

**Decision**: **On-demand validation (lazy loading)**
- Faster CLI startup (critical for UX)
- Validation happens in ContextResolver.resolve() (when context actually used)
- `brat context validate` for explicit validation (recommended before deploys)

### Q3: How to handle secrets in context definitions?

**Current approach**: Interpolate from environment variables
```yaml
runtime:
  gateway:
    authToken: ${MCP_AUTH_TOKEN}
  persistence:
    connection:
      password: ${STAGING_DB_PASSWORD}
```

**Alternative**: Reference secret manager keys
```yaml
runtime:
  gateway:
    authToken:
      secretManager: projects/bitbrat/secrets/mcp-auth-token/versions/latest
```

**Decision**: **Keep environment variable interpolation (current approach)**
- Simpler (no GCP/AWS/Azure secret manager integration needed)
- Works across all deployment types (Docker, Cloud Run, K8s)
- Secrets stored in `.secure.<context>` (gitignored)
- Future enhancement: Add secret manager support in Sprint 350+

### Q4: Should `brat use` be top-level or `brat context use`?

**Options**:
- **Top-level**: `brat use staging` (concise, primary workflow)
- **Subcommand**: `brat context use staging` (consistent with other context commands)

**Decision**: **Top-level `brat use` and `brat current`**
- This is THE primary workflow (most common operation)
- Shorter = better UX (users switch contexts frequently)
- Precedent: `kubectl use-context`, `git checkout`
- Keep `brat context use` as alias (deprecated, redirect to top-level)

---

## Appendix: Example Workflows

### Workflow 1: Daily Developer Usage

```bash
# Morning: Start working on local
brat use local
brat docker up
brat chat --message "!ping"

# Test on staging
brat use staging
brat docker up
brat chat --message "Test query"

# Check what context I'm using
brat current
# → staging

# Deploy to prod
brat use prod
brat deploy service llm-bot

# Quick check on staging without changing context
brat fleet info --context staging

brat current
# → Still prod (--context didn't change current)
```

### Workflow 2: Creating New Environment

```bash
# Create new LLM testing environment
brat context create llm-test \
  --description "Isolated LLM testing environment" \
  --type docker-compose \
  --docker-host ssh://root@llm-test.local \
  --gateway-url http://llm-test.local:3017 \
  --persistence postgres \
  --db-host llm-test.local \
  --tags testing,llm

# Validate configuration
brat context validate llm-test

# Test connectivity
brat context ping llm-test

# Deploy to new environment
brat use llm-test
brat docker up

# Verify services running
brat fleet list
```

### Workflow 3: Debugging Environment Issues

```bash
# List all contexts
brat context list

# Show full config for staging
brat context show staging

# Ping to check connectivity
brat context ping staging
# Output:
#  ✗ SSH: root@bitbrat.lan (connection refused)
#  ✗ Gateway: unreachable
#  ✗ Database: unreachable

# Fix SSH connection, retry
brat context ping staging
# Output:
#  ✓ SSH: root@bitbrat.lan (reachable)
#  ✓ Docker: 25 containers running
#  ✓ Gateway: http://bitbrat.lan:3017 (200 OK)
#  ✓ Database: bitbrat.lan:5432/bitbrat (connected)

# Validate full config
brat context validate staging
# Output:
#  ✓ Schema valid
#  ✓ Required secrets present
#  ✓ Gateway reachable
#  ✓ Database migration up-to-date
```

---

## Appendix: File Structure

### New Files

```
tools/brat/src/
  config/
    execution-context-schema.ts   # Zod schema for ExecutionContext
    bratrc.ts                      # ~/.bratrc load/save utilities

  context/
    context-resolver.ts            # ContextResolver class
    gateway-discovery.ts           # Gateway URL auto-discovery
    persistence-discovery.ts       # Persistence auto-discovery
    types.ts                       # ResolvedContext, BratrcConfig types

  commands/
    use.ts                         # brat use <context>
    current.ts                     # brat current
    migrate-contexts.ts            # brat migrate-contexts
    context/
      list.ts                      # brat context list
      show.ts                      # brat context show
      create.ts                    # brat context create
      delete.ts                    # brat context delete
      validate.ts                  # brat context validate
      ping.ts                      # brat context ping

documentation/
  guides/
    context-migration.md           # Migration guide

  tutorials/
    creating-execution-context.md  # Step-by-step tutorial

  architecture/
    execution-contexts.md          # Technical deep-dive

~/.bratrc                          # User config (current context)
```

### Modified Files

```
architecture.yaml                  # Add executionContexts section

tools/brat/src/
  config/
    schema.ts                      # Add executionContexts to ArchitectureSchema

  cli/
    parse-args.ts                  # Add --context flag, resolve context
    index.ts                       # Register new commands

  commands/
    deploy/service.ts              # Use context.deployment, context.runtime.envVars
    docker/up.ts                   # Use context.deployment.docker
    docker/down.ts
    docker/logs.ts
    docker/ps.ts
    chat.ts                        # Use context.runtime.gateway
    fleet/*.ts                     # Use context.runtime.gateway
    backup.ts                      # Use context.runtime.persistence
    dev-mcp.ts                     # Use context.runtime.gateway

CLAUDE.md                          # Add environment management section
README.md                          # Add "Managing Environments" section
CHANGELOG.md                       # Add Sprint 349 entry
```

---

## Next Steps

1. **Review this execution plan** with team/user
2. **Approve for implementation** or request changes
3. **Start Phase 1** (Schema & Core Infrastructure)
4. **Create request-log.md** to track all prompts/actions during implementation
5. **Create validation script** to verify deliverables

**Ready to proceed?** Let me know when to start implementation.
