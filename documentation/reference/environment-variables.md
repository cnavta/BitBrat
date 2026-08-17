# Environment Variables Reference

Complete reference for environment variables used in the BitBrat Platform. This document covers common variables, service-specific variables, and auto-injected variables.

**Status**: Current (Sprint 8+)
**Last Updated**: 2026-08-10
**Replaces**: `architecture.yaml` → `conventions.env` (partial)

---

## Overview

BitBrat services are configured via environment variables loaded from multiple sources. Variables are resolved in priority order, allowing environment-specific overrides while maintaining sensible defaults.

### Variable Sources

| Source | Priority | Use Case | Example |
|--------|----------|----------|---------|
| **Environment Variables** | 1 (Highest) | Runtime overrides, CI/CD | `export LOG_LEVEL=debug` |
| **`.secure.{ENV}/.env`** | 2 | Secrets and sensitive config | `.secure.local/.env` |
| **`env/{context}/global.yaml`** | 3 | Context-wide defaults | `env/local/global.yaml` |
| **`env/{context}/{service}.yaml`** | 4 | Service-specific config | `env/local/llm-bot.yaml` |
| **`architecture.yaml` defaults** | 5 (Lowest) | Platform defaults | `defaults.services.env` |

**Resolution Example**:
```
LOG_LEVEL value resolution:
1. Check environment variable: LOG_LEVEL=debug ✓ (use this)
2. Check .secure.local/.env: LOG_LEVEL=info (skipped)
3. Check env/local/global.yaml: LOG_LEVEL=info (skipped)
4. Check architecture.yaml: (not defined) (skipped)
5. Result: LOG_LEVEL=debug
```

---

## Quick Reference

### Common Variables (All Services)

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `LOG_LEVEL` | `info` | ✅ | Logging verbosity (error/warn/info/debug/trace) |
| `MESSAGE_BUS_DRIVER` | `nats` | ✅ | Message bus type (nats/pubsub) |
| `NATS_URL` | `nats://nats:4222` | ⚠️ | NATS server URL (if MESSAGE_BUS_DRIVER=nats) |
| `BUS_PREFIX` | ` ` (empty) | ❌ | Topic prefix for multi-tenancy |
| `NODE_ENV` | `development` | ✅ | Node.js environment (development/production) |
| `PORT` | `3000` | ✅ | HTTP server port |
| `PERSISTENCE_DRIVER` | `postgres` | ✅ | Persistence backend (postgres/firestore) |
| `DATABASE_URL` | (constructed) | ⚠️ | PostgreSQL connection string |

### Infrastructure Variables

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `REDIS_URL` | `redis://redis:6379` | ⚠️ | Redis connection URL |
| `REDIS_IDEMPOTENCY_ENABLED` | `true` | ❌ | Enable idempotency middleware (Sprint 1+) |
| `REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS` | `300` | ❌ | Idempotency key TTL (5 minutes) |
| `POSTGRES_HOST` | `localhost` | ⚠️ | PostgreSQL host |
| `POSTGRES_PORT` | `5432` | ⚠️ | PostgreSQL port |
| `POSTGRES_USER` | `bitbrat` | ⚠️ | PostgreSQL username |
| `POSTGRES_PASSWORD` | (required) | ✅ | PostgreSQL password |
| `POSTGRES_DB` | `bitbrat` | ⚠️ | PostgreSQL database name |

### Auto-Injected Variables (Cloud Run)

| Variable | Source | Description |
|----------|--------|-------------|
| `K_REVISION` | Cloud Run | Revision name (e.g., `llm-bot-00001-abc`) |
| `K_SERVICE` | Cloud Run | Service name (e.g., `llm-bot`) |
| `K_CONFIGURATION` | Cloud Run | Configuration name |
| `PORT` | Cloud Run | HTTP port (overrides default) |

---

## Common Variables

### LOG_LEVEL

**Description**: Controls logging verbosity for all services.

**Values**:
- `error`: Only errors (production)
- `warn`: Warnings and errors
- `info`: Informational messages, warnings, and errors (default)
- `debug`: Detailed debugging information
- `trace`: Extremely verbose tracing (all internal operations)

**Default**: `info`

**Required**: ✅ Yes

**Example**:
```bash
# Local development - verbose logging
LOG_LEVEL=debug

# Staging - moderate logging
LOG_LEVEL=info

# Production - minimal logging
LOG_LEVEL=warn
```

**Performance Impact**: `trace` and `debug` modes significantly increase I/O and may impact performance.

**Precedence**: Can be overridden per-service via `env/{context}/{service}.yaml`

---

### MESSAGE_BUS_DRIVER

**Description**: Selects the message bus implementation for service-to-service communication.

**Values**:
- `nats`: NATS JetStream (default, local/self-hosted)
- `pubsub`: Google Cloud Pub/Sub (production GCP)

**Default**: `nats`

**Required**: ✅ Yes

**Context Usage**:
| Context | Value | Rationale |
|---------|-------|-----------|
| `local` | `nats` | Docker Compose local stack |
| `staging` | `nats` | Self-hosted on bitbrat.lan |
| `prod` | `pubsub` | GCP Cloud Run with Pub/Sub |

**Example**:
```bash
# Local/Staging (NATS)
MESSAGE_BUS_DRIVER=nats
NATS_URL=nats://nats:4222

# Production (Pub/Sub)
MESSAGE_BUS_DRIVER=pubsub
# No NATS_URL needed (Pub/Sub uses GCP client libraries)
```

**Related Variables**:
- `NATS_URL` (required if `MESSAGE_BUS_DRIVER=nats`)
- `PUBSUB_MAX_ACK_EXTENSION_SECONDS` (Pub/Sub configuration)
- `PUBSUB_ACK_DEADLINE_SECONDS` (Pub/Sub configuration)

---

### NATS_URL

**Description**: Connection URL for NATS JetStream server.

**Format**: `nats://<host>:<port>`

**Default**: `nats://nats:4222`

**Required**: ⚠️ Yes (if `MESSAGE_BUS_DRIVER=nats`)

**Examples**:
```bash
# Local Docker Compose
NATS_URL=nats://nats:4222

# Remote NATS server
NATS_URL=nats://nats.bitbrat.lan:4222

# NATS with authentication
NATS_URL=nats://user:pass@nats.bitbrat.lan:4222

# NATS cluster (multiple servers)
NATS_URL=nats://nats1:4222,nats://nats2:4222
```

**Security**:
- Use TLS in production: `nats://nats:4222?tls=true`
- Use authentication tokens: `nats://token@nats:4222`

**Health Check**: Services will fail startup if NATS is unreachable.

---

### BUS_PREFIX

**Description**: Prefix for all topic names, enabling multi-tenancy or environment isolation.

**Format**: String (alphanumeric + hyphens)

**Default**: ` ` (empty string, no prefix)

**Required**: ❌ No

**Use Cases**:
1. **Multi-Tenancy**: Isolate topics per customer
   ```bash
   BUS_PREFIX=customer-123-
   # Topics: customer-123-internal.ingress.v1
   ```

2. **Environment Isolation**: Separate staging/prod on shared bus
   ```bash
   BUS_PREFIX=staging-
   # Topics: staging-internal.ingress.v1
   ```

3. **Testing**: Isolate test runs
   ```bash
   BUS_PREFIX=test-${CI_JOB_ID}-
   # Topics: test-42-internal.ingress.v1
   ```

**Example**:
```bash
# No prefix (default)
BUS_PREFIX=
# Topic: internal.ingress.v1

# With prefix
BUS_PREFIX=staging-
# Topic: staging-internal.ingress.v1
```

**Warning**: Changing `BUS_PREFIX` breaks message routing. All services must use the same prefix.

---

### NODE_ENV

**Description**: Node.js environment mode, affects library behavior and optimizations.

**Values**:
- `development`: Development mode (verbose errors, no caching)
- `production`: Production mode (optimized, minimal errors)
- `test`: Test mode (used in CI/CD)

**Default**: `development`

**Required**: ✅ Yes

**Impact**:
- **Development**: Hot reload, detailed stack traces, no caching
- **Production**: Optimized builds, minified errors, caching enabled
- **Test**: Minimal logging, mock external services

**Example**:
```bash
# Local development
NODE_ENV=development

# Production
NODE_ENV=production
```

**Related**: Often paired with `LOG_LEVEL` (e.g., `NODE_ENV=production` + `LOG_LEVEL=warn`)

---

### PORT

**Description**: HTTP server port for the service.

**Default**: `3000`

**Required**: ✅ Yes (auto-injected by Cloud Run, default otherwise)

**Per-Service Overrides**:
Services can specify custom ports in `architecture.yaml`:
```yaml
services:
  stream-analyst-service:
    port: 3010  # Override default 3000
```

**Example**:
```bash
# Default
PORT=3000

# Custom per service
PORT=3010

# Cloud Run (auto-injected)
# PORT=8080 (set by Cloud Run)
```

**Conflict Resolution**: Use `PortManager` for automatic port assignment in local deployments.

---

### PERSISTENCE_DRIVER

**Description**: Selects the persistence backend for event storage and application state.

**Values**:
- `postgres`: PostgreSQL (default, platform-agnostic)
- `firestore`: Google Cloud Firestore (legacy, deprecated)

**Default**: `postgres`

**Required**: ✅ Yes

**Migration**: Firestore is deprecated as of Sprint 344. Migrate to PostgreSQL.

**Example**:
```bash
# Modern (PostgreSQL)
PERSISTENCE_DRIVER=postgres
DATABASE_URL=postgresql://bitbrat:password@localhost:5432/bitbrat

# Legacy (Firestore, deprecated)
PERSISTENCE_DRIVER=firestore
# (Uses GOOGLE_APPLICATION_CREDENTIALS for authentication)
```

**Related Variables**:
- `DATABASE_URL` (PostgreSQL)
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `GOOGLE_APPLICATION_CREDENTIALS` (Firestore)

---

### DATABASE_URL

**Description**: PostgreSQL connection string (libpq format).

**Format**: `postgresql://[user[:password]@][host][:port][/dbname][?param=value]`

**Default**: Constructed from individual variables if not provided

**Required**: ⚠️ Yes (if `PERSISTENCE_DRIVER=postgres`)

**Examples**:
```bash
# Local development
DATABASE_URL=postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat

# Production (SSL required)
DATABASE_URL=postgresql://bitbrat:$POSTGRES_PASSWORD@db.example.com:5432/bitbrat?sslmode=require

# Connection pooling
DATABASE_URL=postgresql://bitbrat:pass@localhost:5432/bitbrat?pool_min=10&pool_max=100
```

**Security**:
- Store password in `.secure.{env}/.env` or Secret Manager
- Use SSL in production (`sslmode=require`)
- Rotate credentials regularly

**Construction** (if `DATABASE_URL` not provided):
```javascript
DATABASE_URL = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`
```

---

## Infrastructure Variables

### Redis (Idempotency Layer - Sprint 1+)

#### REDIS_URL

**Description**: Redis connection URL for idempotency tracking and caching.

**Format**: `redis://[user[:password]@]host[:port][/db]`

**Default**: `redis://redis:6379`

**Required**: ⚠️ Yes (if Redis idempotency enabled)

**Examples**:
```bash
# Local Docker Compose
REDIS_URL=redis://redis:6379

# Remote Redis with authentication
REDIS_URL=redis://:mypassword@redis.bitbrat.lan:6379

# Redis with database selection
REDIS_URL=redis://redis:6379/0

# Redis Sentinel (high availability)
REDIS_URL=redis-sentinel://sentinel1:26379,sentinel2:26379/mymaster
```

**Security**:
- Use authentication in production
- Use TLS for remote connections: `rediss://` (note the 's')

---

#### REDIS_IDEMPOTENCY_ENABLED

**Description**: Enable/disable the idempotency middleware for duplicate message detection.

**Values**: `true` | `false`

**Default**: `true`

**Required**: ❌ No

**Purpose**: Prevents duplicate message processing during platform re-deployments (Sprint 1).

**Example**:
```bash
# Enable idempotency (default)
REDIS_IDEMPOTENCY_ENABLED=true

# Disable idempotency (testing only)
REDIS_IDEMPOTENCY_ENABLED=false
```

**Impact**:
- **Enabled**: All messages checked against Redis before processing (adds ~5-10ms latency)
- **Disabled**: Messages may be processed multiple times (not recommended)

**Services Using Idempotency**:
- `ingress-egress` (egress handlers, 60s TTL)
- `auth` (auth enrichment, 300s TTL)
- `llm-bot` (LLM processing, 300s TTL)

---

#### REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS

**Description**: Time-to-live for idempotency keys in Redis (in seconds).

**Default**: `300` (5 minutes)

**Required**: ❌ No

**Example**:
```bash
# Default (5 minutes)
REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS=300

# Longer TTL for critical operations (1 hour)
REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS=3600

# Shorter TTL for high-throughput (1 minute)
REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS=60
```

**Tuning**:
- **Too short**: Messages may be processed twice if delayed
- **Too long**: Higher memory usage in Redis
- **Recommended**: 300s (5 minutes) for most use cases

**Per-Service Overrides**: Services can override TTL via message metadata.

---

### PostgreSQL

#### POSTGRES_HOST

**Description**: PostgreSQL server hostname or IP address.

**Default**: `localhost`

**Required**: ⚠️ Yes (if `PERSISTENCE_DRIVER=postgres` and `DATABASE_URL` not provided)

**Examples**:
```bash
# Local development
POSTGRES_HOST=localhost

# Docker Compose
POSTGRES_HOST=postgres

# Remote server
POSTGRES_HOST=db.bitbrat.lan

# Cloud SQL (GCP)
POSTGRES_HOST=/cloudsql/project:region:instance  # Unix socket
```

---

#### POSTGRES_PORT

**Description**: PostgreSQL server port.

**Default**: `5432`

**Required**: ⚠️ Yes (if `PERSISTENCE_DRIVER=postgres` and `DATABASE_URL` not provided)

**Example**:
```bash
# Default PostgreSQL port
POSTGRES_PORT=5432

# Custom port
POSTGRES_PORT=5433
```

---

#### POSTGRES_USER

**Description**: PostgreSQL username for authentication.

**Default**: `bitbrat`

**Required**: ⚠️ Yes (if `PERSISTENCE_DRIVER=postgres` and `DATABASE_URL` not provided)

**Security**: Use dedicated user with minimal privileges (not `postgres` superuser).

---

#### POSTGRES_PASSWORD

**Description**: PostgreSQL password for authentication.

**Default**: (none)

**Required**: ✅ Yes (if `PERSISTENCE_DRIVER=postgres`)

**Security**:
- Store in `.secure.{env}/.env` or Secret Manager
- Use strong passwords (64+ characters)
- Rotate every 90 days

**Example**:
```bash
# Development (weak password OK)
POSTGRES_PASSWORD=bitbrat_dev_password

# Production (strong password required)
POSTGRES_PASSWORD=$(openssl rand -base64 48)
```

---

#### POSTGRES_DB

**Description**: PostgreSQL database name.

**Default**: `bitbrat`

**Required**: ⚠️ Yes (if `PERSISTENCE_DRIVER=postgres` and `DATABASE_URL` not provided)

**Example**:
```bash
# Default
POSTGRES_DB=bitbrat

# Multi-tenancy
POSTGRES_DB=bitbrat_customer_123

# Environment-specific
POSTGRES_DB=bitbrat_staging
```

---

## Auto-Injected Variables

### Cloud Run Auto-Injection

When deployed to Google Cloud Run, the following variables are automatically injected and CANNOT be overridden:

#### K_REVISION

**Description**: Cloud Run revision name, used as the default per-instance egress `{instanceId}`.

**Source**: Cloud Run

**Format**: `{service}-{revision}-{hash}` (e.g., `llm-bot-00042-abc`)

**Usage**: Used for routing egress messages to specific instances.

**Example**:
```typescript
// In service code
const instanceId = process.env.K_REVISION ||
                   process.env.EGRESS_INSTANCE_ID ||
                   process.env.SERVICE_INSTANCE_ID ||
                   os.hostname();
```

**Related**: See `messaging.conventions.per_instance` in architecture.yaml

---

#### K_SERVICE

**Description**: Cloud Run service name.

**Source**: Cloud Run

**Example**: `llm-bot`, `ingress-egress`, etc.

**Usage**: Logging, monitoring, service discovery.

---

#### K_CONFIGURATION

**Description**: Cloud Run configuration name.

**Source**: Cloud Run

**Usage**: Internal Cloud Run metadata (rarely used by services).

---

#### PORT

**Description**: HTTP port assigned by Cloud Run.

**Source**: Cloud Run

**Default**: `8080` (Cloud Run standard)

**Override**: ❌ Cannot override (Cloud Run requirement)

**Note**: Cloud Run always listens on the assigned `PORT`. Services MUST use `process.env.PORT`.

---

## Service-Specific Variables

### LLM Services (llm-bot, query-analyzer)

#### OPENAI_MODEL

**Description**: OpenAI model to use for completions.

**Default**: `gpt-4o-mini`

**Values**: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`

**Example**:
```bash
# Fast, cheap model (default)
OPENAI_MODEL=gpt-4o-mini

# More capable model
OPENAI_MODEL=gpt-4o
```

---

#### OPENAI_TIMEOUT_MS

**Description**: Timeout for OpenAI API calls (milliseconds).

**Default**: `30000` (30 seconds)

**Example**:
```bash
# Faster timeout
OPENAI_TIMEOUT_MS=15000

# Longer timeout for complex prompts
OPENAI_TIMEOUT_MS=60000
```

---

#### OPENAI_MAX_RETRIES

**Description**: Maximum retry attempts for failed OpenAI API calls.

**Default**: `3`

**Example**:
```bash
# More retries (higher reliability, higher cost)
OPENAI_MAX_RETRIES=5

# Fewer retries (fail fast)
OPENAI_MAX_RETRIES=1
```

---

### Ingress-Egress Service

#### DISCORD_ENABLED

**Description**: Enable/disable Discord connector.

**Values**: `true` | `false`

**Default**: `false`

**Required**: ❌ No

---

#### TWILIO_ENABLED

**Description**: Enable/disable Twilio connector.

**Values**: `true` | `false`

**Default**: `false`

**Required**: ❌ No

---

#### DEBUG_USERS_SLACK

**Description**: Comma-separated list of Slack user IDs for debug mode.

**Format**: `U0123456789,U9876543210`

**Required**: ❌ No

**Purpose**: Enable verbose logging for specific users.

---

## Environment Configuration Files

### Structure

```
env/
├── local/
│   ├── global.yaml           # All services (local context)
│   ├── infra.yaml            # Infrastructure config (NATS, Redis, Postgres)
│   ├── llm-bot.yaml          # llm-bot service overrides
│   └── ingress-egress.yaml   # ingress-egress overrides
├── staging/
│   ├── global.yaml
│   ├── infra.yaml
│   └── {service}.yaml
└── prod/
    ├── global.yaml
    ├── infra.yaml
    └── {service}.yaml
```

### global.yaml Example

```yaml
# env/local/global.yaml
LOG_LEVEL: debug
MESSAGE_BUS_DRIVER: nats
NATS_URL: nats://nats:4222
BUS_PREFIX: ""
NODE_ENV: development
PERSISTENCE_DRIVER: postgres
DATABASE_URL: postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat

# Redis configuration (Sprint 1+)
REDIS_URL: redis://redis:6379
REDIS_IDEMPOTENCY_ENABLED: "true"
REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS: "300"
```

### infra.yaml Example

```yaml
# env/local/infra.yaml
# Infrastructure-specific configuration
POSTGRES_HOST: localhost
POSTGRES_PORT: "5432"
POSTGRES_USER: bitbrat
POSTGRES_DB: bitbrat
# POSTGRES_PASSWORD loaded from .secure.local/.env

NATS_JETSTREAM_MAX_MEM: "-1"
NATS_JETSTREAM_MAX_FILE: 10Gi

REDIS_MAXMEMORY: 256mb
REDIS_APPENDONLY: "yes"
```

### Service Override Example

```yaml
# env/local/llm-bot.yaml
# llm-bot service-specific overrides
LOG_LEVEL: debug  # Override global LOG_LEVEL for this service
OPENAI_MODEL: gpt-4o-mini
OPENAI_TIMEOUT_MS: "30000"
OPENAI_MAX_RETRIES: "3"
LLM_BOT_MEMORY_MAX_MESSAGES: "50"
LLM_BOT_MEMORY_MAX_CHARS: "10000"
```

---

## Validation

### Startup Validation

Services validate required environment variables on startup:

```typescript
// Example validation in Bit class
constructor() {
  const required = ['LOG_LEVEL', 'MESSAGE_BUS_DRIVER', 'PORT'];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}
```

### Configuration Inspection

```bash
# Show all resolved configuration
npm run brat -- config show

# Show specific service configuration
npm run brat -- config show --filter services.llm-bot

# Show environment variables only
npm run brat -- config show --filter env
```

---

## Troubleshooting

### Variable Not Found

**Symptoms**: Service fails to start with `Missing required environment variable: X`

**Diagnosis**:
```bash
# Check if variable is defined
echo $VARIABLE_NAME

# Check environment file
cat env/local/global.yaml | grep VARIABLE_NAME

# Check secure env
cat .secure.local/.env | grep VARIABLE_NAME
```

**Solutions**:
1. Add variable to appropriate config file (`env/{context}/global.yaml`)
2. For secrets, add to `.secure.{context}/.env`
3. For service-specific vars, add to `env/{context}/{service}.yaml`

---

### Wrong Variable Value

**Symptoms**: Service behaves unexpectedly, wrong database/message bus, etc.

**Diagnosis**:
```bash
# Show resolved configuration
npm run brat -- config show --context local

# Check precedence
# 1. Environment variable
echo $LOG_LEVEL

# 2. Secure env
cat .secure.local/.env | grep LOG_LEVEL

# 3. Global yaml
cat env/local/global.yaml | grep LOG_LEVEL
```

**Solutions**:
1. Check precedence order (env var > .env > yaml > defaults)
2. Unset environment variable if override is unintended: `unset LOG_LEVEL`
3. Update correct configuration file

---

### Cloud Run Port Mismatch

**Symptoms**: Cloud Run service fails health checks, shows "Bad Gateway"

**Cause**: Service not listening on `process.env.PORT`

**Solution**:
```typescript
// Correct (uses PORT from environment)
const port = process.env.PORT || 3000;
server.listen(port);

// Incorrect (hardcoded port)
server.listen(3000);  // ❌ Will fail on Cloud Run
```

---

## Best Practices

### DO

✅ Use `env/{context}/global.yaml` for common variables
✅ Use `env/{context}/{service}.yaml` for service-specific overrides
✅ Use `.secure.{context}/.env` for secrets only
✅ Document all custom variables in this file
✅ Validate required variables on service startup
✅ Use strong typing for boolean/number variables
✅ Provide sensible defaults where possible

### DON'T

❌ Hardcode configuration values in code
❌ Commit `.secure.*/` to git (git-ignored)
❌ Mix secrets with non-secret variables
❌ Override `PORT` on Cloud Run (auto-injected)
❌ Use environment variables for large data (use config files)
❌ Store binary data in environment variables
❌ Assume environment variables are always set (validate!)

---

## See Also

- [Secrets Catalog](./secrets-catalog.md) — Complete secrets reference
- [Execution Contexts Guide](../guides/execution-contexts.md) — Context-specific configuration
- [Architecture YAML](../../architecture.yaml) — Platform configuration
- [Environment Scaffolding](../guides/execution-contexts.md#environment-scaffolding) — Auto-generated env files

---

**Document Status**: ✅ Current
**Sprint**: 8 (sprint-8-uhh8fj)
**Last Reviewed**: 2026-08-10
