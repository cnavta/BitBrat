# Environment Overlay Refactor - Technical Plan

## Problem Statement

The current environment overlay system in `tools/brat/src/orchestration/docker/environment-resolver.ts` **merges ALL service-specific YAML files together** into a single unified environment, causing unexpected behavior where:

1. Service-specific configs overwrite global configs
2. The last service file processed (alphabetically) wins for any conflicting variable
3. All services receive the same merged environment instead of service-specific overrides

### Current Broken Behavior

```typescript
// environment-resolver.ts:31-36
const merged: EnvironmentVariables = {
  ...globalYaml,      // 1. global.yaml (LOG_LEVEL: debug)
  ...infraYaml,       // 2. infra.yaml
  ...serviceYaml,     // 3. ALL service YAMLs merged together (LOG_LEVEL: info from last file)
  ...secureEnv,       // 4. .secure.* file
};
```

**Example Failure:**
- `env/staging/global.yaml` sets `LOG_LEVEL: debug`
- `env/staging/tool-gateway.yaml`, `env/staging/reflex.yaml`, etc. all have `LOG_LEVEL: info`
- All service YAMLs are loaded and merged (lines 19-27), so the last one processed overwrites `LOG_LEVEL` to `info`
- Single `.env.brat` file is created with `LOG_LEVEL=info`, applied to ALL services
- Result: Global `LOG_LEVEL: debug` is ignored

### Expected Behavior

Service-specific YAML files should **override** global configs ONLY for that specific service:

```
global.yaml:          LOG_LEVEL: debug     → Applied to all services
tool-gateway.yaml:    LOG_LEVEL: info      → Applied ONLY to tool-gateway (overrides global)
reflex.yaml:          LOG_LEVEL: info      → Applied ONLY to reflex (overrides global)
[other services]:     [no LOG_LEVEL]       → Inherit LOG_LEVEL: debug from global
```

## Immediate Workaround (Completed)

**Removed conflicting `LOG_LEVEL` entries** from all staging service-specific YAML files:

- `env/staging/image-gen-mcp.yaml`
- `env/staging/reflex.yaml`
- `env/staging/state-engine.yaml`
- `env/staging/story-engine-mcp.yaml`
- `env/staging/stream-analyst-service.yaml`
- `env/staging/tool-gateway.yaml`

Now `LOG_LEVEL: debug` from `global.yaml` applies to all services in staging.

## Long-Term Solution: Per-Service Environment Overlay

### Architecture Decision

**Option A: Per-Service .env Files** (Recommended)

Generate separate `.env.brat.<service>` files for each service, properly layered:

```
.env.brat.tool-gateway:
  global.yaml
  + infra.yaml
  + tool-gateway.yaml  (service-specific overrides)
  + .secure.staging

.env.brat.reflex:
  global.yaml
  + infra.yaml
  + reflex.yaml  (service-specific overrides)
  + .secure.staging
```

**Pros:**
- True per-service overrides
- Matches intuitive expectation
- Services are isolated from each other's configs
- Supports different LOG_LEVEL per service

**Cons:**
- More .env files to manage
- Requires Docker Compose changes to reference service-specific env files

**Option B: Single .env with Service Prefixes** (Not Recommended)

Keep single `.env.brat` but prefix service-specific vars:

```
# global
LOG_LEVEL=debug

# service-specific (prefixed)
TOOL_GATEWAY_LOG_LEVEL=info
REFLEX_LOG_LEVEL=info
```

**Pros:**
- Single env file
- Minimal Docker Compose changes

**Cons:**
- Requires code changes in every service to check prefixed vars
- Breaks existing env var names
- Does not solve the architectural issue

### Implementation Plan (Option A)

#### Phase 1: Refactor EnvironmentResolver

**File:** `tools/brat/src/orchestration/docker/environment-resolver.ts`

**Changes:**

1. Add `serviceName` parameter to `resolve()`:

```typescript
public resolve(envName: string = 'local', serviceName?: string): EnvironmentVariables {
  const envDir = path.join(this.repoRoot, 'env', envName);

  const globalYaml = this.loadYamlIfExists(path.join(envDir, 'global.yaml'));
  const infraYaml = this.loadYamlIfExists(path.join(envDir, 'infra.yaml'));

  // ONLY load service-specific config if a specific service is being deployed
  const serviceYaml: EnvironmentVariables = {};
  if (serviceName) {
    const serviceFile = path.join(envDir, `${serviceName}.yaml`);
    Object.assign(serviceYaml, this.loadYamlIfExists(serviceFile));
  }

  const secureEnv = this.loadSecureLocal(path.join(this.repoRoot, '.secure.local'));

  const merged: EnvironmentVariables = {
    ...globalYaml,     // 1. Global baseline
    ...infraYaml,      // 2. Infrastructure
    ...serviceYaml,    // 3. Service-specific ONLY for the target service
    ...secureEnv,      // 4. Secrets (highest priority)
  };

  return merged;
}
```

2. Add method to generate per-service env files:

```typescript
public resolveAllServices(envName: string, services: string[]): Map<string, EnvironmentVariables> {
  const envMap = new Map<string, EnvironmentVariables>();

  for (const service of services) {
    const env = this.resolve(envName, service);
    envMap.set(service, env);
  }

  return envMap;
}
```

#### Phase 2: Update DockerOrchestrator

**File:** `tools/brat/src/orchestration/docker/orchestrator.ts`

**Changes:**

1. Update `writeEnvFile()` to generate per-service files:

```typescript
private async writeEnvFiles(
  envName: string,
  targetConfig: any,
  contextName?: string,
  services: string[]
): Promise<Map<string, string>> {

  const envPaths = new Map<string, string>();

  for (const service of services) {
    const env = this.envResolver.resolve(envName, service);
    const composeFileSet = this.composeFactory.getComposeFiles(service, undefined, this.options.loki);
    const assignments = await this.portManager.resolvePorts(composeFileSet.serviceFiles, env, targetConfig);
    const portOverrides = this.portManager.getEnvOverrides(assignments);

    const composeProjectName = contextName
      ? `bitbrat-${contextName}`
      : (env['COMPOSE_PROJECT_NAME'] as string || 'bitbratplatform');

    const mergedEnv: Record<string, string | number | boolean> = {
      ...env,
      ...portOverrides,
      COMPOSE_PROJECT_NAME: composeProjectName
    };

    // Handle remote ADC key path
    const isRemote = targetConfig?.host?.startsWith('ssh://');
    if (isRemote && targetConfig?.remoteDir && mergedEnv['GOOGLE_APPLICATION_CREDENTIALS']) {
      mergedEnv['GOOGLE_APPLICATION_CREDENTIALS'] = path.posix.join(
        targetConfig.remoteDir,
        REMOTE_ADC_RELATIVE_PATH,
      );
    }

    const envContent = EnvironmentResolver.flattenToDotEnv(mergedEnv);
    const tempEnvPath = `.env.brat.${service}`;
    const fullEnvPath = path.join(this.options.repoRoot, tempEnvPath);

    if (!this.options.dryRun) {
      fs.writeFileSync(fullEnvPath, envContent);

      // Sync to subdirectories for Docker Compose
      const subDirs = ['infrastructure/docker-compose', 'infrastructure/docker-compose/services'];
      for (const dir of subDirs) {
        const subDirPath = path.join(this.options.repoRoot, dir);
        if (fs.existsSync(subDirPath)) {
          fs.writeFileSync(path.join(subDirPath, tempEnvPath), envContent);
        }
      }
    }

    envPaths.set(service, tempEnvPath);
  }

  return envPaths;
}
```

2. Update cleanup to handle multiple files:

```typescript
private cleanupEnvFiles(envPaths: Map<string, string>): void {
  for (const tempEnvPath of envPaths.values()) {
    const fullEnvPath = path.join(this.options.repoRoot, tempEnvPath);
    if (!this.options.dryRun && fs.existsSync(fullEnvPath)) {
      fs.unlinkSync(fullEnvPath);
      const subDirs = ['infrastructure/docker-compose', 'infrastructure/docker-compose/services'];
      for (const dir of subDirs) {
        const subEnvPath = path.join(this.options.repoRoot, dir, tempEnvPath);
        if (fs.existsSync(subEnvPath)) {
          fs.unlinkSync(subEnvPath);
        }
      }
    }
  }
}
```

#### Phase 3: Update Docker Compose Files

**Update ALL service compose files** to reference service-specific env file:

**Example: `infrastructure/docker-compose/services/tool-gateway.compose.yaml`**

```yaml
services:
  tool-gateway:
    env_file:
      - .env.brat.tool-gateway  # Changed from .env.brat
    build:
      context: .
      dockerfile: Dockerfile.service
      args:
        SERVICE_NAME: tool-gateway
        SERVICE_ENTRY: dist/apps/tool-gateway.js
        SERVICE_PORT: "3000"
    # ... rest of config
```

**Automation:** Create script to update all compose files:

```bash
#!/bin/bash
# tools/scripts/update-compose-env-files.sh

for file in infrastructure/docker-compose/services/*.compose.yaml; do
  service=$(basename "$file" .compose.yaml)
  sed -i '' "s|- .env.brat|- .env.brat.${service}|g" "$file"
done
```

#### Phase 4: Update ComposeFactory

**File:** `tools/brat/src/orchestration/docker/compose-factory.ts`

**Changes:**

Update `buildComposeArgs()` to accept per-service env files:

```typescript
public buildComposeArgs(
  fileSet: ComposeFileSet,
  envFiles: Map<string, string>,  // Changed from string[] to Map<service, envPath>
  projectName: string = 'bitbratplatform'
): string[] {
  const args: string[] = [];
  args.push('-p', projectName);
  args.push('-f', fileSet.baseFile);

  for (const f of fileSet.serviceFiles) {
    args.push('-f', f);

    // Add service-specific env file
    const serviceName = path.basename(f, '.compose.yaml');
    const envFile = envFiles.get(serviceName);
    if (envFile) {
      args.push('--env-file', envFile);
    }
  }

  if (fileSet.observabilityFile) {
    args.push('-f', fileSet.observabilityFile);
  }

  return args;
}
```

### Migration Path

#### Step 1: Add Feature Flag

Add `ENV_OVERLAY_PER_SERVICE` feature flag to enable gradual rollout:

```typescript
const usePerServiceEnv = process.env.ENV_OVERLAY_PER_SERVICE === 'true';

if (usePerServiceEnv) {
  // New per-service logic
} else {
  // Legacy single .env.brat logic
}
```

#### Step 2: Test in Local Context

1. Set `ENV_OVERLAY_PER_SERVICE=true` in local development
2. Deploy services and verify per-service overrides work
3. Validate port assignments, secrets, and configs

#### Step 3: Roll Out to Staging

1. Enable feature flag in staging
2. Deploy and monitor logs
3. Verify services pick up correct configs

#### Step 4: Production Deployment

1. Enable in production contexts
2. Remove legacy code path
3. Remove feature flag

### Testing Strategy

#### Unit Tests

**File:** `tools/brat/src/orchestration/docker/environment-resolver.spec.ts`

```typescript
describe('EnvironmentResolver per-service overlay', () => {
  it('should apply service-specific overrides correctly', () => {
    const resolver = new EnvironmentResolver(repoRoot);
    const env = resolver.resolve('test', 'tool-gateway');
    expect(env['LOG_LEVEL']).toBe('info');  // From tool-gateway.yaml
  });

  it('should use global config when service has no override', () => {
    const resolver = new EnvironmentResolver(repoRoot);
    const env = resolver.resolve('test', 'llm-bot');
    expect(env['LOG_LEVEL']).toBe('debug');  // From global.yaml
  });

  it('should prioritize: secrets > service > infra > global', () => {
    const resolver = new EnvironmentResolver(repoRoot);
    const env = resolver.resolve('test', 'api-gateway');
    expect(env['DATABASE_URL']).toBe('postgresql://from-secrets');
  });
});
```

#### Integration Tests

**File:** `tools/brat/src/orchestration/docker/orchestrator.spec.ts`

```typescript
describe('DockerOrchestrator per-service env files', () => {
  it('should generate separate env files for each service', async () => {
    const orchestrator = new DockerOrchestrator({
      repoRoot,
      context: 'test',
      service: 'tool-gateway'
    });

    await orchestrator.up();

    expect(fs.existsSync('.env.brat.tool-gateway')).toBe(true);
    const content = fs.readFileSync('.env.brat.tool-gateway', 'utf8');
    expect(content).toContain('LOG_LEVEL=info');
  });
});
```

#### Manual Testing Checklist

- [ ] Local deployment with per-service LOG_LEVEL
- [ ] Staging deployment with mixed service configs
- [ ] Verify service A with `LOG_LEVEL: info` logs at info level
- [ ] Verify service B with no override logs at global `debug` level
- [ ] Verify secrets are correctly injected per-service
- [ ] Verify port assignments work with per-service envs
- [ ] Verify remote (SSH) deployment syncs all .env.brat.* files

### Documentation Updates

#### 1. Update CLAUDE.md

Add section explaining environment overlay precedence:

```markdown
### Environment Configuration Precedence

Environment variables are layered with the following precedence (highest to lowest):

1. **Secrets** (`.secure.<context>`) - Passwords, API keys, tokens
2. **Service-specific** (`env/<context>/<service>.yaml`) - Per-service overrides
3. **Infrastructure** (`env/<context>/infra.yaml`) - Database, message bus, shared infra
4. **Global** (`env/<context>/global.yaml`) - Baseline for all services

Example:
- `env/staging/global.yaml`: `LOG_LEVEL: debug` (applies to all services)
- `env/staging/tool-gateway.yaml`: `LOG_LEVEL: info` (overrides for tool-gateway only)
- `env/staging/llm-bot.yaml`: (no LOG_LEVEL, inherits `debug` from global)
```

#### 2. Update execution-contexts.md

Document the per-service overlay mechanism:

```markdown
## Service-Specific Environment Overrides

Each service can override global configuration by creating a `<service>.yaml` file:

**env/staging/global.yaml** (baseline):
```yaml
LOG_LEVEL: debug
NODE_ENV: production
MESSAGE_BUS_DRIVER: nats
```

**env/staging/tool-gateway.yaml** (overrides for tool-gateway only):
```yaml
LOG_LEVEL: info  # tool-gateway uses info, others inherit debug
MCP_AUTH_TOKEN: ${MCP_AUTH_TOKEN}
```

When deploying, each service receives:
- Global baseline
- Infrastructure config
- Service-specific overrides (if file exists)
- Secrets (highest priority)
```

#### 3. Create Migration Guide

**File:** `documentation/guides/env-overlay-migration.md`

Document how to migrate from legacy single .env.brat to per-service files.

### Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Breaking change for existing deployments | High | Feature flag for gradual rollout |
| Multiple .env files increase complexity | Medium | Clear documentation, automated scripts |
| Compose file updates could break builds | High | Automated script + comprehensive testing |
| Remote sync may miss new .env files | Medium | Update sync logic to handle wildcards |
| Port conflicts if services have different envs | Low | Port manager already handles conflicts |

### Success Criteria

- [ ] All staging services respect `LOG_LEVEL: debug` from global.yaml
- [ ] Service-specific overrides (e.g., `tool-gateway.yaml: LOG_LEVEL: info`) work correctly
- [ ] No regression in port assignment, secrets injection, or remote deployment
- [ ] Documentation clearly explains precedence and override behavior
- [ ] Unit and integration tests pass
- [ ] Feature flag can be safely removed after 1 sprint

### Timeline Estimate

- **Phase 1 (Refactor EnvironmentResolver):** 2-3 hours
- **Phase 2 (Update DockerOrchestrator):** 3-4 hours
- **Phase 3 (Update Compose Files):** 1-2 hours (mostly automated)
- **Phase 4 (Update ComposeFactory):** 1 hour
- **Testing:** 2-3 hours
- **Documentation:** 2 hours
- **Code Review + Fixes:** 2 hours

**Total:** 13-17 hours (2 days)

### Open Questions

1. Should we support nested service configs (e.g., `env/staging/services/tool-gateway/config.yaml`)?
2. Should we validate that service-specific YAML files only contain overrides, not duplicates of global?
3. Should we auto-generate service-specific YAML templates during `brat context create`?
4. Should `--all` deployments generate a unified .env.brat with all globals, or separate files?

### Related Issues

- Twitch IRC debug logging disabled due to `LOG_LEVEL: info` override
- PostgreSQL logging now using platform logger (completed)
- Future: Per-service feature flags, per-service resource limits

---

**Status:** Planning
**Priority:** P1 (blocking debug logging in staging)
**Assignee:** TBD
**Sprint:** TBD
