# PostgreSQL Migrations

## Overview

This directory contains SQL migration scripts for evolving the PostgreSQL schema over time. Migrations are numbered sequentially and should be applied in order.

## Migration Files

- `001-rename-commands-to-routing-rules.sql` - Renames `commands` table to `routing_rules` for clarity
- `002-add-persistence-tables.sql` - Adds core persistence layer tables (`sources`, `snapshots`, `state`, `mutation_log`)

## Applying Migrations

### Manual Application

Connect to PostgreSQL and run migrations in order:

```bash
psql $DATABASE_URL -f infrastructure/postgres/migrations/001-rename-commands-to-routing-rules.sql
psql $DATABASE_URL -f infrastructure/postgres/migrations/002-add-persistence-tables.sql
```

### Docker Environment

Migrations are automatically applied when initializing a fresh Docker container via the `/docker-entrypoint-initdb.d` directory.

For existing databases, run migrations manually:

```bash
docker exec -i bitbrat-postgres psql -U bitbrat -d bitbrat -f /docker-entrypoint-initdb.d/migrations/001-rename-commands-to-routing-rules.sql
docker exec -i bitbrat-postgres psql -U bitbrat -d bitbrat -f /docker-entrypoint-initdb.d/migrations/002-add-persistence-tables.sql
```

### Cloud SQL (Production)

Use Cloud SQL Proxy to connect and apply migrations:

```bash
cloud-sql-proxy <instance-connection-name> &
psql "host=127.0.0.1 user=bitbrat dbname=bitbrat" -f infrastructure/postgres/migrations/002-add-persistence-tables.sql
```

## Migration Guidelines

### Naming Convention

Migrations follow the pattern: `NNN-description.sql`

- `NNN`: Three-digit sequential number (e.g., `001`, `002`, `003`)
- `description`: Kebab-case description of the change

### Writing Migrations

1. **Idempotency**: All migrations must be idempotent (safe to run multiple times)
   - Use `IF NOT EXISTS` for CREATE statements
   - Use `IF EXISTS` for DROP/ALTER statements
   - Use DO blocks for conditional logic

2. **Header Comment**: Include migration metadata:
   ```sql
   -- Migration: Brief description
   -- Date: YYYY-MM-DD
   -- Reason: Detailed explanation
   ```

3. **Success Message**: End with a status message:
   ```sql
   SELECT 'Migration description complete' AS status;
   ```

### Testing Migrations

Before committing:

1. Test on a clean database (fresh init)
2. Test on an existing database (migration path)
3. Test idempotency (run twice)
4. Verify indexes were created

Example test workflow:

```bash
# Clean slate test
docker compose down -v
docker compose up -d postgres
docker exec -i bitbrat-postgres psql -U bitbrat -d bitbrat -f /docker-entrypoint-initdb.d/migrations/002-add-persistence-tables.sql

# Idempotency test (should not error)
docker exec -i bitbrat-postgres psql -U bitbrat -d bitbrat -f /docker-entrypoint-initdb.d/migrations/002-add-persistence-tables.sql

# Verify tables
docker exec -it bitbrat-postgres psql -U bitbrat -d bitbrat -c "\dt"
docker exec -it bitbrat-postgres psql -U bitbrat -d bitbrat -c "\d sources"
```

## Vector Search Support

The PostgreSQL backend supports vector similarity search via the pgvector extension.

### Enabled Features

- **Extension**: `vector` (pgvector)
- **Vector Column**: `context_packs.embedding vector(1536)`
- **Distance Operators**:
  - `<=>` - Cosine distance
  - `<->` - Euclidean distance (L2)
  - `<#>` - Negative inner product
- **Index**: IVFFLAT index on `context_packs.embedding`

### Usage Example

```typescript
import { IDocumentStore, VectorOrderBy } from '@/common/persistence/interfaces';

const queryOptions = {
  orderBy: {
    field: 'embedding',
    vector: [0.1, 0.2, 0.3, ...],  // Query embedding
    distanceMeasure: 'COSINE' as const,
    direction: 'asc' as const,  // Closest first
  } as VectorOrderBy,
  limit: 10,
};

const results = await documentStore.query('context_packs', queryOptions);
```

### Generated SQL

```sql
SELECT data, (data->'embedding' <=> $1::vector) AS distance
FROM context_packs
ORDER BY distance ASC
LIMIT 10
```

## Troubleshooting

### Migration Won't Apply

**Symptom**: Migration script errors or is skipped

**Solutions**:
1. Check migration order - earlier migrations must be applied first
2. Verify database permissions - user must have CREATE/ALTER privileges
3. Check for syntax errors - test SQL in psql directly
4. Review migration logs - check for detailed error messages

### Table Already Exists

**Symptom**: `relation "table_name" already exists`

**Solution**: Migrations use `IF NOT EXISTS` - this is expected behavior. The migration detected existing schema and skipped creation.

### Index Creation Fails

**Symptom**: Index creation errors

**Solutions**:
1. Verify column exists before creating index
2. Check index name doesn't conflict with existing index
3. For vector indexes, ensure pgvector extension is installed

### Vector Extension Missing

**Symptom**: `type "vector" does not exist`

**Solution**: Ensure pgvector extension is installed:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

This is handled automatically by `infrastructure/postgres/init/01-enable-extensions.sql` for new databases.

## Schema Evolution Best Practices

1. **Never modify committed migrations** - Always create new migrations for changes
2. **Test rollback paths** - Plan for migration reversals if needed
3. **Document breaking changes** - Note any schema changes that require application updates
4. **Coordinate with code changes** - Ensure application code is compatible with schema changes
5. **Use transactions** - Wrap complex migrations in BEGIN/COMMIT blocks
6. **Backup before production** - Always backup production data before running migrations

## Related Documentation

- [PostgreSQL Persistence Guide](../../../documentation/guides/postgres-persistence.md) (TBD)
- [IDocumentStore Interface](../../../src/common/persistence/interfaces.ts)
- [PostgresDocumentStore Implementation](../../../src/common/persistence/postgres-store.ts)
- [Migration Testing Guide](../../../documentation/guides/testing-migrations.md) (TBD)
