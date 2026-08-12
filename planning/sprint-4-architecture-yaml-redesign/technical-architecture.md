# Technical Architecture: Architecture.yaml v2 Implementation

**Sprint**: 4
**Role**: Architect
**Date**: 2026-08-09
**Status**: Design Document
**Owner**: Architecture Team

## Executive Summary

This document provides the technical architecture for implementing the architecture.yaml v2 redesign. It analyzes the current fragmented infrastructure management, proposes a unified registry-based architecture, and details the implementation strategy for transitioning from hardcoded infrastructure to platform-agnostic capability declarations.

**Key Objectives**:
1. Eliminate infrastructure fragmentation across 5+ locations
2. Replace hardcoded infrastructure lists with declarative schema
3. Enable platform-agnostic deployments (Docker, GCP, AWS, Azure, K8s)
4. Unify single-service and bulk deployment code paths
5. Implement health gate pattern for infrastructure readiness

**Impact**:
- **Code Reduction**: Remove ~500 lines of hardcoded infrastructure
- **Bug Prevention**: Fix root cause of all 11 Sprint 3 infrastructure bugs
- **Developer Experience**: Context creation from 15+ minutes → 2 minutes
- **Platform Flexibility**: Deploy to any platform without code changes

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Proposed Architecture](#2-proposed-architecture)
3. [Core Components](#3-core-components)
4. [Implementation Strategy](#4-implementation-strategy)
5. [Data Flow](#5-data-flow)
6. [Migration Path](#6-migration-path)
7. [Risk Analysis](#7-risk-analysis)
8. [Success Metrics](#8-success-metrics)

---

## 1. Current State Analysis

### 1.1 Infrastructure Fragmentation

Infrastructure knowledge is currently scattered across multiple locations with no coordination:

| Location | Purpose | Issues |
|----------|---------|--------|
| `parse-dependencies.ts:57-72` | Hardcoded infrastructure list | All services get NATS, Redis, Postgres |
| `docker-compose-strategy.ts:1028` | Hardcoded infrastructure services | Different from parse-dependencies |
| `docker-compose.local.yaml` | Infrastructure definitions | Not in architecture.yaml |
| `generate-docker-compose.ts:88-100` | Port allocation, dependency resolution | Coupled to hardcoded lists |
| `architecture.yaml:940-1112` | GCP-specific infrastructure only | Docker infrastructure invisible |

**Sprint 3 Root Cause Analysis**:

All 11 fixes in Sprint 3 traced back to this fragmentation:

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

Fix #3-#4: Docker Compose generation gaps
├─ Cause: generate-docker-compose.ts doesn't coordinate with base file
└─ Result: Infrastructure services not included in generated compose
```

### 1.2 Current Infrastructure Dependencies (Hardcoded)

From `parse-dependencies.ts:54-72`:

```typescript
// All services need NATS for messaging
infrastructure.push('nats');

// Check for persistence driver
const persistenceDriver = getPersistenceDriver(serviceConfig, metadata);
if (persistenceDriver === 'postgres') {
  infrastructure.push('postgres');
} else if (persistenceDriver === 'firestore') {
  infrastructure.push('firebase-emulator');
}

// Sprint 3 Fix #10: Redis is platform-wide infrastructure
if (!infrastructure.includes('redis')) {
  infrastructure.push('redis');
}
```

**Problems**:
1. **Static List**: Every service gets same infrastructure regardless of needs
2. **No Validation**: Typos or missing infrastructure not caught until deployment
3. **No Extensibility**: Adding new infrastructure requires code changes
4. **No Platform Awareness**: Docker-specific, can't adapt to GCP/AWS

### 1.3 Current Docker Compose Generation

From `generate-docker-compose.ts:59-100`:

```typescript
export function generateServiceCompose(
  metadata: ServiceMetadata,
  dependencies: ServiceDependencies,
  contextName: string
): ComposeServiceDef {
  // Build args from architecture.yaml metadata
  const buildArgs: Record<string, string> = {
    SERVICE_NAME: serviceName,
    SERVICE_ENTRY: metadata.entry.replace('src/', 'dist/').replace('.ts', '.js'),
    SERVICE_PORT: '3000',
  };

  // depends_on with health check conditions
  const dependsOn: Record<string, { condition: string }> = {};

  for (const infra of dependencies.infrastructure) {
    dependsOn[infra] = { condition: 'service_healthy' };
  }
```

**Problems**:
1. **Coupled to parse-dependencies**: Depends on hardcoded infrastructure list
2. **No Infrastructure Source**: Infrastructure services come from docker-compose.local.yaml, not architecture.yaml
3. **No Health Gate**: Assumes infrastructure is ready (health checks in compose only)
4. **No Provider Abstraction**: Docker-only, can't generate for other platforms

### 1.4 Architecture Gaps

| Capability | Current State | Required State |
|------------|---------------|----------------|
| **Single Source of Truth** | Infrastructure in 5+ places | All in architecture.yaml |
| **Platform Agnostic** | 100% Docker-specific | Docker/GCP/AWS/Azure support |
| **Validation** | Runtime failures only | Schema validation at load time |
| **Extensibility** | Requires code changes | Declarative configuration |
| **Health Gates** | docker-compose healthchecks | Programmatic health validation |
| **Provider Selection** | Hardcoded per environment | Context-driven provider binding |

---

## 2. Proposed Architecture

### 2.1 Three-Tier Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: platform.infrastructure (WHAT + WHY + HOW)         │
│                                                             │
│ - Declares generic capabilities (messaging, caching, etc.)  │
│ - Platform-level config (TTL, eviction policies)            │
│ - Constraints (min retention, ACID requirements)            │
│ - Intent (current use cases, living documentation)          │
│                                                             │
│ Example: messaging.config.defaultTTL = 3600                 │
│          messaging.constraints.minRetention = 86400         │
│          messaging.intent = ["Event-driven orchestration"]  │
└─────────────────────────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: infrastructure.{provider} (HOW TO IMPLEMENT)       │
│                                                             │
│ - Provider-specific implementations                         │
│ - Provider characteristics (scalability, cost model)        │
│ - Provider constraints (max instances, offline capable)     │
│ - Implementation intent (why NATS over Kafka)               │
│                                                             │
│ Example: docker.messaging.service = "nats"                  │
│          docker.messaging.intent = ["Lightweight for dev"]  │
│          gcp.messaging.type = "pubsub"                      │
└─────────────────────────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: executionContexts.*.infrastructure (OVERRIDES)     │
│                                                             │
│ - Context-specific provider selection                       │
│ - Configuration overrides (ports, databases, SSL)           │
│ - Prerequisites, limitations, guarantees                    │
│ - Promotion path (local → staging → prod)                   │
│                                                             │
│ Example: local.infrastructure.provider = "docker"           │
│          staging.infrastructure.provider = "docker"         │
│          prod.infrastructure.provider = "gcp"               │
└─────────────────────────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Runtime: InfrastructureRegistry + Health Gates              │
│                                                             │
│ InfrastructureRegistry:                                     │
│   - Loads architecture.yaml once                            │
│   - Resolves provider based on execution context            │
│   - Merges config (platform → provider → context)           │
│   - Validates constraints at load time                      │
│                                                             │
│ HealthGate:                                                 │
│   - Waits for infrastructure readiness                      │
│   - Parallel health checks with timeout                     │
│   - Detailed error messages on failure                      │
│   - Replaces fragmented waitForPostgres/Redis/NATS          │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Configuration Resolution Order

The system resolves infrastructure configuration using a 3-level merge:

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

**Priority**: Context > Provider > Platform

### 2.3 Provider Abstraction

Each provider implements the same capability interface:

```typescript
interface InfrastructureProvider {
  // Metadata
  name: string;              // 'docker', 'gcp', 'aws', 'azure', 'k8s'
  config: ProviderConfig;    // Scope, scalability, cost model
  constraints: ProviderConstraints;  // Max instances, offline capable
  intent: string[];          // Why this provider, migration path

  // Capabilities
  messaging?: MessagingImplementation;
  caching?: CachingImplementation;
  persistence?: PersistenceImplementation;
  observability?: ObservabilityImplementation;
}

interface MessagingImplementation {
  service: string;           // 'nats', 'pubsub', 'sqs', etc.
  image?: string;            // Docker only
  type?: string;             // Cloud providers
  config: Record<string, any>;  // Provider-specific config
  healthCheck?: HealthCheck; // How to validate readiness
  intent?: string[];         // Why this implementation
}
```

**Benefits**:
- Uniform API across all providers
- Easy to add new providers (implement interface)
- Platform-agnostic service code
- Automated validation of provider compliance

---

## 3. Core Components

### 3.1 InfrastructureRegistry

**Responsibilities**:
- Load and parse `architecture.yaml` (v2 schema)
- Resolve provider based on execution context
- Merge configuration (platform → provider → context)
- Validate constraints (platform requirements vs provider capabilities)
- Cache loaded infrastructure for performance

**API**:

```typescript
export class InfrastructureRegistry {
  /**
   * Get required infrastructure for a list of services
   *
   * Replaces hardcoded lists in parse-dependencies.ts
   *
   * @param repoRoot - Repository root
   * @param context - Execution context name
   * @param services - List of active services
   * @returns Infrastructure specs with provider implementations
   */
  static getRequiredInfrastructure(
    repoRoot: string,
    context: string,
    services: ServiceMetadata[]
  ): InfrastructureSpec[];

  /**
   * Get infrastructure implementation by capability
   *
   * Example: getInfrastructureByCapability('messaging', 'local')
   *          Returns NATS implementation for Docker provider
   *
   * @param repoRoot - Repository root
   * @param context - Execution context name
   * @param capability - Capability name (messaging, caching, persistence)
   * @returns Infrastructure spec for the capability
   */
  static getInfrastructureByCapability(
    repoRoot: string,
    context: string,
    capability: string
  ): InfrastructureSpec | null;

  /**
   * Validate service dependencies can be satisfied
   *
   * Checks:
   * - All required capabilities have provider implementations
   * - Provider satisfies platform constraints
   * - Service-to-service dependencies are active
   *
   * @param repoRoot - Repository root
   * @param context - Execution context name
   * @param services - List of active services
   * @returns Validation result with errors/warnings
   */
  static validateDependencies(
    repoRoot: string,
    context: string,
    services: ServiceMetadata[]
  ): ValidationResult;

  /**
   * Get all infrastructure services for Docker Compose generation
   *
   * Replaces hardcoded list in docker-compose-strategy.ts
   *
   * @param repoRoot - Repository root
   * @param context - Execution context name
   * @returns List of infrastructure service names (nats, redis, postgres)
   */
  static getInfrastructureServices(
    repoRoot: string,
    context: string
  ): string[];
}
```

**Internal Structure**:

```typescript
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
```

### 3.2 HealthGate

**Responsibilities**:
- Wait for infrastructure to be ready before starting services
- Parallel health checks with configurable timeout
- Detailed error messages with troubleshooting hints
- Replaces fragmented health check logic

**API**:

```typescript
export class HealthGate {
  /**
   * Wait for infrastructure to be ready
   *
   * Replaces:
   * - waitForPostgres() in context/create.ts
   * - validatePostgresConnection() in context-resolver.ts
   * - docker-compose health check waits
   *
   * @param specs - Infrastructure specs to wait for
   * @param options - Timeout, parallel, etc.
   * @returns Promise that resolves when all infrastructure is healthy
   * @throws Error with detailed troubleshooting if timeout
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
   *
   * @param spec - Infrastructure spec
   * @returns True if healthy, false otherwise
   */
  static async checkHealth(spec: InfrastructureSpec): Promise<boolean>;
}
```

**Health Check Strategies**:

| Infrastructure | Strategy | Command |
|----------------|----------|---------|
| PostgreSQL | pg_isready + connection test | `pg_isready -U bitbrat && psql -c 'SELECT 1'` |
| Redis | redis-cli ping | `redis-cli ping` (expect `PONG`) |
| NATS | HTTP /healthz endpoint | `curl -f http://localhost:8222/healthz` |
| Firestore | HTTP emulator endpoint | `curl -f http://localhost:8080` |

**Error Messages**:

```
❌ Infrastructure health check failed: postgres

Cause: Connection timeout after 30s

Troubleshooting:
1. Check PostgreSQL is running: docker ps --filter name=postgres
2. Check PostgreSQL logs: docker logs bitbrat-postgres-1
3. Verify connection: docker exec -it bitbrat-postgres-1 pg_isready -U bitbrat
4. Check architecture.yaml: infrastructure.docker.persistence.healthCheck

Health Check Command: pg_isready -U bitbrat
Expected: accepting connections
Actual: timeout (no response)

See: documentation/troubleshooting/infrastructure.md#postgres-timeout
```

### 3.3 Service Dependency Resolution

**New Flow** (replaces hardcoded logic in `parse-dependencies.ts`):

```typescript
// OLD (v1): Hardcoded infrastructure for all services
infrastructure.push('nats');
infrastructure.push('redis');
if (persistenceDriver === 'postgres') {
  infrastructure.push('postgres');
}

// NEW (v2): Declarative dependencies from architecture.yaml
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

**Architecture.yaml Declaration**:

```yaml
services:
  llm-bot:
    dependencies:
      infrastructure:
        - messaging       # Requires message bus (NATS, Pub/Sub, SQS)
        - caching         # Requires cache (Redis, Memorystore, ElastiCache)
        - persistence     # Requires database (Postgres, Cloud SQL, RDS)
      services:
        - auth            # Requires auth service
        - tool-gateway    # Requires tool-gateway service
```

**Benefits**:
- Explicit dependencies in architecture.yaml (no code reading required)
- Per-service customization (not all services need all infrastructure)
- Automatic validation (missing infrastructure caught at load time)
- Platform-agnostic (same declaration works for Docker, GCP, AWS)

---

## 4. Implementation Strategy

### 4.1 Phase Breakdown

Implementation follows a 5-phase approach with clear exit criteria:

| Phase | Duration | Focus | Key Deliverables |
|-------|----------|-------|------------------|
| **Phase 1: Foundation** | 2 weeks | Schema, validation, migration tools | JSON Schema, migration validator, documentation |
| **Phase 2: Registry** | 2 weeks | InfrastructureRegistry, HealthGate | Central registry, health checks, updated parse-dependencies |
| **Phase 3: Docker Compose** | 1 week | Compose generation from registry | Rewritten generate-docker-compose, deprecated docker-compose.local.yaml |
| **Phase 4: Migration** | 2 weeks | Production migration, validation | All contexts migrated, validation suite, zero downtime |
| **Phase 5: Expansion** | 4+ weeks | Cloud providers (optional) | AWS, Azure, K8s providers |

### 4.2 Phase 1: Foundation (Weeks 1-2)

**Goal**: Establish schema, validation, and migration tooling

#### Task 1.1: JSON Schema Definition (3 days)

Create `documentation/schemas/architecture.v2.json` with:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "BitBrat Architecture v2",
  "type": "object",
  "required": ["platform", "infrastructure", "services", "executionContexts"],
  "properties": {
    "platform": {
      "type": "object",
      "required": ["version", "infrastructure"],
      "properties": {
        "version": {"type": "string", "const": "2.0"},
        "infrastructure": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/definitions/platformCapability"
          }
        }
      }
    },
    "infrastructure": {
      "type": "object",
      "additionalProperties": {
        "$ref": "#/definitions/provider"
      }
    }
  },
  "definitions": {
    "platformCapability": {
      "type": "object",
      "required": ["required", "capabilities"],
      "properties": {
        "required": {"type": "boolean"},
        "capabilities": {"type": "array", "items": {"type": "string"}},
        "config": {"type": "object"},
        "constraints": {"type": "object"},
        "intent": {"type": "array", "items": {"type": "string"}}
      }
    },
    "provider": {
      "type": "object",
      "properties": {
        "config": {"$ref": "#/definitions/providerConfig"},
        "constraints": {"$ref": "#/definitions/providerConstraints"},
        "intent": {"type": "array", "items": {"type": "string"}},
        "messaging": {"$ref": "#/definitions/implementation"},
        "caching": {"$ref": "#/definitions/implementation"},
        "persistence": {"$ref": "#/definitions/implementation"}
      }
    }
  }
}
```

**Validation Rules**:
- All `required: true` capabilities MUST have provider implementations
- Provider implementations MUST satisfy platform constraints
- Context provider MUST exist in infrastructure section
- Service dependencies.infrastructure MUST be subset of platform.infrastructure keys

#### Task 1.2: Migration Validator (4 days)

Create `tools/brat/src/oclif-commands/config/migrate.ts`:

```typescript
export default class ConfigMigrate extends BratCommand {
  static description = 'Migrate architecture.yaml from v1 to v2 schema';

  static flags = {
    ...BratCommand.baseFlags,
    from: Flags.string({
      description: 'Source schema version',
      default: 'v1',
    }),
    to: Flags.string({
      description: 'Target schema version',
      default: 'v2',
    }),
    dryRun: Flags.boolean({
      description: 'Preview migration without modifying files',
      default: false,
    }),
    report: Flags.boolean({
      description: 'Generate migration report',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigMigrate);

    // 1. Detect current schema version
    const currentVersion = detectSchemaVersion(this.repoRoot);

    // 2. Validate source version matches
    if (currentVersion !== flags.from) {
      this.error(`Current schema is ${currentVersion}, expected ${flags.from}`);
    }

    // 3. Generate migration plan
    const plan = generateMigrationPlan(this.repoRoot, flags.from, flags.to);

    // 4. Show migration report
    if (flags.report || flags.dryRun) {
      this.log(formatMigrationReport(plan));
    }

    // 5. Apply migration (unless dry-run)
    if (!flags.dryRun) {
      await applyMigration(this.repoRoot, plan);
      this.log('✓ Migration complete');
    }
  }
}
```

### 4.3 Phase 2: InfrastructureRegistry (Weeks 3-4)

**Goal**: Centralize infrastructure knowledge, replace fragmented patterns

#### Task 2.1: Registry Core (5 days)

Create `tools/brat/src/infrastructure/registry.ts`:

```typescript
export class InfrastructureRegistry {
  private static cache = new Map<string, any>();

  static getRequiredInfrastructure(
    repoRoot: string,
    context: string,
    services: ServiceMetadata[]
  ): InfrastructureSpec[] {
    // 1. Load architecture.yaml
    const arch = this.loadArchitecture(repoRoot);

    // 2. Get execution context
    const ctx = arch.executionContexts[context];
    const provider = ctx.infrastructure.provider;

    // 3. Collect unique capabilities from all services
    const capabilities = new Set<string>();
    for (const service of services) {
      const svcConfig = arch.services[service.name];
      const deps = svcConfig?.dependencies?.infrastructure || [];
      deps.forEach((cap: string) => capabilities.add(cap));
    }

    // 4. Resolve each capability to provider implementation
    const specs: InfrastructureSpec[] = [];
    for (const capability of capabilities) {
      const spec = this.resolveCapability(arch, provider, capability, context);
      if (spec) {
        specs.push(spec);
      }
    }

    return specs;
  }

  private static resolveCapability(
    arch: any,
    provider: string,
    capability: string,
    context: string
  ): InfrastructureSpec | null {
    // 1. Get platform capability config
    const platformCap = arch.platform.infrastructure[capability];
    if (!platformCap) {
      throw new Error(`Unknown capability: ${capability}`);
    }

    // 2. Get provider implementation
    const providerImpl = arch.infrastructure[provider]?.[capability];
    if (!providerImpl) {
      throw new Error(`Provider '${provider}' does not implement '${capability}'`);
    }

    // 3. Merge config (platform → provider → context)
    const config = {
      ...platformCap.config,
      ...providerImpl.config,
      ...arch.executionContexts[context].infrastructure?.[capability]?.config,
    };

    // 4. Validate constraints
    this.validateConstraints(platformCap.constraints, providerImpl, capability);

    // 5. Return spec
    return {
      capability,
      provider,
      serviceName: providerImpl.service || providerImpl.type,
      image: providerImpl.image,
      type: providerImpl.type,
      config,
      healthCheck: providerImpl.healthCheck,
      intent: providerImpl.intent,
    };
  }

  private static validateConstraints(
    constraints: any,
    implementation: any,
    capability: string
  ): void {
    // Example: Check minMemory constraint for caching
    if (constraints.minMemory && implementation.config.maxmemory) {
      const minMemoryBytes = parseMemory(constraints.minMemory);
      const maxMemoryBytes = parseMemory(implementation.config.maxmemory);

      if (maxMemoryBytes < minMemoryBytes) {
        throw new Error(
          `Provider implementation for '${capability}' violates constraint 'minMemory':\n` +
          `  Platform requires: ${constraints.minMemory}\n` +
          `  Provider provides: ${implementation.config.maxmemory}`
        );
      }
    }
  }
}
```

#### Task 2.2: Health Gate Pattern (3 days)

Create `tools/brat/src/infrastructure/health-gate.ts`:

```typescript
export class HealthGate {
  static async waitForInfrastructure(
    specs: InfrastructureSpec[],
    options: {
      timeout?: number;
      parallel?: boolean;
      logger?: Logger;
    } = {}
  ): Promise<void> {
    const timeout = options.timeout || 60000;
    const parallel = options.parallel !== false;
    const logger = options.logger;

    logger?.info(`Waiting for ${specs.length} infrastructure service(s) to be ready...`);

    const checks = specs.map((spec) => ({
      spec,
      check: () => this.checkHealth(spec, logger),
    }));

    if (parallel) {
      await this.waitParallel(checks, timeout, logger);
    } else {
      await this.waitSequential(checks, timeout, logger);
    }

    logger?.info('✓ All infrastructure services are healthy');
  }

  private static async waitParallel(
    checks: any[],
    timeout: number,
    logger?: Logger
  ): Promise<void> {
    const results = await Promise.allSettled(
      checks.map((c) =>
        this.pollUntilHealthy(c.spec, c.check, timeout, logger)
      )
    );

    const failures = results
      .map((r, i) => ({ result: r, spec: checks[i].spec }))
      .filter((x) => x.result.status === 'rejected');

    if (failures.length > 0) {
      const errors = failures
        .map((f) => `  - ${f.spec.serviceName}: ${f.result.reason}`)
        .join('\n');
      throw new Error(
        `Infrastructure health check failed:\n${errors}\n\n` +
        `See: documentation/troubleshooting/infrastructure.md`
      );
    }
  }

  private static async pollUntilHealthy(
    spec: InfrastructureSpec,
    check: () => Promise<boolean>,
    timeout: number,
    logger?: Logger
  ): Promise<void> {
    const start = Date.now();
    const interval = 2000; // Poll every 2 seconds

    while (Date.now() - start < timeout) {
      try {
        const healthy = await check();
        if (healthy) {
          logger?.info(`✓ ${spec.serviceName} is healthy`);
          return;
        }
      } catch (error) {
        // Ignore errors during polling, just retry
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(
      `Timeout after ${timeout}ms\n\n` +
      `Troubleshooting:\n` +
      `1. Check service is running: docker ps --filter name=${spec.serviceName}\n` +
      `2. Check service logs: docker logs bitbrat-${spec.serviceName}-1\n` +
      `3. Verify health check: ${JSON.stringify(spec.healthCheck, null, 2)}`
    );
  }

  static async checkHealth(spec: InfrastructureSpec, logger?: Logger): Promise<boolean> {
    if (!spec.healthCheck) {
      // No health check defined, assume healthy
      return true;
    }

    const { test } = spec.healthCheck;
    const [cmd, ...args] = test;

    // For CMD tests, execute directly
    if (cmd === 'CMD' || cmd === 'CMD-SHELL') {
      const result = await execCmd(args[0], args.slice(1), { timeout: 5000 });
      return result.code === 0;
    }

    // For Docker exec tests
    if (cmd === 'docker') {
      const result = await execCmd('docker', args, { timeout: 5000 });
      return result.code === 0;
    }

    logger?.warn(`Unknown health check type: ${cmd}`);
    return false;
  }
}
```

#### Task 2.3: Update parse-dependencies.ts (2 days)

**Before (v1)**:

```typescript
// Hardcoded infrastructure
infrastructure.push('nats');
if (!infrastructure.includes('redis')) {
  infrastructure.push('redis');
}
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
    process.env.BITBRAT_CONTEXT || 'local',
    capability
  );
  if (spec) {
    infrastructure.push(spec.serviceName);
  }
}
```

### 4.4 Phase 3: Docker Compose Generation (Weeks 5-6)

**Goal**: Generate docker-compose files from architecture.yaml, eliminate manual compose files

#### Task 3.1: Compose Generator Rewrite (5 days)

**New Algorithm**:

```typescript
export function generateDockerCompose(
  repoRoot: string,
  contextName: string
): ComposeConfig {
  // 1. Load architecture.yaml
  const arch = yaml.parse(fs.readFileSync(path.join(repoRoot, 'architecture.yaml'), 'utf-8'));

  // 2. Get execution context and provider
  const context = arch.executionContexts[contextName];
  const provider = context.infrastructure.provider;
  const infraProvider = arch.infrastructure[provider];

  // 3. Generate infrastructure services
  const services: Record<string, ComposeServiceDef> = {};
  const volumes: Record<string, any> = {};

  // Messaging (e.g., NATS)
  if (arch.platform.infrastructure.messaging?.required) {
    const messaging = infraProvider.messaging;
    services[messaging.service] = {
      image: messaging.image,
      ports: Object.values(messaging.ports || {}),
      volumes: messaging.volumes?.map((v: any) => `${v.name}:${v.mount}`),
      healthcheck: messaging.healthCheck,
      environment: messaging.env,
    };

    // Register volumes
    messaging.volumes?.forEach((v: any) => {
      volumes[v.name] = {};
    });
  }

  // Caching (e.g., Redis)
  if (arch.platform.infrastructure.caching?.required) {
    const caching = infraProvider.caching;
    services[caching.service] = {
      image: caching.image,
      ports: Object.values(caching.ports || {}),
      volumes: caching.volumes?.map((v: any) => `${v.name}:${v.mount}`),
      healthcheck: caching.healthCheck,
    };

    caching.volumes?.forEach((v: any) => {
      volumes[v.name] = {};
    });
  }

  // Persistence (e.g., PostgreSQL)
  if (arch.platform.infrastructure.persistence?.required) {
    const persistence = infraProvider.persistence;
    services[persistence.service] = {
      image: persistence.image,
      ports: Object.values(persistence.ports || {}),
      volumes: persistence.volumes?.map((v: any) => {
        if (v.source) {
          return `${v.source}:${v.mount}${v.readOnly ? ':ro' : ''}`;
        }
        return `${v.name}:${v.mount}`;
      }),
      healthcheck: persistence.healthCheck,
      environment: persistence.env,
    };

    persistence.volumes?.forEach((v: any) => {
      if (!v.source) {
        volumes[v.name] = {};
      }
    });
  }

  // 4. Generate application services
  const activeServices = Object.entries(arch.services)
    .filter(([_, svc]: [string, any]) => svc.active)
    .map(([name, svc]: [string, any]) => ({ name, ...svc }));

  for (const svc of activeServices) {
    const metadata = parseServiceMetadata(repoRoot, svc.name);
    const dependencies = parseServiceDependencies(repoRoot, metadata);
    services[svc.name] = generateServiceCompose(metadata, dependencies, contextName);
  }

  return {
    services,
    volumes,
    networks: {
      default: {
        name: 'bitbrat_default',
      },
    },
  };
}
```

**Key Changes**:
1. **Infrastructure from Registry**: No hardcoded NATS/Redis/Postgres
2. **Dynamic Volume Generation**: Volumes created from infrastructure specs
3. **Health Check Propagation**: Health checks from architecture.yaml
4. **Context Overrides**: Apply context-specific config overrides

---

## 5. Data Flow

### 5.1 Infrastructure Resolution Flow

```
User runs: brat deploy service llm-bot --context local

                           ▼
┌────────────────────────────────────────────────────────────┐
│ 1. Load architecture.yaml                                  │
│    - Parse YAML                                            │
│    - Validate against v2 schema                            │
│    - Cache in InfrastructureRegistry                       │
└────────────────────────────────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────┐
│ 2. Resolve Execution Context                               │
│    - Get executionContexts.local                           │
│    - Extract provider: "docker"                            │
│    - Get context-specific overrides                        │
└────────────────────────────────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────┐
│ 3. Collect Service Dependencies                            │
│    - Get services.llm-bot.dependencies.infrastructure      │
│    - Result: [messaging, caching, persistence]             │
└────────────────────────────────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────┐
│ 4. Resolve Each Capability                                 │
│    For capability = "messaging":                           │
│    - Get platform.infrastructure.messaging                 │
│    - Get infrastructure.docker.messaging                   │
│    - Merge config (platform → provider → context)          │
│    - Validate constraints (minRetention, requireDurability)│
│    - Result: InfrastructureSpec(messaging, docker, nats)   │
└────────────────────────────────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────┐
│ 5. Generate Docker Compose                                 │
│    - Generate infrastructure services (nats, redis, ...)   │
│    - Generate application service (llm-bot)                │
│    - Add depends_on (llm-bot → nats, redis, postgres)      │
│    - Add health checks from infrastructure specs           │
└────────────────────────────────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────┐
│ 6. Deploy with DockerOrchestrator                          │
│    - Start infrastructure services                         │
│    - Wait for health (HealthGate)                          │
│    - Start application services                            │
└────────────────────────────────────────────────────────────┘
                           ▼
                   Deployment Complete
```

### 5.2 Configuration Merge Example

```yaml
# Input: architecture.yaml

# Layer 1: Platform defaults
platform:
  infrastructure:
    caching:
      config:
        defaultTTL: 300
        evictionPolicy: allkeys-lru

# Layer 2: Provider implementation
infrastructure:
  docker:
    caching:
      service: redis
      image: redis:7-alpine
      config:
        maxmemory: 256mb
        appendonly: "yes"

# Layer 3: Context override
executionContexts:
  local:
    infrastructure:
      caching:
        config:
          maxmemory: 128mb  # Override for local (less memory)

# Output: Merged config for local context
{
  "capability": "caching",
  "provider": "docker",
  "serviceName": "redis",
  "image": "redis:7-alpine",
  "config": {
    "defaultTTL": 300,           // From platform
    "evictionPolicy": "allkeys-lru",  // From platform
    "maxmemory": "128mb",        // From context (overrides provider)
    "appendonly": "yes"          // From provider
  }
}
```

---

## 6. Migration Path

### 6.1 Backward Compatibility Strategy

**Phase 1-2: Dual Mode (Sprints 4-5)**

Both v1 and v2 patterns work simultaneously:

```typescript
// InfrastructureRegistry checks for v2 first, falls back to v1
static getRequiredInfrastructure(...): InfrastructureSpec[] {
  const arch = this.loadArchitecture(repoRoot);

  // Check schema version
  if (arch.platform?.version === '2.0') {
    // Use v2 infrastructure resolution
    return this.resolveV2Infrastructure(...);
  } else {
    // Fall back to v1 hardcoded logic
    return this.resolveV1Infrastructure(...);
  }
}
```

**Phase 3-4: Deprecation Warnings (Sprint 6)**

V1 patterns emit warnings but continue working:

```typescript
if (!arch.platform?.version) {
  console.warn(
    '⚠️  DEPRECATED: architecture.yaml v1 schema detected\n' +
    '   Please migrate to v2 schema: npm run brat -- config migrate\n' +
    '   See: planning/sprint-4-architecture-yaml-redesign/migration-guide.md'
  );
}
```

**Phase 5: V1 Removal (Sprint 7+)**

V1 support removed entirely:

```typescript
if (!arch.platform?.version || arch.platform.version !== '2.0') {
  throw new Error(
    'architecture.yaml v1 schema is no longer supported.\n' +
    'Please migrate to v2: npm run brat -- config migrate\n' +
    'Rollback: git checkout v0.22.0 (last v1 support)'
  );
}
```

### 6.2 Migration Checklist

Per execution context (local, staging, prod):

- [ ] **Step 1**: Add `platform.infrastructure` (30 min)
- [ ] **Step 2**: Add `infrastructure.docker` (45 min)
- [ ] **Step 3**: Add `services.*.dependencies.infrastructure` (30 min)
- [ ] **Step 4**: Add `executionContexts.*.infrastructure` (45 min)
- [ ] **Step 5**: Validate schema: `brat config validate --schema v2`
- [ ] **Step 6**: Test deployment: `brat deploy services --all --dry-run`
- [ ] **Step 7**: Deploy to context: `brat deploy services --all`
- [ ] **Step 8**: Verify health: `brat fleet list`
- [ ] **Step 9**: Run integration tests
- [ ] **Step 10**: Monitor for 24 hours

**Total Time per Context**: 2-4 hours

---

## 7. Risk Analysis

### 7.1 High-Risk Areas

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Breaking changes in production** | HIGH | LOW | Blue/green deployment, instant rollback, 24h monitoring |
| **Infrastructure dependency loops** | MEDIUM | MEDIUM | Topological sort, cycle detection, validation at load time |
| **Provider implementation bugs** | MEDIUM | MEDIUM | Start with Docker (most tested), add cloud providers incrementally |
| **Migration data loss** | HIGH | LOW | Dry-run required, backup architecture.yaml, rollback plan |
| **Performance regression** | LOW | LOW | Registry caching, parallel health checks, benchmark tests |

### 7.2 Failure Modes & Recovery

#### Failure: Schema validation fails in production

**Symptom**: Services fail to start with "Invalid architecture.yaml v2" error

**Recovery**:
1. Immediate rollback: `git revert <migration-commit>`
2. Rebuild and restart: `npm run build && npm run local`
3. Verify health: `npm run brat -- fleet list`
4. Debug schema offline: `npm run brat -- config validate --schema v2`

**Prevention**: Require schema validation in CI/CD before merge

#### Failure: Infrastructure not starting (health gate timeout)

**Symptom**: "Infrastructure health check failed: postgres (timeout after 60s)"

**Recovery**:
1. Check infrastructure logs: `docker logs bitbrat-postgres-1`
2. Manual health check: `docker exec -it bitbrat-postgres-1 pg_isready -U bitbrat`
3. Increase timeout: `executionContexts.local.infrastructure.persistence.healthCheck.retries: 20`
4. Restart infrastructure only: `docker-compose up -d postgres`

**Prevention**: Test infrastructure independently before service deployment

#### Failure: Provider constraint violation

**Symptom**: "Provider 'docker' violates constraint 'minMemory' for caching"

**Recovery**:
1. Override constraint for specific context:
   ```yaml
   executionContexts.local.infrastructure.caching.constraints.minMemory: 64mb
   ```
2. Or increase provider allocation:
   ```yaml
   infrastructure.docker.caching.config.maxmemory: 256mb
   ```

**Prevention**: Validate constraints in migration tool before deployment

### 7.3 Rollback Procedure

If v2 migration fails completely:

```bash
# 1. Stop all services
npm run local:down

# 2. Restore v1 architecture.yaml
git checkout architecture.v1.backup.yaml
mv architecture.v1.backup.yaml architecture.yaml

# 3. Restore v1 code
git checkout main -- tools/brat/src/context/parse-dependencies.ts
git checkout main -- tools/brat/src/orchestration/deployment/docker-compose-strategy.ts

# 4. Rebuild and restart
npm run build
npm run local

# 5. Verify health
npm run brat -- fleet list
```

---

## 8. Success Metrics

### 8.1 Technical Metrics

| Metric | Baseline (v1) | Target (v2) | Measurement |
|--------|---------------|-------------|-------------|
| **Lines of Code (Infrastructure)** | ~500 lines hardcoded | ~50 lines (registry only) | 90% reduction |
| **Infrastructure Deployment Bugs** | 11 in Sprint 3 | 0 in 2+ sprints | Zero bugs |
| **Test Coverage** | 85% | 90%+ | Jest coverage report |
| **Build Time** | ~30s | ~30s | No regression |
| **Deployment Time** | 2-3 min | 2-3 min | No regression |
| **Context Creation Time** | 15-20 min | <2 min | 85% faster |

### 8.2 Developer Experience Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| **Infrastructure Debugging Time** | 30-60 min | <10 min | Developer survey |
| **Onboarding Time (Infrastructure)** | 2-4 hours | <1 hour | New developer feedback |
| **Schema Validation Failures** | N/A (no validation) | <1% false positives | Validation logs |
| **Documentation Clarity** | 6/10 | 9/10 | Developer survey |

### 8.3 Platform Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| **Supported Platforms** | 2 (Docker, GCP) | 4+ (Docker, GCP, AWS, Azure) | Provider count |
| **Platform-Agnostic Services** | 0% | 100% | No platform-specific code in services |
| **Provider Implementations** | 2 | 5+ | GCP, AWS, Azure, K8s, community |

---

## 9. Appendix

### 9.1 Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `architecture.yaml` | **MAJOR** | Add v2 schema (platform, infrastructure, dependencies) |
| `tools/brat/src/infrastructure/registry.ts` | **NEW** | InfrastructureRegistry implementation |
| `tools/brat/src/infrastructure/health-gate.ts` | **NEW** | HealthGate implementation |
| `tools/brat/src/context/parse-dependencies.ts` | **MAJOR** | Replace hardcoded lists with registry calls |
| `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts` | **MAJOR** | Replace hardcoded infrastructure with registry |
| `tools/brat/src/context/generate-docker-compose.ts` | **MAJOR** | Generate from infrastructure section |
| `infrastructure/docker-compose/docker-compose.local.yaml` | **DEPRECATED** | Infrastructure moved to architecture.yaml |
| `documentation/schemas/architecture.v2.json` | **NEW** | JSON Schema for v2 |

### 9.2 Testing Strategy

#### Unit Tests

- **InfrastructureRegistry**: 20+ tests
  - Capability resolution (happy path, missing capability, missing provider)
  - Config merging (platform → provider → context)
  - Constraint validation (satisfied, violated, missing)
  - Provider selection based on context

- **HealthGate**: 15+ tests
  - Parallel health checks (all succeed, some fail, all fail)
  - Timeout handling (within timeout, timeout exceeded)
  - Error messages (detailed, with troubleshooting)

- **parse-dependencies**: 10+ tests
  - v2 infrastructure resolution
  - v1 fallback (backward compatibility)
  - Service-to-service dependencies
  - Validation errors

#### Integration Tests

- **Docker Compose Generation**: 8+ tests
  - Generate from v2 schema (local, staging)
  - Include infrastructure services (NATS, Redis, Postgres)
  - Apply context overrides (ports, databases)
  - Validate with `docker-compose config`

- **End-to-End Deployment**: 5+ tests
  - Deploy infrastructure only
  - Deploy single service with dependencies
  - Deploy all services (bulk)
  - Health gate validates infrastructure
  - Services start successfully

### 9.3 Documentation Deliverables

| Document | Audience | Status |
|----------|----------|--------|
| `technical-architecture.md` (this doc) | Engineers | Complete |
| `schema-proposal.md` | Engineers, Architects | Complete |
| `implementation-roadmap.md` | Engineers, PM | Complete |
| `migration-guide.md` | DevOps, Engineers | Complete |
| `documentation/architecture/infrastructure-management.md` | All developers | In Progress |
| `documentation/troubleshooting/infrastructure.md` | DevOps | In Progress |
| `documentation/schemas/architecture.v2.json` | Validation tools | In Progress |

---

## 10. Next Steps

### Immediate (Before Sprint Start)

1. **Review & Approval**:
   - [ ] Technical architecture review with team
   - [ ] Schema proposal review
   - [ ] Risk mitigation strategy approval

2. **Preparation**:
   - [ ] Set up sprint board with 5 phases
   - [ ] Assign engineers to Phase 1-2
   - [ ] Prepare development environment (Docker, NATS, Redis, Postgres)

### Phase 1 (Weeks 1-2)

1. **JSON Schema** (Engineer 1, 3 days):
   - Create `documentation/schemas/architecture.v2.json`
   - Implement schema validation in `tools/brat/src/validation/`
   - Write 20+ validation tests

2. **Migration Validator** (Engineer 2, 4 days):
   - Create `tools/brat/src/oclif-commands/config/migrate.ts`
   - Implement v1 → v2 detection and migration
   - Write 15+ migration tests

3. **Documentation** (Tech Writer, 3 days):
   - Complete `infrastructure-management.md`
   - Update `README.md` with v2 schema
   - Create troubleshooting guide

### Checkpoint (Week 2)

**Go/No-Go Decision**: Proceed to Phase 2 if:
- [ ] Schema validates all example configurations
- [ ] Migration tool identifies all v1 patterns
- [ ] Documentation complete and reviewed
- [ ] Team trained on new architecture

---

## References

- [Schema Proposal](./schema-proposal.md) - Complete architecture.yaml v2 schema
- [Implementation Roadmap](./implementation-roadmap.md) - Detailed phase-by-phase plan
- [Migration Guide](./migration-guide.md) - Step-by-step migration instructions
- [Sprint 3 Retrospective](../sprint-3-p8ehzo/retro.md) - Issues that motivated this redesign
- [Execution Contexts](../../documentation/guides/execution-contexts.md) - Context architecture (Sprint 349)

---

**Document Status**: ✅ Ready for Review
**Next Review**: Before Sprint 4 Kickoff
**Approval Required**: Engineering Lead, Product Owner
