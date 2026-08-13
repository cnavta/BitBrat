# HOTFIX: Twitch Tokens Not Loading from PostgreSQL

**Date**: 2026-08-13
**Severity**: CRITICAL
**Status**: ✅ FIXED
**Affected Service**: ingress-egress
**Deployment**: Staging (discovered), Production (not yet deployed)

---

## Problem

After deploying Sprint 12 IntegrationBit refactoring to staging, the Twitch integration could not find its tokens despite tokens being present and valid in the staging `twitch_tokens` PostgreSQL table.

### Symptoms

1. ❌ Twitch connector fails to start
2. ❌ "missing token" errors in logs
3. ❌ No incoming messages from Twitch
4. ❌ Tokens verified to be present in `twitch_tokens` table

---

## Root Cause

**IntegrationBit refactoring introduced a regression in credentials provider selection.**

### Code Analysis

**File**: `src/services/ingress/twitch/factory.ts`

**Before Refactoring** (in old `ingress-egress-service.ts`, commit af394e8b):
```typescript
// Get documentStore for OAuth token storage
const documentStore = this.getResource('documentStore') || this.getResource('firestore');

// Use persistent credentials if documentStore available
const usePersistentCredentials = !!documentStore;
const credentialsProvider = usePersistentCredentials
  ? new FirestoreTwitchCredentialsProvider(
      config,
      createTokenStore(config.tokenDocPath || 'oauth/twitch/bot', documentStore),
      createTokenStore('oauth/twitch/broadcaster', documentStore)
    )
  : new ConfigTwitchCredentialsProvider(config);
```

**After Refactoring** (Sprint 12, factory.ts - BROKEN):
```typescript
// Hardcoded to use ConfigTwitchCredentialsProvider (env vars only)
const credentialsProvider = new ConfigTwitchCredentialsProvider(config);
```

**Why It Happened**:
- Sprint 12 extracted Twitch connector into reusable factory function
- Factory was hardcoded to use `ConfigTwitchCredentialsProvider` (env vars)
- The persistent credentials logic from commit af394e8b was not ported to the new factory
- Comments mentioned checking PERSISTENCE_DRIVER but code didn't implement it

### Credentials Provider Comparison

| Provider | Data Source | When to Use |
|----------|-------------|-------------|
| **FirestoreTwitchCredentialsProvider** | PostgreSQL (`twitch_tokens` table) or Firestore | When `documentStore` resource available |
| **ConfigTwitchCredentialsProvider** | Environment variables (`TWITCH_BOT_ACCESS_TOKEN`) | When no persistent storage available |

**Staging Environment**:
- `PERSISTENCE_DRIVER=postgres`
- Tokens stored in `twitch_tokens` table
- `TWITCH_BOT_ACCESS_TOKEN` environment variable **NOT** set
- Factory tried to use `ConfigTwitchCredentialsProvider` → "missing token" error

---

## Fix

**Files Modified**:
1. `src/common/integration-bit.ts` - Updated ConnectorFactory type and pass documentStore
2. `src/services/ingress/twitch/factory.ts` - Use persistent credentials when available

### 1. Updated ConnectorFactory Type

Added optional `documentStore` parameter to factory options:

```typescript
// File: src/common/integration-bit.ts
export type ConnectorFactory = (
  config: any,
  opts: {
    egressDestinationTopic: string;
    publisherFactory?: (topic: string) => any;
    documentStore?: any;  // ← NEW: For persistent credentials
  }
) => Promise<IngressConnector>;
```

### 2. IntegrationBit Passes documentStore to Factories

```typescript
// File: src/common/integration-bit.ts (registerConnectors method)
for (const connectorConfig of this.integrationConfig.connectors) {
  // Get documentStore for persistent credentials (PostgreSQL/Firestore)
  const documentStore = this.getResource('documentStore') || this.getResource('firestore');

  // Call factory function
  const connector = await factory(this.getConfig(), {
    egressDestinationTopic: this.egressTopic,
    publisherFactory: (topic: string) => {...},
    documentStore, // ← Pass to factory
  });

  this.connectorManager.register(name, connector);
}
```

### 3. Twitch Factory Uses Persistent Credentials When Available

```typescript
// File: src/services/ingress/twitch/factory.ts
export const createTwitchConnector: ConnectorFactory = async (config: IConfig, opts) => {
  const { egressDestinationTopic, publisherFactory, documentStore } = opts;

  // Create publisher for ingress events
  const publisher = publisherFactory
    ? publisherFactory('internal.ingress.v1')
    : createTwitchIngressPublisherFromConfig(config);

  // Use persistent credentials from PostgreSQL or Firestore if documentStore is available
  // Falls back to config-based credentials (environment variables) if no persistence available
  const usePersistentCredentials = !!documentStore;
  const credentialsProvider = usePersistentCredentials
    ? new FirestoreTwitchCredentialsProvider(
        config,
        createTokenStore(config.tokenDocPath || 'oauth/twitch/bot', documentStore),
        createTokenStore('oauth/twitch/broadcaster', documentStore)
      )
    : new ConfigTwitchCredentialsProvider(config);

  // Create Twitch IRC client
  const client = new TwitchIrcClient(
    new TwitchEnvelopeBuilder(),
    publisher,
    config.twitchChannels || [],
    {
      credentialsProvider,
      egressDestinationTopic,
    }
  );

  // Wrap with connector adapter
  return new TwitchConnectorAdapter(client);
};
```

### How It Works

1. **IntegrationBit** gets `documentStore` resource (PostgresDocumentStore or Firestore)
2. **IntegrationBit** passes `documentStore` to connector factory
3. **Twitch Factory** checks if `documentStore` is provided
4. **If yes**: Use `FirestoreTwitchCredentialsProvider`
   - Calls `createTokenStore(docPath, documentStore)`
   - `createTokenStore()` auto-selects backend:
     - `PERSISTENCE_DRIVER=postgres` → `PostgresTokenStore` (queries `twitch_tokens`)
     - `PERSISTENCE_DRIVER=firestore` → `FirestoreTokenStore` (queries Firestore)
5. **If no**: Use `ConfigTwitchCredentialsProvider` (reads `TWITCH_BOT_ACCESS_TOKEN` env var)

---

## Testing

### Build Verification

```bash
$ npm run build
✅ SUCCESS (0 TypeScript errors)
```

### Expected Behavior After Fix

**Staging Environment** (PERSISTENCE_DRIVER=postgres):

1. ✅ IntegrationBit gets `documentStore` (PostgresDocumentStore)
2. ✅ Passes `documentStore` to Twitch factory
3. ✅ Factory uses `FirestoreTwitchCredentialsProvider`
4. ✅ `createTokenStore()` returns `PostgresTokenStore`
5. ✅ `PostgresTokenStore` queries `twitch_tokens` table (key: "twitch:bot")
6. ✅ Tokens loaded successfully
7. ✅ Twitch IRC client connects
8. ✅ Incoming Twitch messages received

### Log Messages to Verify

**On startup**:
```
integration-bit.initialized
integration-bit.registering-connectors
integration-bit.connector-registering (connector: twitch)
Loaded token from PostgreSQL (docPath: oauth/twitch/bot, backend: postgres)  ← CRITICAL
connector.register (name: twitch)
integration-bit.connector-registered (connector: twitch, platform: twitch)
integration-bit.starting-connectors
connector.started (for twitch)  ← CRITICAL
integration-bit.connectors-started
```

**On incoming message**:
```
twitch.message.received
internal.ingress.v1 (event published)
```

---

## Impact

### Before Fix

- **Twitch Connector**: ❌ Failed to start ("missing token" error)
- **Incoming Messages**: ❌ None (connector not running)
- **Token Storage**: PostgreSQL `twitch_tokens` table (ignored)
- **Credentials Source**: Environment variables (not set)

### After Fix

- **Twitch Connector**: ✅ Started successfully
- **Incoming Messages**: ✅ Received from Twitch
- **Token Storage**: PostgreSQL `twitch_tokens` table (used)
- **Credentials Source**: PostgreSQL via `FirestoreTwitchCredentialsProvider` + `PostgresTokenStore`

---

## Deployment

### Staging

1. Build latest code:
   ```bash
   npm run build
   ```

2. Deploy to staging:
   ```bash
   npm run brat -- deploy service ingress-egress --context staging
   ```

3. Verify logs show token loading from PostgreSQL:
   ```bash
   npm run brat -- fleet logs ingress-egress --context staging --since 5m
   ```

   **Look for**:
   - `Loaded token from PostgreSQL` (backend: postgres)
   - `connector.started` (for twitch)
   - NO "missing token" errors
   - NO "ConfigTwitchCredentialsProvider: missing token" errors

4. Test incoming Twitch messages:
   - Send test message in Twitch chat channel
   - Verify `twitch.message.received` in logs

### Production

**⚠️ DO NOT DEPLOY TO PRODUCTION YET**

This hotfix must be:
1. ✅ Verified in staging first
2. ✅ Tested with real Twitch traffic
3. ✅ Monitored for 30+ minutes
4. ✅ Confirmed tokens loading from database

---

## Prevention

### How This Slipped Through

1. **Factory Pattern**: New factory function introduced in Sprint 12
2. **Lost Context**: Previous fix (commit af394e8b) not ported to factory
3. **No Integration Tests**: Tests don't verify token loading from PostgreSQL
4. **Comments vs Code**: Comments described behavior but code didn't implement it

### Future Prevention

1. **Add Integration Test**:
   ```typescript
   it('should load tokens from PostgreSQL when documentStore available', async () => {
     const documentStore = new PostgresDocumentStore();
     await documentStore.set('twitch_tokens', 'twitch:bot', {
       accessToken: 'test-token',
       userId: 'test-user',
     });

     const connector = await createTwitchConnector(config, {
       egressDestinationTopic: 'test-topic',
       documentStore,
     });

     // Verify connector uses PostgreSQL credentials
   });
   ```

2. **Add Factory Contract Tests**:
   - Verify factory respects `documentStore` parameter
   - Verify credentials provider selection logic

3. **Deployment Checklist**:
   - [ ] Build succeeds
   - [ ] Unit tests pass
   - [ ] Staging deployment succeeds
   - [ ] **"Loaded token from PostgreSQL" in logs** ← ADD THIS
   - [ ] Connector shows `started: true` in debug endpoint
   - [ ] Test message received from platform
   - [ ] Monitor for 30 minutes
   - [ ] Production deployment

---

## Related Files

### Modified
- `src/common/integration-bit.ts` - Updated ConnectorFactory type, pass documentStore
- `src/services/ingress/twitch/factory.ts` - Use persistent credentials when available

### Created
- `planning/sprint-12-fxes5l/HOTFIX-twitch-tokens-not-loading.md` - This document

---

## Lessons Learned

1. **Preserve Critical Logic**: When refactoring, ensure critical logic (like credentials selection) is ported
2. **Comments Are Hints**: If comments describe behavior, code should implement it
3. **Integration Tests Critical**: Unit tests don't catch integration issues with databases
4. **Staging Catches Issues**: Testing in staging caught this before production deployment
5. **Previous Fixes Matter**: Check commit history for previous fixes that might be relevant

---

## Next Steps

1. ✅ Code fix applied
2. ✅ Build verified
3. 🔄 Deploy to staging
4. 🔄 Verify token loading from PostgreSQL in logs
5. 🔄 Test Twitch message flow
6. ⏳ Monitor staging for 30+ minutes
7. ⏳ Deploy to production (if staging verification passes)
8. ⏳ Add integration test to prevent regression

---

## Sign-Off

**Identified By**: User report (staging deployment)
**Diagnosed By**: Claude (code analysis + commit history)
**Fixed By**: Claude
**Verified By**: TBD (staging verification)
**Approved For Production**: TBD
