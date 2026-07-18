# Backup and Migration Guide

## Overview

BitBrat provides comprehensive backup and migration tools for both Firestore and PostgreSQL backends. This guide covers:

- **Manual backups** - On-demand exports for immediate needs
- **Automated backups** - Scheduled backups via cron
- **Cross-environment migration** - Copying data between local/staging/prod
- **Disaster recovery** - Restoring from backups

## Quick Reference

```bash
# Manual PostgreSQL backup (all data) - DEFAULT
DATABASE_URL="..." npm run brat -- pg:backup --output backup.json

# Manual Firestore backup (config collections only) - LEGACY
npm run brat -- backup export --target local --out backup.json

# Cross-environment migration
./tools/scripts/migrate-environment.sh local staging --full --dry-run

# Automated daily backup (cron)
0 2 * * * /path/to/backup-automated.sh prod --retention 30
```

---

## Firestore Backups (Legacy)

**Note:** Firestore is a legacy persistence backend. For the default PostgreSQL backend, see [PostgreSQL Backups (Default)](#postgresql-backups-default) below.

### What Gets Backed Up

Firestore backups use an **allowlist approach** and only export **configuration collections**:

**Included** (config collections):
- `routing_rules` - Event router rules
- `context_packs` - LLM context packs
- `service_registry` - Service registrations
- `auth_users`, `auth_scopes` - Authentication data
- `user_state`, `global_state` - Application state
- `sessions` - User sessions
- `integration_configs` - Platform integrations

**Excluded** (NEVER backed up):
- `events`, `snapshots` - Event persistence (transient data)
- `mutation_log` - State mutations audit trail
- `llm_responses` - LLM response cache
- `metrics` - Telemetry data

**Sensitive Collections** (opt-in):
- Some collections require `--include-secrets` flag
- Check registry: `npm run brat -- backup list`

### Commands

**List collections in backup registry:**
```bash
npm run brat -- backup list
npm run brat -- backup list --json
```

**Export Firestore config:**
```bash
# Local environment (emulator)
npm run brat -- backup export --target local --out backup.json

# Staging environment
npm run brat -- backup export --target staging --out backup.json

# Production (requires explicit project ID)
npm run brat -- backup export --project-id bitbrat-prod --out backup.json

# Include sensitive collections
npm run brat -- backup export --target local --out backup.json --include-secrets

# Export specific collections
npm run brat -- backup export --target local --out backup.json --collections routing_rules,context_packs
```

**Import Firestore config:**
```bash
# Dry-run (preview changes, no writes)
npm run brat -- backup import --in backup.json --target local --dry-run

# Merge mode (default) - keep existing docs, update matching IDs
npm run brat -- backup import --in backup.json --target local --mode merge --confirm

# Overwrite mode - replace matching docs
npm run brat -- backup import --in backup.json --target local --mode overwrite --confirm

# Skip mode - only create new docs, never update existing
npm run brat -- backup import --in backup.json --target local --mode skip --confirm
```

**Safety Rails:**

1. **Dry-run by default** - Import requires `--confirm` to write
2. **GCP protection** - Production imports require explicit `--project-id`
3. **Allowlist enforcement** - Only registered collections are exported
4. **Sensitive opt-in** - Secrets require `--include-secrets`

### Backup Format

Firestore backups use a JSON envelope format:

```json
{
  "metadata": {
    "version": "1.0.0",
    "timestamp": "2026-07-16T10:30:00.000Z",
    "source": "local",
    "collectionCount": 5,
    "documentCount": 127,
    "includeSecrets": false
  },
  "data": {
    "routing_rules": [
      { "id": "rule-1", "pattern": "!help", "action": "..." }
    ],
    "context_packs": [
      { "id": "pack-1", "name": "greeting", "content": "..." }
    ]
  }
}
```

---

## PostgreSQL Backups (Default)

**PostgreSQL is the default persistence backend.** PostgreSQL backups are comprehensive and include all data.

### What Gets Backed Up

PostgreSQL backups include **all data** across all tables:

**Core Persistence:**
- `events` - Event aggregates
- `snapshots` - Event snapshots (flattened subcollection)
- `sources` - External source tracking (Twitch/Discord)
- `state` - State engine mutations
- `mutation_log` - Mutation audit trail

**Configuration:**
- `routing_rules` - Event router rules
- `context_packs` - LLM context packs (with vector embeddings)
- `service_registry` - Service registrations

**Authentication & State:**
- `auth_users`, `auth_scopes`
- `user_state`, `global_state`
- `sessions`

**Application Data:**
- `conversation_history`
- `llm_responses`
- `integration_configs`
- `metrics`

### Commands

**Backup to JSON:**
```bash
# Full backup (all collections)
DATABASE_URL="..." npm run brat -- pg:backup --output backup.json

# Compressed backup
DATABASE_URL="..." npm run brat -- pg:backup --output backup.json --compress

# Specific collections only
DATABASE_URL="..." npm run brat -- pg:backup --output backup.json --collections events,snapshots,state
```

**Backup to SQL (pg_dump):**
```bash
# Native PostgreSQL backup format
DATABASE_URL="..." npm run brat -- pg:backup --output backup.pgdump --format sql --compress
```

**Restore from JSON:**
```bash
# Dry-run (preview)
DATABASE_URL="..." npm run brat -- pg:restore --input backup.json --dry-run

# Merge mode (keep existing, update matching)
DATABASE_URL="..." npm run brat -- pg:restore --input backup.json --mode merge

# Overwrite mode (replace matching)
DATABASE_URL="..." npm run brat -- pg:restore --input backup.json --mode overwrite
```

**Restore from SQL (pg_restore):**
```bash
# Full database restore (WARNING: drops existing objects)
DATABASE_URL="..." npm run brat -- pg:restore --input backup.pgdump --format sql
```

**Local environment shorthand:**
```bash
# Export local PostgreSQL
export DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
npm run brat -- pg:backup --output local-backup.json

# Restore to local PostgreSQL
export DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
npm run brat -- pg:restore --input local-backup.json
```

---

## Cross-Environment Migration

Use the unified migration script to copy data between environments.

### Script: `migrate-environment.sh`

**Location:** `tools/scripts/migrate-environment.sh`

**Usage:**
```bash
./migrate-environment.sh <source-env> <target-env> [options]
```

**Environments:**
- `local` - Local Docker stack
- `staging` - Staging GCP environment
- `prod` - Production GCP environment

**Options:**
- `--firestore` - Migrate Firestore config collections
- `--postgres` - Migrate PostgreSQL data
- `--full` - Migrate both Firestore and PostgreSQL
- `--dry-run` - Preview migration without applying changes
- `--include-secrets` - Include sensitive collections
- `--no-compress` - Disable gzip compression
- `--no-cleanup` - Keep backup files after migration

### Examples

**Migrate local → staging (full stack, dry-run):**
```bash
./tools/scripts/migrate-environment.sh local staging --full --dry-run
```

**Migrate staging → prod (Firestore config only, with confirmation):**
```bash
./tools/scripts/migrate-environment.sh staging prod --firestore --include-secrets
```

**Migrate local → staging (PostgreSQL data only):**
```bash
export STAGING_DATABASE_URL="postgresql://user:pass@staging-host:5432/bitbrat"
./tools/scripts/migrate-environment.sh local staging --postgres
```

**Backup prod to local (reverse migration for testing):**
```bash
export PROD_DATABASE_URL="postgresql://user:pass@prod-host:5432/bitbrat"
./tools/scripts/migrate-environment.sh prod local --full --no-cleanup
```

### Prerequisites

**For Firestore migrations:**
- Source/target environments configured in `architecture.yaml` or `--project-id` specified
- GCP authentication configured (`gcloud auth login` for production)
- Emulators running for local targets

**For PostgreSQL migrations:**
- `DATABASE_URL` environment variables set for each environment
- Network access to source and target databases
- Sufficient disk space for backup files (default: `./backups/`)

---

## Automated Backups

Use the automated backup script for scheduled backups via cron.

### Script: `backup-automated.sh`

**Location:** `tools/scripts/backup-automated.sh`

**Usage:**
```bash
./backup-automated.sh [environment] [options]
```

**Options:**
- `--retention <days>` - Number of days to retain backups (default: 30)
- `--s3-upload` - Upload backups to AWS S3
- `--s3-bucket <bucket>` - S3 bucket name
- `--gcs-upload` - Upload backups to Google Cloud Storage
- `--gcs-bucket <bucket>` - GCS bucket name
- `--include-secrets` - Include sensitive collections
- `--no-compress` - Disable gzip compression
- `--notify <email>` - Send notification emails

### Examples

**Manual backup of local environment:**
```bash
./tools/scripts/backup-automated.sh local
```

**Backup staging with 7-day retention:**
```bash
export STAGING_DATABASE_URL="postgresql://..."
./tools/scripts/backup-automated.sh staging --retention 7
```

**Backup production to GCS with notifications:**
```bash
export PROD_DATABASE_URL="postgresql://..."
export GCS_BUCKET="bitbrat-backups"
export NOTIFY_EMAIL="ops@example.com"

./tools/scripts/backup-automated.sh prod \
  --retention 90 \
  --gcs-upload \
  --include-secrets \
  --notify ops@example.com
```

### Cron Setup

**Daily backup at 2am:**
```cron
0 2 * * * /path/to/BitBratPlatform/tools/scripts/backup-automated.sh prod --retention 30 --gcs-upload >> /var/log/bitbrat-backup.log 2>&1
```

**Hourly staging backups (business hours):**
```cron
0 9-17 * * 1-5 /path/to/backup-automated.sh staging --retention 3 >> /var/log/bitbrat-staging-backup.log 2>&1
```

**Weekly full backup with S3 upload:**
```cron
0 3 * * 0 /path/to/backup-automated.sh prod --retention 90 --s3-upload --include-secrets >> /var/log/bitbrat-weekly-backup.log 2>&1
```

### Backup Directory Structure

```
backups/
├── local/
│   ├── 20260716/
│   │   ├── firestore-20260716-020000.json.gz
│   │   └── postgres-20260716-020000.json.gz
│   └── 20260717/
│       ├── firestore-20260717-020000.json.gz
│       └── postgres-20260717-020000.json.gz
├── staging/
│   └── 20260716/
│       ├── firestore-20260716-020000.json.gz
│       └── postgres-20260716-020000.json.gz
└── prod/
    └── 20260716/
        ├── firestore-20260716-020000.json.gz
        └── postgres-20260716-020000.json.gz
```

---

## Disaster Recovery

### Scenario: Complete Data Loss

**1. Identify most recent backup:**
```bash
ls -lth backups/prod/
```

**2. Restore Firestore config:**
```bash
# Decompress if needed
gunzip backups/prod/20260716/firestore-20260716-020000.json.gz

# Import to prod (CAUTION)
npm run brat -- backup import \
  --in backups/prod/20260716/firestore-20260716-020000.json \
  --project-id bitbrat-prod \
  --mode overwrite \
  --include-secrets \
  --confirm
```

**3. Restore PostgreSQL data:**
```bash
# Decompress if needed
gunzip backups/prod/20260716/postgres-20260716-020000.json.gz

# Restore to prod database
export DATABASE_URL="postgresql://..."
npm run brat -- pg:restore \
  --input backups/prod/20260716/postgres-20260716-020000.json \
  --mode overwrite
```

**4. Verify restoration:**
```bash
# Check Firestore collections
npm run brat -- backup list --json | jq '.collections | length'

# Check PostgreSQL tables
psql $DATABASE_URL -c "\dt"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM events"
```

### Scenario: Corrupted Collection

**Restore single Firestore collection:**
```bash
npm run brat -- backup import \
  --in backup.json \
  --target prod \
  --collections routing_rules \
  --mode overwrite \
  --confirm
```

**Restore single PostgreSQL table:**
```sql
-- Manual approach: extract from backup JSON
SELECT data FROM backup WHERE collection = 'routing_rules';

-- Then insert into target database
```

---

## Best Practices

### 1. Regular Backups

- **Production:** Daily full backups with 90-day retention
- **Staging:** Daily backups with 7-day retention
- **Local:** As needed (development data is ephemeral)

### 2. Test Restores

Regularly verify backups are restorable:

```bash
# Monthly restore drill
./tools/scripts/migrate-environment.sh prod local --full --dry-run
```

### 3. Multiple Storage Locations

- **Primary:** Local disk (`./backups/`)
- **Secondary:** Cloud storage (GCS or S3)
- **Tertiary:** Offsite backup for disaster recovery

### 4. Security

- **Encrypt backups** - Use `gpg` for sensitive data
- **Limit access** - Restrict backup file permissions (600)
- **Rotate keys** - Update encryption keys quarterly
- **Audit logs** - Monitor backup/restore operations

### 5. Monitoring

Track backup health:
- Backup size trends (detect anomalies)
- Backup duration (performance regression)
- Success/failure rate (reliability)
- Last successful backup timestamp (staleness)

---

## Troubleshooting

### Backup Fails with "Permission Denied"

**Firestore:**
```bash
# Ensure GCP authentication is configured
gcloud auth login
gcloud config set project bitbrat-prod
```

**PostgreSQL:**
```bash
# Verify DATABASE_URL is correct
psql $DATABASE_URL -c "SELECT version();"
```

### Import Fails with "Document Already Exists"

Use `--mode overwrite` to replace existing documents:

```bash
npm run brat -- backup import --in backup.json --target local --mode overwrite --confirm
```

### Backup Size Unexpectedly Large

**Check collection sizes:**
```bash
npm run brat -- backup export --target local --out /tmp/backup.json --json | jq '.documentCount'
```

**Exclude large collections:**
```bash
npm run brat -- backup export --target local --out backup.json --collections routing_rules,context_packs
```

### Restore Performance is Slow

- Use `--format sql` for PostgreSQL backups (faster restore)
- Disable indexes during bulk import, rebuild afterward
- Increase connection pool size in `PostgresDocumentStore`
- Use batch operations for large restores

---

## Related Documentation

- [PostgreSQL Persistence Guide](./postgres-persistence.md) (TBD)
- [PostgreSQL Migrations](../../infrastructure/postgres/migrations/README.md)
- [IDocumentStore Interface](../../src/common/persistence/interfaces.ts)
- [Firestore Backup Registry](../../tools/brat/src/backup/registry.ts)
