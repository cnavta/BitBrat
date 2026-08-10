# Architecture.yaml v1 → v2 Migration Workflow

**Sprint**: 6 (Foundation & Production Migration)
**Task**: S6-M2.2
**Status**: Active
**Last Updated**: 2026-08-10

This document provides a comprehensive step-by-step guide for migrating from architecture.yaml v1 to v2 infrastructure model.

---

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Migration Steps](#migration-steps)
- [Before/After Examples](#beforeafter-examples)
- [Rollback Procedures](#rollback-procedures)
- [Common Issues](#common-issues)
- [Validation](#validation)

---

## Overview

### What's Changing?

**v1 Schema (Legacy)**:
- Hardcoded, provider-specific infrastructure
- `infrastructure.gcp.resources` pattern
- No explicit capability declarations
- Implicit service dependencies
- Provider selection via `infrastructure.target`

**v2 Schema (Current)**:
- **Three-tier declarative model**:
  1. **Platform** (`platform.infrastructure`): WHAT capabilities are needed + WHY
  2. **Providers** (`infrastructure.{provider}`): HOW each provider implements capabilities
  3. **Contexts** (`executionContexts.*.infrastructure`): Context-specific overrides

- **Benefits**:
  - Multi-cloud portability (docker, gcp, aws, azure, k8s)
  - Explicit service dependencies
  - Validation and type safety
  - Clear separation of concerns

### Migration Timeline

- **Estimated Effort**: 1-4 hours (depending on complexity)
- **Risk Level**: Low to Medium
- **Recommended Approach**: Incremental (local → staging → prod)

---

## Prerequisites

### 1. Run Migration Detector

```bash
# Detect current schema version and get migration report
brat config migrate

# Generate machine-readable report
brat config migrate --format json > migration-report.json
```

### 2. Backup Current Configuration

```bash
# Create backup
cp architecture.yaml architecture.yaml.v1.backup

# Commit current state
git add architecture.yaml
git commit -m "chore: Backup v1 schema before migration"
```

### 3. Review Dependencies

- Identify active services that depend on infrastructure
- Review execution contexts (local, staging, prod)
- Check for custom infrastructure configurations

---

## Migration Steps

### Step 1: Add `platform.infrastructure` Section

Define WHAT infrastructure capabilities your platform needs and WHY.

```yaml
# Add to root of architecture.yaml
platform:
  version: "2.0"

  infrastructure:
    # --------------------------------------------------------------------------
    # Messaging: Event-driven orchestration between services
    # --------------------------------------------------------------------------
    messaging:
      required: true
      capabilities:
        - publish-subscribe
        - stream-retention
        - at-least-once-delivery
      config:
        defaultTTL: 3600  # Default message TTL in seconds
        deliveryGuarantee: at-least-once
        maxRetries: 5
      constraints:
        minRetention: 86400  # 24 hours minimum
        requireDurability: true
        maxLatencyMs: 100  # Sub-100ms for real-time
      intent:
        - "Event-driven orchestration between services"
        - "Routing slips carry processing steps with messages"
        - "Decoupled publish-subscribe for scalability"

    # --------------------------------------------------------------------------
    # Caching: Distributed locks and idempotency tracking
    # --------------------------------------------------------------------------
    caching:
      required: true
      capabilities:
        - key-value-store
        - expiration-policies
        - atomic-operations
      config:
        defaultTTL: 300  # 5 minutes
        evictionPolicy: allkeys-lru
      constraints:
        minMemory: "128mb"
        requirePersistence: true  # AOF/RDB
        requireAtomicity: true  # SET NX EX support
      intent:
        - "Idempotency tracking via distributed locks (Sprint 1)"
        - "Duplicate message detection with Redis SET NX EX"
        - "Session state and rate limiting"

    # --------------------------------------------------------------------------
    # Persistence: Event storage with JSONB and full-text search
    # --------------------------------------------------------------------------
    persistence:
      required: true
      capabilities:
        - relational-database
        - ACID-transactions
        - JSONB-support
        - full-text-search
      config:
        connectionPool:
          min: 10
          max: 100
        statementTimeout: 30000  # 30s
        idleTimeout: 10000  # 10s
      constraints:
        requireACID: true
        requireSSL: true
        requireJSONB: true
      intent:
        - "Persistent event storage with flexible JSONB payload"
        - "Full-text search for event query capabilities"
        - "Primary data store as of Sprint 344"
```

### Step 2: Add `infrastructure.docker` Provider

Define HOW Docker implements the platform capabilities.

```yaml
# Replace or restructure existing infrastructure section
infrastructure:
  # --------------------------------------------------------------------------
  # Docker Provider: Local development and self-hosted deployments
  # --------------------------------------------------------------------------
  docker:
    config:
      scope: local
      scalability: vertical
      costModel: zero-cost
    constraints:
      maxInstances: 1
      offlineCapable: true

    # Messaging: NATS JetStream
    messaging:
      service: nats
      image: nats:2.10-alpine
      ports:
        client: "4222:4222"
        http: "8222:8222"
      volumes:
        - type: named
          name: nats-data
          target: /data
      env:
        NATS_JETSTREAM_MAX_MEM: "-1"
        NATS_JETSTREAM_MAX_FILE: "10Gi"
      config:
        jetstream: true
        persistence: true
        maxPayload: 10485760  # 10MB
        retention: 604800  # 7 days
      healthCheck:
        test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:8222/healthz"]
        interval: "10s"
        timeout: "5s"
        retries: 10

    # Caching: Redis with AOF
    caching:
      service: redis
      image: redis:7-alpine
      ports:
        main: "6379:6379"
      volumes:
        - type: named
          name: redis-data
          target: /data
      command:
        - redis-server
        - "--appendonly"
        - "yes"
        - "--maxmemory"
        - "512mb"
        - "--maxmemory-policy"
        - "allkeys-lru"
      healthCheck:
        test: ["CMD", "redis-cli", "ping"]
        interval: "10s"
        timeout: "5s"
        retries: 10

    # Persistence: PostgreSQL 15
    persistence:
      service: postgres
      image: postgres:15-alpine
      ports:
        main: "5432:5432"
      volumes:
        - type: named
          name: postgres-data
          target: /var/lib/postgresql/data
      env:
        POSTGRES_DB: bitbrat
        POSTGRES_USER: bitbrat
        POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      config:
        database: bitbrat
        user: bitbrat
        maxConnections: 100
      healthCheck:
        test: ["CMD-SHELL", "pg_isready -U bitbrat -d bitbrat"]
        interval: "10s"
        timeout: "5s"
        retries: 10
```

### Step 3: Update Service Dependencies

Add explicit `dependencies.infrastructure` declarations to services.

```yaml
services:
  ingress-egress:
    active: true
    # ... other fields ...

    # Add infrastructure dependencies
    dependencies:
      infrastructure:
        - messaging  # Publishes to internal.ingress.v1
        - caching    # Idempotency tracking (Sprint 1)
        - persistence  # Snapshot mode

  llm-bot:
    active: true
    # ... other fields ...

    dependencies:
      infrastructure:
        - messaging  # Consumes from internal.llmbot.v1
        - caching    # Idempotency tracking (Sprint 1)
        - persistence  # Conversation memory

  event-router:
    active: true
    # ... other fields ...

    dependencies:
      infrastructure:
        - messaging  # Consumes/publishes events
        - persistence  # Command lookup
```

### Step 4: Update Execution Contexts

Add `infrastructure.provider` to each execution context.

```yaml
executionContexts:
  local:
    description: Local Docker development environment
    deployment:
      type: docker-compose
      docker:
        host: unix:///var/run/docker.sock

    # Add infrastructure configuration
    infrastructure:
      provider: docker  # Use Docker provider for local

      # Optional: Context-specific overrides
      caching:
        config:
          maxmemory: "256mb"  # Reduce for local dev

      persistence:
        config:
          maxConnections: 50  # Lower pool for local

  staging:
    description: Remote staging environment
    deployment:
      type: docker-compose
      docker:
        host: ssh://root@bitbrat.lan
        remoteDir: /opt/bitbrat-staging

    infrastructure:
      provider: docker  # Docker for staging too

      caching:
        config:
          maxmemory: "1gb"  # More memory for staging

      persistence:
        config:
          maxConnections: 100
```

### Step 5: Remove Legacy Patterns

Remove v1-specific patterns:

```yaml
# ❌ REMOVE: Legacy infrastructure.gcp.resources
infrastructure:
  gcp:
    resources:  # DELETE THIS SECTION
      pubsub: [...]
      cloudsql: [...]

# ❌ REMOVE: Legacy infrastructure.target
infrastructure:
  target: gcp  # DELETE THIS FIELD

# ✅ KEEP: GCP provider (if using GCP in production)
# But restructure to v2 format:
infrastructure:
  gcp:
    messaging:
      type: pubsub
      config: ...
    persistence:
      type: cloudsql
      config: ...
```

### Step 6: Validate Migration

```bash
# Validate with v2 schema
brat config validate --schema v2

# Expected output:
# ✅ All validations passed!
# OR
# ⚠️  Warnings: [list of warnings]

# If errors, review and fix issues
# Then re-validate
```

### Step 7: Test Deployment

```bash
# Test local deployment
brat deploy services --all --context local

# Verify services are healthy
docker ps  # Check all services running

# Check logs for errors
brat local:logs

# Test basic functionality
brat chat  # Interactive chat test
```

---

## Before/After Examples

### Example 1: Minimal Migration

**Before (v1)**:
```yaml
name: BitBrat Platform
project:
  version: 1.0.0

infrastructure:
  target: gcp
  gcp:
    resources:
      pubsub: [internal.ingress.v1]

services:
  llm-bot:
    active: true
    entry: src/apps/llm-bot-service.ts
```

**After (v2)**:
```yaml
name: BitBrat Platform
project:
  version: 1.0.0

platform:
  version: "2.0"
  infrastructure:
    messaging:
      required: true
      capabilities: [publish-subscribe]

infrastructure:
  docker:
    messaging:
      service: nats
      image: nats:alpine

executionContexts:
  local:
    description: Local development
    deployment:
      type: docker-compose
    infrastructure:
      provider: docker

services:
  llm-bot:
    active: true
    entry: src/apps/llm-bot-service.ts
    dependencies:
      infrastructure:
        - messaging
```

### Example 2: Multi-Environment Migration

**Before (v1)**:
```yaml
infrastructure:
  target: gcp
  gcp:
    resources:
      pubsub: [...]
      cloudsql: [...]

deploymentTargets:
  local:
    type: docker-compose
  prod:
    type: cloud-run
```

**After (v2)**:
```yaml
platform:
  version: "2.0"
  infrastructure:
    messaging: { required: true, ... }
    persistence: { required: true, ... }

infrastructure:
  docker:
    messaging: { service: nats, ... }
    persistence: { service: postgres, ... }

  gcp:
    messaging: { type: pubsub, ... }
    persistence: { type: cloudsql, ... }

executionContexts:
  local:
    deployment: { type: docker-compose }
    infrastructure:
      provider: docker

  prod:
    deployment: { type: cloud-run }
    infrastructure:
      provider: gcp
```

---

## Rollback Procedures

### Scenario 1: Migration Failed Validation

```bash
# Restore from backup
cp architecture.yaml.v1.backup architecture.yaml

# Verify restoration
brat config validate

# Commit rollback
git add architecture.yaml
git commit -m "chore: Rollback to v1 schema - migration failed validation"
```

### Scenario 2: Deployment Failures

```bash
# 1. Stop failed deployment
brat local:down  # or staging deployment

# 2. Restore v1 configuration
git checkout HEAD~1 architecture.yaml

# 3. Redeploy with v1
brat deploy services --all --context local

# 4. Investigate issues
# Review migration report: brat config migrate
# Check validation errors: brat config validate --schema v2
```

### Scenario 3: Partial Migration (Staged Rollback)

If you migrated incrementally (e.g., local works but staging fails):

```bash
# Rollback only staging context
git show HEAD~1:architecture.yaml > /tmp/arch-v1.yaml

# Extract staging context from v1
# Manually copy staging section back

# Or: Cherry-pick specific changes
git revert <commit-hash> --no-commit
git reset HEAD executionContexts.local  # Keep local
git checkout -- executionContexts.local
git commit -m "chore: Rollback staging to v1, keep local on v2"
```

---

## Common Issues

### Issue 1: "Missing platform.infrastructure section"

**Cause**: Forgot to add platform section

**Solution**:
```yaml
# Add to root of architecture.yaml
platform:
  version: "2.0"
  infrastructure:
    messaging: { required: true, ... }
    caching: { required: true, ... }
    persistence: { required: true, ... }
```

### Issue 2: "infrastructure.docker not found"

**Cause**: Missing Docker provider implementation

**Solution**:
```yaml
infrastructure:
  docker:
    messaging: { service: nats, image: nats:alpine, ... }
    caching: { service: redis, image: redis:alpine, ... }
    persistence: { service: postgres, image: postgres:alpine, ... }
```

### Issue 3: "Service missing infrastructure dependencies"

**Cause**: Services don't declare what infrastructure they need

**Solution**:
```yaml
services:
  your-service:
    active: true
    dependencies:
      infrastructure:
        - messaging  # If service publishes/consumes messages
        - caching    # If service uses Redis
        - persistence  # If service uses database
```

### Issue 4: "Execution context missing infrastructure.provider"

**Cause**: Contexts don't specify which provider to use

**Solution**:
```yaml
executionContexts:
  local:
    infrastructure:
      provider: docker  # or gcp, aws, azure
```

### Issue 5: "Legacy infrastructure.gcp.resources detected"

**Cause**: Old v1 pattern still present

**Solution**: Restructure GCP provider to v2 format:

```yaml
# ❌ OLD (v1)
infrastructure:
  gcp:
    resources:
      pubsub: [...]

# ✅ NEW (v2)
infrastructure:
  gcp:
    messaging:
      type: pubsub
      config: ...
```

---

## Validation

### Pre-Migration Checklist

- [ ] Run `brat config migrate` to get migration report
- [ ] Backup current architecture.yaml
- [ ] Review breaking changes in migration report
- [ ] Identify all active services
- [ ] Map service infrastructure dependencies
- [ ] Review execution contexts

### Migration Checklist

- [ ] Add `platform.version: "2.0"`
- [ ] Add `platform.infrastructure` section
- [ ] Add `infrastructure.docker` provider
- [ ] Update all active services with `dependencies.infrastructure`
- [ ] Update all execution contexts with `infrastructure.provider`
- [ ] Remove legacy v1 patterns (`infrastructure.gcp.resources`, `infrastructure.target`)

### Post-Migration Checklist

- [ ] Run `brat config validate --schema v2` (should pass with 0 errors)
- [ ] Test local deployment: `brat deploy services --all --context local`
- [ ] Verify all services healthy: `docker ps`
- [ ] Check service logs for errors: `brat local:logs`
- [ ] Test basic functionality: `brat chat`
- [ ] Commit migration: `git add architecture.yaml && git commit -m "feat: Migrate to architecture.yaml v2 schema"`

### Production Migration Checklist

- [ ] Complete and validate local migration first
- [ ] Complete and validate staging migration
- [ ] Review production-specific infrastructure (GCP, AWS, etc.)
- [ ] Schedule production migration during low-traffic window
- [ ] Prepare rollback plan
- [ ] Execute migration with blue/green deployment
- [ ] Monitor production for 24 hours
- [ ] Document any issues encountered

---

## Next Steps

After completing migration:

1. **Remove v1 Backup** (after 1 week of stable operation)
   ```bash
   rm architecture.yaml.v1.backup
   ```

2. **Update Documentation**
   - Update team wikis with v2 examples
   - Share migration experience with team
   - Document any custom patterns or edge cases

3. **CI/CD Integration**
   ```bash
   # Add to CI pipeline
   brat config validate --schema v2
   ```

4. **Explore v2 Features**
   - Multi-cloud deployments (GCP + AWS)
   - Custom provider implementations
   - Advanced capability constraints

---

## Additional Resources

- **JSON Schema**: `documentation/schemas/architecture.v2.json`
- **Migration Detector**: `tools/brat/src/validation/migration-detector.ts`
- **Validation Guide**: `documentation/architecture/infrastructure-management.md`
- **Sprint 6 Plan**: `planning/sprint-6-foundation/execution-plan.md`

---

**Need Help?**

- Run `brat config migrate --format json` for machine-readable report
- Check migration detector tests for examples: `tools/brat/src/validation/migration-detector.test.ts`
- Review current architecture.yaml for v2 reference patterns
