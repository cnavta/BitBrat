# Implementation Plan: Sprint 5 - Architecture.yaml Infrastructure Redesign

**Sprint ID**: sprint-5-anrn33
**Sprint**: 5 (Architecture Redesign)
**Goal**: Make architecture.yaml the single source of truth for infrastructure declarations across all deployment platforms
**Owner**: christophernavta
**Status**: Planning → Awaiting Approval

---

## Executive Summary

This sprint addresses the **root cause of all 11 Sprint 3 bugs** by eliminating infrastructure fragmentation across 5+ locations and replacing hardcoded lists with a declarative, platform-agnostic schema in architecture.yaml.

**Key Deliverables**:
1. **InfrastructureRegistry** - Centralized infrastructure knowledge (replaces 5+ hardcoded locations)
2. **HealthGate Pattern** - Unified health check system (replaces fragmented waitFor* functions)
3. **Docker Provider Implementation** - Complete Docker infrastructure declarations in architecture.yaml
4. **Migration Tools** - Automated migration validator and documentation

**Timeline**: 2-3 weeks
**Impact**: Zero infrastructure bugs for 2+ sprints, 85% faster context creation (15min → 2min)

---

## Problem Statement

### Current Fragmentation

Infrastructure knowledge is currently scattered across **5+ locations** with no coordination:

| Location | Purpose | Issues |
|----------|---------|--------|
| `parse-dependencies.ts:57-72` | Hardcoded infrastructure list | All services get NATS, Redis, Postgres |
| `docker-compose-strategy.ts:1028` | Hardcoded infrastructure services | Different from parse-dependencies |
| `docker-compose.local.yaml` | Infrastructure definitions | Not in architecture.yaml |
| `generate-docker-compose.ts:88-100` | Port allocation, dependency resolution | Coupled to hardcoded lists |
| `architecture.yaml:940-1112` | GCP-specific infrastructure only | Docker infrastructure invisible |

### Sprint 3 Root Cause Analysis

**All 11 Sprint 3 fixes traced back to this fragmentation:**

```
Fix #10-#11: Redis not deployed
├─ Cause: parse-dependencies.ts had Redis
├─ But: docker-compose-strategy.ts didn't
└─ Result: Bulk deployments missing Redis

Fix #6-#9: PostgreSQL connection failures
├─ Cause: waitForPostgres() in create.ts
├─ And: validatePostgresConnection() in context-resolver.ts
├─ And: autoDiscover logic in runtime.persistence
└─ Result: Three different connection validation paths with different bugs
```

---

## Proposed Architecture

### Three-Tier Design

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: platform.infrastructure (WHAT + WHY + HOW)         │
│                                                             │
│ - Declares generic capabilities (messaging, caching, etc.)  │
│ - Platform-level config (TTL, eviction policies)            │
│ - Constraints (min retention, ACID requirements)            │
│ - Intent (current use cases, living documentation)          │
└─────────────────────────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: infrastructure.{provider} (HOW TO IMPLEMENT)       │
│                                                             │
│ - Provider-specific implementations                         │
│ - Provider characteristics (scalability, cost model)        │
│ - Implementation intent (why NATS over Kafka)               │
│                                                             │
│ Example: docker.messaging.service = "nats"                  │
│          gcp.messaging.type = "pubsub"                      │
└─────────────────────────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: executionContexts.*.infrastructure (OVERRIDES)     │
│                                                             │
│ - Context-specific provider selection                       │
│ - Configuration overrides (ports, databases, SSL)           │
│                                                             │
│ Example: local.infrastructure.provider = "docker"           │
│          prod.infrastructure.provider = "gcp"               │
└─────────────────────────────────────────────────────────────┘
```

### Configuration Resolution Order

**Priority**: Context > Provider > Platform

```yaml
# 1. Platform defaults (applies to ALL providers)
platform.infrastructure.caching.config.defaultTTL: 300

# 2. Provider implementation (Docker-specific)
infrastructure.docker.caching.config.maxmemory: 256mb

# 3. Context override (local-specific)
executionContexts.local.infrastructure.caching.config.maxmemory: 128mb

# Final resolved config for local context:
caching:
  defaultTTL: 300        # From platform
  maxmemory: 128mb       # From context (overrides provider)
  evictionPolicy: allkeys-lru  # From provider (not overridden)
```

---

## Implementation Phases

### Phase 1: Foundation (Days 1-3)

**Goal**: Create core abstractions and interfaces

#### Tasks

**1.1 Create InfrastructureRegistry Interface (Day 1)**

```typescript
// File: tools/brat/src/infrastructure/types.ts

export interface InfrastructureSpec {
  capability: string;        // 'messaging', 'caching', 'persistence'
  provider: string;          // 'docker', 'gcp', 'aws', 'azure', 'k8s'
  serviceName: string;       // 'nats', 'redis', 'postgres' (Docker)
  type?: string;             // 'pubsub', 'memorystore', 'cloudsql' (GCP)
  image?: string;            // Docker image (Docker only)
  config: Record<string, any>;  // Merged config
  healthCheck?: HealthCheck; // How to validate readiness
  intent?: string[];         // Why this implementation
}

export interface HealthCheck {
  test: string[];            // ['CMD-SHELL', 'pg_isready -U bitbrat']
  interval?: string;         // '10s'
  timeout?: string;          // '5s'
  retries?: number;          // 10
  startPeriod?: string;      // '30s'
}
```

**1.2 Create InfrastructureRegistry Core (Day 2)**

```typescript
// File: tools/brat/src/infrastructure/registry.ts

export class InfrastructureRegistry {
  /**
   * Get required infrastructure for active services
   * Replaces hardcoded lists in parse-dependencies.ts
   */
  static getRequiredInfrastructure(
    repoRoot: string,
    context: string,
    services: ServiceMetadata[]
  ): InfrastructureSpec[];

  /**
   * Get infrastructure implementation by capability
   */
  static getInfrastructureByCapability(
    repoRoot: string,
    context: string,
    capability: string
  ): InfrastructureSpec | null;

  /**
   * Validate service dependencies can be satisfied
   */
  static validateDependencies(
    repoRoot: string,
    context: string,
    services: ServiceMetadata[]
  ): ValidationResult;

  /**
   * Get all infrastructure services for Docker Compose generation
   * Replaces hardcoded list in docker-compose-strategy.ts
   */
  static getInfrastructureServices(
    repoRoot: string,
    context: string
  ): string[];
}
```

**1.3 Create HealthGate Implementation (Day 3)**

```typescript
// File: tools/brat/src/infrastructure/health-gate.ts

export class HealthGate {
  /**
   * Wait for infrastructure to be ready before starting services
   * Replaces:
   * - waitForPostgres() in context/create.ts
   * - validatePostgresConnection() in context-resolver.ts
   * - docker-compose health check waits
   */
  static async waitForInfrastructure(
    specs: InfrastructureSpec[],
    options?: {
      timeout?: number;      // Milliseconds (default: 60000)
      parallel?: boolean;    // Run checks in parallel (default: true)
      logger?: Logger;       // Optional logger for progress
    }
  ): Promise<void>;

  /**
   * Check if specific infrastructure is healthy
   */
  static async checkHealth(spec: InfrastructureSpec): Promise<boolean>;
}
```

**Phase 1 Deliverables**:
- ✅ `tools/brat/src/infrastructure/types.ts` - Interface definitions
- ✅ `tools/brat/src/infrastructure/registry.ts` - Registry implementation
- ✅ `tools/brat/src/infrastructure/health-gate.ts` - Health gate implementation
- ✅ Unit tests for all three modules (90%+ coverage)

---

### Phase 2: Architecture.yaml v2 Schema (Days 4-6)

**Goal**: Define complete v2 schema in architecture.yaml

#### Tasks

**2.1 Add platform.infrastructure Section (Day 4)**

```yaml
# architecture.yaml
platform:
  version: "2.0"  # Indicate v2 schema
  infrastructure:
    messaging:
      required: true
      capabilities:
        - publish-subscribe
        - stream-retention
        - dead-letter-queue
      config:
        defaultTTL: 3600
        deliveryGuarantee: at-least-once
        deadLetterPolicy:
          maxDeliveryAttempts: 5
      constraints:
        minRetention: 86400        # MUST retain messages for 24+ hours
        maxMessageSize: 10485760   # MUST support 10MB messages
        requireDurability: true    # MUST survive restarts
      intent:
        - Event-driven orchestration between services
        - Asynchronous task processing with retry
        - Dead letter queue for failed messages

    caching:
      required: true
      capabilities:
        - key-value-store
        - expiration-policies
        - atomic-operations
      config:
        defaultTTL: 300
        evictionPolicy: allkeys-lru
      constraints:
        minMemory: 128mb           # MUST have at least 128MB
        requirePersistence: true   # MUST support RDB/AOF
      intent:
        - Idempotency tracking via distributed locks
        - Session storage for user state
        - Rate limiting counters

    persistence:
      required: true
      capabilities:
        - relational-database
        - ACID-transactions
        - connection-pooling
      config:
        connectionPool:
          min: 10
          max: 100
      constraints:
        requireACID: true
        requireSSL: true
        minVersion: "15.0"
      intent:
        - Persistent event storage with JSONB
        - State management with transactions
        - User and session data
```

**2.2 Add infrastructure.docker Section (Day 5)**

```yaml
# architecture.yaml
infrastructure:
  docker:
    config:
      scope: local                # local-only infrastructure
      scalability: vertical       # scale up single node
      costModel: zero-cost        # no runtime costs
    constraints:
      maxInstances: 1             # single-node only
      offlineCapable: true        # works without internet
    intent:
      - Primary development environment
      - Self-hosted production deployments
      - CI/CD testing

    messaging:
      service: nats
      image: nats:2.10-alpine
      ports:
        client: "4222:4222"
        http: "8222:8222"
      volumes:
        - name: nats-data
          mount: /data
      healthCheck:
        test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:8222/healthz"]
        interval: "10s"
        timeout: "5s"
        retries: 10
        startPeriod: "30s"
      env:
        NATS_JETSTREAM: "true"
      config:
        maxPayload: 10485760  # 10MB
        retention: 604800     # 7 days
      intent:
        - Lightweight message bus for development
        - JetStream for durability and replay
        - Lower resource footprint than Kafka

    caching:
      service: redis
      image: redis:7-alpine
      ports:
        main: "6379:6379"
      volumes:
        - name: redis-data
          mount: /data
      healthCheck:
        test: ["CMD", "redis-cli", "ping"]
        interval: "10s"
        timeout: "5s"
        retries: 10
        startPeriod: "30s"
      config:
        maxmemory: 256mb
        maxmemoryPolicy: allkeys-lru
        appendonly: "yes"
        appendfsync: everysec
      intent:
        - In-memory caching with persistence
        - AOF for durability across restarts
        - allkeys-lru eviction for memory management

    persistence:
      service: postgres
      image: postgres:15-alpine
      ports:
        main: "5432:5432"
      volumes:
        - name: postgres-data
          mount: /var/lib/postgresql/data
        - source: ./infrastructure/postgres/migrations
          mount: /docker-entrypoint-initdb.d
          readOnly: true
      healthCheck:
        test: ["CMD-SHELL", "pg_isready -U bitbrat"]
        interval: "10s"
        timeout: "5s"
        retries: 10
        startPeriod: "30s"
      env:
        POSTGRES_DB: bitbrat
        POSTGRES_USER: bitbrat
        POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}  # From .env
      config:
        maxConnections: 200
        sharedBuffers: 256MB
      intent:
        - Primary relational database
        - JSONB for event storage
        - ACID transactions for state management
```

**2.3 Update executionContexts with Infrastructure Config (Day 6)**

```yaml
# architecture.yaml
executionContexts:
  local:
    description: "Local Docker development environment"
    infrastructure:
      provider: docker  # Use docker provider
      # Context-specific overrides
      messaging:
        ports:
          client: "4222:4222"
      caching:
        config:
          maxmemory: 128mb  # Override for local (less memory)
      persistence:
        config:
          database: bitbrat_local
    deployment:
      type: docker-compose
      docker:
        host: unix:///var/run/docker.sock
    runtime:
      persistence:
        driver: postgres
        connection:
          host: localhost
          port: 5432
          database: bitbrat_local
          username: bitbrat
          password: ${POSTGRES_PASSWORD}
    tags: [development, local]

  staging:
    description: "Remote staging environment on bitbrat.lan"
    infrastructure:
      provider: docker  # Same Docker provider, different host
      messaging:
        ports:
          client: "4222:4222"
      caching:
        config:
          maxmemory: 512mb  # More memory for staging
      persistence:
        config:
          database: bitbrat_staging
    deployment:
      type: docker-compose
      docker:
        host: ssh://root@bitbrat.lan
        remoteDir: /opt/BitBratPlatform
    runtime:
      persistence:
        driver: postgres
        connection:
          host: bitbrat.lan
          port: 5432
          database: bitbrat_staging
          username: bitbrat
          password: ${POSTGRES_PASSWORD}
    tags: [staging, remote]
```

**Phase 2 Deliverables**:
- ✅ `architecture.yaml` updated with v2 schema
- ✅ All Docker infrastructure moved from docker-compose.local.yaml
- ✅ Validation script to verify schema correctness
- ✅ Documentation for each section

---

### Phase 3: Integration (Days 7-10)

**Goal**: Replace hardcoded infrastructure with registry calls

#### Tasks

**3.1 Update parse-dependencies.ts (Day 7)**

**Before (v1)**:
```typescript
// Hardcoded infrastructure
infrastructure.push('nats');
infrastructure.push('redis');
if (persistenceDriver === 'postgres') {
  infrastructure.push('postgres');
}
```

**After (v2)**:
```typescript
// Get infrastructure from service dependencies in architecture.yaml
const serviceDeps = serviceConfig.dependencies?.infrastructure || [];
for (const capability of serviceDeps) {
  const spec = InfrastructureRegistry.getInfrastructureByCapability(
    repoRoot,
    context,
    capability
  );
  if (spec) {
    infrastructure.push(spec.serviceName);
  }
}
```

**3.2 Update docker-compose-strategy.ts (Day 8)**

Replace hardcoded infrastructure list:
```typescript
// OLD: Hardcoded
const infrastructureServices = ['nats', 'redis', 'postgres'];

// NEW: From registry
const infrastructureServices = InfrastructureRegistry.getInfrastructureServices(
  repoRoot,
  contextName
);
```

**3.3 Update generate-docker-compose.ts (Days 9-10)**

Generate infrastructure services from architecture.yaml:
```typescript
export function generateDockerCompose(
  repoRoot: string,
  contextName: string
): ComposeConfig {
  const arch = loadArchitectureYaml(repoRoot);
  const context = arch.executionContexts[contextName];
  const provider = context.infrastructure.provider;
  const infraProvider = arch.infrastructure[provider];

  const services: Record<string, ComposeServiceDef> = {};
  const volumes: Record<string, any> = {};

  // Generate infrastructure services from provider
  for (const [capability, impl] of Object.entries(infraProvider)) {
    if (capability === 'config' || capability === 'constraints' || capability === 'intent') continue;

    const serviceName = impl.service;
    services[serviceName] = {
      image: impl.image,
      ports: Object.values(impl.ports || {}),
      volumes: impl.volumes?.map(v =>
        v.source ? `${v.source}:${v.mount}${v.readOnly ? ':ro' : ''}` : `${v.name}:${v.mount}`
      ),
      healthcheck: impl.healthCheck,
      environment: impl.env,
    };

    // Register volumes
    impl.volumes?.forEach(v => {
      if (!v.source) volumes[v.name] = {};
    });
  }

  // Generate application services (existing logic)
  // ...

  return { services, volumes, networks: { default: { name: 'bitbrat_default' } } };
}
```

**3.4 Replace waitForPostgres() with HealthGate (Day 10)**

**Before**:
```typescript
await waitForPostgres(connection, logger);
```

**After**:
```typescript
const specs = InfrastructureRegistry.getRequiredInfrastructure(
  repoRoot,
  contextName,
  activeServices
);
await HealthGate.waitForInfrastructure(specs, { logger });
```

**Phase 3 Deliverables**:
- ✅ `parse-dependencies.ts` updated to use registry
- ✅ `docker-compose-strategy.ts` updated to use registry
- ✅ `generate-docker-compose.ts` generates from architecture.yaml
- ✅ All `waitFor*()` functions replaced with HealthGate
- ✅ Integration tests passing

---

### Phase 4: Testing & Validation (Days 11-12)

**Goal**: Comprehensive testing and validation

#### Tasks

**4.1 Unit Tests (Day 11)**
- InfrastructureRegistry: 25+ tests
  - Capability resolution (happy path, missing capability, missing provider)
  - Config merging (platform → provider → context)
  - Constraint validation
- HealthGate: 15+ tests
  - Parallel health checks
  - Timeout handling
  - Error messages

**4.2 Integration Tests (Day 12)**
- Docker Compose generation from v2 schema
- End-to-end deployment (single service)
- End-to-end deployment (bulk)
- Health gate validates infrastructure
- Context creation with new schema

**4.3 Validation Script**
```bash
#!/bin/bash
# planning/sprint-5-anrn33/validate_deliverable.sh

set -e

echo "=== Phase 1: Build ==="
npm run build

echo "=== Phase 2: Unit Tests ==="
npm test -- infrastructure/registry.test.ts
npm test -- infrastructure/health-gate.test.ts

echo "=== Phase 3: Integration Tests ==="
npm test -- integration/docker-compose-generation.test.ts
npm test -- integration/infrastructure-deployment.test.ts

echo "=== Phase 4: Schema Validation ==="
node dist/tools/validate-architecture-v2.js

echo "=== Phase 5: Dry-Run Deployment ==="
npm run brat -- deploy services --all --dry-run --context local

echo "✓ All validation checks passed!"
```

**Phase 4 Deliverables**:
- ✅ 40+ unit tests (90%+ coverage)
- ✅ 10+ integration tests
- ✅ Validation script executable
- ✅ All tests passing

---

### Phase 5: Documentation & Migration (Days 13-14)

**Goal**: Complete documentation and migration guide

#### Tasks

**5.1 Developer Documentation (Day 13)**
- Update CLAUDE.md with v2 schema examples
- Create infrastructure-management.md guide
- Update troubleshooting docs with HealthGate errors

**5.2 Migration Guide (Day 14)**
- Step-by-step migration from v1 to v2
- Backward compatibility notes
- Rollback procedure

**Phase 5 Deliverables**:
- ✅ CLAUDE.md updated
- ✅ `documentation/architecture/infrastructure-management.md`
- ✅ Migration guide complete

---

## Success Metrics

| Metric | Baseline (v1) | Target (v2) | Measurement |
|--------|---------------|-------------|-------------|
| **Lines of Code (Infrastructure)** | ~500 lines hardcoded | ~50 lines (registry only) | 90% reduction |
| **Infrastructure Deployment Bugs** | 11 in Sprint 3 | 0 in 2+ sprints | Zero bugs |
| **Test Coverage** | 85% | 90%+ | Jest coverage report |
| **Context Creation Time** | 15-20 min | <2 min | 85% faster |
| **Developer Onboarding** | 2-4 hours | <1 hour | Survey feedback |

---

## Risk Mitigation

### High-Risk Areas

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Breaking changes in production** | HIGH | Backward compatibility layer, instant rollback |
| **Infrastructure dependency loops** | MEDIUM | Topological sort, cycle detection |
| **Performance regression** | LOW | Registry caching, parallel health checks |

### Rollback Procedure

If v2 migration fails:
```bash
# 1. Stop all services
npm run local:down

# 2. Restore v1 code
git checkout main -- tools/brat/src/context/parse-dependencies.ts
git checkout main -- tools/brat/src/orchestration/deployment/docker-compose-strategy.ts

# 3. Rebuild and restart
npm run build && npm run local

# 4. Verify health
npm run brat -- fleet list
```

---

## Timeline

| Phase | Days | Focus |
|-------|------|-------|
| **Phase 1: Foundation** | 1-3 | InfrastructureRegistry, HealthGate, Types |
| **Phase 2: Schema** | 4-6 | architecture.yaml v2 sections |
| **Phase 3: Integration** | 7-10 | Replace hardcoded infrastructure |
| **Phase 4: Testing** | 11-12 | Unit + integration tests |
| **Phase 5: Documentation** | 13-14 | Guides, migration, examples |

**Total**: 14 days (2-3 weeks)

---

## Exit Criteria

- [ ] All hardcoded infrastructure lists removed (parse-dependencies.ts, docker-compose-strategy.ts)
- [ ] architecture.yaml contains complete Docker infrastructure declarations
- [ ] InfrastructureRegistry passes 90%+ test coverage
- [ ] HealthGate replaces all fragmented health check logic
- [ ] Docker Compose generated entirely from architecture.yaml
- [ ] All integration tests passing
- [ ] Documentation complete and reviewed
- [ ] Zero infrastructure bugs for 2+ test deployments

---

## References

- [Technical Architecture](./technical-architecture.md) - Complete design document
- [Schema Proposal](./schema-proposal.md) - Full YAML schema
- [Implementation Roadmap](./implementation-roadmap.md) - Detailed phase breakdown
- [Migration Guide](./migration-guide.md) - Step-by-step migration
- [Sprint 3 Retrospective](../sprint-3-p8ehzo/retro.md) - Issues that motivated this redesign

---

**Status**: ✅ Ready for Review
**Next Step**: User approval before Phase 1 implementation
