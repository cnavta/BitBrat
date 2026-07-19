# PostgreSQL Setup Scripts

This directory contains database setup and migration scripts for PostgreSQL deployments.

## Table Creation Scripts

These scripts create the necessary PostgreSQL tables for the BitBrat platform:

### `create-api-tokens-table.mjs`
Creates the `api_tokens` table for storing API authentication tokens.

**Usage:**
```bash
node scripts/postgres/create-api-tokens-table.mjs
```

**Environment Variables:**
- `POSTGRES_HOST` - PostgreSQL server host
- `POSTGRES_PORT` - PostgreSQL server port (default: 5432)
- `POSTGRES_DB` - Database name
- `POSTGRES_USER` - Database user
- `POSTGRES_PASSWORD` - Database password

### `create-prompt-logs-table.mjs`
Creates the `prompt_logs` table for storing LLM prompt/response logs.

**Usage:**
```bash
node scripts/postgres/create-prompt-logs-table.mjs
```

### `create-reflexes-table.ts`
Creates the `reflexes` table for storing reflex (instant response) definitions.

**Usage:**
```bash
npx ts-node scripts/postgres/create-reflexes-table.ts
```

### `create-tool-usage-table.mjs`
Creates the `tool_usage` table for MCP tool usage tracking and observability.

**Usage:**
```bash
node scripts/postgres/create-tool-usage-table.mjs
```

## Migration Scripts

### `run-staging-migration.sh`
Executes the full database migration for the staging environment.

**Usage:**
```bash
./scripts/postgres/run-staging-migration.sh
```

**Prerequisites:**
- PostgreSQL connection configured
- Database credentials in environment or .env file
- Staging environment access

## Development Workflow

### Setting Up a New PostgreSQL Environment

1. **Configure Connection:**
   ```bash
   export POSTGRES_HOST=localhost
   export POSTGRES_PORT=5432
   export POSTGRES_DB=bitbrat
   export POSTGRES_USER=bitbrat
   export POSTGRES_PASSWORD=your_password
   ```

2. **Create Tables:**
   ```bash
   node scripts/postgres/create-api-tokens-table.mjs
   node scripts/postgres/create-prompt-logs-table.mjs
   npx ts-node scripts/postgres/create-reflexes-table.ts
   node scripts/postgres/create-tool-usage-table.mjs
   ```

3. **Verify Setup:**
   ```bash
   psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c "\dt"
   ```

### Running Migrations

For production migrations, use the `brat` CLI:

```bash
npm run brat -- backup export --target local
npm run brat -- backup import --target staging --confirm
```

See [Backup and Migration Guide](../../documentation/guides/backup-and-migration.md) for complete migration procedures.

## Schema Management

All table schemas should match the definitions in:
- `src/services/postgres/schemas/` - TypeScript schema definitions
- `documentation/concepts/database-architecture.md` - Conceptual schema documentation

When adding new tables:
1. Create a TypeScript schema in `src/services/postgres/schemas/`
2. Create a table creation script in this directory
3. Update this README with usage instructions
4. Add the table to migration procedures

## Related Documentation

- [PostgreSQL Setup Guide](../../documentation/guides/postgres-setup.md)
- [Database Architecture](../../documentation/concepts/database-architecture.md)
- [Backup and Migration](../../documentation/guides/backup-and-migration.md)
- [Migration Documentation](../../documentation/migrations/README.md) - Historical migration docs

---

**Note:** These scripts are idempotent where possible (using `CREATE TABLE IF NOT EXISTS`). However, always back up your data before running migrations in production environments.
