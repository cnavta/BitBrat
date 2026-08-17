# Infrastructure Management

**Platform-agnostic infrastructure declarations for BitBrat services**

**Status**: Sprint 5+ (InfrastructureRegistry with architecture.yaml v2 schema)
**Audience**: Service developers, platform engineers

## Overview

BitBrat uses a three-tier infrastructure model declared in `architecture.yaml`:

1. **Platform Requirements** (`platform.infrastructure`): Generic capabilities needed (messaging, caching, persistence) with:
   - **Config**: Platform-level defaults (TTL, eviction policies, connection pools)
   - **Constraints**: Hard requirements providers MUST satisfy (durability, retention, SSL)
   - **Intent**: Current living use cases (why the platform needs this infrastructure)

2. **Provider Implementations** (`infrastructure.{provider}`): How each platform provides capabilities (Docker, GCP, AWS, Azure, K8s)
   - Must satisfy all platform constraints
   - Can provide additional provider-specific features

3. **Context Overrides** (`executionContexts.*.infrastructure`): Environment-specific configuration (local, staging, prod)
   - Can override platform config per environment
   - Can relax constraints (e.g., disable SSL for local dev)

This model ensures services are platform-agnostic while supporting diverse deployment targets with **consistent behavior** across environments.

## Quick Start

### Declare Infrastructure Requirements

When creating a new service, declare infrastructure dependencies:

```yaml
# architecture.yaml
services:
  my-new-service:
    active: true
    dependencies:
      infrastructure:
        - messaging      # REQUIRED: Service needs message bus
        - caching        # OPTIONAL: Service needs Redis
        - persistence    # OPTIONAL: Service needs database
      services:
        - auth           # REQUIRED: Service depends on auth service
```

### Use Infrastructure in Code

Services access infrastructure through environment variables:

```typescript
// src/apps/my-new-service.ts
import { Bit } from '../common/base-server';

export class MyNewService extends Bit {
  async setup(): Promise<void> {
    // Messaging: NATS_URL or PUBSUB_PROJECT_ID (provider-specific)
    const natsUrl = this.getConfig('NATS_URL');
    await this.onMessage('internal.my-topic.v1', async (data, attrs, ctx) => {
      // Handle message
      await ctx.ack();
    });

    // Caching: REDIS_URL
    const redisUrl = this.getConfig('REDIS_URL');
    // Use RedisManager singleton (already configured)

    // Persistence: DATABASE_URL or FIRESTORE_PROJECT_ID
    const databaseUrl = this.getConfig('DATABASE_URL');
    // Use PersistenceManager (already configured based on PERSISTENCE_DRIVER)
  }
}
```

### Deploy with Infrastructure

Infrastructure deploys automatically with services:

```bash
# Local development - uses Docker provider
npm run local

# Staging - uses Docker provider (remote)
npm run brat -- deploy services --all --context staging

# Production - uses GCP provider
npm run brat -- deploy services --all --context prod
```

## Core Concepts

### Infrastructure Capabilities

| Capability | Purpose | Examples |
|------------|---------|----------|
| **messaging** | Pub/sub, queuing, streaming | NATS, Google Pub/Sub, AWS SQS+SNS, Azure Service Bus |
| **caching** | Key-value store, distributed locks | Redis, Google Memorystore, AWS ElastiCache, Azure Cache |
| **persistence** | Relational database, transactions | PostgreSQL, Cloud SQL, AWS RDS, Azure Database |
| **observability** | Metrics, tracing, logging | Prometheus+Jaeger, Cloud Monitoring+Trace, CloudWatch+X-Ray |

### Providers

| Provider | Deployment Target | Status |
|----------|------------------|--------|
| **docker** | Local dev, self-hosted | ✅ Stable (Sprint 4+) |
| **gcp** | Google Cloud Platform | ✅ Stable (Sprint 4+) |
| **aws** | Amazon Web Services | 🚧 Roadmap (Sprint 5+) |
| **azure** | Microsoft Azure | 🚧 Roadmap (Sprint 6+) |
| **k8s** | Kubernetes clusters | 🚧 Roadmap (Sprint 7+) |

### Configuration Hierarchy

```
platform.infrastructure (generic requirements)
  ↓
infrastructure.docker (Docker implementation)
  ↓
executionContexts.local.infrastructure (local overrides)
  ↓
Environment variables at runtime
```

Higher levels override lower levels.

### Platform Constraints

Platform constraints ensure consistent behavior across all providers. Constraints are **validated at deployment time**.

| Constraint Type | Example | Validation |
|----------------|---------|------------|
| **Durability** | `requireDurability: true` | Provider MUST survive container restarts |
| **Retention** | `minRetention: 86400` | Provider MUST retain data for 24+ hours |
| **Size** | `maxMessageSize: 10MB` | Provider MUST support messages up to 10MB |
| **Performance** | `minConnections: 10` | Provider MUST support 10+ concurrent connections |
| **Security** | `requireSSL: true` | Provider MUST use encrypted connections |

**Example - Messaging Constraints**:

```yaml
platform:
  infrastructure:
    messaging:
      constraints:
        minRetention: 86400        # 24 hours minimum
        maxMessageSize: 10485760   # 10MB max
        requireDurability: true    # Survive restarts
        requireDeadLetter: true    # Support DLQ

# Docker provider MUST satisfy these
infrastructure:
  docker:
    messaging:
      service: nats
      config:
        jetstream:
          enabled: true              # ✅ Satisfies requireDurability
          fileStorage:
            maxAge: 7d               # ✅ Exceeds minRetention (24h)
```

**Validation CLI**:

```bash
# Validate all providers satisfy constraints
$ npm run brat -- config validate --check-constraints

✅ Provider 'docker.messaging' satisfies all constraints
✅ Provider 'docker.caching' satisfies all constraints
⚠️  Provider 'docker.persistence' violates constraint 'requireSSL'
   Platform requires: SSL connections
   Provider provides: Unencrypted connections
   Fix: Override constraint for local dev or add SSL config
```

**Override Constraints per Context**:

```yaml
executionContexts:
  local:
    infrastructure:
      persistence:
        constraints:
          requireSSL: false  # Allow unencrypted for local dev
```

### Configuration Example

Higher levels override lower levels. Example:

```yaml
# 1. Platform declares messaging is required
platform:
  infrastructure:
    messaging:
      required: true
      defaultTTL: 3600

# 2. Docker provider implements with NATS
infrastructure:
  docker:
    messaging:
      service: nats
      image: nats:2.10-alpine
      ports:
        client: 4222

# 3. Staging context overrides port
executionContexts:
  staging:
    infrastructure:
      provider: docker
      messaging:
        ports:
          client: 14222  # Use alternate port

# 4. Runtime env var (highest priority)
# NATS_URL=nats://custom-host:4222
```

## Common Tasks

### Add Infrastructure Dependency to Service

**When**: Your service needs messaging, caching, or persistence

**How**:

1. Edit `architecture.yaml`:
   ```yaml
   services:
     my-service:
       dependencies:
         infrastructure: [messaging, caching]  # Add capabilities
   ```

2. Validate dependencies:
   ```bash
   npm run brat -- config validate --schema v2
   ```

3. Access in code:
   ```typescript
   // Messaging
   const natsUrl = this.getConfig('NATS_URL');

   // Caching
   const redisUrl = this.getConfig('REDIS_URL');
   ```

4. Deploy:
   ```bash
   npm run brat -- deploy service my-service
   ```

### Add New Infrastructure Capability

**When**: Platform needs a new capability (e.g., search, analytics)

**How**:

1. Declare in platform requirements:
   ```yaml
   platform:
     infrastructure:
       search:
         required: false
         capabilities: [fulltext, faceted, autocomplete]
   ```

2. Implement in Docker provider:
   ```yaml
   infrastructure:
     docker:
       search:
         service: elasticsearch
         image: elasticsearch:8.8.0
         ports:
           http: 9200
         healthCheck:
           test: ["CMD", "curl", "-f", "http://localhost:9200/_cluster/health"]
   ```

3. Implement in other providers (GCP, AWS, etc.):
   ```yaml
   infrastructure:
     gcp:
       search:
         type: algolia  # Managed service
         apiKey: ${ALGOLIA_API_KEY}
   ```

4. Validate:
   ```bash
   npm run brat -- config validate --schema v2
   ```

### Override Infrastructure Configuration

**When**: Need environment-specific configuration (ports, databases, auth)

**How**:

1. Edit execution context:
   ```yaml
   executionContexts:
     staging:
       infrastructure:
         provider: docker
         messaging:
           auth:
             token: ${NATS_TOKEN}  # Enable auth for remote
         persistence:
           database: bitbrat_staging  # Different database
   ```

2. Update runtime configuration:
   ```yaml
   executionContexts:
     staging:
       runtime:
         persistence:
           connection:
             host: bitbrat.lan
             database: bitbrat_staging  # Match infrastructure override
   ```

3. Deploy:
   ```bash
   npm run brat -- deploy services --all --context staging
   ```

### Deploy Infrastructure Only

**When**: Need to update infrastructure without redeploying services

**How**:

```bash
# Preview changes
npm run brat -- deploy infrastructure --context staging --dry-run

# Deploy infrastructure only
npm run brat -- deploy infrastructure --context staging

# Verify infrastructure health
npm run brat -- infrastructure health --context staging
```

### Add Conditional Infrastructure

**When**: Infrastructure only needed in specific scenarios (e.g., legacy Firestore)

**How**:

1. Declare conditional requirement:
   ```yaml
   platform:
     infrastructure:
       legacy-persistence:
         required: false
         conditionalOn:
           env: PERSISTENCE_DRIVER
           value: firestore
   ```

2. Implement conditionally:
   ```yaml
   infrastructure:
     docker:
       legacy-persistence:
         conditionalOn:
           env: PERSISTENCE_DRIVER
           value: firestore
         service: firebase-emulator
         image: andreysenov/firebase-tools:latest
   ```

3. Deploy with condition:
   ```bash
   PERSISTENCE_DRIVER=firestore npm run brat -- deploy services --all
   ```

## Infrastructure Registry API

**Internal API for platform tooling (not for service code)**

Sprint 5 introduces `InfrastructureRegistry` as the central source of truth for infrastructure configuration. All deployment tooling uses this API instead of hardcoded infrastructure lists.

### Core Methods

```typescript
import { InfrastructureRegistry } from '@/infrastructure/registry';

// 1. Get all required infrastructure for active services
const specs = InfrastructureRegistry.getRequiredInfrastructure(
  repoRoot,
  context,
  activeServices
);
// Returns: InfrastructureSpec[] - deduplicated specs for all required infrastructure
// Example: [{serviceName: 'nats', capability: 'messaging', ...}, {serviceName: 'redis', ...}]

// 2. Get infrastructure implementation for specific capability
const spec = InfrastructureRegistry.getInfrastructureByCapability(
  repoRoot,
  context,
  'messaging'
);
// Returns: InfrastructureSpec | null
// Example: {serviceName: 'nats', capability: 'messaging', provider: 'docker', image: 'nats:2.10-alpine', ports: {...}, ...}

// 3. Get all infrastructure service names (for docker-compose)
const serviceNames = InfrastructureRegistry.getInfrastructureServices(
  repoRoot,
  context
);
// Returns: string[] - sorted array of service names
// Example: ['nats', 'postgres', 'redis']

// 4. Get all infrastructure specs for a context
const allSpecs = InfrastructureRegistry.getAllInfrastructureSpecs(
  repoRoot,
  context
);
// Returns: InfrastructureSpec[] - all infrastructure specs (not filtered by dependencies)
// Example: [{serviceName: 'nats', ...}, {serviceName: 'redis', ...}, {serviceName: 'postgres', ...}]

// 5. Validate service dependencies
const result = InfrastructureRegistry.validateDependencies(
  repoRoot,
  context,
  services
);
// Returns: ValidationResult { valid: boolean, errors: string[], warnings: string[] }
// Example: {valid: false, errors: ['Service "llm-bot" requires "caching" but no provider found'], warnings: []}
```

### InfrastructureSpec Interface

```typescript
interface InfrastructureSpec {
  capability: string;          // 'messaging', 'caching', 'persistence'
  provider: string;            // 'docker', 'gcp', 'aws', 'azure'
  serviceName: string;         // 'nats', 'redis', 'postgres'
  type?: string;               // Provider-specific type (e.g., 'pubsub', 'memorystore')
  image?: string;              // Docker image (docker provider only)
  ports?: Record<string, string>;  // Port mappings {client: '4222', http: '8222'}
  volumes?: VolumeSpec[];      // Volume mounts
  env?: Record<string, string>;    // Environment variables
  config?: Record<string, any>;    // Merged configuration (platform → provider → context)
  healthCheck?: HealthCheck;   // Health check configuration
  intent?: string;             // Why this infrastructure is needed
}
```

### Usage in Deployment Tools

**parse-dependencies.ts** - Sprint 5 migration:

```typescript
// OLD (hardcoded):
const infrastructure = new Set<string>(['nats', 'redis']);

// NEW (declarative):
const specs = InfrastructureRegistry.getRequiredInfrastructure(
  repoRoot,
  context,
  activeServices
);
const infrastructure = new Set(specs.map(s => s.serviceName));
```

**generate-docker-compose.ts** - Sprint 5 migration:

```typescript
// OLD (read from docker-compose.local.yaml):
const infraCompose = yaml.parse(fs.readFileSync('docker-compose.local.yaml'));

// NEW (generate from InfrastructureRegistry):
const allSpecs = InfrastructureRegistry.getAllInfrastructureSpecs(repoRoot, context);
for (const spec of allSpecs) {
  const composeDef = {
    image: spec.image,
    environment: spec.env || {},
    healthcheck: spec.healthCheck ? {
      test: spec.healthCheck.test,
      interval: spec.healthCheck.interval || '5s',
      timeout: spec.healthCheck.timeout || '3s',
      retries: spec.healthCheck.retries || 10,
    } : undefined,
  };
  services[spec.serviceName] = composeDef;
}
```

**docker-compose-strategy.ts** - Sprint 5 migration:

```typescript
// OLD (hardcoded):
const INFRA_SERVICES = ['nats', 'redis', 'postgres', 'nats-box'];

// NEW (dynamic):
const infraServices = InfrastructureRegistry.getInfrastructureServices(repoRoot, context);
```

## Health Checks

Infrastructure health checks ensure services don't start until infrastructure is ready.

### Configure Health Checks

```yaml
infrastructure:
  docker:
    messaging:
      service: nats
      healthCheck:
        test: ["CMD", "wget", "--spider", "http://localhost:8222/healthz"]
        interval: 5s    # Check every 5 seconds
        timeout: 3s     # Timeout after 3 seconds
        retries: 10     # Retry 10 times before failing
```

### Health Gate Pattern

**Automatic** (used by `brat deploy`):

```typescript
import { HealthGate } from '@/infrastructure/health-gate';

// Wait for all infrastructure to be healthy
await HealthGate.waitForInfrastructure(infrastructureSpecs, {
  timeout: 60000,  // 60 seconds
  parallel: true   // Check all in parallel
});
```

### Manual Health Checks

```bash
# Check all infrastructure
npm run brat -- infrastructure health --context local

# Check specific service
docker exec -it bitbrat-postgres-1 pg_isready -U bitbrat
docker exec -it bitbrat-redis-1 redis-cli ping
curl -f http://localhost:8222/healthz  # NATS
```

## Provider-Specific Guides

### Docker Provider

**Best for**: Local development, self-hosted production

**Infrastructure**: Docker Compose

**Example**:

```yaml
infrastructure:
  docker:
    messaging:
      service: nats
      image: nats:2.10-alpine
      ports: {client: 4222, http: 8222}
      volumes: [{name: nats-data, mount: /data}]

executionContexts:
  local:
    infrastructure:
      provider: docker
    deployment:
      type: docker-compose
      docker:
        host: unix:///var/run/docker.sock
```

**Access in service**:

```typescript
// NATS_URL automatically set to nats://localhost:4222
const natsUrl = this.getConfig('NATS_URL');
```

### GCP Provider

**Best for**: Managed cloud infrastructure, auto-scaling

**Infrastructure**: Cloud Pub/Sub, Memorystore, Cloud SQL

**Example**:

```yaml
infrastructure:
  gcp:
    project: ${GCP_PROJECT}
    region: us-central1

    messaging:
      type: pubsub
      topics:
        - name: internal-ingress-v1
          retentionDuration: 7d

    caching:
      type: memorystore-redis
      tier: BASIC
      memorySizeGb: 1

    persistence:
      type: cloudsql
      instance: bitbrat-prod
      databaseVersion: POSTGRES_15

executionContexts:
  prod:
    infrastructure:
      provider: gcp
    deployment:
      type: cloud-run
      gcp:
        project: ${GCP_PROJECT}
        region: us-central1
```

**Access in service**:

```typescript
// PUBSUB_PROJECT_ID automatically set
const projectId = this.getConfig('PUBSUB_PROJECT_ID');

// REDIS_URL set to Cloud Memorystore instance
const redisUrl = this.getConfig('REDIS_URL');

// DATABASE_URL set to Cloud SQL instance (via Cloud SQL Proxy)
const databaseUrl = this.getConfig('DATABASE_URL');
```

## Docker Provider Examples (v2 Schema)

Complete working examples for common infrastructure services using architecture.yaml v2 schema.

### Example 1: NATS (Messaging)

**Full configuration**:

```yaml
# architecture.yaml
platform:
  infrastructure:
    messaging:
      required: true
      intent: "Message bus for event-driven service orchestration"
      config:
        defaultTTL: 3600  # 1 hour message retention
      constraints:
        minRetention: 86400        # 24 hours minimum
        maxMessageSize: 10485760   # 10MB max
        requireDurability: true    # Survive container restarts
        requireDeadLetter: true    # Support DLQ for failed messages

infrastructure:
  docker:
    messaging:
      service: nats
      image: nats:2.10-alpine
      ports:
        client: 4222
        http: 8222
      volumes:
        - name: nats-data
          mount: /data
      env:
        NATS_JET_STREAM: "true"
      healthCheck:
        test: ["CMD", "wget", "--spider", "http://localhost:8222/healthz"]
        interval: 5s
        timeout: 3s
        retries: 10

executionContexts:
  local:
    infrastructure:
      provider: docker
      messaging:
        ports:
          client: 4222  # Default port for local
    runtime:
      envOverlay:
        path: env/local
        files: [global.yaml, infra.yaml]

volumes:
  nats-data:
    driver: local
```

**Service usage**:

```typescript
// src/apps/my-service.ts
export class MyService extends Bit {
  async setup(): Promise<void> {
    // NATS_URL automatically set to nats://localhost:4222
    const natsUrl = this.getConfig('NATS_URL');

    // Subscribe to messages
    await this.onMessage('internal.my-topic.v1', async (data, attrs, ctx) => {
      this.logger.info('Received message', { data });
      await ctx.ack();
    });

    // Publish messages
    await this.publish('internal.my-topic.v1', { foo: 'bar' });
  }
}
```

**Environment variables** (`env/local/infra.yaml`):

```yaml
NATS_URL: "nats://localhost:4222"
MESSAGE_BUS_DRIVER: "nats"
NATS_JET_STREAM: "true"
```

### Example 2: PostgreSQL (Persistence)

**Full configuration**:

```yaml
# architecture.yaml
platform:
  infrastructure:
    persistence:
      required: true
      intent: "Relational database for state, events, and user data"
      config:
        connectionPoolSize: 10
        queryTimeout: 5000
      constraints:
        requireTransactions: true
        requireSSL: false  # SSL required in prod, optional in local
        minConnections: 5

infrastructure:
  docker:
    persistence:
      service: postgres
      image: postgres:15-alpine
      ports:
        db: 5432
      volumes:
        - name: postgres-data
          mount: /var/lib/postgresql/data
      env:
        POSTGRES_USER: bitbrat
        POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
        POSTGRES_DB: bitbrat
      healthCheck:
        test: ["CMD-SHELL", "pg_isready -U bitbrat"]
        interval: 5s
        timeout: 3s
        retries: 10

executionContexts:
  local:
    infrastructure:
      provider: docker
      persistence:
        constraints:
          requireSSL: false  # Allow unencrypted for local dev
    runtime:
      persistence:
        driver: postgres
        connection:
          host: localhost
          port: 5432
          database: bitbrat
          username: bitbrat
          password: ${POSTGRES_PASSWORD}

volumes:
  postgres-data:
    driver: local
```

**Service usage**:

```typescript
// src/apps/my-service.ts
import { PersistenceManager } from '@/common/persistence-manager';

export class MyService extends Bit {
  async setup(): Promise<void> {
    // DATABASE_URL automatically set to postgresql://bitbrat:password@localhost:5432/bitbrat
    const databaseUrl = this.getConfig('DATABASE_URL');

    // Use PersistenceManager (already configured)
    const registry = PersistenceManager.getRegistry();

    // Create a table
    await registry.query(`
      CREATE TABLE IF NOT EXISTS my_table (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Insert data
    await registry.query(
      'INSERT INTO my_table (name) VALUES ($1)',
      ['test']
    );
  }
}
```

**Environment variables** (`env/local/infra.yaml`):

```yaml
PERSISTENCE_DRIVER: "postgres"
DATABASE_URL: "postgresql://bitbrat:${POSTGRES_PASSWORD}@localhost:5432/bitbrat"
POSTGRES_HOST: "localhost"
POSTGRES_PORT: "5432"
POSTGRES_DATABASE: "bitbrat"
POSTGRES_USER: "bitbrat"
POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}"  # Set in .secure.local/.env
```

**Secure environment** (`.secure.local/.env`):

```bash
POSTGRES_PASSWORD=your_secure_password_here
```

### Example 3: Redis (Caching)

**Full configuration**:

```yaml
# architecture.yaml
platform:
  infrastructure:
    caching:
      required: true
      intent: "Distributed cache for idempotency and session state"
      config:
        defaultTTL: 300  # 5 minutes
        maxMemory: "256mb"
        evictionPolicy: "allkeys-lru"
      constraints:
        minConnections: 5
        requireSSL: false  # SSL required in prod, optional in local

infrastructure:
  docker:
    caching:
      service: redis
      image: redis:7-alpine
      ports:
        client: 6379
      volumes:
        - name: redis-data
          mount: /data
      env:
        REDIS_MAXMEMORY: "256mb"
        REDIS_MAXMEMORY_POLICY: "allkeys-lru"
      healthCheck:
        test: ["CMD", "redis-cli", "ping"]
        interval: 5s
        timeout: 3s
        retries: 10

executionContexts:
  local:
    infrastructure:
      provider: docker
      caching:
        config:
          maxMemory: "128mb"  # Lower memory for local dev
    runtime:
      envOverlay:
        path: env/local
        files: [global.yaml, infra.yaml]

volumes:
  redis-data:
    driver: local
```

**Service usage**:

```typescript
// src/apps/my-service.ts
import { RedisManager } from '@/common/resources/redis-manager';

export class MyService extends Bit {
  private redis!: RedisManager;

  async setup(): Promise<void> {
    // REDIS_URL automatically set to redis://localhost:6379
    const redisUrl = this.getConfig('REDIS_URL');

    // Use RedisManager singleton
    this.redis = RedisManager.getInstance();
    await this.redis.connect();

    // Set/get cache values
    await this.redis.set('my-key', 'my-value', 300);  // TTL: 5 minutes
    const value = await this.redis.get('my-key');

    // Idempotency pattern
    const messageId = 'unique-message-id';
    const isDuplicate = await this.redis.exists(`idempotency:${messageId}`);
    if (!isDuplicate) {
      await this.redis.set(`idempotency:${messageId}`, '1', 300);
      // Process message
    }
  }

  async shutdown(): Promise<void> {
    await this.redis.disconnect();
  }
}
```

**Environment variables** (`env/local/infra.yaml`):

```yaml
REDIS_URL: "redis://localhost:6379"
REDIS_IDEMPOTENCY_ENABLED: "true"
REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS: "300"
```

### Example 4: Full Stack (NATS + PostgreSQL + Redis)

**Complete architecture.yaml**:

```yaml
# architecture.yaml
platform:
  infrastructure:
    messaging:
      required: true
      intent: "Event-driven orchestration"
    persistence:
      required: true
      intent: "State and event storage"
    caching:
      required: true
      intent: "Idempotency and session state"

infrastructure:
  docker:
    messaging:
      service: nats
      image: nats:2.10-alpine
      ports: {client: 4222, http: 8222}
      volumes: [{name: nats-data, mount: /data}]
      env: {NATS_JET_STREAM: "true"}
      healthCheck:
        test: ["CMD", "wget", "--spider", "http://localhost:8222/healthz"]
        interval: 5s
        timeout: 3s
        retries: 10

    persistence:
      service: postgres
      image: postgres:15-alpine
      ports: {db: 5432}
      volumes: [{name: postgres-data, mount: /var/lib/postgresql/data}]
      env:
        POSTGRES_USER: bitbrat
        POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
        POSTGRES_DB: bitbrat
      healthCheck:
        test: ["CMD-SHELL", "pg_isready -U bitbrat"]
        interval: 5s
        timeout: 3s
        retries: 10

    caching:
      service: redis
      image: redis:7-alpine
      ports: {client: 6379}
      volumes: [{name: redis-data, mount: /data}]
      env:
        REDIS_MAXMEMORY: "256mb"
        REDIS_MAXMEMORY_POLICY: "allkeys-lru"
      healthCheck:
        test: ["CMD", "redis-cli", "ping"]
        interval: 5s
        timeout: 3s
        retries: 10

services:
  llm-bot:
    active: true
    dependencies:
      infrastructure: [messaging, caching, persistence]
      services: [auth, tool-gateway]

executionContexts:
  local:
    infrastructure:
      provider: docker
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
          database: bitbrat
          username: bitbrat
          password: ${POSTGRES_PASSWORD}
      envOverlay:
        path: env/local
        files: [global.yaml, infra.yaml, "{service}.yaml"]
        secure: .secure.local

volumes:
  nats-data: {driver: local}
  postgres-data: {driver: local}
  redis-data: {driver: local}
```

**Deploy**:

```bash
# Generate docker-compose.local.yaml from architecture.yaml
npm run brat -- context create local

# Deploy all infrastructure + services
npm run brat -- deploy services --all --context local

# Verify infrastructure health
docker ps  # All containers should be healthy
docker exec -it bitbratplatform-postgres-1 pg_isready -U bitbrat
docker exec -it bitbratplatform-redis-1 redis-cli ping
curl -f http://localhost:8222/healthz  # NATS health check
```

## Schema Validation Troubleshooting

Common validation errors when using `brat config validate --schema v2` and their solutions.

### Error: Missing infrastructure dependencies

**Error Message**:
```
⚠️  4 WARNING(S):
  Path: services.llm-bot.dependencies.infrastructure
  Warning: Active platform service has no infrastructure dependencies
```

**Cause**: Service is marked `active: true` but doesn't declare infrastructure dependencies.

**Solution**: Add explicit infrastructure dependencies:

```yaml
services:
  llm-bot:
    active: true
    dependencies:
      infrastructure: [messaging, caching, persistence]  # Add this
```

**Validation**:
```bash
npm run brat -- config validate --schema v2
# ✅ 0 errors, 0 warnings
```

### Error: Provider not found for capability

**Error Message**:
```
❌ Service 'llm-bot' depends on 'caching' but no provider found for context 'local'
```

**Cause**: Service declares `caching` dependency but `infrastructure.docker.caching` is not defined.

**Solution**: Add provider implementation:

```yaml
infrastructure:
  docker:
    caching:  # Add this section
      service: redis
      image: redis:7-alpine
      ports: {client: 6379}
```

**Validation**:
```bash
npm run brat -- config validate --schema v2 --check-providers
# ✅ All providers found
```

### Error: Context missing provider declaration

**Error Message**:
```
❌ Context 'local' missing infrastructure.provider declaration
```

**Cause**: Execution context doesn't specify which infrastructure provider to use.

**Solution**: Add provider to execution context:

```yaml
executionContexts:
  local:
    infrastructure:
      provider: docker  # Add this
```

**Validation**:
```bash
npm run brat -- config validate --schema v2
# ✅ 0 errors, 0 warnings
```

### Error: Invalid constraint type

**Error Message**:
```
❌ Invalid constraint type 'requireDurability' - expected boolean, got string
```

**Cause**: Constraint value has wrong type (string instead of boolean).

**Solution**: Fix constraint type:

```yaml
# ❌ Wrong
platform:
  infrastructure:
    messaging:
      constraints:
        requireDurability: "true"  # String

# ✅ Correct
platform:
  infrastructure:
    messaging:
      constraints:
        requireDurability: true  # Boolean
```

### Error: Missing volume declaration

**Error Message**:
```
❌ Volume 'postgres-data' referenced but not declared in volumes section
```

**Cause**: Infrastructure service references volume that doesn't exist in global volumes.

**Solution**: Add volume declaration:

```yaml
infrastructure:
  docker:
    persistence:
      volumes:
        - name: postgres-data  # Referenced here
          mount: /var/lib/postgresql/data

volumes:
  postgres-data:  # Must be declared here
    driver: local
```

## Troubleshooting

### Infrastructure Not Starting

**Symptom**: `[health-gate] ✗ postgres is unhealthy (timeout after 30s)`

**Solutions**:

1. Check container logs:
   ```bash
   docker logs bitbrat-postgres-1
   ```

2. Verify health check configuration:
   ```yaml
   healthCheck:
     test: ["CMD-SHELL", "pg_isready -U bitbrat"]
     interval: 5s
     retries: 10
   ```

3. Increase retry count if slow startup:
   ```yaml
   healthCheck:
     retries: 20  # Increase from 10
   ```

### Service Dependencies Not Satisfied

**Symptom**: `❌ Service 'llm-bot' depends on 'caching' but no provider found`

**Solutions**:

1. Check service dependencies:
   ```yaml
   services:
     llm-bot:
       dependencies:
         infrastructure: [messaging, caching, persistence]
   ```

2. Ensure provider implements capability:
   ```yaml
   infrastructure:
     docker:
       caching:  # Must be defined
         service: redis
   ```

3. Validate configuration:
   ```bash
   npm run brat -- config validate --schema v2 --check-providers
   ```

### Wrong Infrastructure Used

**Symptom**: Service connects to wrong database/cache

**Solutions**:

1. Check execution context provider:
   ```yaml
   executionContexts:
     staging:
       infrastructure:
         provider: docker  # Should match infrastructure.docker section
   ```

2. Verify environment variables:
   ```bash
   npm run brat -- config show --context staging | grep -E "(REDIS_URL|DATABASE_URL|NATS_URL)"
   ```

3. Check runtime configuration:
   ```yaml
   executionContexts:
     staging:
       runtime:
         persistence:
           connection:
             host: bitbrat.lan  # Should match infrastructure deployment
   ```

### Port Conflicts

**Symptom**: `Bind for 0.0.0.0:6379 failed: port is already allocated`

**Solutions**:

1. Override port in execution context:
   ```yaml
   executionContexts:
     local:
       infrastructure:
         caching:
           ports:
             client: 16379  # Use alternate port
   ```

2. Stop conflicting containers:
   ```bash
   docker ps | grep redis
   docker stop <container-id>
   ```

3. Use PortManager (automatic):
   ```bash
   # PortManager automatically assigns unique ports
   npm run brat -- deploy services --all
   ```

## Migration from v1 to v2 Schema

Complete before/after examples showing how to migrate from hardcoded infrastructure to declarative v2 schema.

### Migration Example 1: Service with Messaging

**BEFORE (v1)** - Hardcoded infrastructure, no explicit dependencies:

```yaml
# architecture.yaml (v1)
services:
  event-router:
    active: true
    port: 3005
    # No infrastructure dependencies declared
```

```typescript
// tools/brat/src/context/parse-dependencies.ts (v1)
// Infrastructure hardcoded in deployment tool
const infrastructure: string[] = [];
infrastructure.push('nats');  // Always deployed
```

```yaml
# docker-compose.local.yaml (v1) - Static, manually maintained
services:
  nats:
    image: nats:2.10-alpine
    ports:
      - "4222:4222"
```

**AFTER (v2)** - Declarative infrastructure with explicit dependencies:

```yaml
# architecture.yaml (v2)
platform:
  infrastructure:
    messaging:
      required: true
      intent: "Event-driven service orchestration"

infrastructure:
  docker:
    messaging:
      service: nats
      image: nats:2.10-alpine
      ports: {client: 4222}

services:
  event-router:
    active: true
    port: 3005
    dependencies:
      infrastructure: [messaging]  # ✅ Explicit dependency

executionContexts:
  local:
    infrastructure:
      provider: docker
```

```typescript
// tools/brat/src/context/parse-dependencies.ts (v2)
// Infrastructure derived from service dependencies
const requiredInfra = metadata.dependencies?.infrastructure || [];
for (const capability of requiredInfra) {
  const spec = InfrastructureRegistry.getInfrastructureByCapability(repoRoot, context, capability);
  if (spec) {
    infrastructure.push(spec.serviceName);  // Pushes 'nats'
  }
}
```

**Benefits**:
- ✅ Service explicitly declares what it needs
- ✅ Infrastructure derived from actual requirements
- ✅ No static docker-compose file to maintain
- ✅ Portable across deployment platforms (Docker, GCP, AWS)

### Migration Example 2: Service with Full Stack

**BEFORE (v1)** - Conditional infrastructure, hardcoded in multiple places:

```yaml
# architecture.yaml (v1)
services:
  llm-bot:
    active: true
    port: 3002
    env:
      NATS_URL: "nats://localhost:4222"
      REDIS_URL: "redis://localhost:6379"
      DATABASE_URL: "postgresql://bitbrat:password@localhost:5432/bitbrat"
```

```typescript
// tools/brat/src/context/parse-dependencies.ts (v1)
const infrastructure: string[] = [];
infrastructure.push('nats');
infrastructure.push('redis');
if (metadata.envKeys.includes('PERSISTENCE_DRIVER')) {
  infrastructure.push('postgres');  // Conditional based on env var
}
```

```yaml
# docker-compose.local.yaml (v1) - Static file
services:
  nats:
    image: nats:2.10-alpine
    ports: ["4222:4222"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  postgres:
    image: postgres:15-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_USER: bitbrat
      POSTGRES_PASSWORD: password
```

**AFTER (v2)** - Declarative, platform-agnostic infrastructure:

```yaml
# architecture.yaml (v2)
platform:
  infrastructure:
    messaging:
      required: true
      intent: "Event-driven orchestration"
    caching:
      required: true
      intent: "Idempotency and session state"
    persistence:
      required: true
      intent: "State and event storage"

infrastructure:
  docker:
    messaging:
      service: nats
      image: nats:2.10-alpine
      ports: {client: 4222}
      healthCheck:
        test: ["CMD", "wget", "--spider", "http://localhost:8222/healthz"]
        interval: 5s
        retries: 10

    caching:
      service: redis
      image: redis:7-alpine
      ports: {client: 6379}
      healthCheck:
        test: ["CMD", "redis-cli", "ping"]
        interval: 5s
        retries: 10

    persistence:
      service: postgres
      image: postgres:15-alpine
      ports: {db: 5432}
      env:
        POSTGRES_USER: bitbrat
        POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
        POSTGRES_DB: bitbrat
      healthCheck:
        test: ["CMD-SHELL", "pg_isready -U bitbrat"]
        interval: 5s
        retries: 10

services:
  llm-bot:
    active: true
    port: 3002
    dependencies:
      infrastructure: [messaging, caching, persistence]  # ✅ Explicit
      services: [auth, tool-gateway]

executionContexts:
  local:
    infrastructure:
      provider: docker
    runtime:
      persistence:
        driver: postgres
        connection:
          host: localhost
          port: 5432
          database: bitbrat
          username: bitbrat
          password: ${POSTGRES_PASSWORD}
```

**Benefits**:
- ✅ All infrastructure declared once in platform section
- ✅ Docker provider maps generic capabilities to specific services
- ✅ Service explicitly lists ALL dependencies
- ✅ Environment variables auto-generated from infrastructure config
- ✅ Health checks built-in to infrastructure definitions
- ✅ Secrets managed via `.secure.local/.env` instead of hardcoded

### Migration Example 3: Multi-Context Infrastructure

**BEFORE (v1)** - Separate compose files per environment:

```yaml
# docker-compose.local.yaml (v1)
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: bitbrat_local
      POSTGRES_PASSWORD: password

# docker-compose.staging.yaml (v1)
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: bitbrat_staging
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
```

**AFTER (v2)** - Single source with context overrides:

```yaml
# architecture.yaml (v2)
platform:
  infrastructure:
    persistence:
      required: true

infrastructure:
  docker:
    persistence:
      service: postgres
      image: postgres:15-alpine
      ports: {db: 5432}
      env:
        POSTGRES_USER: bitbrat
        POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}  # From .secure.{context}/.env
        POSTGRES_DB: bitbrat  # Default

executionContexts:
  local:
    infrastructure:
      provider: docker
      persistence:
        env:
          POSTGRES_DB: bitbrat_local  # ✅ Override for local

  staging:
    infrastructure:
      provider: docker
      persistence:
        env:
          POSTGRES_DB: bitbrat_staging  # ✅ Override for staging
        constraints:
          requireSSL: true  # ✅ Enforce SSL in staging
```

**Benefits**:
- ✅ Single infrastructure definition
- ✅ Context-specific overrides clear and explicit
- ✅ No duplication across compose files
- ✅ Easy to see differences between environments

### Migration Steps

**Step 1: Audit Current Infrastructure**

```bash
# Find all hardcoded infrastructure references
grep -r "infrastructure.push" tools/brat/
grep -r "nats\|redis\|postgres" tools/brat/src/context/

# List all services
npm run brat -- config show | grep "services:" -A 100
```

**Step 2: Declare Platform Requirements**

```yaml
# Add to architecture.yaml
platform:
  infrastructure:
    messaging:
      required: true
      intent: "Why we need messaging"
    caching:
      required: false  # Optional capability
      intent: "Why we need caching"
```

**Step 3: Implement Docker Provider**

```yaml
# Add to architecture.yaml
infrastructure:
  docker:
    messaging:
      service: nats
      image: nats:2.10-alpine
      ports: {client: 4222}
    caching:
      service: redis
      image: redis:7-alpine
      ports: {client: 6379}
```

**Step 4: Add Service Dependencies**

```yaml
# For each service in architecture.yaml
services:
  llm-bot:
    dependencies:
      infrastructure: [messaging, caching, persistence]

  event-router:
    dependencies:
      infrastructure: [messaging]  # Only needs messaging
```

**Step 5: Validate Configuration**

```bash
# Validate v2 schema
npm run brat -- config validate --schema v2

# Check for missing providers
npm run brat -- config validate --check-providers

# Test deployment
npm run brat -- deploy services --all --context local --dry-run
```

**Step 6: Test Migration**

```bash
# Deploy with new configuration
npm run brat -- deploy services --all --context local

# Verify infrastructure health
docker ps  # All containers healthy?
npm run brat -- infrastructure health --context local

# Test service connectivity
npm run brat -- chat  # Interactive test
```

**Step 7: Remove v1 Artifacts**

```bash
# After successful v2 deployment, remove old files
rm infrastructure/docker-compose/docker-compose.local.yaml  # Static file
rm infrastructure/docker-compose/docker-compose.staging.yaml

# Remove hardcoded infrastructure from code
# (Update parse-dependencies.ts, generate-docker-compose.ts, etc.)
```

### Common Migration Issues

**Issue 1: Missing dependencies**

```bash
# Symptom
❌ Service 'llm-bot' requires messaging but no provider found

# Solution
# Add docker provider for messaging capability
infrastructure:
  docker:
    messaging:
      service: nats
```

**Issue 2: Duplicate infrastructure**

```bash
# Symptom
⚠️ Infrastructure 'nats' deployed twice

# Solution
# Consolidate duplicate declarations, check for typos
services:
  service-a:
    dependencies:
      infrastructure: [messaging]  # Don't duplicate
```

**Issue 3: Environment variable mismatch**

```bash
# Symptom
Error: NATS_URL is not defined

# Solution
# Ensure env overlay includes infra.yaml
executionContexts:
  local:
    runtime:
      envOverlay:
        files: [global.yaml, infra.yaml]  # Add infra.yaml
```

See [Sprint 6 Migration Guide](../../planning/sprint-6-foundation/migration-workflow.md) for complete migration instructions.

## Best Practices

### DO ✅

- **Declare dependencies explicitly**: Add all infrastructure dependencies to `services.*.dependencies.infrastructure`
- **Use generic capabilities**: Declare `messaging` not `nats`, `caching` not `redis`
- **Test locally first**: Validate infrastructure changes in local context before staging/prod
- **Use health checks**: Configure appropriate health checks for all infrastructure
- **Override sparingly**: Only override when necessary (ports, auth, databases)

### DON'T ❌

- **Hardcode infrastructure**: Never hardcode NATS, Redis, PostgreSQL in code
- **Skip validation**: Always run `brat config validate` after architecture.yaml changes
- **Assume providers**: Check provider availability per context
- **Bypass health gates**: Don't start services before infrastructure is ready
- **Mix v1 and v2**: Complete migration to v2, don't leave v1 patterns

## Examples

### Minimal Service (Messaging Only)

```yaml
services:
  event-router:
    dependencies:
      infrastructure: [messaging]  # Only needs NATS
      services: []
```

### Standard Service (Messaging + Caching + Persistence)

```yaml
services:
  llm-bot:
    dependencies:
      infrastructure: [messaging, caching, persistence]
      services: [auth, tool-gateway]
```

### Infrastructure-Heavy Service (All Capabilities)

```yaml
services:
  analytics:
    dependencies:
      infrastructure: [messaging, caching, persistence, observability, search]
      services: [auth]
```

### Context-Specific Infrastructure

```yaml
executionContexts:
  local:
    infrastructure:
      provider: docker
      persistence:
        database: bitbrat_local

  staging:
    infrastructure:
      provider: docker
      persistence:
        database: bitbrat_staging
        ssl:
          enabled: true

  prod:
    infrastructure:
      provider: gcp
      persistence:
        backupConfiguration:
          retentionDays: 30
```

## Reference

- [Schema Proposal](../../planning/sprint-5-anrn33/schema-proposal.md) - Complete v2 schema with InfrastructureRegistry
- [Migration Guide](../../planning/sprint-5-anrn33/migration-guide.md) - v1 → v2 migration (hardcoded → declarative)
- [Implementation Roadmap](../../planning/sprint-5-anrn33/implementation-roadmap.md) - Phased rollout with InfrastructureRegistry
- [Sprint 5 README](../../planning/sprint-5-anrn33/README.md) - Complete Sprint 5 documentation
- [Execution Contexts](../guides/execution-contexts.md) - Context configuration
- [Docker Deployment](../guides/docker-deployment.md) - Docker provider details
- [GCP Deployment](../guides/gcp-deployment.md) - GCP provider details
