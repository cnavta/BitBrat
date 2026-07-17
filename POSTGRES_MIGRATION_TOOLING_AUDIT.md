# PostgreSQL Migration Tooling Audit

**Date:** 2026-07-17
**Sprint:** 343 - PostgreSQL Migration
**Status:** Gap Analysis Complete

## Executive Summary

This audit identifies gaps in data migration tooling after adding new PostgreSQL tables during Sprint 343. Two new tables have been added (`twitch_tokens` and `api_tokens`), and the existing migration tooling needs to be updated to support them.

## PostgreSQL Tables Inventory

### Existing Tables (15 total)

| # | Table Name | Purpose | Firestore Collection | Migration Support |
|---|------------|---------|---------------------|-------------------|
| 1 | `events` | Event persistence | `events` | ✅ Supported |
| 2 | `routing_rules` | Event router rules | `configs` | ✅ Supported |
| 3 | `context_packs` | RAG context packs | `context_packs` | ✅ Supported |
| 4 | `service_registry` | Service discovery | `services` | ✅ Supported |
| 5 | `auth_users` | User accounts | `users` | ✅ Supported |
| 6 | `auth_scopes` | OAuth scopes | `oauth` | ✅ Supported |
| 7 | `user_state` | User state | `state` | ✅ Supported |
| 8 | `global_state` | Global state | `global_state` | ✅ Supported |
| 9 | `sessions` | User sessions | `sessions` | ✅ Supported |
| 10 | `conversation_history` | Chat history | `conversation_history` | ✅ Supported |
| 11 | `llm_responses` | LLM responses | `llm_responses` | ✅ Supported |
| 12 | `integration_configs` | Platform configs | `integration_configs` | ✅ Supported |
| 13 | `metrics` | System metrics | `metrics` | ✅ Supported |
| 14 | `twitch_tokens` | OAuth tokens | `oauth/twitch/*/token` | ❌ **GAP** |
| 15 | `api_tokens` | API gateway tokens | `gateways/api/tokens` | ❌ **GAP** |

## Migration Tools Analysis

### 1. **tools/brat/src/cli/migrate.ts** (Main Migration CLI)

**Purpose:** Bulk migration of Firestore collections to PostgreSQL

**Supported Collections:**
```typescript
const COLLECTIONS = [
  'events',
  'configs',              // → routing_rules
  'context_packs',
  'services',             // → service_registry
  'users',                // → auth_users
  'oauth',                // → auth_scopes
  'state',                // → user_state
  'global_state',
  'sessions',
  'conversation_history',
  'llm_responses',
  'integration_configs',
  'metrics',
];
```

**Gaps:**
- ❌ No support for `twitch_tokens` (nested Firestore paths: `oauth/twitch/bot/token`)
- ❌ No support for `api_tokens` (nested Firestore paths: `gateways/api/tokens/{hash}`)

**Reason:** These tables use nested Firestore document paths, not top-level collections.

---

### 2. **tools/migrate-tokens-simple.js** (OAuth Token Migration)

**Purpose:** Migrate OAuth tokens from Firestore to PostgreSQL

**Supported Tokens:**
```javascript
const paths = [
  { fs: 'oauth/twitch/bot/token', pg: 'twitch:bot' },
  { fs: 'oauth/twitch/broadcaster/token', pg: 'twitch:broadcaster' },
  { fs: 'oauth/discord/broadcaster/token', pg: 'discord:broadcaster' }
];
```

**Status:** ✅ Supports `twitch_tokens` table migration
**Gaps:**
- ❌ No support for `api_tokens` table
- ❌ Not integrated with `brat migrate` CLI (standalone script)
- ⚠️ Hardcoded paths (not discoverable/configurable)

---

### 3. **tools/migrate-tokens-to-postgres.ts** (TypeScript Version)

**Purpose:** TypeScript version of OAuth token migration

**Status:** ⚠️ Duplicate of `migrate-tokens-simple.js`
**Recommendation:** Consolidate into one tool

---

## Identified Gaps

### Gap 1: No CLI Support for twitch_tokens Migration

**Issue:**
- `brat migrate` CLI doesn't support migrating nested Firestore paths
- `migrate-tokens-simple.js` exists but is not integrated into CLI
- Users must manually run standalone script

**Impact:**
- ❌ Cannot use `brat migrate all` to migrate everything
- ❌ OAuth tokens must be migrated separately
- ❌ No dry-run support for token migration
- ❌ No progress tracking or error reporting

**Recommended Fix:**
```bash
brat migrate tokens --dry-run     # Migrate all OAuth tokens
brat migrate tokens twitch        # Migrate only Twitch tokens
brat migrate tokens discord       # Migrate only Discord tokens
```

**Effort:** 2-3 hours

---

### Gap 2: No Migration Tool for api_tokens

**Issue:**
- No migration tool exists for `api_tokens` table
- Firestore path: `gateways/api/tokens/{token_hash}`
- Users must manually migrate API tokens or lose them

**Impact:**
- ❌ Existing API tokens will be lost during PostgreSQL migration
- ❌ Users will need to regenerate API tokens
- ❌ No migration path for production systems

**Recommended Fix:**
```bash
brat migrate api-tokens --dry-run  # Migrate all API tokens
```

**Migration Logic:**
```typescript
// Firestore: gateways/api/tokens/{hash}
// PostgreSQL: api_tokens table with id = {hash}

async function migrateApiTokens() {
  const snapshot = await firestore
    .collection('gateways/api/tokens')
    .get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    await postgres.set('api_tokens', doc.id, {
      user_id: data.user_id,
      created_at: data.created_at,
      token_hash: data.token_hash,
    });
  }
}
```

**Effort:** 1-2 hours

---

### Gap 3: Nested Collection Support in Main CLI

**Issue:**
- `brat migrate` only supports top-level Firestore collections
- Cannot migrate nested collections like:
  - `gateways/api/tokens/{id}` (api_tokens)
  - `oauth/twitch/bot/token` (twitch_tokens)
  - `users/{id}/roles/{role}` (if we add user roles table)

**Impact:**
- ⚠️ Limited flexibility for future nested collections
- ⚠️ Need custom scripts for each nested path

**Recommended Fix:**
Add `--path` flag support:
```bash
brat migrate collection gateways/api/tokens --table api_tokens --dry-run
```

**Effort:** 3-4 hours

---

## Missing Collections in PostgreSQL

The following Firestore collections were found in the codebase but have **no PostgreSQL tables:**

| Collection | Usage | Recommendation |
|------------|-------|----------------|
| `personalities` | Bot personality configs | ⚠️ Low priority - rarely changes |
| `sources` | Event source configs | ⚠️ Low priority - static data |
| `mutation_log` | State mutation audit trail | ⚠️ Consider retention policy |
| `tool_usage` | MCP tool usage tracking | ✅ **HIGH PRIORITY** - analytics data |
| `mcp_servers` | MCP server registry | ⚠️ Low priority - admin data |
| `stream_observers` | Stream analyst observers | ⚠️ Feature-specific |
| `summarization_runs` | Stream summarization | ⚠️ Feature-specific |
| `configs/routingRules/rules` | Router rules (nested) | ✅ Already mapped to `routing_rules` |

**Recommended Action:**
- Add `tool_usage` table to PostgreSQL (analytics tracking)
- Consider adding `personalities` and `sources` tables (low priority)

---

## Recommendations

### Immediate Actions (Sprint 343)

1. **Create `brat migrate tokens` command** (2-3 hours)
   - Integrate `migrate-tokens-simple.js` into CLI
   - Add dry-run and progress tracking
   - Support Twitch and Discord tokens

2. **Create `brat migrate api-tokens` command** (1-2 hours)
   - Migrate API gateway tokens from `gateways/api/tokens`
   - Support dry-run mode

3. **Add `tool_usage` table to PostgreSQL** (2-3 hours)
   - Create migration `005-add-tool-usage-table.sql`
   - Update migration CLI to support `tool_usage` collection

**Total Effort:** 5-8 hours

---

### Future Enhancements (Post-Sprint 343)

1. **Generic nested path support** (3-4 hours)
   - Add `--path` and `--table` flags to `brat migrate`
   - Support arbitrary Firestore paths

2. **Consolidate token migration tools** (1 hour)
   - Remove duplicate `migrate-tokens-to-postgres.ts`
   - Keep only `migrate-tokens-simple.js` as CLI integration

3. **Add validation checks** (2-3 hours)
   - Verify migrated data matches Firestore
   - Generate migration report with stats

**Total Effort:** 6-8 hours

---

## Migration Checklist for Production

Before migrating production to PostgreSQL, ensure:

- [ ] All 15 PostgreSQL tables exist (run `02-create-tables.sql`)
- [ ] Run `brat migrate tokens` to migrate OAuth tokens
- [ ] Run `brat migrate api-tokens` to migrate API tokens
- [ ] Run `brat migrate all` to migrate all collections
- [ ] Verify `tool_usage` data (if table added)
- [ ] Test application functionality with `PERSISTENCE_DRIVER=postgres`
- [ ] Monitor for missing data or errors
- [ ] Keep Firestore as fallback during transition period

---

## Summary

**Tables Added in Sprint 343:**
- ✅ `twitch_tokens` (migration tool exists but not integrated)
- ✅ `api_tokens` (no migration tool exists)

**Critical Gaps:**
1. No CLI support for OAuth token migration
2. No migration tool for API gateway tokens
3. No PostgreSQL table for `tool_usage` collection

**Recommended Work:**
- **Phase 1** (Immediate): Create `brat migrate tokens` and `brat migrate api-tokens` (3-5 hours)
- **Phase 2** (Future): Add `tool_usage` table and generic nested path support (5-8 hours)

**Risk Assessment:**
- 🔴 **HIGH RISK**: API tokens will be lost without migration tool
- 🟡 **MEDIUM RISK**: OAuth tokens migration is manual/error-prone
- 🟢 **LOW RISK**: All other collections supported by `brat migrate all`
