# Architecture.yaml Schema Proposal

**Version**: 2.0
**Status**: Proposed
**Last Updated**: 2026-08-09

## Schema Overview

This document defines the complete schema for architecture.yaml v2, introducing platform-agnostic infrastructure declarations while maintaining backward compatibility during migration.

## Top-Level Structure

```yaml
platform:
  version: "2.0"              # Schema version
  name: "BitBrat Platform"
  infrastructure: {...}       # NEW: Generic capability requirements

infrastructure:               # NEW: Provider-specific implementations
  docker: {...}
  gcp: {...}
  aws: {...}
  azure: {...}
  k8s: {...}

services: {...}               # MODIFIED: Add dependencies.infrastructure
executionContexts: {...}      # MODIFIED: Add infrastructure section
resources: {...}              # DEPRECATED: Move to infrastructure.{provider}
```

## Section 1: platform.infrastructure

**Purpose**: Declare generic infrastructure capabilities, platform-level configuration, constraints, and intent

This section defines **what** the platform needs and **why** (current use cases), independent of **how** it's implemented. Providers must satisfy these requirements.

**Schema**:

```yaml
platform:
  infrastructure:
    # Core messaging infrastructure (REQUIRED)
    messaging:
      required: true
      capabilities:
        - pubsub            # Publish-subscribe messaging
        - streaming         # Stream processing (NATS JetStream, Kafka, etc.)
        - queuing           # Work queues

      # Platform-level configuration (applies to ALL providers)
      config:
        defaultTTL: 3600                  # Message retention in seconds
        deliveryGuarantee: at-least-once  # at-most-once | at-least-once | exactly-once
        orderingGuarantee: false          # Message ordering per key
        deadLetterPolicy:
          enabled: true
          maxDeliveryAttempts: 5
          retentionDuration: 604800       # DLQ retention: 7 days

      # Hard constraints that providers MUST satisfy
      constraints:
        minRetention: 86400        # Messages must be durable for 24+ hours
        maxMessageSize: 10485760   # Must support 10MB messages
        requireDurability: true    # Must survive container/pod restarts
        requireDeadLetter: true    # Must support dead letter queues

      # Intent documentation (current living use cases)
      intent:
        - Event-driven orchestration between services
        - Asynchronous task processing with retry
        - Dead letter queue for failed messages
        - Distributed tracing correlation

    # Distributed caching (REQUIRED for idempotency, sessions, locks)
    caching:
      required: true
      capabilities:
        - keyvalue          # Key-value storage
        - pubsub            # Redis pub/sub
        - distributed-lock  # Distributed locking

      config:
        defaultTTL: 300               # Default key expiration in seconds
        evictionPolicy: allkeys-lru   # LRU eviction when memory full
        persistenceMode: rdb          # rdb | aof | none (survive restarts)
        maxMemory: 256mb              # Default memory limit

      constraints:
        minMemory: 128mb              # Minimum memory allocation
        requirePersistence: true      # Must survive restarts
        requireDistributedLock: true  # Must support distributed locking
        requirePubSub: false          # Pub/sub optional

      intent:
        - Idempotency tracking (Sprint 1 Redis layer)
        - Distributed locks for cross-service coordination
        - Session storage for stateful workflows
        - Rate limiting and circuit breakers

    # Persistent data storage (REQUIRED)
    persistence:
      required: true
      capabilities:
        - relational        # SQL database (PostgreSQL, MySQL, etc.)
        - transactional     # ACID transactions
        - migrations        # Schema migration support
      driver: postgres      # Default driver: postgres | firestore | mongodb

      config:
        connectionPool:
          min: 10
          max: 100
          idleTimeout: 30000          # Milliseconds
        transactionIsolation: READ_COMMITTED
        migrationStrategy: versioned  # versioned | timestamp | none
        backupSchedule: "0 3 * * *"   # Daily at 3am

      constraints:
        requireACID: true             # Must support ACID transactions
        minConnections: 10            # Minimum connection pool size
        requireSSL: true              # SSL connections required (can override per context)
        backupRetention: 7            # Days to retain backups
        requireMigrations: true       # Must support schema migrations

      intent:
        - Persistent event storage (Event Sourcing)
        - Service state management (State Engine)
        - Transactional workflows across services
        - Audit trail and compliance

    # Observability infrastructure (OPTIONAL)
    observability:
      required: false
      capabilities:
        - metrics           # Prometheus-compatible metrics
        - tracing           # Distributed tracing (OpenTelemetry)
        - logging           # Structured logging aggregation

      config:
        metricsRetention: 15d         # How long to keep metrics
        traceSamplingRate: 0.1        # 10% of requests
        logRetention: 30d             # How long to keep logs

      constraints:
        requireMetrics: true
        requireTracing: false
        requireLogging: true

      intent:
        - Performance monitoring and alerting
        - Distributed tracing for debugging
        - Centralized log aggregation
        - SLO/SLA tracking

    # Service mesh (OPTIONAL)
    mesh:
      required: false
      capabilities:
        - service-discovery # Automatic service discovery
        - load-balancing    # Client-side load balancing
        - circuit-breaking  # Circuit breaker pattern

      config:
        discoveryInterval: 5s         # Service discovery refresh
        healthCheckInterval: 10s      # Health check frequency

      constraints:
        requireServiceDiscovery: false
        requireLoadBalancing: false
        requireCircuitBreaker: false

      intent:
        - Automatic service discovery in multi-instance deployments
        - Client-side load balancing for performance
        - Circuit breaker for fault tolerance
```

**Validation Rules**:
- All `required: true` capabilities MUST have provider implementations
- Capabilities list MUST be subset of well-known capabilities
- All config values MUST be valid for their type (positive integers, valid policies, etc.)
- **Providers MUST satisfy all constraints** (validated at deployment time)
- Intent is documentation-only (not validated, but provides context for future changes)

## Section 2: infrastructure.{provider}

**Purpose**: Define provider-specific implementations for each infrastructure capability, including provider characteristics, limitations, and intent

Providers must satisfy all `platform.infrastructure` constraints while documenting their own characteristics and trade-offs.

### 2.1 Docker Provider

```yaml
infrastructure:
  docker:
    # Provider-level metadata
    config:
      scope: local-dev           # local-dev | staging | production
      scalability: single-host   # single-host | multi-host | cloud-native
      costModel: hardware        # hardware | usage-based | hybrid
      deployment: docker-compose # docker-compose | docker-swarm | k8s

    constraints:
      maxInstances: 1            # Cannot scale beyond single Docker host
      requiresLocalDocker: true  # Docker Desktop or daemon required
      offlineCapable: true       # Can run without internet connection
      autoScaling: false         # No auto-scaling support
      multiRegion: false         # Single geographic location

    intent:
      - Rapid local development without cloud costs
      - Exact production parity for service logic (same Docker images)
      - Offline development during travel or network outages
      - Onboarding: new developers productive in 10 minutes
      - Migration path: Docker → GCP Cloud Run (containerized workloads)
      - Trade-off: Not suitable for multi-region or high-availability production

    # Messaging implementation (NATS)
    messaging:
      service: nats
      image: nats:2.10-alpine

      # Implementation-level intent
      intent:
        - Chosen over Kafka: lighter weight for local dev (50MB vs 500MB+ memory)
        - JetStream provides persistence without Kafka/Zookeeper complexity
        - Easy migration to NATS on K8s or nats.io cloud
        - Production-ready for up to 10K msg/sec (adequate for current scale)
        - Trade-off: Not ideal for >100K msg/sec or multi-DC replication

      ports:
        client: 4222        # Client connections
        http: 8222          # HTTP monitoring
        cluster: 6222       # Cluster connections
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

    # Caching implementation (Redis)
    caching:
      service: redis
      image: redis:7-alpine

      # Implementation-level intent
      intent:
        - De facto standard for distributed caching and sessions
        - Sprint 1: Idempotency layer prevents duplicate message processing
        - AOF persistence ensures cache survives container restarts
        - Chosen over Memcached: persistence + pub/sub + distributed locks
        - Easy migration to Redis Cluster or Cloud Memorystore
        - Trade-off: Single instance (no HA), adequate for current scale

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

    # Persistence implementation (PostgreSQL)
    persistence:
      service: postgres
      image: postgres:15-alpine

      # Implementation-level intent
      intent:
        - Sprint 344: Migrated from Firestore for platform-agnostic persistence
        - Chosen over MySQL: better JSON support, PostGIS for future geo features
        - ACID transactions critical for event sourcing and state management
        - Easy migration to Cloud SQL, AWS RDS, Azure Database
        - Init scripts support versioned migrations (Flyway-compatible)
        - Trade-off: No auto-scaling (vertical only), adequate for current scale

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

    # Observability implementation (OPTIONAL)
    observability:
      metrics:
        service: prometheus
        image: prom/prometheus:latest
        ports:
          http: 9090
      tracing:
        service: jaeger
        image: jaegertracing/all-in-one:latest
        ports:
          ui: 16686
          collector: 14268

    # Utilities (nats-box for debugging)
    utilities:
      - service: nats-box
        image: natsio/nats-box:latest
        depends_on: [nats]
        command: ["sleep", "infinity"]
```

**Provider Constraint Validation**:

The Docker provider configurations must satisfy platform constraints. Validation occurs at deployment time:

```yaml
# ✅ VALID: NATS configuration satisfies messaging constraints
infrastructure.docker.messaging:
  - requireDurability: ✅ JetStream enabled with fileStorage
  - minRetention: ✅ maxStorage=10GB exceeds 24h requirement
  - maxMessageSize: ✅ Default 1MB < 10MB limit (can configure)
  - requireDeadLetter: ✅ NATS supports consumer retry and DLQ

# ✅ VALID: Redis configuration satisfies caching constraints
infrastructure.docker.caching:
  - minMemory: ✅ 256MB > 128MB minimum
  - requirePersistence: ✅ appendonly="yes" (AOF persistence)
  - requireDistributedLock: ✅ Redis supports SET NX EX pattern
  - requirePubSub: ✅ Redis supports PUBLISH/SUBSCRIBE

# ✅ VALID: PostgreSQL configuration satisfies persistence constraints
infrastructure.docker.persistence:
  - requireACID: ✅ PostgreSQL is ACID-compliant
  - minConnections: ✅ Connection pooling configured (min: 10)
  - requireSSL: ⚠️  SSL not enforced (can override per context)
  - backupRetention: ✅ Volume persistence supports backups
  - requireMigrations: ✅ init scripts support versioned migrations
```

**Validation CLI**:

```bash
# Validate provider satisfies platform constraints
$ npm run brat -- config validate --check-constraints

✅ Provider 'docker.messaging' satisfies all constraints
✅ Provider 'docker.caching' satisfies all constraints
⚠️  Provider 'docker.persistence' violates constraint 'requireSSL'
   Platform requires: SSL connections
   Provider provides: Unencrypted connections
   Fix: Add SSL configuration or override constraint in execution context

# Override constraint for local development
executionContexts:
  local:
    infrastructure:
      persistence:
        constraints:
          requireSSL: false  # Allow unencrypted for local dev
```

### 2.2 GCP Provider

```yaml
infrastructure:
  gcp:
    project: ${GCP_PROJECT}
    region: us-central1

    # Provider-level metadata
    config:
      scope: production          # local-dev | staging | production
      scalability: cloud-native  # cloud-native with auto-scaling
      costModel: usage-based     # Pay per request, scale to zero
      deployment: cloud-run      # cloud-run | gke | compute-engine

    constraints:
      maxInstances: 100          # Cloud Run default max
      requiresGCPAccount: true   # GCP project and billing required
      offlineCapable: false      # Requires internet connectivity
      autoScaling: true          # Automatic instance scaling
      multiRegion: true          # Can deploy across multiple regions

    intent:
      - Production deployment with minimal operational overhead
      - Auto-scaling from 0 to 100 instances based on load
      - Cost optimization: scale to zero during idle periods
      - High availability across GCP zones (99.95% SLA)
      - Compliance: SOC2, GDPR, HIPAA-eligible infrastructure
      - Migration path: GCP Cloud Run → GKE (if custom networking needed)
      - Trade-off: Vendor lock-in to GCP ecosystem

    # Messaging implementation (Cloud Pub/Sub)
    messaging:
      type: pubsub
      topics:
        # Auto-created from services.*.topics.publishes/consumes
        - name: internal-ingress-v1
          retentionDuration: 7d
        - name: internal-egress-v1
          retentionDuration: 7d
      deadLetterPolicy:
        maxDeliveryAttempts: 5
        deadLetterTopic: dlq-undeliverable

    # Caching implementation (Cloud Memorystore for Redis)
    caching:
      type: memorystore-redis
      tier: BASIC          # BASIC | STANDARD_HA
      memorySizeGb: 1
      version: REDIS_7_0
      authEnabled: true
      transitEncryption: SERVER_AUTHENTICATION

    # Persistence implementation (Cloud SQL for PostgreSQL)
    persistence:
      type: cloudsql
      instance: bitbrat-prod
      databaseVersion: POSTGRES_15
      tier: db-f1-micro    # db-f1-micro | db-g1-small | db-custom-*
      diskSize: 10         # GB
      backupConfiguration:
        enabled: true
        startTime: "03:00"
        retentionDays: 7
      ipConfiguration:
        requireSsl: true
        authorizedNetworks: []  # Private IP only

    # Observability implementation (Cloud Monitoring + Cloud Trace)
    observability:
      metrics:
        type: cloud-monitoring
        workspace: ${GCP_PROJECT}
      tracing:
        type: cloud-trace
        samplingRate: 0.1   # 10% sampling

    # Cloud-specific resources
    cloudrun:
      vpcConnector: bitbrat-vpc-connector
      ingressSettings: INGRESS_SETTINGS_ALL
      executionEnvironment: gen2
```

### 2.3 AWS Provider

```yaml
infrastructure:
  aws:
    region: us-east-1
    accountId: ${AWS_ACCOUNT_ID}

    # Messaging implementation (SQS + SNS)
    messaging:
      type: sqs-sns
      topics:
        - name: internal-ingress-v1
          fifo: false
        - name: internal-egress-v1
          fifo: false
      deadLetterQueue:
        maxReceiveCount: 5
        retentionPeriod: 1209600  # 14 days in seconds

    # Caching implementation (ElastiCache for Redis)
    caching:
      type: elasticache-redis
      nodeType: cache.t3.micro
      numCacheNodes: 1
      engineVersion: "7.0"
      transitEncryption: true
      atRestEncryption: true

    # Persistence implementation (RDS for PostgreSQL)
    persistence:
      type: rds-postgres
      instanceClass: db.t3.micro
      allocatedStorage: 20    # GB
      engine: postgres
      engineVersion: "15.4"
      backupRetentionPeriod: 7
      multiAZ: false

    # Observability implementation (CloudWatch)
    observability:
      metrics:
        type: cloudwatch
        namespace: BitBrat
      tracing:
        type: xray
        samplingRate: 0.1

    # ECS-specific configuration
    ecs:
      cluster: bitbrat-cluster
      taskExecutionRole: ${ECS_TASK_EXECUTION_ROLE_ARN}
      taskRole: ${ECS_TASK_ROLE_ARN}
```

### 2.4 Kubernetes Provider

```yaml
infrastructure:
  k8s:
    namespace: bitbrat

    # Messaging implementation (NATS Helm chart)
    messaging:
      type: nats-helm
      chart:
        repo: https://nats-io.github.io/k8s/helm/charts/
        name: nats
        version: 1.0.0
      values:
        jetstream:
          enabled: true
          memStorage:
            size: 1Gi
          fileStorage:
            size: 10Gi

    # Caching implementation (Redis Helm chart)
    caching:
      type: redis-helm
      chart:
        repo: https://charts.bitnami.com/bitnami
        name: redis
        version: 17.11.3
      values:
        master:
          persistence:
            size: 8Gi

    # Persistence implementation (PostgreSQL Helm chart)
    persistence:
      type: postgresql-helm
      chart:
        repo: https://charts.bitnami.com/bitnami
        name: postgresql
        version: 12.5.8
      values:
        primary:
          persistence:
            size: 20Gi
```

## Section 3: services.*.dependencies

**Purpose**: Explicitly declare service infrastructure dependencies

**Schema**:

```yaml
services:
  llm-bot:
    # NEW: Explicit infrastructure dependencies
    dependencies:
      infrastructure:
        - messaging         # REQUIRED: Service needs message bus
        - caching           # REQUIRED: Service needs Redis for idempotency
        - persistence       # OPTIONAL: Service needs database
      services:
        - auth              # REQUIRED: Service depends on auth service
        - tool-gateway      # OPTIONAL: Service depends on tool-gateway

    # Existing fields...
    active: true
    profile: llm
    # ...
```

**Validation Rules**:
- `dependencies.infrastructure` items MUST be subset of `platform.infrastructure` keys
- `dependencies.services` items MUST reference existing services
- All infrastructure dependencies MUST have provider implementations in active context

## Section 4: executionContexts.*

**Purpose**: Define execution contexts with characteristics, prerequisites, guarantees, and intent

Each execution context documents why it exists, what it's for, and what guarantees it provides.

**Schema**:

```yaml
executionContexts:
  local:
    description: "Local Docker development environment"

    # Context-level metadata
    config:
      purpose: development       # development | testing | staging | production
      isolation: full            # full | partial | shared
      dataRetention: ephemeral   # ephemeral | persistent | backed-up
      team: individual          # individual | shared | multi-tenant

    constraints:
      prerequisites:
        - Docker Desktop 20.10+ or Docker Engine 20.10+
        - 8GB RAM minimum (16GB recommended)
        - 20GB free disk space
        - No VPN required
      limitations:
        - Single developer only (no multi-user support)
        - No auto-scaling (manual service restart)
        - Unencrypted connections (SSL disabled for debugging)
        - Single-host deployment (no distributed services)
      guarantees:
        - Fully isolated from other developers
        - Safe to destroy and recreate without data loss concerns
        - No production data access (local seed data only)
        - Offline capable (no internet required after initial setup)

    intent:
      - Rapid iteration with hot reload and instant feedback
      - Test infrastructure changes safely without cloud costs
      - Work offline during flights, coffee shops, or network outages
      - Onboarding: new developers run "brat setup" and productive in 10 minutes
      - Debug with unencrypted traffic visible in Docker logs
      - Promotion path: local → staging (validate integration) → prod

    # Infrastructure configuration
    infrastructure:
      provider: docker              # Which provider to use
      messaging:
        # Override specific configuration
        ports:
          client: 14222             # Use alternate port for local dev
      persistence:
        database: bitbrat_local     # Use different database name
        initScripts:
          - path: ../postgres/init/01-schema.sql
          - path: ../postgres/init/02-seed-dev.sql

    # Existing runtime configuration
    runtime:
      gateway: {...}
      persistence:
        driver: postgres
        autoDiscover: false         # Use explicit config above
        connection:
          host: localhost
          port: 5432
          database: bitbrat_local
          username: bitbrat
          password: ${POSTGRES_PASSWORD}
      envOverlay: {...}

  staging:
    description: "Remote staging environment on bitbrat.lan"

    # Context-level metadata
    config:
      purpose: testing           # Integration and load testing
      isolation: partial         # Shared infrastructure, isolated services
      dataRetention: persistent  # Data persists between deployments
      team: shared              # Shared by entire team

    constraints:
      prerequisites:
        - VPN connection to bitbrat.lan OR on local network
        - SSH key access for root@bitbrat.lan
        - MCP_AUTH_TOKEN environment variable
        - NATS_TOKEN environment variable
      limitations:
        - Single staging environment (shared by team, not isolated)
        - Limited to 4GB RAM per service (hardware constraint)
        - Manual scaling only (no auto-scaling)
        - SSL required (cannot disable for remote deployment)
      guarantees:
        - Production-like infrastructure (Docker + PostgreSQL + NATS)
        - Data persists between deployments (PostgreSQL volume)
        - Same Docker images as production (build once, deploy everywhere)
        - Accessible from any team member on VPN

    intent:
      - Integration testing before production deployment
      - Validate infrastructure changes (PostgreSQL migrations, Redis config)
      - Load testing with production-like data volume
      - Demonstrate features to stakeholders before release
      - Team collaboration: multiple developers can test together
      - Promotion path: staging → prod (blue/green deployment with rollback)

    infrastructure:
      provider: docker
      messaging:
        auth:
          token: ${NATS_TOKEN}
      persistence:
        ssl:
          enabled: true
          ca: /var/secrets/postgres-ca.crt

    deployment:
      type: docker-compose
      docker:
        host: ssh://root@bitbrat.lan
        remoteDir: /opt/BitBratPlatform
    runtime: {...}

  prod:
    description: "Production environment on GCP Cloud Run"

    # Context-level metadata
    config:
      purpose: production        # Serve customer traffic
      isolation: full            # Fully isolated from other environments
      dataRetention: backed-up   # Automated backups, 30-day retention
      team: multi-tenant        # Serves multiple customers

    constraints:
      prerequisites:
        - GCP project access (bitbrat-prod)
        - gcloud CLI authenticated with appropriate IAM roles
        - Terraform state access (GCS backend: gs://bitbrat-terraform-state)
        - OPENAI_API_KEY secret in Google Secret Manager
      limitations:
        - No direct SSH access (Cloud Run managed environment)
        - Limited to GCP region: us-central1 (can expand to multi-region)
        - Rollback window: 7 days (Cloud Run revision history)
        - Cold start latency: 0-2 seconds when scaling from zero
      guarantees:
        - 99.95% SLA (Cloud Run commitment)
        - Automated backups: daily at 3am UTC, 30-day retention
        - SSL/TLS enforced (Cloud Run default)
        - Auto-scaling: 0-100 instances based on traffic
        - DDoS protection (Cloud Armor)
        - Encryption at rest and in transit

    intent:
      - Serve customer traffic at scale with high availability
      - Minimize operational overhead via managed services
      - Cost optimization: scale to zero when idle (night/weekends)
      - High availability across GCP zones (automatic failover)
      - Compliance: SOC2, GDPR, HIPAA-eligible infrastructure
      - Observability: Cloud Monitoring + Cloud Trace integration
      - Promotion path: blue/green deployment with instant rollback

    infrastructure:
      provider: gcp
      messaging:
        topics:
          retentionDuration: 14d
      persistence:
        backupConfiguration:
          retentionDays: 30

    deployment:
      type: cloud-run
      gcp: {...}
    runtime: {...}
```

## Section 5: Conditional Infrastructure

**Purpose**: Support conditional infrastructure based on configuration

**Schema**:

```yaml
platform:
  infrastructure:
    # Conditional infrastructure based on env vars
    legacy-persistence:
      required: false
      conditionalOn:
        env: PERSISTENCE_DRIVER
        value: firestore
      capabilities:
        - document-store

infrastructure:
  docker:
    # Only deploy if PERSISTENCE_DRIVER=firestore
    legacy-persistence:
      conditionalOn:
        env: PERSISTENCE_DRIVER
        value: firestore
      service: firebase-emulator
      image: andreysenov/firebase-tools:latest
      ports:
        firestore: 8080
        ui: 4000
```

## Complete Example: Local Context

```yaml
platform:
  version: "2.0"
  name: "BitBrat Platform"
  infrastructure:
    messaging:
      required: true
      capabilities: [pubsub, streaming, queuing]
      config:
        defaultTTL: 3600
        deliveryGuarantee: at-least-once
        orderingGuarantee: false
        deadLetterPolicy:
          enabled: true
          maxDeliveryAttempts: 5
      constraints:
        minRetention: 86400
        maxMessageSize: 10485760
        requireDurability: true
      intent:
        - Event-driven orchestration between services
        - Asynchronous task processing with retry

    caching:
      required: true
      capabilities: [keyvalue, pubsub, distributed-lock]
      config:
        defaultTTL: 300
        evictionPolicy: allkeys-lru
        persistenceMode: rdb
        maxMemory: 256mb
      constraints:
        minMemory: 128mb
        requirePersistence: true
        requireDistributedLock: true
      intent:
        - Idempotency tracking (Sprint 1 Redis layer)
        - Distributed locks for coordination

    persistence:
      required: true
      capabilities: [relational, transactional, migrations]
      driver: postgres
      config:
        connectionPool: {min: 10, max: 100, idleTimeout: 30000}
        transactionIsolation: READ_COMMITTED
        migrationStrategy: versioned
      constraints:
        requireACID: true
        minConnections: 10
        requireSSL: true
        backupRetention: 7
      intent:
        - Persistent event storage
        - Service state management

infrastructure:
  docker:
    # Provider-level metadata
    config: {scope: local-dev, scalability: single-host, costModel: hardware}
    constraints: {maxInstances: 1, offlineCapable: true, autoScaling: false}
    intent:
      - Rapid local development without cloud costs
      - Exact production parity for service logic
      - Migration path: Docker → GCP Cloud Run

    messaging:
      service: nats
      image: nats:2.10-alpine
      intent: [Chosen over Kafka for lightweight local dev, Production-ready up to 10K msg/sec]
      ports: {client: 4222, http: 8222}
      volumes: [{name: nats-data, mount: /data}]
      config: {jetstream: {enabled: true}}
      healthCheck:
        test: ["CMD", "wget", "--spider", "http://localhost:8222/healthz"]
        interval: 5s
        timeout: 3s
        retries: 10

    caching:
      service: redis
      image: redis:7-alpine
      intent: [Sprint 1 idempotency layer, AOF persistence survives restarts]
      ports: {client: 6379}
      volumes: [{name: redis-data, mount: /data}]
      healthCheck:
        test: ["CMD", "redis-cli", "ping"]
        interval: 5s
        timeout: 3s
        retries: 10

    persistence:
      service: postgres
      image: postgres:15-alpine
      intent: [Sprint 344 migration from Firestore, ACID transactions for event sourcing]
      ports: {client: 5432}
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
        POSTGRES_PASSWORD: bitbrat_dev_password
      healthCheck:
        test: ["CMD-SHELL", "pg_isready -U bitbrat"]
        interval: 5s
        timeout: 5s
        retries: 10

services:
  llm-bot:
    dependencies:
      infrastructure: [messaging, caching, persistence]
      services: [auth, tool-gateway]
    active: true
    profile: llm
    # ... rest of service config

executionContexts:
  local:
    description: "Local Docker development environment"

    # Context-level metadata
    config: {purpose: development, isolation: full, dataRetention: ephemeral}
    constraints:
      prerequisites: [Docker Desktop 20.10+, 8GB RAM minimum]
      limitations: [Single developer only, No auto-scaling]
      guarantees: [Fully isolated, Safe to destroy, No production data]
    intent:
      - Rapid iteration with hot reload
      - Work offline during flights
      - Onboarding: productive in 10 minutes
      - Promotion path: local → staging → prod

    infrastructure:
      provider: docker
      persistence:
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
          password: bitbrat_dev_password
      envOverlay:
        path: env/local
        files: [global.yaml, infra.yaml, "{service}.yaml"]
```

## Migration Path

### V1 (Current) → V2 (Proposed)

1. **Add new sections** (non-breaking):
   - `platform.infrastructure`
   - `infrastructure.{provider}`
   - `services.*.dependencies.infrastructure`

2. **Deprecate old patterns** (warning phase):
   - Hardcoded infrastructure in parse-dependencies.ts
   - Infrastructure in docker-compose.local.yaml
   - infrastructure.resources (GCP-specific)

3. **Remove deprecated patterns** (breaking, future sprint):
   - Delete hardcoded infrastructure lists
   - Remove docker-compose.local.yaml infrastructure section
   - Migrate infrastructure.resources to infrastructure.gcp

## JSON Schema

JSON Schema for validation available at: `documentation/schemas/architecture.v2.json`

## Validation Tools

```bash
# Validate architecture.yaml against v2 schema
npm run brat -- config validate --schema v2

# Migrate v1 → v2
npm run brat -- config migrate --from v1 --to v2 --dry-run

# Check for breaking changes
npm run brat -- config diff architecture.yaml architecture.v2.yaml
```

## References

- [README.md](./README.md) - Proposal overview
- [implementation-roadmap.md](./implementation-roadmap.md) - Phased implementation plan
- [migration-guide.md](./migration-guide.md) - Step-by-step migration instructions
- [../documentation/architecture/infrastructure-management.md](../../documentation/architecture/infrastructure-management.md) - Developer guide
