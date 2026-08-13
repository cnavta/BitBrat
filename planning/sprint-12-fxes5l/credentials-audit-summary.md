# Integration Credentials Audit Summary

**Date**: 2026-08-13
**Sprint**: Sprint 12 (sprint-12-fxes5l)
**Objective**: Verify all integrations are loading credentials correctly after IntegrationBit refactoring

---

## Executive Summary

Audited all four platform integrations (Twitch, Discord, Slack, Twilio) to ensure they load credentials correctly in staging environment with `PERSISTENCE_DRIVER=postgres`.

### Findings

| Integration | Credentials Source | Credentials Status | Publisher Status | Overall Status |
|-------------|-------------------|-------------------|------------------|----------------|
| **Twitch** | PostgreSQL (`twitch_tokens` table) | ✅ FIXED | ✅ FIXED | ✅ READY |
| **Discord** | PostgreSQL (`auth_scopes` table) | ✅ FIXED (consistent) | ✅ FIXED | ✅ READY |
| **Slack** | Environment variables (bot tokens) | ✅ OK (no change) | ✅ FIXED | ✅ READY |
| **Twilio** | Environment variables (API keys) | ✅ OK (no change) | ✅ FIXED | ✅ READY |

### Actions Taken

#### Credentials Fixes
1. **Twitch**: CRITICAL FIX - Restored persistent credentials via `documentStore` parameter
2. **Discord**: Consistency fix - Updated to use `documentStore` parameter for shared backend instance
3. **Slack**: No change needed (uses config-based credentials)
4. **Twilio**: No change needed (uses config-based credentials)

#### Publisher Interface Fixes (CRITICAL - Staging Deployment Issue)
After deploying credentials fixes to staging, discovered critical publisher interface mismatch:

**Problem**: Factories were calling `publisherFactory('internal.ingress.v1')` directly, which returns `MessagePublisher` with `publishJson()` method. But clients expected `IngressPublisher` interface with `publish()` method.

**Error in Staging**:
```
TypeError: this.publisher.publish is not a function
```

**Solution**: Updated all factories to use platform-specific publisher wrappers:

1. **Discord**: Changed to use `createDiscordIngressPublisherFromConfig(config, publisherFactory)`
2. **Slack**: Created new `SlackIngressPublisher` wrapper class + updated factory
3. **Twilio**: Changed to use `createTwilioIngressPublisherFromConfig(config, publisherFactory)`
4. **Twitch**: Changed to use `createTwitchIngressPublisherFromConfig(config, publisherFactory)`

**Pattern**: All factories now follow consistent pattern:
```typescript
// BEFORE (BROKEN):
const publisher = publisherFactory ? publisherFactory('internal.ingress.v1') : fallback;

// AFTER (FIXED):
const publisher = createPlatformIngressPublisherFromConfig(config, publisherFactory);
```

The wrapper classes implement `IngressPublisher` interface and internally wrap `MessagePublisher`.

---

## Integration-by-Integration Analysis

### 1. Twitch (CRITICAL FIX)

**Credentials Type**: OAuth2 with refresh tokens (stored in database)

**Storage**:
- **Table**: `twitch_tokens`
- **Key Format**: `twitch:bot`, `twitch:broadcaster`
- **Backend**: PostgreSQL when `PERSISTENCE_DRIVER=postgres`, Firestore when `PERSISTENCE_DRIVER=firestore`

**Problem Found**:
```typescript
// Before (BROKEN):
const credentialsProvider = new ConfigTwitchCredentialsProvider(config);
```
- Factory hardcoded to use `ConfigTwitchCredentialsProvider` (environment variables)
- Ignored tokens in `twitch_tokens` table
- Staging has `PERSISTENCE_DRIVER=postgres` but no `TWITCH_BOT_ACCESS_TOKEN` env var
- Result: "missing token" errors, connector fails to start

**Solution Applied**:
```typescript
// After (FIXED):
const usePersistentCredentials = !!documentStore;
const credentialsProvider = usePersistentCredentials
  ? new FirestoreTwitchCredentialsProvider(
      config,
      createTokenStore(config.tokenDocPath || 'oauth/twitch/bot', documentStore),
      createTokenStore('oauth/twitch/broadcaster', documentStore)
    )
  : new ConfigTwitchCredentialsProvider(config);
```

**Credentials Flow (After Fix)**:
```
IntegrationBit → documentStore (PostgresDocumentStore)
  ↓
Twitch Factory → FirestoreTwitchCredentialsProvider
  ↓
createTokenStore(docPath, documentStore) → PostgresTokenStore
  ↓
PostgreSQL query: SELECT * FROM twitch_tokens WHERE id = 'twitch:bot'
  ↓
Tokens loaded ✅
```

**Files Modified**:
- `src/common/integration-bit.ts` - Updated ConnectorFactory type, pass documentStore
- `src/services/ingress/twitch/factory.ts` - Use persistent credentials when available

**Related**: `HOTFIX-twitch-tokens-not-loading.md`

---

### 2. Discord (Consistency Fix)

**Credentials Type**: OAuth2 with refresh tokens (stored in database)

**Storage**:
- **Table**: `auth_scopes`
- **Key Format**: `discord:bot`, `discord:broadcaster`
- **Backend**: PostgreSQL when `PERSISTENCE_DRIVER=postgres`, Firestore when `PERSISTENCE_DRIVER=firestore`

**Issue Found**:
```typescript
// Before (WORKS but inconsistent):
const tokenStore = createAuthTokenStore();
```
- Factory called `createAuthTokenStore()` with NO parameters
- `createAuthTokenStore()` auto-detects `PERSISTENCE_DRIVER` and creates its own DocumentStore
- Works correctly but creates separate DocumentStore instance
- Inconsistent with Twitch pattern

**Solution Applied**:
```typescript
// After (Consistent):
const tokenStore = createAuthTokenStore(documentStore);
```

**Benefits**:
1. **Consistency**: Same pattern as Twitch
2. **Efficiency**: Reuses service's DocumentStore instance instead of creating new one
3. **Correctness**: Guaranteed to use same persistence backend as service

**Credentials Flow (After Fix)**:
```
IntegrationBit → documentStore (PostgresDocumentStore)
  ↓
Discord Factory → createAuthTokenStore(documentStore)
  ↓
DocumentStoreAuthTokenStore (reuses same PostgreSQL connection pool)
  ↓
PostgreSQL query: SELECT * FROM auth_scopes WHERE id = 'discord:bot'
  ↓
Tokens loaded ✅
```

**Files Modified**:
- `src/services/ingress/discord/factory.ts` - Pass documentStore to createAuthTokenStore()

---

### 3. Slack (No Change Needed)

**Credentials Type**: Long-lived bot tokens (not OAuth2)

**Storage**: Environment variables (not in database)

**Credentials Used**:
- `SLACK_APP_TOKEN` (App-Level Token, starts with `xapp-`)
- `SLACK_BOT_TOKEN` (Bot User OAuth Token, starts with `xoxb-`)

**Factory Implementation**:
```typescript
const slackAppToken = config.slackAppToken;
const slackBotToken = config.slackBotToken;

if (!slackAppToken) {
  throw new Error('Missing required config: slackAppToken');
}
if (!slackBotToken) {
  throw new Error('Missing required config: slackBotToken');
}
```

**Why No Change Needed**:
- Slack doesn't use OAuth2 with refresh tokens
- Uses long-lived bot tokens that don't expire
- Tokens stored in environment variables (not database)
- Factory correctly validates and uses config-based credentials

**Credentials Flow**:
```
Environment Variables (SLACK_APP_TOKEN, SLACK_BOT_TOKEN)
  ↓
IConfig object
  ↓
Slack Factory (validates tokens exist)
  ↓
SlackIngressClient (uses tokens directly)
```

**Files**: No changes needed

---

### 4. Twilio (No Change Needed)

**Credentials Type**: API keys (not OAuth2)

**Storage**: Environment variables (not in database)

**Credentials Used**:
- `TWILIO_ACCOUNT_SID` (Account SID)
- `TWILIO_API_KEY` (API Key)
- `TWILIO_API_SECRET` (API Secret)
- `TWILIO_CHAT_SERVICE_SID` (Chat Service SID)
- `TWILIO_AUTH_TOKEN` (Auth Token for webhook signature verification)

**Factory Implementation**:
```typescript
const tokenProvider = new TwilioTokenProvider(config);
```

**TwilioTokenProvider validates config**:
```typescript
if (!twilioAccountSid || !twilioApiKey || !twilioApiSecret || !twilioChatServiceSid) {
  throw new Error('Missing Twilio configuration for token generation');
}
```

**Why No Change Needed**:
- Twilio doesn't use OAuth2 with refresh tokens
- Uses API keys that don't expire
- Keys stored in environment variables (not database)
- Factory correctly validates and uses config-based credentials

**Credentials Flow**:
```
Environment Variables (TWILIO_ACCOUNT_SID, TWILIO_API_KEY, etc.)
  ↓
IConfig object
  ↓
TwilioTokenProvider (validates credentials exist)
  ↓
TwilioIngressClient (generates JWT tokens for conversations)
```

**Files**: No changes needed

---

## Persistence Backends Comparison

### OAuth2 Integrations (Twitch, Discord)

These integrations use OAuth2 with refresh tokens that must be stored in a database.

| Integration | Table Name | Key Format | Credentials Provider |
|-------------|-----------|------------|---------------------|
| Twitch | `twitch_tokens` | `twitch:bot` | FirestoreTwitchCredentialsProvider |
| Discord | `auth_scopes` | `discord:bot` | DocumentStoreAuthTokenStore |

**Backend Selection** (both use same logic):
```typescript
// If documentStore provided (RECOMMENDED):
const tokenStore = createTokenStore(docPath, documentStore);
// OR
const tokenStore = createAuthTokenStore(documentStore);

// Auto-selects:
// - PostgresTokenStore when documentStore is PostgresDocumentStore
// - FirestoreTokenStore when documentStore is Firestore instance
```

### Non-OAuth Integrations (Slack, Twilio)

These integrations use long-lived credentials that don't need database storage.

| Integration | Credentials Type | Storage | Provider |
|-------------|-----------------|---------|----------|
| Slack | Bot tokens | Environment variables | Direct from config |
| Twilio | API keys | Environment variables | TwilioTokenProvider |

---

## Testing Checklist

### Staging Verification

After deploying fixes to staging:

#### 1. Verify Twitch Token Loading

```bash
# Deploy to staging
npm run brat -- deploy service ingress-egress --context staging

# Check logs for PostgreSQL token loading
npm run brat -- fleet logs ingress-egress --context staging --since 5m | grep -i "token"

# Expected:
# ✅ "Loaded token from PostgreSQL" (backend: postgres, docPath: oauth/twitch/bot)
# ❌ NO "ConfigTwitchCredentialsProvider: missing token"
```

#### 2. Verify Discord Token Loading

```bash
# Check logs for Discord auth token loading
npm run brat -- fleet logs ingress-egress --context staging --since 5m | grep -i "discord"

# Expected:
# ✅ Discord client initializes successfully
# ✅ No "missing token" errors
```

#### 3. Verify Connector States

```bash
# Check connector debug endpoint
curl -s https://staging.bitbrat.com/_debug/connectors | jq

# Expected:
# {
#   "connectors": {
#     "twitch": { "started": true, "state": "CONNECTED" },
#     "discord": { "started": true, "state": "CONNECTED" },
#     "slack": { "started": true, "state": "CONNECTED" },  # if enabled
#     "twilio": { "started": true, "state": "CONNECTED" }  # if enabled
#   }
# }
```

#### 4. Test Message Flow (Each Platform)

**Twitch**:
```bash
# Send test message in Twitch chat
# Monitor logs
npm run brat -- fleet logs ingress-egress --context staging --since 1m | grep "twitch.message.received"
```

**Discord**:
```bash
# Send test message in Discord channel
# Monitor logs
npm run brat -- fleet logs ingress-egress --context staging --since 1m | grep "discord.message.received"
```

**Slack** (if enabled):
```bash
# Send test message in Slack channel
npm run brat -- fleet logs ingress-egress --context staging --since 1m | grep "slack.message.received"
```

**Twilio** (if enabled):
```bash
# Send test SMS
npm run brat -- fleet logs ingress-egress --context staging --since 1m | grep "twilio.message.received"
```

---

## Credentials Provider Decision Tree

```
┌─────────────────────────────────────┐
│ Integration needs credentials?      │
└──────────┬──────────────────────────┘
           │
           ├─ OAuth2 with refresh tokens? ─→ YES ─→ Use persistent storage
           │                                         │
           │                                         ├─ Twitch → FirestoreTwitchCredentialsProvider
           │                                         │            + createTokenStore(docPath, documentStore)
           │                                         │
           │                                         └─ Discord → createAuthTokenStore(documentStore)
           │
           └─ API keys / bot tokens? ─→ YES ─→ Use config-based credentials
                                                │
                                                ├─ Slack → config.slackAppToken, config.slackBotToken
                                                │
                                                └─ Twilio → TwilioTokenProvider(config)
```

---

## Summary of Changes

### Files Modified (Credentials Fixes)

1. **src/common/integration-bit.ts**
   - Updated `ConnectorFactory` type to accept optional `documentStore` parameter
   - Pass `documentStore` to all connector factories in `registerConnectors()`

2. **src/services/ingress/twitch/factory.ts**
   - Import `createTokenStore`
   - Use `FirestoreTwitchCredentialsProvider` when `documentStore` is available
   - Fall back to `ConfigTwitchCredentialsProvider` when not available

3. **src/services/ingress/discord/factory.ts**
   - Pass `documentStore` to `createAuthTokenStore()` for consistency
   - Updated documentation

### Files Modified (Publisher Interface Fixes)

1. **src/services/ingress/discord/factory.ts**
   - Changed from `publisherFactory('internal.ingress.v1')` to `createDiscordIngressPublisherFromConfig(config, publisherFactory)`
   - Added comment explaining wrapper pattern

2. **src/services/ingress/slack/factory.ts**
   - Changed from `publisherFactory('internal.ingress.v1')` to `createSlackIngressPublisherFromConfig(config, publisherFactory)`
   - Removed 19 lines of manual publisher fallback code
   - Added comment explaining wrapper pattern

3. **src/services/ingress/slack/publisher.ts** (NEW FILE CREATED)
   - Created `SlackIngressPublisher` class implementing `IngressPublisher` interface
   - Wraps `MessagePublisher` with `publish()` method that calls `publishJson()`
   - Created `createSlackIngressPublisherFromConfig()` helper function
   - 37 lines total

4. **src/services/ingress/twilio/factory.ts**
   - Changed from `publisherFactory('internal.ingress.v1')` to `createTwilioIngressPublisherFromConfig(config, publisherFactory)`
   - Added comment explaining wrapper pattern

5. **src/services/ingress/twitch/factory.ts**
   - Changed from `publisherFactory('internal.ingress.v1')` to `createTwitchIngressPublisherFromConfig(config, publisherFactory)`
   - Added comment explaining wrapper pattern

### Files Audited (No Credentials Changes Needed)

1. **src/services/ingress/slack/factory.ts**
   - Uses config-based credentials (correct)
   - No database storage needed
   - BUT: Required publisher wrapper fix (see above)

2. **src/services/ingress/twilio/factory.ts**
   - Uses config-based credentials (correct)
   - No database storage needed
   - BUT: Required publisher wrapper fix (see above)

---

## Deployment Plan

1. ✅ Code fixes applied (credentials + publisher interface)
2. ✅ Build verified (0 TypeScript errors)
3. ⏳ **READY FOR STAGING** - Deploy to staging
4. ⏳ Verify Twitch tokens loaded from PostgreSQL (critical)
5. ⏳ Verify Discord tokens loaded from PostgreSQL
6. ⏳ Test message flow from all platforms (Twitch, Discord, Slack, Twilio)
7. ⏳ Monitor staging for 30+ minutes
8. ⏳ Deploy to production (if staging verification passes)

### Deployment Command

```bash
# Build
npm run build

# Deploy to staging
npm run brat -- deploy service ingress-egress --context staging

# Monitor logs
npm run brat -- fleet logs ingress-egress --context staging --since 5m
```

### Critical Log Messages to Verify

**Twitch Credentials (MOST CRITICAL)**:
```
✅ "Loaded token from PostgreSQL" (backend: postgres, docPath: oauth/twitch/bot)
❌ NO "ConfigTwitchCredentialsProvider: missing token"
✅ "connector.started" (for twitch)
```

**Discord Credentials**:
```
✅ Discord client initializes successfully
❌ NO "missing token" errors
✅ "connector.started" (for discord)
```

**Publisher Interface (ALL PLATFORMS)**:
```
❌ NO "TypeError: this.publisher.publish is not a function"
✅ "twitch.message.received" (when Twitch message sent)
✅ "discord.message.received" (when Discord message sent)
✅ "slack.message.received" (when Slack message sent, if enabled)
✅ "twilio.message.received" (when Twilio message sent, if enabled)
```

---

## Related Documentation

- `HOTFIX-twitch-tokens-not-loading.md` - Detailed Twitch credentials fix
- `lifecycle-verification.md` - Complete lifecycle verification checklist
- `HOTFIX-connectors-not-starting.md` - Original connector startup issue

---

## Sign-Off

**Audited By**: Claude
**Findings**: 1 critical issue (Twitch), 1 consistency improvement (Discord), 2 verified correct (Slack, Twilio)
**Verified By**: TBD (staging verification)
**Approved For Production**: TBD
