# Sprint 4: Architecture.yaml Infrastructure Redesign

**Status**: Proposed
**Sprint**: 4
**Goal**: Make architecture.yaml the single source of truth for infrastructure declarations across all deployment platforms
**Owner**: Architecture Team

## Executive Summary

This proposal redesigns `architecture.yaml` to become the true single source of truth for infrastructure requirements, moving from a GCP-centric model to a platform-agnostic capability declaration system.

**Current State**: 80% GCP-specific infrastructure declarations, 0% platform-agnostic infrastructure, Docker infrastructure completely absent from architecture.yaml

**Desired State**: Platform-agnostic capability declarations in architecture.yaml, provider-specific implementations per execution context, automated infrastructure deployment

## Problem Statement

Sprint 3 exposed fundamental architectural fragility in BitBrat's infrastructure management:

1. **Fragmented Knowledge**: Infrastructure services defined in 5+ locations with no coordination
2. **GCP Bias**: architecture.yaml contains only GCP-specific resources (Cloud Storage, Firestore, Application LB)
3. **Docker Invisibility**: Local/staging infrastructure (NATS, Redis, PostgreSQL) exists only in docker-compose.local.yaml
4. **Hardcoded Dependencies**: Service dependencies on infrastructure scattered across codebase
5. **Deployment Divergence**: Single-service and bulk deployments use different code paths with different bugs

### Sprint 3 Issues Traced to Fragmentation

All 11 fixes in Sprint 3 stemmed from infrastructure fragmentation:

- **Fixes #10-#11**: Redis not deployed because hardcoded in parse-dependencies.ts but not in docker-compose-strategy.ts
- **Fixes #6-#9**: PostgreSQL connection logic fragmented across waitForPostgres(), ContextResolver, validatePostgresConnection()
- **Fixes #3-#4**: Docker Compose generation doesn't coordinate with base compose file
- **Fix #5**: Port manager needs service list but has no infrastructure source of truth

## Proposed Solution

### Three-Tier Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ architecture.yaml                                           │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ platform.infrastructure (Requirements + Intent)         │ │
│ │ - messaging: {required, config, constraints, intent}    │ │
│ │ - caching: {required, config, constraints, intent}      │ │
│ │ - persistence: {required, config, constraints, intent}  │ │
│ │ - observability: {optional, config, constraints}        │ │
│ └─────────────────────────────────────────────────────────┘ │
│                           ▼                                 │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ infrastructure.{provider} (Provider Implementations)    │ │
│ │ - docker: {messaging: nats, caching: redis, ...}        │ │
│ │ - gcp: {messaging: pubsub, persistence: cloudsql, ...}  │ │
│ │ - aws: {messaging: sqs, persistence: rds, ...}          │ │
│ └─────────────────────────────────────────────────────────┘ │
│                           ▼                                 │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ executionContexts.*.infrastructure (Context Overrides)  │ │
│ │ - local: uses docker provider                           │ │
│ │ - staging: uses docker provider (remote)                │ │
│ │ - prod: uses gcp provider                               │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Generated Artifacts (Docker Compose, Terraform, K8s)        │
│ - docker-compose.{context}.yaml (from docker provider)      │
│ - terraform/{gcp,aws,azure}/ (from cloud providers)         │
│ - k8s/manifests/ (from k8s provider)                        │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Principles

1. **Configuration Over Discovery**: Architecture.yaml declares requirements, discovery optimizes
2. **Platform Agnostic by Default**: Generic capabilities (messaging, caching, persistence) with provider bindings
3. **Progressive Enhancement**: Start with minimal providers (docker), expand to cloud platforms incrementally
4. **Single Deployment Path**: Same orchestration code for single-service and bulk deployments
5. **Validation First**: Schema validation prevents invalid configurations from reaching deployment
6. **Intent-Driven Infrastructure**: Platform declares not just *what* but *why* and *how* infrastructure is used

### Platform Infrastructure: Config, Constraints, Intent

The `platform.infrastructure` section is enriched with three dimensions:

**1. Config** (Platform-level defaults)
```yaml
messaging:
  config:
    defaultTTL: 3600                  # All providers must honor
    deliveryGuarantee: at-least-once  # Consistent behavior everywhere
    deadLetterPolicy:
      maxDeliveryAttempts: 5
```

**2. Constraints** (Provider requirements)
```yaml
messaging:
  constraints:
    minRetention: 86400        # MUST retain messages for 24+ hours
    maxMessageSize: 10485760   # MUST support 10MB messages
    requireDurability: true    # MUST survive restarts
```

**3. Intent** (Current living use cases)
```yaml
messaging:
  intent:
    - Event-driven orchestration between services
    - Asynchronous task processing with retry
    - Dead letter queue for failed messages
```

**Benefits**:
- **Cross-environment consistency**: Same TTL, eviction, persistence policies everywhere (local, staging, prod)
- **Provider compliance**: Automated validation that Docker/GCP/AWS meet platform needs
- **Clear contracts**: Documented guarantees for service developers
- **Migration safety**: Validate new providers before deployment
- **Operational clarity**: Intent is explicit (idempotency, sessions, etc.)

## Complete Schema Hierarchy

With all enhancements applied, the full architecture.yaml v2 structure is:

```
platform.infrastructure.{capability}
  ├── config (platform-wide defaults)
  ├── constraints (provider requirements)
  └── intent (current use cases)

infrastructure.{provider}
  ├── config (provider characteristics: scope, scalability, cost model)
  ├── constraints (provider limitations: max instances, offline capability)
  ├── intent (why this provider, migration path, trade-offs)
  └── {capability}
      ├── service/type (implementation details)
      ├── intent (why this implementation over alternatives)
      ├── config (technical configuration)
      └── healthCheck (readiness validation)

executionContexts.{name}
  ├── description (human-readable summary)
  ├── config (purpose, isolation, data retention, team model)
  ├── constraints
  │   ├── prerequisites (required tooling/access)
  │   ├── limitations (what you can't do)
  │   └── guarantees (what is promised)
  ├── intent (why this context exists, promotion path)
  ├── infrastructure (context-specific overrides)
  ├── deployment (deployment configuration)
  └── runtime (runtime configuration)
```

This creates a fully self-documenting architecture where every decision, limitation, and guarantee is explicit in the configuration itself.

## Architecture Changes

### New Top-Level Sections

```yaml
# Generic platform capabilities (what + why + how)
platform:
  infrastructure:
    messaging:
      required: true
      config: {defaultTTL: 3600, deliveryGuarantee: at-least-once}
      constraints: {minRetention: 86400, requireDurability: true}
      intent: [Event-driven orchestration, Async task processing]
    caching:
      required: true
      config: {defaultTTL: 300, evictionPolicy: allkeys-lru}
      constraints: {minMemory: 128mb, requirePersistence: true}
      intent: [Idempotency tracking, Distributed locks]
    persistence:
      required: true
      config: {connectionPool: {min: 10, max: 100}}
      constraints: {requireACID: true, requireSSL: true}
      intent: [Persistent event storage, State management]

# Provider-specific implementations (how to provide capabilities)
infrastructure:
  docker:
    messaging: {service: nats, image: nats:2.10-alpine, ...}
    caching: {service: redis, image: redis:7-alpine, ...}
    persistence: {service: postgres, image: postgres:15-alpine, ...}

  gcp:
    messaging: {type: pubsub, ...}
    persistence: {type: cloudsql, instance: bitbrat-prod, ...}

  aws:
    messaging: {type: sqs, ...}
    persistence: {type: rds, ...}

# Per-context infrastructure configuration
executionContexts:
  local:
    infrastructure:
      provider: docker
      messaging: {port: 4222}
      caching: {port: 6379}
      persistence: {port: 5432, database: bitbrat}
```

### Modified Sections

**services.*.dependencies**: Declare infrastructure dependencies explicitly

```yaml
services:
  llm-bot:
    dependencies:
      infrastructure: [messaging, caching, persistence]
      services: [auth, tool-gateway]
```

## Implementation Roadmap

### Phase 1: Foundation (1-2 weeks)
- JSON schema for new architecture.yaml sections
- Migration validator (architecture.yaml v1 → v2)
- Documentation and examples

### Phase 2: Integration (2 weeks)
- InfrastructureRegistry v2 (replaces fragmented infrastructure knowledge)
- Health gate pattern implementation
- Update parse-dependencies.ts to use registry

### Phase 3: Docker Compose Generation (1 week)
- Rewrite generate-docker-compose.ts to consume infrastructure section
- Remove hardcoded infrastructure from docker-compose.local.yaml
- Automated testing for generation

### Phase 4: Production Migration (2 weeks)
- Migrate existing contexts to new schema
- Deprecate old infrastructure patterns
- Comprehensive validation

### Phase 5: Ecosystem Expansion (4+ weeks)
- AWS provider implementation
- Azure provider implementation
- Kubernetes provider implementation

## Success Metrics

1. **Single Source of Truth**: All infrastructure requirements in architecture.yaml (0 hardcoded lists)
2. **Platform Coverage**: Docker (baseline), GCP, AWS, Azure providers implemented
3. **Bug Reduction**: No infrastructure deployment bugs for 2+ sprints
4. **Developer Experience**: `brat context create` generates complete infrastructure automatically

## Documentation Structure

- `README.md` (this file): Overview and executive summary
- `schema-proposal.md`: Complete JSON schema and YAML examples
- `implementation-roadmap.md`: Detailed phase-by-phase implementation plan
- `migration-guide.md`: Step-by-step migration from v1 to v2
- `../documentation/architecture/infrastructure-management.md`: Developer-facing guide

## Related Work

- **Sprint 1**: Redis idempotency layer (exposed infrastructure fragmentation)
- **Sprint 2**: Redis BEC generation gaps (hardcoded infrastructure lists)
- **Sprint 3**: BEC creation fixes (11 fixes all traced to fragmentation)
- **Sprint 349**: Execution contexts introduced (runtime configuration)
- **Sprint 344**: PostgreSQL migration (platform-agnostic persistence)

## Open Questions

1. How to handle conditional infrastructure? (e.g., Firestore only if PERSISTENCE_DRIVER=firestore)
2. Migration strategy for existing deployments? (blue/green, rolling, big-bang)
3. Provider plugin architecture? (allow community providers)
4. Terraform integration? (generate .tf files from architecture.yaml)

## Next Steps

1. Review and approve this proposal
2. Create detailed implementation plan for Phase 1
3. Assign engineering resources
4. Set sprint goals and timeline
