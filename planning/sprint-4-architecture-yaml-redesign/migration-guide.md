# Migration Guide: architecture.yaml v1 → v2

**Audience**: Platform engineers, DevOps
**Estimated Time**: 2-4 hours per execution context
**Prerequisites**: Sprint 4 Phase 1-2 complete, backup of architecture.yaml

## Overview

This guide walks through migrating an existing architecture.yaml from v1 (current) to v2 (proposed) schema. Migration happens in-place with validation at each step.

## Pre-Migration Checklist

- [ ] Backup current architecture.yaml: `cp architecture.yaml architecture.v1.backup.yaml`
- [ ] Ensure all services are healthy: `brat fleet list`
- [ ] Stop all running contexts: `brat context list` → `docker-compose down` for each
- [ ] Install migration tools: `npm install` (includes v2 schema validation)
- [ ] Review schema proposal: [schema-proposal.md](./schema-proposal.md)

## Migration Strategy

**Approach**: Blue/Green with Progressive Rollout

1. **Blue (v1)**: Keep existing architecture.yaml functional
2. **Green (v2)**: Create parallel v2 sections
3. **Validation**: Test v2 schema in local context
4. **Cutover**: Atomically switch to v2, deprecate v1 patterns
5. **Cleanup**: Remove deprecated v1 code after 1 sprint

**Rollback Plan**: Revert to architecture.v1.backup.yaml if issues arise

## Step-by-Step Migration

### Step 1: Add Platform Infrastructure (30 min)

**Goal**: Declare generic infrastructure capabilities

**Current State (v1)**: No platform.infrastructure section exists

**Target State (v2)**:

```yaml
platform:
  version: "2.0"  # NEW: Schema version
  name: "BitBrat Platform"

  # NEW: Generic infrastructure capabilities
  infrastructure:
    messaging:
      required: true
      capabilities: [pubsub, streaming, queuing]
      defaultTTL: 3600

    caching:
      required: true
      capabilities: [keyvalue, pubsub, distributed-lock]
      defaultTTL: 300

    persistence:
      required: true
      capabilities: [relational, transactional, migrations]
      driver: postgres  # postgres | firestore (legacy)

    observability:
      required: false
      capabilities: [metrics, tracing, logging]
```

**Actions**:

1. Open architecture.yaml
2. Add `platform.version: "2.0"` at top level
3. Add `platform.infrastructure` section (copy from schema-proposal.md)
4. Validate: `npm run brat -- config validate --schema v2`

**Validation**:

```bash
$ npm run brat -- config validate --schema v2
✓ platform.infrastructure.messaging is valid
✓ platform.infrastructure.caching is valid
✓ platform.infrastructure.persistence is valid
✓ platform.infrastructure.observability is valid
```

---

### Step 2: Add Docker Provider (45 min)

**Goal**: Define Docker implementations for infrastructure capabilities

**Current State (v1)**: Infrastructure hardcoded in `infrastructure/docker-compose/docker-compose.local.yaml`

**Target State (v2)**:

```yaml
infrastructure:
  docker:
    messaging:
      service: nats
      image: nats:2.10-alpine
      ports:
        client: 4222
        http: 8222
        cluster: 6222
      volumes:
        - name: nats-data
          mount: /data
      config:
        jetstream:
          enabled: true
          maxMemory: 1GB
          maxStorage: 10GB
      healthCheck:
        test: ["CMD", "wget", "--spider", "http://localhost:8222/healthz"]
        interval: 5s
        timeout: 3s
        retries: 10

    caching:
      service: redis
      image: redis:7-alpine
      ports:
        client: 6379
      volumes:
        - name: redis-data
          mount: /data
      config:
        maxmemory: 256mb
        maxmemory-policy: allkeys-lru
        appendonly: "yes"
      healthCheck:
        test: ["CMD", "redis-cli", "ping"]
        interval: 5s
        timeout: 3s
        retries: 10

    persistence:
      service: postgres
      image: postgres:15-alpine
      ports:
        client: 5432
      volumes:
        - name: postgres-data
          mount: /var/lib/postgresql/data
        - name: postgres-init
          mount: /docker-entrypoint-initdb.d
          source: ../postgres/init
          readOnly: true
      env:
        POSTGRES_DB: bitbrat
        POSTGRES_USER: bitbrat
        POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-bitbrat_dev_password}
      healthCheck:
        test: ["CMD-SHELL", "pg_isready -U bitbrat"]
        interval: 5s
        timeout: 5s
        retries: 10

    utilities:
      - service: nats-box
        image: natsio/nats-box:latest
        depends_on: [nats]
        command: ["sleep", "infinity"]
```

**Actions**:

1. Add `infrastructure.docker` section to architecture.yaml
2. Copy NATS configuration from docker-compose.local.yaml
3. Copy Redis configuration from docker-compose.local.yaml
4. Copy PostgreSQL configuration from docker-compose.local.yaml
5. Add nats-box utility
6. Validate: `npm run brat -- config validate --schema v2`

**Validation**:

```bash
$ npm run brat -- config validate --schema v2
✓ infrastructure.docker.messaging is valid
✓ infrastructure.docker.caching is valid
✓ infrastructure.docker.persistence is valid
✓ All required capabilities have providers
```

---

### Step 3: Add Service Dependencies (30 min)

**Goal**: Explicitly declare infrastructure dependencies for each service

**Current State (v1)**: Dependencies inferred from hardcoded lists in parse-dependencies.ts

**Target State (v2)**:

```yaml
services:
  ingress-egress:
    dependencies:
      infrastructure: [messaging, caching, persistence]
      services: []
    # ... rest of service config

  auth:
    dependencies:
      infrastructure: [messaging, caching, persistence]
      services: []
    # ... rest of service config

  llm-bot:
    dependencies:
      infrastructure: [messaging, caching, persistence]
      services: [auth, tool-gateway]
    # ... rest of service config

  tool-gateway:
    dependencies:
      infrastructure: [messaging, caching, persistence]
      services: [auth]
    # ... rest of service config

  event-router:
    dependencies:
      infrastructure: [messaging, caching, persistence]
      services: []
    # ... rest of service config

  persistence:
    dependencies:
      infrastructure: [messaging, persistence]  # No caching needed
      services: []
    # ... rest of service config
```

**Actions**:

1. For each service in `services:` section:
   - Add `dependencies.infrastructure` array
   - Add `dependencies.services` array (service-to-service deps)
2. Reference current hardcoded dependencies:
   - `tools/brat/src/context/parse-dependencies.ts` lines 67-72 (all services get messaging, caching)
   - `tools/brat/src/context/parse-dependencies.ts` lines 59-65 (services with PERSISTENCE_DRIVER get persistence)
3. Validate: `npm run brat -- config validate --schema v2`

**Quick Reference** (current behavior to migrate):

```typescript
// All services get messaging (NATS)
infrastructure.push('nats');

// All services get caching (Redis) - Sprint 3 Fix #10
infrastructure.push('redis');

// Services with PERSISTENCE_DRIVER get persistence (PostgreSQL)
if (metadata.envKeys.includes('PERSISTENCE_DRIVER')) {
  infrastructure.push('postgres');
}
```

**Validation**:

```bash
$ npm run brat -- config validate --schema v2
✓ services.ingress-egress.dependencies is valid
✓ services.auth.dependencies is valid
✓ services.llm-bot.dependencies is valid
✓ All service dependencies can be satisfied
```

---

### Step 4: Update Execution Contexts (45 min)

**Goal**: Add infrastructure configuration to each execution context

**Current State (v1)**: Contexts have `runtime.persistence` but no infrastructure declaration

**Target State (v2)**:

```yaml
executionContexts:
  local:
    description: "Local Docker development environment"

    # NEW: Infrastructure configuration
    infrastructure:
      provider: docker
      messaging:
        ports:
          client: 4222  # Default, no override needed
      caching:
        ports:
          client: 6379  # Default, no override needed
      persistence:
        database: bitbrat_local  # Override database name
        initScripts:
          - path: ../postgres/init/01-schema.sql
          - path: ../postgres/init/02-seed-dev.sql

    deployment:
      type: docker-compose
      docker:
        host: unix:///var/run/docker.sock

    runtime:
      gateway:
        autoDiscover: true
      persistence:
        driver: postgres
        connection:
          host: localhost
          port: 5432
          database: bitbrat_local  # Match infrastructure.persistence.database
          username: bitbrat
          password: ${POSTGRES_PASSWORD:-bitbrat_dev_password}
      envOverlay:
        path: env/local
        files: [global.yaml, infra.yaml, "{service}.yaml"]
        secure: .secure.local

    tags: [development, local]

  staging:
    description: "Remote staging environment on bitbrat.lan"

    # NEW: Infrastructure configuration
    infrastructure:
      provider: docker
      messaging:
        auth:
          token: ${NATS_TOKEN}  # Enable auth for remote
      persistence:
        database: bitbrat_staging
        ssl:
          enabled: true
          ca: /var/secrets/postgres-ca.crt

    deployment:
      type: docker-compose
      docker:
        host: ssh://root@bitbrat.lan
        remoteDir: /opt/BitBratPlatform

    runtime:
      gateway:
        autoDiscover: true
        authToken: ${MCP_AUTH_TOKEN}
      persistence:
        driver: postgres
        connection:
          host: bitbrat.lan
          port: 5432
          database: bitbrat_staging  # Match infrastructure.persistence.database
          username: bitbrat
          password: ${POSTGRES_PASSWORD}
      envOverlay:
        path: env/staging
        files: [global.yaml, infra.yaml, "{service}.yaml"]
        secure: .secure.staging

    tags: [staging, remote]
```

**Actions**:

1. For each context in `executionContexts:`
   - Add `infrastructure.provider: docker` (or `gcp`, `aws`, etc.)
   - Add infrastructure capability overrides (optional)
   - Ensure `runtime.persistence.connection.database` matches `infrastructure.persistence.database`
2. Validate: `npm run brat -- config validate --schema v2`

**Validation**:

```bash
$ npm run brat -- config validate --schema v2
✓ executionContexts.local.infrastructure is valid
✓ executionContexts.staging.infrastructure is valid
✓ Provider 'docker' is defined in infrastructure section
✓ All infrastructure capabilities satisfied
```

---

### Step 5: Validate Complete Migration (15 min)

**Goal**: Comprehensive validation of v2 schema

**Actions**:

1. Run full schema validation:
   ```bash
   npm run brat -- config validate --schema v2
   ```

2. Check for missing providers:
   ```bash
   npm run brat -- config validate --schema v2 --check-providers
   ```

3. Validate dependency graph:
   ```bash
   npm run brat -- config validate --schema v2 --check-dependencies
   ```

4. Generate migration report:
   ```bash
   npm run brat -- config migrate --from v1 --to v2 --report
   ```

**Expected Output**:

```
✓ Schema version: 2.0
✓ Platform infrastructure: 4 capabilities defined
✓ Providers: docker (complete)
✓ Services: 15 active, all dependencies satisfied
✓ Execution contexts: 2 (local, staging)

Migration Report:
  Added sections:
    - platform.infrastructure (4 capabilities)
    - infrastructure.docker (3 implementations)
    - services.*.dependencies (15 services)
    - executionContexts.*.infrastructure (2 contexts)

  Deprecated patterns:
    - Hardcoded infrastructure in parse-dependencies.ts
    - Infrastructure in docker-compose.local.yaml

  Breaking changes: None (backward compatible)
```

---

### Step 6: Test Local Context (30 min)

**Goal**: Verify v2 schema works with local development

**Actions**:

1. Generate docker-compose file from v2 schema:
   ```bash
   npm run brat -- context create local --regenerate
   ```

2. Validate generated compose file:
   ```bash
   docker-compose -f infrastructure/docker-compose/docker-compose.local.yaml config
   ```

3. Start local context:
   ```bash
   npm run local
   ```

4. Wait for infrastructure health:
   ```bash
   # NATS should be healthy
   curl -f http://localhost:8222/healthz

   # Redis should be healthy
   docker exec -it bitbrat-redis-1 redis-cli ping

   # PostgreSQL should be healthy
   docker exec -it bitbrat-postgres-1 pg_isready -U bitbrat
   ```

5. Verify services start:
   ```bash
   npm run brat -- fleet list --context local
   ```

6. Run integration tests:
   ```bash
   npm test -- --testPathPattern=integration
   ```

**Expected Output**:

```
$ npm run local
[orchestrator] Starting local context...
[orchestrator] Generating docker-compose.local.yaml from architecture.yaml v2
[orchestrator] Infrastructure services: nats, redis, postgres, nats-box
[orchestrator] Application services: ingress-egress, auth, llm-bot, tool-gateway, event-router, persistence
[docker-compose] Creating network bitbrat_default
[docker-compose] Creating volume bitbrat_nats-data
[docker-compose] Creating volume bitbrat_redis-data
[docker-compose] Creating volume bitbrat_postgres-data
[docker-compose] Starting bitbrat-nats-1     ... done
[docker-compose] Starting bitbrat-redis-1    ... done
[docker-compose] Starting bitbrat-postgres-1 ... done
[health-gate] Waiting for infrastructure to be ready...
[health-gate] ✓ nats is healthy (http://localhost:8222/healthz)
[health-gate] ✓ redis is healthy (PONG)
[health-gate] ✓ postgres is healthy (accepting connections)
[docker-compose] Starting bitbrat-ingress-egress-1 ... done
[docker-compose] Starting bitbrat-auth-1            ... done
[docker-compose] Starting bitbrat-llm-bot-1         ... done
[orchestrator] All services started successfully

$ npm run brat -- fleet list --context local
BIT              PROFILE    STATUS    UPTIME
ingress-egress   gateway    healthy   12s
auth             core       healthy   10s
llm-bot          llm        healthy   8s
tool-gateway     mcp-server healthy   7s
event-router     core       healthy   6s
persistence      core       healthy   5s
```

---

### Step 7: Test Staging Context (30 min)

**Goal**: Verify v2 schema works with remote Docker

**Actions**:

1. Sync infrastructure to remote:
   ```bash
   npm run brat -- deploy infrastructure --context staging --dry-run
   ```

2. Deploy infrastructure:
   ```bash
   npm run brat -- deploy infrastructure --context staging
   ```

3. Wait for remote infrastructure health:
   ```bash
   ssh root@bitbrat.lan "docker ps --filter name=bitbrat"
   ```

4. Deploy services:
   ```bash
   npm run brat -- deploy services --all --context staging
   ```

5. Verify remote services:
   ```bash
   npm run brat -- fleet list --context staging
   ```

**Expected Output**:

```
$ npm run brat -- deploy infrastructure --context staging
[orchestrator] Deploying infrastructure to staging (ssh://root@bitbrat.lan)
[orchestrator] Syncing files to /opt/BitBratPlatform
[sync] ✓ infrastructure/postgres/init
[sync] ✓ infrastructure/docker-compose
[docker-compose] Generating docker-compose.staging.yaml from architecture.yaml v2
[docker-compose] Starting bitbrat-nats-1     ... done
[docker-compose] Starting bitbrat-redis-1    ... done
[docker-compose] Starting bitbrat-postgres-1 ... done
[health-gate] Waiting for infrastructure to be ready...
[health-gate] ✓ nats is healthy (bitbrat.lan:4222)
[health-gate] ✓ redis is healthy (bitbrat.lan:6379)
[health-gate] ✓ postgres is healthy (bitbrat.lan:5432)
[orchestrator] Infrastructure deployment complete

$ npm run brat -- fleet list --context staging
BIT              PROFILE    STATUS    UPTIME
ingress-egress   gateway    healthy   45s
auth             core       healthy   42s
llm-bot          llm        healthy   39s
tool-gateway     mcp-server healthy   36s
event-router     core       healthy   33s
persistence      core       healthy   30s
```

---

### Step 8: Update Code (60 min)

**Goal**: Replace hardcoded infrastructure with InfrastructureRegistry

**Current State (v1)**: Hardcoded infrastructure in multiple files

**Target State (v2)**: InfrastructureRegistry reads from architecture.yaml

**Files to Update**:

1. **tools/brat/src/context/parse-dependencies.ts**
   - Remove hardcoded `infrastructure.push('redis')` (line 70)
   - Remove hardcoded `infrastructure.push('nats')` (line 57)
   - Use `InfrastructureRegistry.getRequiredInfrastructure(services)`

2. **tools/brat/src/orchestration/deployment/docker-compose-strategy.ts**
   - Remove hardcoded `infrastructureServices` array (line 1028)
   - Use `InfrastructureRegistry.getInfrastructureServices(context)`

3. **tools/brat/src/commands/context/create.ts**
   - Replace `waitForPostgres()` with `HealthGate.waitForInfrastructure()`
   - Use generic health checks for all infrastructure

**Example Refactor (parse-dependencies.ts)**:

Before (v1):
```typescript
// All services need NATS for messaging
infrastructure.push('nats');

// Sprint 3 Fix #10: Redis is platform-wide infrastructure
if (!infrastructure.includes('redis')) {
  infrastructure.push('redis');
}
```

After (v2):
```typescript
// Get infrastructure from service dependencies
const requiredInfra = metadata.dependencies?.infrastructure || [];
for (const capability of requiredInfra) {
  const provider = InfrastructureRegistry.getProvider(repoRoot, context, capability);
  if (provider) {
    infrastructure.push(provider.service);
  }
}
```

**Actions**:

1. Install InfrastructureRegistry (from Phase 2):
   ```bash
   npm install  # Includes new InfrastructureRegistry module
   ```

2. Update parse-dependencies.ts:
   ```bash
   git diff tools/brat/src/context/parse-dependencies.ts
   ```

3. Update docker-compose-strategy.ts:
   ```bash
   git diff tools/brat/src/orchestration/deployment/docker-compose-strategy.ts
   ```

4. Run tests:
   ```bash
   npm test -- tools/brat/src/context/parse-dependencies.test.ts
   npm test -- tools/brat/src/orchestration/deployment/docker-compose-strategy.test.ts
   ```

**Validation**:

```bash
$ npm test -- parse-dependencies
PASS tools/brat/src/context/parse-dependencies.test.ts
  ✓ uses InfrastructureRegistry instead of hardcoded lists
  ✓ respects service dependencies from architecture.yaml
  ✓ handles missing infrastructure gracefully

$ npm test -- docker-compose-strategy
PASS tools/brat/src/orchestration/deployment/docker-compose-strategy.test.ts
  ✓ includes infrastructure from registry
  ✓ bulk deployment uses same code path as single-service
```

---

### Step 9: Deprecate Old Patterns (15 min)

**Goal**: Mark v1 patterns as deprecated, add warnings

**Actions**:

1. Add deprecation warnings to docker-compose.local.yaml:
   ```yaml
   # DEPRECATED: Infrastructure section moved to architecture.yaml v2
   # This file will be removed in Sprint +1
   # See: planning/sprint-4-architecture-yaml-redesign/migration-guide.md
   ```

2. Add deprecation warnings to parse-dependencies.ts:
   ```typescript
   // DEPRECATED (v1): Hardcoded infrastructure lists
   // TODO: Remove in Sprint +1, use InfrastructureRegistry
   ```

3. Update CHANGELOG.md:
   ```markdown
   ## [Unreleased]
   ### Deprecated
   - Hardcoded infrastructure in parse-dependencies.ts (use architecture.yaml v2)
   - Infrastructure section in docker-compose.local.yaml (use architecture.yaml v2)
   ```

---

### Step 10: Commit and Deploy (30 min)

**Goal**: Commit v2 migration, deploy to production (if applicable)

**Actions**:

1. Review all changes:
   ```bash
   git status
   git diff architecture.yaml
   ```

2. Run full test suite:
   ```bash
   npm test
   npm run lint
   npm run build
   ```

3. Commit migration:
   ```bash
   git add architecture.yaml
   git add tools/brat/src/context/parse-dependencies.ts
   git add tools/brat/src/orchestration/deployment/docker-compose-strategy.ts
   git add CHANGELOG.md
   git commit -m "feat(architecture): Migrate to architecture.yaml v2 schema

   - Add platform.infrastructure capability declarations
   - Add infrastructure.docker provider implementations
   - Add services.*.dependencies.infrastructure explicit dependencies
   - Add executionContexts.*.infrastructure context overrides
   - Replace hardcoded infrastructure with InfrastructureRegistry
   - Deprecate v1 patterns (remove in Sprint +1)

   BREAKING CHANGE: None (backward compatible during migration period)

   Fixes: Sprint 3 infrastructure fragmentation issues
   Implements: planning/sprint-4-architecture-yaml-redesign/

   🤖 Generated with [Claude Code](https://claude.com/claude-code)

   Co-Authored-By: Claude <noreply@anthropic.com>"
   ```

4. Push to feature branch:
   ```bash
   git push origin feature/architecture-v2-migration
   ```

5. Create pull request:
   ```bash
   gh pr create --title "Migrate to architecture.yaml v2 schema" \
     --body "$(cat <<'EOF'
   ## Summary
   - Migrated architecture.yaml from v1 to v2 schema
   - Added platform-agnostic infrastructure declarations
   - Replaced hardcoded infrastructure with InfrastructureRegistry
   - All tests passing, backward compatible

   ## Migration Checklist
   - [x] Added platform.infrastructure section
   - [x] Added infrastructure.docker provider
   - [x] Added services.*.dependencies
   - [x] Added executionContexts.*.infrastructure
   - [x] Updated parse-dependencies.ts
   - [x] Updated docker-compose-strategy.ts
   - [x] Validated local context
   - [x] Validated staging context
   - [x] All tests passing

   ## Breaking Changes
   None (backward compatible during migration period)

   ## Rollback Plan
   Revert to architecture.v1.backup.yaml if issues arise

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```

---

## Post-Migration

### Monitoring (Week 1)

- [ ] Monitor infrastructure health: `brat fleet list --context <name>`
- [ ] Check for deployment errors in logs
- [ ] Verify no infrastructure bugs for 1 week
- [ ] Gather developer feedback

### Cleanup (Sprint +1)

- [ ] Remove deprecated code:
  - Hardcoded infrastructure in parse-dependencies.ts
  - Infrastructure in docker-compose.local.yaml
  - Old dependency inference logic
- [ ] Remove deprecation warnings
- [ ] Update documentation to reflect v2 as default

### Continuous Improvement

- [ ] Expand provider ecosystem (AWS, Azure, K8s)
- [ ] Add provider-specific optimizations
- [ ] Iterate on schema based on real-world usage

---

## Troubleshooting

### Issue: Schema validation fails

**Symptom**:
```
❌ platform.infrastructure.messaging is invalid: required property 'required' missing
```

**Solution**:
Ensure all required fields are present:
```yaml
platform:
  infrastructure:
    messaging:
      required: true  # REQUIRED
      capabilities: [pubsub]  # REQUIRED
```

### Issue: Provider not found

**Symptom**:
```
❌ No provider 'docker' found for capability 'messaging'
```

**Solution**:
Ensure `infrastructure.docker` section exists and has messaging implementation:
```yaml
infrastructure:
  docker:
    messaging:
      service: nats
      image: nats:2.10-alpine
```

### Issue: Infrastructure not starting

**Symptom**:
```
[health-gate] ✗ postgres is unhealthy (timeout after 30s)
```

**Solution**:
1. Check PostgreSQL logs: `docker logs bitbrat-postgres-1`
2. Verify health check configuration:
   ```yaml
   healthCheck:
     test: ["CMD-SHELL", "pg_isready -U bitbrat"]
     interval: 5s
     timeout: 5s
     retries: 10
   ```
3. Increase timeout if needed: `retries: 20`

### Issue: Service dependencies not satisfied

**Symptom**:
```
❌ Service 'llm-bot' depends on 'auth' but it is not active
```

**Solution**:
1. Check that 'auth' service is marked active:
   ```yaml
   services:
     auth:
       active: true
   ```
2. Verify dependencies are correct:
   ```yaml
   services:
     llm-bot:
       dependencies:
         services: [auth, tool-gateway]
   ```

---

## Rollback Procedure

If migration fails and rollback is needed:

1. Stop all running contexts:
   ```bash
   npm run local:down
   ssh root@bitbrat.lan "cd /opt/BitBratPlatform && docker-compose down"
   ```

2. Restore v1 architecture.yaml:
   ```bash
   git checkout architecture.v1.backup.yaml
   mv architecture.v1.backup.yaml architecture.yaml
   ```

3. Restore v1 code:
   ```bash
   git checkout main -- tools/brat/src/context/parse-dependencies.ts
   git checkout main -- tools/brat/src/orchestration/deployment/docker-compose-strategy.ts
   ```

4. Rebuild and restart:
   ```bash
   npm run build
   npm run local
   ```

5. Verify services healthy:
   ```bash
   npm run brat -- fleet list
   ```

---

## References

- [README.md](./README.md) - Proposal overview
- [schema-proposal.md](./schema-proposal.md) - Complete schema definition
- [implementation-roadmap.md](./implementation-roadmap.md) - Phased implementation plan
- [../../documentation/architecture/infrastructure-management.md](../../documentation/architecture/infrastructure-management.md) - Developer guide
