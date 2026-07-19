# PostgreSQL Migration Documentation

This directory contains documentation from Sprint 343 (PostgreSQL Migration) and related follow-up work. These documents provide historical context and technical details for the platform's migration from Firestore to PostgreSQL as the default persistence backend.

## Migration Timeline

The PostgreSQL migration occurred across multiple sprints in Q3 2026:

- **Sprint 343**: Primary PostgreSQL migration implementation
- **Follow-up sprints**: Bug fixes, schema refinements, and deployment validations

## Document Index

### Core Migration Documentation

- **POSTGRES_MIGRATION_COMPLETE.md** - Overall migration summary and completion report
- **COMPLETE_FIRESTORE_MIGRATION.md** - Firestore-to-PostgreSQL migration overview
- **POSTGRES_MIGRATION_TOOLING_AUDIT.md** - Audit of migration tooling and scripts
- **SPRINT_343_SESSION_SUMMARY.md** - Detailed Sprint 343 session summary

### Deployment & Validation

- **STAGING_POSTGRES_DEPLOYMENT_REPORT.md** - Staging environment deployment results
- **STAGING_POSTGRES_MIGRATION_STATUS.md** - Staging migration status tracking

### Table-Specific Migrations

- **REFLEXES_TABLE_GAP_ANALYSIS.md** - Reflexes table schema analysis
- **SNAPSHOTS_REFLEXES_TABLE_FIX.md** - Reflexes table snapshot handling fixes
- **STATE_ENGINE_TABLES_FIX.md** - State engine table schema corrections
- **SOURCES_TABLE_MIGRATION.md** - Sources table migration details
- **ROUTING_RULES_NESTED_PATH_FIX.md** - Routing rules nested collection path fixes
- **NESTED_COLLECTIONS_AUDIT.md** - Audit of nested Firestore collection patterns

### Service-Specific Migrations

- **AUTH_SERVICE_FIREBASE_FIX.md** - Auth service Firebase/Firestore compatibility fixes
- **IDENTITY_ROLES_MISSING_FIX.md** - Identity roles schema migration
- **IDENTITY_ROLES_FIX_COMPLETE.md** - Identity roles completion report
- **PROMPT_LOGGING_INVESTIGATION.md** - Prompt logging system investigation
- **POSTGRES_PROMPT_LOGGING_FIX.md** - PostgreSQL prompt logging implementation

### OAuth & Authentication

- **OAUTH_TOKEN_FIX.md** - OAuth token handling fixes
- **OAUTH_TOKEN_POSTGRES_MIGRATION.md** - OAuth token PostgreSQL migration
- **OAUTH_TOKENS_FIRESTORE_REQUIREMENT.md** - OAuth Firestore requirements analysis
- **OAUTH_MIGRATION_SUMMARY.md** - Overall OAuth migration summary

### Firebase Emulator & Firestore

- **FIREBASE_EMULATOR_DISABLED.md** - Firebase emulator disablement rationale
- **FIRESTORE_EMULATOR_ERRORS_FIX.md** - Firestore emulator error fixes
- **FIRESTORE_MIGRATION_AUDIT.md** - Firestore usage audit across codebase

## Current State (Post-Migration)

**Default Backend:** PostgreSQL
**Legacy Backend:** Firestore (supported but deprecated)

All new deployments should use PostgreSQL. Firestore remains supported for existing deployments but is considered legacy. See [Backup and Migration Guide](../guides/backup-and-migration.md) for migration instructions.

## Related Documentation

- [PostgreSQL Setup Guide](../guides/postgres-setup.md) - PostgreSQL deployment and configuration
- [Backup and Migration Guide](../guides/backup-and-migration.md) - Data backup and migration procedures
- [Architecture: Database](../concepts/database-architecture.md) - Database architecture overview

---

**Note:** These documents are historical records and should not be modified. They preserve the context and decisions made during the migration process for future reference and debugging.
