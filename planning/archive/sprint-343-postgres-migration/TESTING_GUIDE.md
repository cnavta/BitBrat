# Sprint 343: PostgreSQL Migration - Testing Guide

This guide provides step-by-step instructions for testing the PostgreSQL migration tooling.

## Prerequisites

### 1. Environment Setup

Ensure you have the following environment variables set:

```bash
# PostgreSQL connection (local Docker)
export DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"

# Or for remote Docker
export DATABASE_URL="postgresql://bitbrat:password@bitbrat.lan:5432/bitbrat"

# Firestore (if using emulator)
export FIRESTORE_EMULATOR_HOST="localhost:8080"
export GOOGLE_CLOUD_PROJECT="bitbrat-local"
```

### 2. Start Services

```bash
# Build the project first
npm run build

# Start PostgreSQL (local Docker)
docker compose -f infrastructure/docker-compose/docker-compose.local.yaml up postgres -d

# Or use brat command (if configured)
npm run brat -- docker up --service postgres --env local

# Verify PostgreSQL is running
npm run brat -- db:validate --help  # Should not error about DATABASE_URL
```

### 3. Start Firestore Emulator (if testing locally)

```bash
# In a separate terminal
npm run brat -- docker up --service firebase-emulator --env local
```

## Testing Workflow

### Option 1: Quick Test (Automated)

Run the full test cycle with automated instructions:

```bash
npm run test-migration full
```

This will:
1. Clean up any existing test data
2. Generate 1000 sample events
3. Upload them to Firestore
4. Provide instructions for next steps

### Option 2: Manual Step-by-Step Test

#### Step 1: Generate Test Data

```bash
# Generate 1000 test events (default)
npm run test-migration seed

# Or generate a specific number
npm run test-migration seed 5000
npm run test-migration seed 10000
```

**Expected Output:**
```
📝 Generating 5000 test events...
📤 Uploading to Firestore...
  ✓ Written 500/5000 events
  ✓ Written 1000/5000 events
  ...
✅ Successfully seeded 5000 events to Firestore
```

#### Step 2: Run Migration

```bash
# Migrate just the events collection
npm run brat -- migrate collection events

# Or run with dry-run first to test
npm run brat -- migrate collection events --dry-run
```

**Expected Output:**
```
[PostgresDocumentStore] PostgreSQL connection healthy
Migrating events: 5000 documents
████████████████████████████████████████ 100% | 5000/5000

Migration complete:
  Migrated: 5000
  Errors: 0
```

#### Step 3: Verify Data in PostgreSQL

```bash
npm run test-migration verify
```

**Expected Output:**
```
🔍 Verifying PostgreSQL data...
  ✓ Found 5000 events in PostgreSQL
  ✓ Sample event has correct structure
✅ Verification passed!
```

#### Step 4: Validate Data Consistency

```bash
# Validate specific collection
npm run brat -- db:validate --collection events

# Or validate with sampling (faster for large datasets)
npm run brat -- db:validate --collection events --sample 1000
```

**Expected Output:**
```
Validation Results: events
============================================================
Firestore count: 5000
PostgreSQL count: 5000
Count match: ✓

Sampled: 1000 documents
Checksum matches: 1000
Checksum mismatches: 0
Missing in PostgreSQL: 0
Missing in Firestore: 0
```

#### Step 5: Clean Up Test Data

```bash
npm run test-migration cleanup
```

**Expected Output:**
```
🧹 Cleaning up test data...
✅ Cleaned up 5000 test events from Firestore
```

## Advanced Testing

### Performance Benchmarking

Test migration performance with different dataset sizes:

```bash
# Test with 1K events
npm run test-migration seed 1000
time npm run brat -- migrate collection events
npm run test-migration cleanup

# Test with 10K events
npm run test-migration seed 10000
time npm run brat -- migrate collection events
npm run test-migration cleanup

# Test with 50K events (if you have time)
npm run test-migration seed 50000
time npm run brat -- migrate collection events --json > migration-results.json
npm run test-migration cleanup
```

**Performance Targets:**
- 1K events: < 30 seconds
- 10K events: < 5 minutes
- 50K events: < 25 minutes

### Backup & Restore Testing

```bash
# 1. Seed data
npm run test-migration seed 1000

# 2. Migrate to PostgreSQL
npm run brat -- migrate collection events

# 3. Create backup
npm run brat -- pg:backup --output test-backup.json --collections events

# 4. Verify backup file
ls -lh test-backup.json

# 5. Test restore (dry-run first)
npm run brat -- pg:restore --input test-backup.json --dry-run

# 6. Actual restore
npm run brat -- pg:restore --input test-backup.json --mode overwrite

# 7. Validate
npm run brat -- db:validate --collection events

# 8. Clean up
npm run test-migration cleanup
rm test-backup.json
```

### Compressed Backup Testing

```bash
# Create compressed backup
npm run brat -- pg:backup --output test-backup.json --compress

# Should create test-backup.json.gz
ls -lh test-backup.json.gz

# Restore from compressed backup
npm run brat -- pg:restore --input test-backup.json.gz

# Clean up
rm test-backup.json.gz
```

### SQL Format Backup (requires pg_dump/pg_restore)

```bash
# SQL backup
npm run brat -- pg:backup --output test-backup.pgdump --format sql

# SQL restore
npm run brat -- pg:restore --input test-backup.pgdump --format sql

# Clean up
rm test-backup.pgdump
```

## Troubleshooting

### Database Connection Errors

**Error:** `DATABASE_URL environment variable is required`

**Solution:**
```bash
export DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
```

**Error:** `PostgreSQL connection failed: connection refused`

**Solution:**
- Ensure PostgreSQL is running: `docker ps | grep postgres`
- Check connection string is correct
- Verify PostgreSQL is listening on the expected port

### Firestore Errors

**Error:** `Firestore not initialized`

**Solution:**
- Start Firestore emulator: `npm run brat -- docker up --service firebase-emulator`
- Or set GCP credentials if using production Firestore

### Migration Errors

**Error:** `Failed to migrate document xyz`

**Solution:**
- Check PostgreSQL logs: `docker logs <postgres-container>`
- Verify table exists: Run `npm run brat -- db:validate` to see details
- Check for data validation issues in the error logs

## Success Criteria (FND-014)

To complete FND-014, verify the following:

- ✅ Test data generation works (1000+ events)
- ✅ Migration completes without errors
- ✅ PostgreSQL verification passes
- ✅ Data consistency validation passes (100% checksum match)
- ✅ Performance is acceptable (< 5 min for 10K events)
- ✅ Backup/restore cycle works
- ✅ Cleanup removes test data

## Next Steps

After successful testing:

1. **FND-015**: Run performance benchmarking with real workload patterns
2. **FND-016**: Deploy PostgreSQL to remote Docker (bitbrat.lan)
3. **Phase 1**: Begin migrating all 13 collections in production

## Support

If you encounter issues:

1. Check logs: `npm run brat -- docker logs --service postgres`
2. Validate schema: Check `infrastructure/postgres/init/02-create-tables.sql`
3. Review error messages in migration output
4. Check `planning/sprint-343-postgres-migration/request-log.md` for known issues
