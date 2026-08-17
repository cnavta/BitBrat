# Sprint 343: PostgreSQL Migration - Execution Plan

**Sprint Goal**: Replace Firestore with PostgreSQL for Docker-first deployment portability

**Timeline**: 3-4 weeks (Foundation: 1 week, Migration: 2 weeks, Cleanup: 3-5 days)

**Approach**: Docker-first → Migrate → Deploy → GCP (optional future)

**Status**: Planning → Ready for Execution

---

## Strategic Approach: Simplified Docker-First Migration

### Why This Approach?

1. **No Sensitive Production Data Yet** - We can do a simple switch instead of gradual rollout
2. **Docker is Primary Target** - Local and remote Docker (bitbrat.lan) are the deployment environments
3. **GCP Can Wait** - Cloud SQL is optional future work when production GCP deployment is needed
4. **Faster Delivery** - 3-4 weeks instead of 6 weeks by removing unnecessary complexity

### Key Simplifications

- **NO Dual-Write Pattern** - Simple factory: if `PERSISTENCE_DRIVER=postgres` use PostgreSQL, else Firestore
- **NO Gradual Rollout** - Migrate data, flip switch, done
- **NO GCP Infrastructure** - Docker PostgreSQL for now, Cloud SQL deferred to Phase 3 (optional)

---

## Phase 0: Foundation (Week 1) - Docker-First PostgreSQL

**Goal**: Get local and remote Docker working with PostgreSQL and migration tooling

**Duration**: 1 week (60 hours)

**Decision Point**: If foundation works → proceed to full migration. If issues → iterate.

### Deliverables

1. **Persistence Abstractions** - Vendor-neutral interfaces
2. **PostgreSQL Implementation** - node-postgres (pg) with connection pooling
3. **Docker Compose PostgreSQL** - Local and remote environments
4. **Migration Tooling** - CLI commands for migrate, backup, restore, validate
5. **Validated Locally** - 10k events migrated and tested

### Key Tasks

#### 1. Persistence Abstractions (FND-001 to FND-005)

**File**: `src/common/persistence/interfaces.ts`

```typescript
/**
 * Vendor-neutral document store interface.
 * Simple, no complex dual-write patterns.
 */
export interface IDocumentStore {
  // Core CRUD
  get<T>(collection: string, id: string): Promise<T | null>;
  set<T>(collection: string, id: string, data: T, options?: SetOptions): Promise<void>;
  update<T>(collection: string, id: string, updates: Partial<T>): Promise<void>;
  delete(collection: string, id: string): Promise<void>;

  // Queries
  query<T>(collection: string, query: QueryOptions): Promise<T[]>;
  queryOne<T>(collection: string, query: QueryOptions): Promise<T | null>;

  // Transactions
  transaction<R>(fn: (tx: ITransaction) => Promise<R>): Promise<R>;

  // Watch (polling-based for PostgreSQL, 5s default)
  watch<T>(collection: string, callback: (docs: T[]) => void, pollInterval?: number): () => void;
}

export interface IKVStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  mget(keys: string[]): Promise<(string | null)[]>;
  exists(key: string): Promise<boolean>;
}

export interface QueryOptions {
  where?: Array<{ field: string; op: '==' | '!=' | '>' | '<' | '>=' | '<='; value: any }>;
  orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  limit?: number;
  offset?: number;
}

export interface SetOptions {
  merge?: boolean;
  mergeFields?: string[];
}
```

**Simple Factory** (FND-005):

```typescript
// src/common/persistence/factory.ts
export function createDocumentStore(): IDocumentStore {
  const driver = process.env.PERSISTENCE_DRIVER || 'firestore';

  if (driver === 'postgres') {
    return new PostgresDocumentStore({
      connectionString: process.env.DATABASE_URL,
      poolSize: 10
    });
  }

  // Fallback to Firestore (legacy)
  return getFirestore(); // Existing Firestore instance
}
```

#### 2. PostgreSQL Implementation (FND-004)

**File**: `src/common/persistence/postgres-store.ts`

```typescript
import { Pool } from 'pg';

export class PostgresDocumentStore implements IDocumentStore {
  private pool: Pool;

  constructor(config: { connectionString: string; poolSize: number }) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      max: config.poolSize,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const result = await this.pool.query(
      `SELECT data FROM ${collection} WHERE id = $1`,
      [id]
    );
    return result.rows[0]?.data || null;
  }

  async set<T>(collection: string, id: string, data: T, options?: SetOptions): Promise<void> {
    const query = options?.merge
      ? `INSERT INTO ${collection} (id, data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET data = ${collection}.data || $2, updated_at = NOW()`
      : `INSERT INTO ${collection} (id, data, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`;

    await this.pool.query(query, [id, JSON.stringify(data)]);
  }

  async query<T>(collection: string, query: QueryOptions): Promise<T[]> {
    let sql = `SELECT data FROM ${collection}`;
    const params: any[] = [];
    let paramIndex = 1;

    // WHERE clauses
    if (query.where && query.where.length > 0) {
      const conditions = query.where.map(w => {
        params.push(w.value);
        return `data->>'${w.field}' ${w.op} $${paramIndex++}`;
      });
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    // ORDER BY
    if (query.orderBy && query.orderBy.length > 0) {
      const orders = query.orderBy.map(o =>
        `data->>'${o.field}' ${o.direction.toUpperCase()}`
      );
      sql += ` ORDER BY ${orders.join(', ')}`;
    }

    // LIMIT and OFFSET
    if (query.limit) {
      sql += ` LIMIT ${query.limit}`;
    }
    if (query.offset) {
      sql += ` OFFSET ${query.offset}`;
    }

    const result = await this.pool.query(sql, params);
    return result.rows.map(row => row.data);
  }

  async transaction<R>(fn: (tx: ITransaction) => Promise<R>): Promise<R> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx = new PostgresTransaction(client);
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  watch<T>(collection: string, callback: (docs: T[]) => void, pollInterval = 5000): () => void {
    let stopped = false;

    const poll = async () => {
      if (stopped) return;

      try {
        const docs = await this.query<T>(collection, {});
        callback(docs);
      } catch (error) {
        console.error(`[PostgresDocumentStore] watch error:`, error);
      }

      if (!stopped) {
        setTimeout(poll, pollInterval);
      }
    };

    poll(); // Start immediately

    return () => { stopped = true; };
  }
}
```

#### 3. PostgreSQL Schema for Events (FND-003)

**File**: `infrastructure/postgres/schema/001_events.sql`

```sql
-- Event aggregates (parent table)
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  platform TEXT,
  message JSONB,
  routing JSONB,
  annotations JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  expire_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_events_correlation_id ON events(correlation_id);
CREATE INDEX idx_events_idempotency_key ON events(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_expire_at ON events(expire_at) WHERE expire_at IS NOT NULL;
CREATE INDEX idx_events_created_at ON events(created_at DESC);

-- Event snapshots (subcollection pattern)
CREATE TABLE event_snapshots (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  event JSONB NOT NULL,
  reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_snapshots_event_id ON event_snapshots(event_id);
CREATE INDEX idx_snapshots_created_at ON event_snapshots(created_at DESC);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_updated_at BEFORE UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- TTL cleanup function
CREATE OR REPLACE FUNCTION cleanup_expired_events()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM events WHERE expire_at IS NOT NULL AND expire_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Run cleanup via cron or scheduled task:
-- SELECT cleanup_expired_events();
```

#### 4. Docker Compose PostgreSQL (FND-007)

**File**: `infrastructure/docker-compose/docker-compose.local.yaml`

```yaml
services:
  postgres:
    image: postgres:15-alpine
    container_name: bitbrat-postgres-local
    environment:
      POSTGRES_DB: bitbrat
      POSTGRES_USER: bitbrat
      POSTGRES_PASSWORD: bitbrat_local_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ../../infrastructure/postgres/schema:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bitbrat"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - bitbrat

volumes:
  postgres-data:

networks:
  bitbrat:
    driver: bridge
```

#### 5. Migration Tooling (FND-008 to FND-011)

**File**: `tools/brat/src/commands/migrate.ts`

```typescript
import { Command } from 'commander';
import { getFirestore } from '../../../src/common/firebase';
import { PostgresDocumentStore } from '../../../src/common/persistence/postgres-store';
import cliProgress from 'cli-progress';

export function registerMigrateCommand(program: Command) {
  const migrate = program
    .command('migrate')
    .description('Migrate data from Firestore to PostgreSQL');

  migrate
    .command('collection <name>')
    .option('--from <source>', 'Source database', 'firestore')
    .option('--to <target>', 'Target database', 'postgres')
    .option('--dry-run', 'Simulate migration without writing')
    .option('--batch-size <size>', 'Batch size', '1000')
    .action(async (name, options) => {
      console.log(`[brat migrate] Migrating collection: ${name}`);
      console.log(`[brat migrate] Source: ${options.from}, Target: ${options.to}`);

      if (options.dryRun) {
        console.log('[brat migrate] DRY RUN - no data will be written');
      }

      const firestore = getFirestore();
      const postgres = new PostgresDocumentStore({
        connectionString: process.env.DATABASE_URL!,
        poolSize: 10
      });

      // Get total count
      const snapshot = await firestore.collection(name).get();
      const total = snapshot.size;
      console.log(`[brat migrate] Total documents: ${total}`);

      // Progress bar
      const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
      bar.start(total, 0);

      let migrated = 0;
      let errors = 0;
      const batchSize = parseInt(options.batchSize);

      // Migrate in batches
      for (let i = 0; i < snapshot.docs.length; i += batchSize) {
        const batch = snapshot.docs.slice(i, i + batchSize);

        for (const doc of batch) {
          try {
            const data = doc.data();

            if (!options.dryRun) {
              await postgres.set(name, doc.id, data);
            }

            migrated++;
            bar.update(migrated);
          } catch (error) {
            errors++;
            console.error(`[brat migrate] Error migrating ${doc.id}:`, error);
          }
        }
      }

      bar.stop();
      console.log(`[brat migrate] Complete: ${migrated} migrated, ${errors} errors`);
    });

  migrate
    .command('all')
    .option('--from <source>', 'Source database', 'firestore')
    .option('--to <target>', 'Target database', 'postgres')
    .option('--dry-run', 'Simulate migration without writing')
    .action(async (options) => {
      const collections = [
        'events',
        'commands',        // routing rules
        'mcp_servers',
        'users',
        'context_packs',
        'router_state',
        'state',
        'tool_usage',
        'prompt_logs',
        'mutation_log',
        'oauth_tokens'
      ];

      console.log(`[brat migrate all] Migrating ${collections.length} collections`);

      for (const collection of collections) {
        console.log(`\n[brat migrate all] Starting: ${collection}`);
        // Call migrate collection command programmatically
        // (implementation details...)
      }

      console.log('\n[brat migrate all] All collections migrated!');
    });
}
```

**File**: `tools/brat/src/commands/db-validate.ts`

```typescript
export function registerDbValidateCommand(program: Command) {
  program
    .command('db:validate')
    .option('--collection <name>', 'Collection to validate')
    .option('--all', 'Validate all collections')
    .action(async (options) => {
      const firestore = getFirestore();
      const postgres = new PostgresDocumentStore({
        connectionString: process.env.DATABASE_URL!,
        poolSize: 10
      });

      const collections = options.all
        ? ['events', 'commands', 'mcp_servers', 'users', 'context_packs', ...]
        : [options.collection];

      let allValid = true;

      for (const collection of collections) {
        console.log(`\n[db:validate] Validating: ${collection}`);

        // Compare counts
        const firestoreSnapshot = await firestore.collection(collection).get();
        const postgresRows = await postgres.query(collection, {});

        const firestoreCount = firestoreSnapshot.size;
        const postgresCount = postgresRows.length;

        console.log(`  Firestore: ${firestoreCount} documents`);
        console.log(`  PostgreSQL: ${postgresCount} documents`);

        if (firestoreCount !== postgresCount) {
          console.error(`  ❌ COUNT MISMATCH`);
          allValid = false;
        } else {
          console.log(`  ✅ Counts match`);
        }

        // Sample checksum validation (10% of records)
        const sampleSize = Math.ceil(firestoreCount * 0.1);
        console.log(`  Validating ${sampleSize} sample records...`);

        let checksumMatches = 0;
        for (let i = 0; i < sampleSize; i++) {
          const randomDoc = firestoreSnapshot.docs[
            Math.floor(Math.random() * firestoreSnapshot.docs.length)
          ];

          const firestoreData = randomDoc.data();
          const postgresData = await postgres.get(collection, randomDoc.id);

          const firestoreChecksum = checksum(JSON.stringify(firestoreData));
          const postgresChecksum = checksum(JSON.stringify(postgresData));

          if (firestoreChecksum === postgresChecksum) {
            checksumMatches++;
          }
        }

        console.log(`  Checksums: ${checksumMatches}/${sampleSize} match`);

        if (checksumMatches === sampleSize) {
          console.log(`  ✅ Data integrity validated`);
        } else {
          console.error(`  ❌ DATA INTEGRITY ISSUES`);
          allValid = false;
        }
      }

      if (allValid) {
        console.log('\n✅ All validations passed');
        process.exit(0);
      } else {
        console.error('\n❌ Validation failed');
        process.exit(1);
      }
    });
}
```

#### 6. Refactor PersistenceStore (FND-012)

**File**: `src/services/persistence/store.ts`

```typescript
import { IDocumentStore } from '../common/persistence/interfaces';
import { createDocumentStore } from '../common/persistence/factory';

export class PersistenceStore {
  private store: IDocumentStore;

  constructor(store?: IDocumentStore) {
    // Allow injection for testing, otherwise use factory
    this.store = store || createDocumentStore();
  }

  async upsertIngressEvent(event: InternalEventV2): Promise<void> {
    await this.store.transaction(async (tx) => {
      // Insert/update event
      await tx.set('events', event.correlationId, {
        id: event.correlationId,
        correlation_id: event.correlationId,
        idempotency_key: event.idempotencyKey,
        status: event.status,
        platform: event.platform,
        message: event.message,
        routing: event.routing,
        annotations: event.annotations,
        metadata: event.metadata,
        expire_at: event.expireAt,
      });

      // Create snapshot
      await tx.set('event_snapshots', `${event.correlationId}_${Date.now()}`, {
        event_id: event.correlationId,
        event: event,
        reason: 'ingress',
      });
    });
  }

  async getEvent(correlationId: string): Promise<InternalEventV2 | null> {
    return await this.store.get<InternalEventV2>('events', correlationId);
  }

  async queryEvents(options: QueryOptions): Promise<InternalEventV2[]> {
    return await this.store.query<InternalEventV2>('events', options);
  }
}
```

#### 7. Testing & Validation (FND-013 to FND-016)

**Test with 10k events** (FND-014):

```bash
# Create test dataset in Firestore
npm run brat -- test-data create --count 10000

# Migrate to PostgreSQL
npm run brat -- migrate collection events --dry-run
npm run brat -- migrate collection events

# Validate
npm run brat -- db:validate --collection events
# Should see: ✅ 10000/10000 migrated, 0 errors

# Performance benchmark
npm run brat -- benchmark persistence
# Should see: PostgreSQL within 20% of Firestore baseline
```

---

## Phase 1: Full Migration (Weeks 2-3) - All Collections

**Goal**: Migrate all 13 Firestore collections, refactor all services, deploy to remote Docker

**Duration**: 2 weeks (105 hours)

**Decision Point**: All services on PostgreSQL in staging → proceed to cleanup

### Deliverables

1. **13 PostgreSQL Schemas** - All Firestore collections mapped
2. **All Services Refactored** - Use IDocumentStore instead of Firestore
3. **All Data Migrated** - Zero data loss validated
4. **Remote Docker Deployed** - bitbrat.lan running PostgreSQL
5. **Integration Tests Passing** - End-to-end validation

### Collections to Migrate

1. ✅ **events** (already done in Phase 0)
2. **commands** (routing rules) - JSONB for logic/enrichments
3. **mcp_servers** - JSONB for env vars
4. **users** - TEXT[] for roles/tags, JSONB for metadata
5. **context_packs** - vector(1536) for embeddings (pgvector)
6. **router_state** - Pending actions with TTL
7. **state** - State engine storage
8. **tool_usage** - Observability tracking
9. **prompt_logs** - Observability tracking
10. **mutation_log** - Observability tracking
11. **oauth_tokens** - Encrypted token storage

### Schema Examples

**Routing Rules** (MIG-001):

```sql
CREATE TABLE commands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  logic JSONB NOT NULL,           -- JsonLogic rules
  enrichments JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_commands_enabled_priority ON commands(enabled, priority DESC);
```

**Context Packs with pgvector** (MIG-016):

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE context_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  embedding vector(1536),        -- OpenAI embeddings
  content JSONB NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Vector similarity index (cosine distance)
CREATE INDEX idx_context_packs_embedding ON context_packs
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Similarity search query example:
-- SELECT id, name, 1 - (embedding <=> $1) AS similarity
-- FROM context_packs
-- ORDER BY embedding <=> $1
-- LIMIT 10;
```

**Users** (MIG-010):

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  roles TEXT[] DEFAULT ARRAY[]::TEXT[],
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
```

### Service Refactoring Pattern

**RuleLoader Example** (MIG-002, MIG-003):

```typescript
// BEFORE (Firestore direct)
export class RuleLoader {
  private unsubscribe?: () => void;

  start() {
    this.unsubscribe = getFirestore()
      .collection('commands')
      .where('enabled', '==', true)
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          // Handle rule changes
        });
      });
  }
}

// AFTER (IDocumentStore with polling)
export class RuleLoader {
  private store: IDocumentStore;
  private unsubscribe?: () => void;

  constructor(store?: IDocumentStore) {
    this.store = store || createDocumentStore();
  }

  start() {
    // Watch with 5s polling (configurable via RULE_POLL_INTERVAL)
    const pollInterval = parseInt(process.env.RULE_POLL_INTERVAL || '5000');

    this.unsubscribe = this.store.watch<RoutingRule>(
      'commands',
      (rules) => {
        // Filter enabled rules, sort by priority
        const enabled = rules
          .filter(r => r.enabled)
          .sort((a, b) => b.priority - a.priority);

        // Update cache
        this.updateRuleCache(enabled);
      },
      pollInterval
    );
  }

  stop() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}
```

### Migration Execution

**Step 1: Create all schemas** (MIG-001, MIG-006, MIG-010, MIG-016, MIG-020, MIG-023, MIG-026, MIG-029)

```bash
# Apply all schema files
psql $DATABASE_URL -f infrastructure/postgres/schema/001_events.sql
psql $DATABASE_URL -f infrastructure/postgres/schema/002_routing_rules.sql
psql $DATABASE_URL -f infrastructure/postgres/schema/003_mcp_servers.sql
psql $DATABASE_URL -f infrastructure/postgres/schema/004_users.sql
psql $DATABASE_URL -f infrastructure/postgres/schema/005_context_packs.sql
psql $DATABASE_URL -f infrastructure/postgres/schema/006_router_state.sql
psql $DATABASE_URL -f infrastructure/postgres/schema/007_state.sql
psql $DATABASE_URL -f infrastructure/postgres/schema/008_observability.sql
psql $DATABASE_URL -f infrastructure/postgres/schema/009_oauth_tokens.sql
```

**Step 2: Refactor all services** (MIG-002, MIG-007, MIG-013, MIG-017, MIG-021, MIG-024, MIG-027, MIG-030)

- RuleLoader → IDocumentStore (MIG-002, MIG-003)
- RegistryWatcher → IDocumentStore (MIG-007)
- Auth service → UserRepository (MIG-013)
- ContextPackManager → IDocumentStore (MIG-017)
- RouterStateManager → IDocumentStore (MIG-021)
- StateEngine → IDocumentStore (MIG-024)
- Observability services → IDocumentStore (MIG-027)
- OAuth service → IDocumentStore (MIG-030)

**Step 3: Migrate all data** (MIG-005, MIG-009, MIG-015, MIG-019, MIG-022, MIG-025, MIG-028, MIG-031)

```bash
# Migrate all collections
npm run brat -- migrate all --from firestore --to postgres

# Validate all data
npm run brat -- db:validate --all
# Should see: ✅ All validations passed
```

**Step 4: Deploy to remote Docker** (MIG-033, MIG-034, MIG-035)

```bash
# Deploy PostgreSQL to bitbrat.lan
npm run brat -- docker up --target staging --service postgres

# Migrate staging data
npm run brat -- migrate all --target staging

# Set driver to postgres
# Edit env/staging/global.yaml:
# PERSISTENCE_DRIVER: postgres

# Deploy all services
npm run brat -- docker up --target staging

# Verify no Firestore reads
npm run brat -- fleet logs --target staging | grep -i firestore
# Should see: (no results)

# Integration tests
npm run brat -- test:integration --target staging
# Should see: ✅ All tests passed
```

**Step 5: Integration Testing** (MIG-032)

```bash
# Full message flow test
npm run brat -- chat --target staging

# Test scenarios:
# 1. Ingest event → persistence works
# 2. Event triggers routing rule → rule applied
# 3. MCP tool invoked → registry lookup works
# 4. User lookup for auth → user retrieved
# 5. Context pack similarity search works
# 6. Full message flow end-to-end succeeds
```

---

## Phase 2: Cleanup (Week 4) - Remove Firestore

**Goal**: Remove Firestore dependencies from codebase

**Duration**: 3-5 days (15 hours)

**Decision Point**: Zero Firestore operations for 48 hours → safe to remove

### Deliverables

1. **Firestore Removed** - firebase-admin uninstalled
2. **Code Cleaned** - src/common/firebase.ts deleted
3. **Emulator Removed** - docker-compose.local.yaml updated
4. **Docs Updated** - README.md, CLAUDE.md reflect PostgreSQL

### Tasks

**CLN-001: Verify Zero Firestore Reads**

```bash
# Monitor staging for 48 hours
npm run brat -- fleet logs --target staging --since 48h | grep -i firestore
# Should see: (no results)

# Check metrics
# - Firestore read operations: 0
# - Firestore write operations: 0
# - PostgreSQL read operations: > 0
# - PostgreSQL write operations: > 0
```

**CLN-002: Remove firebase-admin**

```bash
npm uninstall firebase-admin @types/firebase-admin
npm install
npm run build
# Should succeed with no import errors
```

**CLN-003: Delete Firestore code**

```bash
rm src/common/firebase.ts
rm src/common/firebase.test.ts
# Search for imports:
grep -r "from.*firebase" src/
# Should see: (no results)
```

**CLN-004: Remove Firestore emulator**

Edit `infrastructure/docker-compose/docker-compose.local.yaml`:

```yaml
# REMOVE:
# firebase-emulator:
#   image: gcr.io/google.com/cloudsdktool/cloud-sdk:emulators
#   command: gcloud emulators firestore start --host-port=0.0.0.0:8080
#   ports:
#     - "8080:8080"
```

**CLN-005: Remove FIRESTORE_* env vars**

```bash
# Edit .env.example
# REMOVE: FIRESTORE_EMULATOR_HOST=localhost:8080

# Edit env/local/global.yaml
# REMOVE: FIRESTORE_EMULATOR_HOST: localhost:8080

# Edit env/staging/global.yaml
# REMOVE: FIRESTORE_EMULATOR_HOST (if present)
```

**CLN-006: Update documentation**

```markdown
# README.md - BEFORE
## Prerequisites
- Node.js 18+
- Docker (for Firestore emulator)
- Google Cloud account (optional)

## Getting Started
1. Start Firestore emulator: `docker-compose up firebase-emulator`
2. Seed data: `npm run brat -- setup`

# README.md - AFTER
## Prerequisites
- Node.js 18+
- Docker (for PostgreSQL)

## Getting Started
1. Start PostgreSQL: `docker-compose up postgres`
2. Apply schemas: `psql $DATABASE_URL -f infrastructure/postgres/schema/*.sql`
3. Seed data: `npm run brat -- setup`
```

**CLN-007: Archive deprecated code**

```bash
mkdir -p deprecated/firestore-migration
mv src/common/firebase.ts deprecated/firestore-migration/
mv infrastructure/docker-compose/firebase-emulator.yaml deprecated/firestore-migration/
git add deprecated/
git commit -m "Archive Firestore code for historical reference"
```

---

## Phase 3: GCP Cloud SQL (Optional Future Work)

**Goal**: Add Cloud SQL support for GCP production deployments

**Duration**: 1 week (~40 hours)

**Status**: DEFERRED - Not needed for initial deployment

**Scope**:
- Terraform modules for Cloud SQL
- Cloud SQL instance provisioning (staging, prod)
- Secret Manager integration (DATABASE_URL)
- VPC peering configuration
- Cloud Run deployment updates (socket mounting)
- Backup/restore for Cloud SQL
- Migration from Docker PostgreSQL to Cloud SQL

**When to Execute**:
- When GCP production deployment is required
- When Cloud SQL high availability is needed
- When automated backups via GCP are desired

**Note**: Docker PostgreSQL works fine for now. This phase can be done anytime in the future.

---

## Rollback Strategy

### Immediate Rollback (<2 minutes)

If issues are discovered after switching to PostgreSQL:

1. **Set driver back to Firestore**:
   ```bash
   # Edit environment config
   export PERSISTENCE_DRIVER=firestore
   ```

2. **Restart services**:
   ```bash
   docker-compose restart
   ```

3. **Verify**:
   ```bash
   # Check logs - should show Firestore connections
   docker-compose logs | grep -i "firestore\|connected"
   ```

**Recovery Time**: < 2 minutes

**Data Impact**: None - Firestore data is untouched (migration is read-only)

### Data Recovery

If PostgreSQL data is corrupted or lost:

1. **Restore from Firestore** (source of truth during migration):
   ```bash
   # Firestore data is never deleted during migration
   export PERSISTENCE_DRIVER=firestore
   docker-compose restart
   ```

2. **Restore from PostgreSQL backup**:
   ```bash
   npm run brat -- restore --env staging --input backup-20260715.json
   ```

3. **Re-migrate from Firestore**:
   ```bash
   # Drop PostgreSQL tables
   psql $DATABASE_URL -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

   # Re-apply schemas
   psql $DATABASE_URL -f infrastructure/postgres/schema/*.sql

   # Re-migrate
   npm run brat -- migrate all
   ```

---

## Success Metrics

### Performance Targets

- **Event throughput**: >= baseline (currently ~1000 events/sec)
- **Query latency**: <= baseline + 20% (currently <5ms avg)
- **Vector search**: <100ms for 10k context packs
- **Connection pool**: Stable memory usage, no leaks

### Migration Validation

- **Zero data loss**: `npm run brat -- db:validate --all` exits 0
- **All collections**: 13/13 migrated successfully
- **Record counts**: Firestore count === PostgreSQL count for all collections
- **Checksums**: 100% match for sampled records

### Operational Metrics

- **Zero Firestore reads**: No Firestore operations in logs for 48 hours
- **Integration tests**: 100% passing on staging
- **Service health**: All services healthy in remote Docker
- **End-to-end flow**: Full message flow works without errors

---

## Communication Plan

### Weekly Updates

**Week 1 Report**: Foundation Complete
- ✅ Persistence abstractions implemented
- ✅ PostgreSQL running in Docker
- ✅ Migration tooling validated
- ✅ 10k events migrated and tested
- 📊 Performance: PostgreSQL within 15% of Firestore baseline

**Week 2-3 Report**: Migration Complete
- ✅ All 13 schemas created
- ✅ All services refactored
- ✅ All data migrated (zero data loss)
- ✅ Deployed to remote Docker (staging)
- ✅ Integration tests passing

**Week 4 Report**: Cleanup Complete
- ✅ Zero Firestore operations for 48 hours
- ✅ Firestore dependencies removed
- ✅ Documentation updated
- ✅ Ready for production use

---

## Next Steps

### Immediate (Week 1)

1. **Get approval** to proceed with 3-4 week sprint
2. **Allocate resources** (Lead Implementor)
3. **Begin FND-001**: Create persistence abstraction interfaces
4. **Set up environment**: Local Docker with PostgreSQL

### Week 2-3

5. **Execute MIG-001 to MIG-035**: Full migration
6. **Deploy to staging**: Remote Docker with PostgreSQL
7. **Validate**: Zero Firestore reads, integration tests passing

### Week 4

8. **Execute CLN-001 to CLN-007**: Remove Firestore
9. **Update docs**: README, CLAUDE.md
10. **Mark sprint complete**: PostgreSQL migration done! 🎉

---

## References

- **Architectural Analysis**: `planning/persistence-architecture-analysis.md`
- **Backlog**: `planning/sprint-343-postgres-migration/backlog.yaml`
- **Sprint Manifest**: `planning/sprint-343-postgres-migration/sprint-manifest.yaml`
- **Simplified Approach**: `planning/sprint-343-postgres-migration/SIMPLIFIED_APPROACH.md`
