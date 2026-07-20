# Environment Unification - Technical Architecture Proposal

**Status**: RFC - Request for Comments
**Author**: BitBrat Architecture Team
**Date**: 2026-07-19
**Sprint**: Post-348

---

## Executive Summary

BitBrat currently suffers from **environment confusion** across CLI commands, configuration files, and subsystems. This proposal unifies environment handling under a single abstraction called **Execution Contexts**, eliminates the `--target` vs `--env` confusion, and provides a `brat context` command for creating and managing deployment environments.

**Key Improvements:**
- Single source of truth: `architecture.yaml` → `executionContexts`
- Unified CLI flag: `--context` (deprecates `--env` and `--target`)
- Automatic discovery of gateway URLs, persistence, SSH, and other environment-specific config
- Simple workflow for creating new execution contexts (e.g., LLM sandbox, testing, demos)

---

## Problem Statement

### Current Pain Points

#### 1. **Inconsistent Terminology**

```bash
# Some commands use --env
brat deploy service llm-bot --env staging

# Others use --target
brat docker up --target staging

# Chat accepts BOTH (after recent fix)
brat chat --target staging --message "!ping"
brat chat --env staging --message "!ping"

# What's the difference? Users are confused.
```

#### 2. **Duplication in architecture.yaml**

```yaml
deploymentTargets:
  local:
    type: docker-engine
    host: unix:///var/run/docker.sock
    env: local  # ← Redundant! Key name IS the environment
  staging:
    type: docker-engine
    host: ssh://root@bitbrat.lan
    env: staging  # ← Redundant!
```

The `env` field inside each target is redundant - the key name (`local`, `staging`) already identifies the environment.

#### 3. **Port/Gateway Discovery is Fragmented**

- **Docker commands**: Read `target` → `host` from `architecture.yaml`
- **Fleet commands**: Read `target` → `gateway.url` from `architecture.yaml`
- **Chat command**: (Before fix) Hardcoded URLs, (After fix) Reads `gateway.url`
- **Deploy commands**: Use `--env` to select Cloud Run environment
- **No single pattern** for "what is this environment's api-gateway URL?"

#### 4. **No Easy Way to Create New Environments**

**Current workflow** (manual, error-prone):
1. Edit `architecture.yaml` manually
2. Add `deploymentTargets.new-env` block
3. Copy/paste from existing environment
4. Remember to add `gateway.url`, `persistence`, `host`, etc.
5. Hope you didn't fat-finger a YAML key

**Desired workflow:**
```bash
brat context create llm-sandbox \
  --type docker-engine \
  --host ssh://root@llm-test.local \
  --gateway-port 3017 \
  --persistence postgres \
  --description "Isolated LLM testing environment"
```

#### 5. **Environment Variable Chaos**

- `BITBRAT_ENV` - Some commands read this
- `API_GATEWAY_HOST_PORT` - Chat command only (local)
- `MCP_AUTH_TOKEN` - Interpolated in `architecture.yaml`
- No standardization

---

## Current State Analysis

### CLI Command Matrix

| Command | Flag Used | Reads From | Discovery Logic |
|---------|-----------|------------|-----------------|
| `deploy service` | `--env` | `flags.env` → Cloud Run | Hardcoded GCP region/project |
| `docker up` | `--target` | `arch.deploymentTargets[target]` | Reads `host`, `remoteDir` |
| `chat` | `--env` or `--target` | `arch.deploymentTargets[env]` | Reads `gateway.url` (new) |
| `fleet *` | `--target` | `arch.deploymentTargets[target]` | Reads `gateway.url`, `authToken` |
| `backup` | `--env` | `arch.deploymentTargets[env]` | Reads `persistence.*` |
| `dev-mcp` | `--target` | `arch.deploymentTargets[target]` | Reads `gateway.url` |

**Observation:** Half use `--env`, half use `--target`, all read from `deploymentTargets`, but with different logic.

### architecture.yaml Structure

```yaml
deploymentTargets:
  local:
    type: docker-engine                  # Deployment method
    host: unix:///var/run/docker.sock    # Docker connection
    env: local                           # ← REDUNDANT
    # No gateway.url (port discovery instead)
    # No persistence config (defaults to Firestore)

  staging:
    type: docker-engine
    host: ssh://root@bitbrat.lan
    env: staging                         # ← REDUNDANT
    remoteDir: /opt/BitBratPlatform
    maxConcurrent: 3
    gateway:
      url: http://bitbrat.lan:3017      # Fleet/chat/dev-mcp need this
      authToken: ${MCP_AUTH_TOKEN}
    persistence:
      driver: postgres                   # Backup/migrate need this
      host: bitbrat.lan
      port: 5432
      database: bitbrat
      username: bitbrat
      password: bitbrat_dev_password

  # prod would go here (type: gcp for Cloud Run)
```

**Issues:**
- `env` field is redundant
- No schema validation for required fields
- No discovery of api-gateway port (only explicit `gateway.url`)
- Mixed concerns: deployment (docker/gcp) + runtime (gateway/persistence)

---

## Proposed Solution: Execution Contexts

### Design Principles

1. **Single Source of Truth**: `architecture.yaml` → `executionContexts`
2. **Unified CLI Flag**: `--context` replaces both `--env` and `--target`
3. **Auto-Discovery**: Gateway URLs, ports, persistence, SSH discovered automatically
4. **Composable**: Separate deployment method from runtime configuration
5. **Extensible**: Easy to add new contexts via CLI

### New Schema: executionContexts

```yaml
# architecture.yaml

executionContexts:
  local:
    description: "Local Docker development environment"
    deployment:
      type: docker-compose
      docker:
        host: unix:///var/run/docker.sock
    runtime:
      gateway:
        autoDiscover: true              # Port discovery from docker ps
        fallbackPort: 3004
      persistence:
        driver: firestore               # Local uses Firestore emulator
        autoDiscover: true
      envOverlay:
        path: env/local                 # Environment variable overlays
        files:                          # Load order (later files override)
          - global.yaml                 # Global env vars for all services
          - infra.yaml                  # Infrastructure-specific vars
          - "{service}.yaml"            # Per-service overrides (e.g., llm-bot.yaml)
        secure: .secure.local           # Optional secrets file (gitignored)
    tags:
      - development
      - local

  staging:
    description: "Remote staging environment on bitbrat.lan"
    deployment:
      type: docker-compose
      docker:
        host: ssh://root@bitbrat.lan
        remoteDir: /opt/BitBratPlatform
        maxConcurrent: 3
    runtime:
      gateway:
        url: http://bitbrat.lan:3017    # Explicit URL
        authToken: ${MCP_AUTH_TOKEN}
      persistence:
        driver: postgres
        connection:
          host: bitbrat.lan
          port: 5432
          database: bitbrat
          username: bitbrat
          password: ${STAGING_DB_PASSWORD}
      envOverlay:
        path: env/staging
        files:
          - global.yaml
          - infra.yaml
          - "{service}.yaml"
        secure: .secure.staging         # Staging-specific secrets
    tags:
      - staging
      - remote

  prod:
    description: "Production Cloud Run environment"
    deployment:
      type: cloud-run
      gcp:
        project: ${PROJECT_ID}
        region: us-central1
    runtime:
      gateway:
        url: https://api.bitbrat.ai
        authToken: ${MCP_AUTH_TOKEN}
      persistence:
        driver: postgres
        connection:
          host: ${PROD_DB_HOST}          # Cloud SQL private IP
          port: 5432
          database: bitbrat
          username: bitbrat
          password: ${PROD_DB_PASSWORD}
    tags:
      - production
      - cloud-run

  llm-sandbox:
    description: "Isolated LLM testing environment"
    deployment:
      type: docker-compose
      docker:
        host: ssh://root@llm-test.local
        remoteDir: /opt/BitBrat-LLM
    runtime:
      gateway:
        url: http://llm-test.local:3017
        authToken: ${MCP_AUTH_TOKEN}
      persistence:
        driver: postgres
        connection:
          host: llm-test.local
          port: 5432
          database: bitbrat_llm
          username: bitbrat
          password: ${LLM_DB_PASSWORD}
    tags:
      - testing
      - llm
      - isolated

# Backward compatibility (optional migration period)
deploymentTargets: !deprecated
  # Old configs here, warn on use
```

### Environment Variable Overlays (env/)

**Current Pattern (Preserved):**

BitBrat uses a layered configuration approach via `env/{context}/` directories:

```
env/
  local/
    global.yaml       # Global vars for all services (LOG_LEVEL, MESSAGE_BUS_DRIVER)
    infra.yaml        # Infrastructure vars (DOMAIN_SUFFIX, PROJECT_ID)
    llm-bot.yaml      # Service-specific vars (LLM_BOT_LLM_MODEL, OPENAI_TIMEOUT_MS)
    auth.yaml         # Per-service overrides
    ...
  staging/
    global.yaml       # Staging globals
    infra.yaml
    llm-bot.yaml      # Staging-specific LLM config
    ...
  prod/
    global.yaml
    infra.yaml
    ...
  .secure.local       # Gitignored secrets (API keys, passwords)
  .secure.staging
  .secure.prod
```

**Load Order (Later Overrides Earlier):**
1. `global.yaml` - Base environment variables
2. `infra.yaml` - Infrastructure-specific config
3. `{service}.yaml` - Per-service customization
4. `.secure.{context}` - Secrets (highest priority)

**Integration with executionContexts:**

The `envOverlay` field in each execution context defines where to load these overlays:

```yaml
executionContexts:
  local:
    runtime:
      envOverlay:
        path: env/local               # Directory containing overlays
        files:                        # Load order
          - global.yaml
          - infra.yaml
          - "{service}.yaml"          # {service} replaced at runtime
        secure: .secure.local         # Optional secrets file
```

**Resolution Process:**

```typescript
// When deploying llm-bot to staging:
const context = await ContextResolver.resolve('staging');
const envVars = await EnvironmentResolver.resolve(context, 'llm-bot');

// Loads in order:
// 1. env/staging/global.yaml
// 2. env/staging/infra.yaml
// 3. env/staging/llm-bot.yaml  ({service} → llm-bot)
// 4. .secure.staging
// Result: Merged key-value pairs (later files override)
```

**Why This Approach?**

1. **Service Isolation**: Each service can have custom config without affecting others
2. **Environment Parity**: Same structure across local/staging/prod
3. **Version Control**: YAML files in git, secrets in `.secure.*` (gitignored)
4. **Override Pattern**: Progressive refinement (global → infra → service → secrets)
5. **Existing Pattern**: Already used by `EnvironmentResolver`, just formalized

### CLI Changes

#### Unified Flag: --context

**Primary Workflow: Implicit Context (Recommended)**

```bash
# Set your working context once
brat use staging
# → Writes to ~/.bratrc: current_context: staging

# All subsequent commands use staging automatically
brat docker up                    # Uses staging (from ~/.bratrc)
brat chat --message "!ping"       # Uses staging
brat fleet list                   # Uses staging
brat deploy service llm-bot       # Uses staging

# Check current context
brat current
# → staging (from ~/.bratrc)

# Switch contexts easily
brat use local
brat docker up                    # Now uses local

brat use prod
brat deploy service llm-bot       # Now uses prod
```

**Explicit Override (When Needed)**

```bash
# Current context is staging, but need to check prod
brat use staging
brat fleet list --context prod    # Temporarily override to prod
# → Next command reverts to staging
brat fleet list                    # Uses staging again
```

**Environment Variable (CI/CD)**

```bash
# For automation/CI where ~/.bratrc doesn't exist
export BITBRAT_CONTEXT=staging
brat deploy service llm-bot        # Uses $BITBRAT_CONTEXT
```

**Resolution Priority (Highest to Lowest)**
1. Explicit `--context` flag
2. `BITBRAT_CONTEXT` environment variable
3. `~/.bratrc` current_context (set by `brat use`)
4. Default: `local`

**Backward Compatibility (Warn + Redirect)**

```bash
brat deploy service llm-bot --env staging  # ⚠️  --env is deprecated, use --context or 'brat use'
brat docker up --target staging            # ⚠️  --target is deprecated, use --context or 'brat use'
```

#### New Commands: brat use / brat current

**Quick Context Switching (Most Common)**

```bash
# Switch to a context (sets as current)
brat use staging
# → Updates ~/.bratrc: current_context: staging
# → All future commands use staging

# Check current context
brat current
# → staging

# Switch to different context
brat use local
brat current
# → local
```

#### New Command: brat context

**Advanced Context Management**

```bash
# List all execution contexts
brat context list
# Output:
# NAME         TYPE            DESCRIPTION                              TAGS
# local        docker-compose  Local Docker development environment     development, local
# staging      docker-compose  Remote staging on bitbrat.lan            staging, remote
# prod         cloud-run       Production Cloud Run environment         production, cloud-run
# llm-sandbox  docker-compose  Isolated LLM testing environment         testing, llm, isolated

# Show details for a specific context
brat context show staging
# Output: YAML dump of executionContexts.staging

# Create a new context (interactive wizard)
brat context create llm-sandbox
# Prompts:
#  - Description? "Isolated LLM testing environment"
#  - Deployment type? [docker-compose, cloud-run, k8s] → docker-compose
#  - Docker host? ssh://root@llm-test.local
#  - Remote directory? /opt/BitBrat-LLM
#  - Gateway URL? http://llm-test.local:3017
#  - Persistence driver? [postgres, firestore] → postgres
#  - Database host? llm-test.local
#  - Tags? testing, llm, isolated

# Create context (non-interactive)
brat context create llm-sandbox \
  --description "Isolated LLM testing environment" \
  --type docker-compose \
  --docker-host ssh://root@llm-test.local \
  --remote-dir /opt/BitBrat-LLM \
  --gateway-url http://llm-test.local:3017 \
  --persistence postgres \
  --db-host llm-test.local \
  --tags testing,llm,isolated

# Delete a context (with safety prompt)
brat context delete llm-sandbox
# Prompt: Delete context 'llm-sandbox'? This cannot be undone. [y/N]

# Validate context configuration
brat context validate llm-sandbox
# Checks:
#  ✓ Docker host reachable
#  ✓ Gateway URL responds to /healthz
#  ✓ Database connection successful
#  ✓ Required secrets present (MCP_AUTH_TOKEN, DB_PASSWORD)

# Test connection to a context
brat context ping staging
# Output:
#  ✓ Docker host: ssh://root@bitbrat.lan (reachable)
#  ✓ Gateway: http://bitbrat.lan:3017 (200 OK)
#  ✓ Database: bitbrat.lan:5432 (connected)

# Set default context
brat context use staging
# Writes to ~/.bratrc: default_context: staging
# Future commands use this context unless overridden

# Get current context
brat context current
# Output: staging (from ~/.bratrc or $BITBRAT_CONTEXT)
```

### Auto-Discovery Logic

#### Gateway URL Discovery

```typescript
// Pseudocode for gateway URL resolution

function resolveGatewayUrl(context: ExecutionContext): string {
  // 1. Explicit URL (highest priority)
  if (context.runtime.gateway.url) {
    return context.runtime.gateway.url;
  }

  // 2. Auto-discover from Docker (local contexts only)
  if (context.runtime.gateway.autoDiscover && context.deployment.type === 'docker-compose') {
    const port = discoverApiGatewayPort(context.deployment.docker.host);
    if (port) {
      const isLocal = context.deployment.docker.host.includes('unix://');
      const host = isLocal ? 'localhost' : extractHostFromSSH(context.deployment.docker.host);
      return `ws://${host}:${port}/ws/v1`;
    }
  }

  // 3. Fallback to default port
  if (context.runtime.gateway.fallbackPort) {
    const host = extractHost(context.deployment.docker.host);
    return `ws://${host}:${context.runtime.gateway.fallbackPort}/ws/v1`;
  }

  // 4. Error - no way to reach gateway
  throw new Error(`Cannot resolve gateway URL for context '${context.name}'`);
}

function discoverApiGatewayPort(dockerHost: string): string | null {
  if (dockerHost.includes('ssh://')) {
    // Remote Docker: SSH into host and run docker ps
    const sshTarget = dockerHost.replace('ssh://', '');
    const cmd = `ssh ${sshTarget} "docker ps --filter 'label=com.docker.compose.service=api-gateway' --format '{{.Ports}}'"`;
    const output = execSync(cmd).toString();
    return extractPortFromDockerPs(output);
  } else {
    // Local Docker
    const cmd = `docker ps --filter 'label=com.docker.compose.service=api-gateway' --format '{{.Ports}}'`;
    const output = execSync(cmd).toString();
    return extractPortFromDockerPs(output);
  }
}
```

#### Persistence Discovery

```typescript
function resolvePersistence(context: ExecutionContext): PersistenceConfig {
  const persistence = context.runtime.persistence;

  if (persistence.driver === 'postgres') {
    // Explicit connection config
    if (persistence.connection) {
      return {
        driver: 'postgres',
        ...persistence.connection
      };
    }

    // Auto-discover (e.g., find postgres container in same docker-compose stack)
    if (persistence.autoDiscover && context.deployment.type === 'docker-compose') {
      const pgConfig = discoverPostgresContainer(context.deployment.docker.host);
      if (pgConfig) return pgConfig;
    }
  }

  if (persistence.driver === 'firestore') {
    // Auto-discover Firestore emulator or use production Firestore
    return resolveFirestoreConfig(context);
  }

  throw new Error(`Cannot resolve persistence for context '${context.name}'`);
}
```

---

## Implementation Plan

### Phase 1: Schema & Validation (Week 1)

**Tasks:**
1. Define `ExecutionContextSchema` in Zod (tools/brat/src/config/schema.ts)
2. Add `executionContexts` to `architecture.yaml` schema
3. Migrate existing `deploymentTargets` → `executionContexts`
4. Add validation for required fields per deployment type
5. Write migration script: `brat migrate-contexts` (converts old → new)

**Deliverables:**
- ✅ New schema validated by architecture.yaml parser
- ✅ Backward compatibility layer (warns on `deploymentTargets` usage)
- ✅ Unit tests for schema validation

### Phase 2: Context Resolution Library (Week 1-2)

**Tasks:**
1. Create `ContextResolver` class (tools/brat/src/context/resolver.ts)
2. Implement gateway URL discovery (auto + explicit)
3. Implement persistence discovery
4. Implement SSH/Docker host resolution
5. **Integrate env overlay resolution** (use existing `EnvironmentResolver`)
6. Cached context resolution (avoid repeated lookups)

**Deliverables:**
- ✅ `ContextResolver.resolve(contextName)` → `ResolvedContext`
- ✅ Auto-discovery working for local + remote Docker
- ✅ **Environment overlays loaded from `runtime.envOverlay` config**
- ✅ Integration tests

**Env Overlay Integration:**
```typescript
// Reuse existing EnvironmentResolver, enhance with context awareness
class ContextResolver {
  async resolveEnvironmentVars(context: ExecutionContext, serviceName: string): Promise<Record<string, string>> {
    const overlayConfig = context.runtime.envOverlay;
    if (!overlayConfig) return {};

    const envResolver = new EnvironmentResolver(this.repoRoot);

    // Load files in order
    const merged: Record<string, string> = {};
    for (const file of overlayConfig.files) {
      const fileName = file.replace('{service}', serviceName);
      const filePath = path.join(overlayConfig.path, fileName);
      const vars = envResolver.loadYamlIfExists(filePath);
      Object.assign(merged, vars);
    }

    // Load secure file last (highest priority)
    if (overlayConfig.secure) {
      const secureVars = envResolver.loadSecureLocal(overlayConfig.secure);
      Object.assign(merged, secureVars);
    }

    return merged;
  }
}
```

### Phase 3: CLI Unification (Week 2)

**Tasks:**
1. **Update `parseArgs()` to resolve context (implicit or explicit)**
2. Add deprecation warnings for `--env` and `--target`
3. Update all commands to use `ContextResolver`
4. Refactor command signatures: `(flags, rest)` → `(context, flags, rest)`

**Context Resolution Logic:**
```typescript
function resolveContext(flags: GlobalFlags): string {
  // Priority 1: Explicit --context flag
  if (flags.context) {
    return flags.context;
  }

  // Priority 2: BITBRAT_CONTEXT environment variable
  if (process.env.BITBRAT_CONTEXT) {
    return process.env.BITBRAT_CONTEXT;
  }

  // Priority 3: ~/.bratrc current_context
  const bratrc = loadBratrc();
  if (bratrc?.current_context) {
    return bratrc.current_context;
  }

  // Priority 4: Default to 'local'
  return 'local';
}

function loadBratrc(): BratrcConfig | null {
  const bratrcPath = path.join(os.homedir(), '.bratrc');
  if (!fs.existsSync(bratrcPath)) return null;

  try {
    const content = fs.readFileSync(bratrcPath, 'utf8');
    return yaml.load(content) as BratrcConfig;
  } catch (error) {
    console.warn(`Warning: Failed to parse ~/.bratrc: ${error.message}`);
    return null;
  }
}
```

**Affected Commands:**
- `deploy service` - Use context.deployment.gcp or context.deployment.docker
- `docker up/down/logs/ps` - Use context.deployment.docker.host
- `chat` - Use context.runtime.gateway.url
- `fleet *` - Use context.runtime.gateway
- `backup` - Use context.runtime.persistence
- `dev-mcp` - Use context.runtime.gateway

**Deliverables:**
- ✅ All commands accept `--context` (optional)
- ✅ **Context resolution checks ~/.bratrc first**
- ✅ Backward compatibility warnings
- ✅ Help text updated

### Phase 4: Context Management Commands (Week 3)

**Tasks:**
1. **Implement `brat use <context>` (top-level command, most important)**
2. **Implement `brat current` (top-level command)**
3. Implement `brat context list`
4. Implement `brat context show <name>`
5. Implement `brat context create <name>` (interactive + flags)
6. Implement `brat context delete <name>`
7. Implement `brat context validate <name>`
8. Implement `brat context ping <name>`

**Deliverables:**
- ✅ `brat use` / `brat current` as primary workflow
- ✅ Full CRUD for execution contexts
- ✅ Validation and health checks
- ✅ **~/.bratrc support for persisting current context**

**~/.bratrc File Format:**
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

### Phase 5: Documentation & Migration (Week 3-4)

**Tasks:**
1. Update CLAUDE.md with new patterns
2. Create migration guide: `documentation/guides/context-migration.md`
3. Update all command help text
4. Add examples to README.md
5. Create video tutorial (optional)

**Deliverables:**
- ✅ Complete documentation
- ✅ Migration guide for existing users
- ✅ Deprecation timeline announced

---

## Backward Compatibility

### Migration Path

**Deprecation Timeline:**
- **Sprint 349**: Introduce `executionContexts`, keep `deploymentTargets` working (warn)
- **Sprint 350-352**: Both work, warnings increase
- **Sprint 353**: `deploymentTargets` removed, only `executionContexts`

**Automatic Migration:**
```bash
# Converts deploymentTargets → executionContexts in architecture.yaml
brat migrate-contexts

# Before (architecture.yaml):
deploymentTargets:
  staging:
    type: docker-engine
    host: ssh://root@bitbrat.lan
    env: staging

# After (architecture.yaml):
executionContexts:
  staging:
    description: "Migrated from deploymentTargets"
    deployment:
      type: docker-compose
      docker:
        host: ssh://root@bitbrat.lan
    runtime:
      gateway:
        autoDiscover: true
```

### Flag Compatibility

```bash
# Sprint 349+ (all work, deprecated flags warn)
brat docker up --context staging       # ✅ Recommended
brat docker up --target staging        # ⚠️  Deprecated, use --context
brat docker up --env staging           # ⚠️  Deprecated, use --context

# Sprint 353+ (only --context works)
brat docker up --context staging       # ✅ Only way
brat docker up --target staging        # ❌ Error: --target removed, use --context
```

---

## Benefits

### For Users

1. **No More Confusion**: `--context` is the only flag
2. **Self-Service Environments**: `brat context create` → instant new environment
3. **Auto-Discovery Just Works**: No manual port/URL hunting
4. **Validated Configs**: `brat context validate` catches errors early
5. **Consistent Experience**: All commands work the same way

### For Developers

1. **Single Resolution Point**: `ContextResolver.resolve()` everywhere
2. **Type Safety**: Zod schema validation
3. **Testable**: Mock contexts easily
4. **Extensible**: Add new deployment types without refactoring all commands
5. **Less Code**: Eliminate per-command discovery logic

### For Architecture

1. **Single Source of Truth**: `architecture.yaml` → `executionContexts`
2. **Clear Separation**: Deployment vs. Runtime concerns
3. **Composable**: Mix deployment types (Docker, Cloud Run, K8s) with runtime configs
4. **Future-Proof**: Easy to add new deployment types (K8s, AWS ECS, Azure, etc.)

---

## Alternative Approaches Considered

### Alternative 1: Keep --env and --target Separate

**Rationale**: `--env` for Cloud Run, `--target` for Docker
**Rejected because**:
- Still confusing for users
- Doesn't solve discovery problem
- Commands still inconsistent

### Alternative 2: Environment Variable Only

**Rationale**: Force users to set `BITBRAT_CONTEXT=staging`
**Rejected because**:
- CI/CD scripts need explicit flags
- Hard to switch contexts rapidly
- Less discoverable than CLI flags

### Alternative 3: Config Files per Environment

**Rationale**: `config/staging.yaml`, `config/prod.yaml`
**Rejected because**:
- Duplicates architecture.yaml structure
- Harder to validate cross-environment consistency
- More files to manage

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Breaking change for existing users | High | High | Deprecation period (3 sprints), automatic migration tool |
| Auto-discovery fails edge cases | Medium | Medium | Explicit `gateway.url` always overrides, fallback logic |
| Performance (repeated context resolution) | Low | Low | Cache resolved contexts per CLI invocation |
| Schema complexity | Medium | Low | Comprehensive Zod validation, unit tests |
| Migration bugs | High | Medium | Extensive testing, rollback plan, beta period |

---

## Success Criteria

### Sprint 349 (MVP)
- ✅ `executionContexts` schema merged to architecture.yaml
- ✅ `ContextResolver` library implemented
- ✅ `--context` flag works in 3+ commands
- ✅ `brat context list/show/create` working

### Sprint 350 (Adoption)
- ✅ All commands support `--context`
- ✅ Deprecation warnings active
- ✅ Documentation complete
- ✅ 80% of team using new syntax

### Sprint 353 (Completion)
- ✅ `deploymentTargets` removed
- ✅ `--env` and `--target` flags removed
- ✅ Zero confusion in user feedback
- ✅ `brat context create` used for new environments

---

## Open Questions

1. **Should we support context inheritance?**
   ```yaml
   executionContexts:
     staging:
       extends: base-docker
       runtime:
         gateway:
           url: http://staging.bitbrat.lan:3017
   ```

2. **Should contexts support profiles (like Kubernetes)?**
   ```bash
   brat context use staging --profile llm-testing
   ```

3. **Should we validate contexts at startup or on-demand?**
   - Startup: Catch errors early, slower CLI startup
   - On-demand: Faster startup, errors discovered late

4. **How to handle secrets in context definitions?**
   - Current: Interpolate `${MCP_AUTH_TOKEN}` from env
   - Alternative: Reference secret manager keys

---

## Conclusion

This proposal unifies BitBrat's fragmented environment handling under a single **Execution Context** abstraction. It eliminates user confusion (`--context` replaces `--env`/`--target`), enables self-service environment creation (`brat context create`), and provides automatic discovery of gateway URLs, persistence, and other environment-specific configuration.

**Recommended Action**: Approve for implementation in Sprint 349.

**Next Steps**:
1. Review and discuss this RFC with the team
2. Gather feedback on open questions
3. Prioritize Phase 1 (Schema & Validation) for Sprint 349
4. Create implementation stories in backlog

---

## Appendix A: Example Workflows

### Creating an LLM Testing Environment

```bash
# User wants isolated LLM testing environment
brat context create llm-test \
  --description "Isolated LLM testing environment" \
  --type docker-compose \
  --docker-host ssh://root@llm-test.local \
  --gateway-url http://llm-test.local:3017 \
  --persistence postgres \
  --db-host llm-test.local \
  --tags testing,llm

# Deploy to new environment
brat docker up --context llm-test

# Test with chat
brat chat --context llm-test --message "Test LLM integration"

# Validate everything works
brat context validate llm-test
```

### Switching Between Environments (Primary Workflow)

```bash
# Start working on local (implicit context)
brat use local
brat docker up
brat chat --message "!ping"
# All commands use local

# Switch to staging
brat use staging
brat docker up
brat chat --message "!ping"
# All commands now use staging

# Check what you're currently using
brat current
# → staging

# Quick check on prod without changing current context
brat fleet info --context prod
brat current
# → Still staging

# Switch to prod for deployment
brat use prod
brat deploy service llm-bot
brat fleet info
# All commands now use prod
```

**Legacy Explicit Pattern (Still Supported)**

```bash
# Specify context on every command (verbose, not recommended)
brat docker up --context local
brat chat --context local --message "!ping"
brat docker up --context staging
brat chat --context staging --message "!ping"
```

### Debugging Environment Configuration

```bash
# Check what contexts are available
brat context list

# Show full configuration for staging
brat context show staging

# Ping staging to check connectivity
brat context ping staging
# Output:
#  ✓ SSH: root@bitbrat.lan (reachable)
#  ✓ Docker: 25 containers running
#  ✓ Gateway: http://bitbrat.lan:3017 (200 OK, version 0.14.4)
#  ✓ Database: bitbrat.lan:5432/bitbrat (connected, 147 tables)

# Validate configuration
brat context validate staging
# Output:
#  ✓ Schema valid
#  ✓ Required secrets present (MCP_AUTH_TOKEN, DB_PASSWORD)
#  ✓ Gateway URL reachable
#  ✓ Database migration up-to-date (v0.14.4)
```

---

## Appendix B: Schema Reference

### ExecutionContext Schema (Zod)

```typescript
const ExecutionContextSchema = z.object({
  description: z.string().optional(),

  deployment: z.object({
    type: z.enum(['docker-compose', 'cloud-run', 'k8s']),

    docker: z.object({
      host: z.string(),  // unix:// or ssh://
      remoteDir: z.string().optional(),
      maxConcurrent: z.number().optional(),
    }).optional(),

    gcp: z.object({
      project: z.string(),
      region: z.string(),
    }).optional(),

    k8s: z.object({
      cluster: z.string(),
      namespace: z.string(),
    }).optional(),
  }),

  runtime: z.object({
    gateway: z.object({
      url: z.string().optional(),
      authToken: z.string().optional(),
      autoDiscover: z.boolean().optional(),
      fallbackPort: z.number().optional(),
    }).optional(),

    persistence: z.object({
      driver: z.enum(['postgres', 'firestore']),
      autoDiscover: z.boolean().optional(),
      connection: z.object({
        host: z.string(),
        port: z.number(),
        database: z.string(),
        username: z.string(),
        password: z.string(),
      }).optional(),
    }),

    envOverlay: z.object({
      path: z.string(),                    // Directory path (e.g., env/local)
      files: z.array(z.string()),          // Load order (global.yaml, {service}.yaml)
      secure: z.string().optional(),       // Optional secrets file (.secure.local)
    }).optional(),
  }),

  tags: z.array(z.string()).optional(),
});
```

---

**End of RFC**
