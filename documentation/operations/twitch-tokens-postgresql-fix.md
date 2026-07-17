# Twitch Tokens PostgreSQL Fix

**Date:** 2026-07-17
**Environment:** Staging
**Issue:** Twitch connectors failing to start due to missing `twitch_tokens` table in PostgreSQL

## Problem

When staging was migrated to PostgreSQL (`PERSISTENCE_DRIVER=postgres`), the ingress-egress service failed to start all three Twitch connectors with the following error:

```
[PostgresDocumentStore] get error: error: relation "twitch_tokens" does not exist
```

This caused all Twitch connectors to transition to `ERROR` state:
- **twitch** (bot credentials) - ERROR
- **twitch-broadcaster** (broadcaster credentials) - ERROR
- **twitch-eventsub** (EventSub credentials) - ERROR

## Root Cause

The `PostgresTokenStore` (introduced in the PostgreSQL migration) attempted to read OAuth tokens from a `twitch_tokens` table that was never created during the initial migration. The table schema was missing from both:
1. `infrastructure/postgres/init/02-create-tables.sql` (initial setup)
2. Migration scripts

## Solution

### 1. Created the Missing Table

Created migration script `infrastructure/postgres/migrations/003-add-twitch-tokens-table.sql`:

```sql
CREATE TABLE twitch_tokens (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_twitch_tokens_user_id ON twitch_tokens((data->>'userId'));
CREATE INDEX idx_twitch_tokens_updated_at ON twitch_tokens(updated_at);
```

### 2. Migrated Existing Tokens

Created and ran `tools/migrate-tokens-simple.js` to copy OAuth tokens from Firestore to PostgreSQL:

**Tokens migrated:**
- `oauth/twitch/bot/token` → `twitch:bot` (userId: 1369021733)
- `oauth/twitch/broadcaster/token` → `twitch:broadcaster` (userId: 91960688)

### 3. Updated Init Scripts

Added the `twitch_tokens` table to `infrastructure/postgres/init/02-create-tables.sql` to ensure future deployments include this table from the start.

## Verification

After applying the fix and restarting ingress-egress:

✅ All connectors successfully transitioned to `CONNECTED` state:
```
{"msg":"ingress-egress.status_change","name":"twitch","from":"NONE","to":"CONNECTED"}
{"msg":"ingress-egress.status_change","name":"twitch-broadcaster","from":"NONE","to":"CONNECTED"}
{"msg":"ingress-egress.status_change","name":"twitch-eventsub","from":"NONE","to":"CONNECTED"}
{"msg":"ingress-egress.status_change","name":"discord","from":"NONE","to":"CONNECTED"}
```

✅ Tokens successfully loaded from PostgreSQL:
```
{"msg":"Loaded token from PostgreSQL","docPath":"oauth/twitch/bot","backend":"postgres"}
{"msg":"Loaded token from PostgreSQL","docPath":"oauth/twitch/broadcaster","backend":"postgres"}
```

✅ No errors in logs after restart

## Files Modified

- `infrastructure/postgres/init/02-create-tables.sql` - Added twitch_tokens table
- `infrastructure/postgres/migrations/003-add-twitch-tokens-table.sql` - New migration script
- `tools/migrate-tokens-simple.js` - Token migration utility
- `tools/migrate-tokens-to-postgres.ts` - TypeScript version of migration utility

## Future Deployments

For new PostgreSQL deployments:
1. The `twitch_tokens` table will be created automatically via `02-create-tables.sql`
2. Run `tools/migrate-tokens-simple.js` to migrate tokens from Firestore (if needed)
3. Ensure `PERSISTENCE_DRIVER=postgres` is set in environment

## Related Issues

This fix completes the PostgreSQL migration started in Sprint 343. The missing table was an oversight during the initial migration planning phase.
