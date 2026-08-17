# IntegrationBit Lifecycle Verification

**Date**: 2026-08-13
**Sprint**: Sprint 12 (sprint-12-fxes5l)
**Status**: ✅ READY FOR STAGING VERIFICATION
**Service**: ingress-egress

---

## Overview

This document provides comprehensive verification procedures for the IntegrationBit lifecycle improvements implemented in Sprint 12. These changes fix critical race conditions and ensure proper connector startup sequencing.

---

## Problems Fixed

### 1. Connectors Never Started (HOTFIX Issue)

**Problem**: Connectors were registered but `connectorManager.start()` was NEVER called
**Impact**: No incoming messages from ANY platform in staging deployment
**Fix**: Added `onStartup()` hook to call `connectorManager.start()`

### 2. Async Initialization Race Conditions

**Problem**: Async methods called from constructor without awaiting
**Impact**:
- Connectors could start before registration complete
- Message bus subscriptions could be incomplete
- Timing-dependent failures

**Fix**: Track promises from async initialization, await all in startup hook

---

## Correct Lifecycle Sequence

### Phase 1: Constructor

```typescript
constructor(config: IntegrationBitConfig) {
  super(config);

  // 1. Store promises from async initialization (don't await)
  this.registrationPromise = this.registerConnectors();
  this.egressRoutingPromise = this.setupEgressRouting();

  // 2. Setup synchronous components
  this.setupWebhookRouting();
  this.setupStatusMonitoring();
  this.setupDebugEndpoints();

  // 3. Register startup hook (called later by bit.start())
  this.onStartup(async () => {
    // Wait for ALL async initialization
    await this.registrationPromise;
    await this.egressRoutingPromise;

    // THEN start connectors
    await this.connectorManager.start();
  });
}
```

**Log Messages** (Constructor Phase):
```
integration-bit.initialized (serviceName, instanceId, egressTopic, connectorCount)
integration-bit.registering-connectors (total)
integration-bit.connector-registering (connector: <name>)
connector.register (name: <name>)
integration-bit.connector-registered (connector: <name>, platform: <platform>)
integration-bit.connector-disabled (connector: <name>) [if disabled]
integration-bit.connectors-registered
integration-bit.webhook-routing-setup
integration-bit.egress-routing-setup [or egress-routing-skipped if test env]
integration-bit.status-monitoring-setup (intervalMs)
integration-bit.debug-endpoints-setup
```

### Phase 2: Startup Hook (bit.start())

```typescript
this.onStartup(async () => {
  // Wait for connector registration to complete
  await this.registrationPromise;

  // Wait for egress routing setup to complete
  await this.egressRoutingPromise;

  // NOW safe to start connectors
  await this.connectorManager.start();
});
```

**Log Messages** (Startup Phase):
```
integration-bit.awaiting-initialization
integration-bit.registration-complete
integration-bit.egress-routing-complete
integration-bit.starting-connectors
connector.started (for each connector)  ← CRITICAL NEW MESSAGE
integration-bit.connectors-started      ← CRITICAL NEW MESSAGE
```

### Phase 3: Running State

- Connectors actively receiving messages
- Status monitoring publishing connector state every 15 seconds
- Egress subscriptions processing outbound messages

**Log Messages** (Running State):
```
[connector-name].message.received (when messages arrive)
internal.ingress.v1 (event published)
integration-bit.connector-state-changed (if connector state changes)
```

### Phase 4: Shutdown (bit.close())

```typescript
async close(): Promise<void> {
  // Wait for any in-flight async initialization
  await this.registrationPromise?.catch(...);
  await this.egressRoutingPromise?.catch(...);

  // Clear status monitoring interval
  clearInterval(this.statusMonitorInterval);

  // Stop all connectors gracefully
  await this.connectorManager.stop();

  // Call parent close() for shutdown hooks
  await super.close();
}
```

**Log Messages** (Shutdown Phase):
```
integration-bit.closing
integration-bit.awaiting-registration-completion [if still initializing]
integration-bit.awaiting-egress-routing-completion [if still initializing]
integration-bit.status-monitor-cleared
integration-bit.stopping-connectors
connector.stopped (for each connector)
integration-bit.connectors-stopped
integration-bit.closed
```

---

## Verification Checklist

### Pre-Deployment Verification

- [x] ✅ Build succeeds (0 TypeScript errors)
- [x] ✅ Unit tests pass (integration-bit.test.ts)
- [x] ✅ Service tests pass (ingress-egress-service.test.ts)
- [x] ✅ Lifecycle fixes committed
- [ ] ⏳ Deploy to staging

### Staging Deployment Verification

#### 1. Deploy to Staging

```bash
# Build latest code
npm run build

# Deploy to staging
npm run brat -- deploy service ingress-egress --context staging
```

#### 2. Verify Startup Sequence

```bash
# Watch logs from last 5 minutes
npm run brat -- fleet logs ingress-egress --context staging --since 5m
```

**Required Log Messages** (in order):
1. ✅ `integration-bit.initialized`
2. ✅ `integration-bit.registering-connectors`
3. ✅ `integration-bit.connector-registered` (for each enabled connector)
4. ✅ `integration-bit.connectors-registered`
5. ✅ `integration-bit.webhook-routing-setup`
6. ✅ `integration-bit.egress-routing-setup`
7. ✅ `integration-bit.status-monitoring-setup`
8. ✅ `integration-bit.debug-endpoints-setup`
9. ✅ **`integration-bit.awaiting-initialization`** ← NEW
10. ✅ **`integration-bit.registration-complete`** ← NEW
11. ✅ **`integration-bit.egress-routing-complete`** ← NEW
12. ✅ **`integration-bit.starting-connectors`** ← NEW
13. ✅ **`connector.started`** (for each connector) ← NEW
14. ✅ **`integration-bit.connectors-started`** ← NEW

#### 3. Verify Connector State

```bash
# Check debug endpoint for connector status
curl -s https://staging.bitbrat.com/_debug/connectors | jq
```

**Expected Response**:
```json
{
  "connectors": {
    "twitch": {
      "platform": "twitch",
      "state": "CONNECTED",
      "started": true,  // ← CRITICAL: Must be true
      "counters": { ... }
    },
    "discord": {
      "platform": "discord",
      "state": "CONNECTED",
      "started": true,  // ← CRITICAL: Must be true
      "counters": { ... }
    }
  }
}
```

#### 4. Test Message Flow (Each Platform)

**Twitch**:
```bash
# Send test message in Twitch chat channel
# Monitor for incoming message
npm run brat -- fleet logs ingress-egress --context staging --since 1m | grep "twitch.message.received"
```

**Discord**:
```bash
# Send test message in Discord channel
# Monitor for incoming message
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

#### 5. Verify Egress Routing

```bash
# Send message that triggers bot response
# Verify response is delivered back to platform
npm run brat -- fleet logs ingress-egress --context staging --since 1m | grep "egress"
```

**Expected Log Messages**:
```
egress.message.received (correlationId, platform, channel)
egress.delivery.success (platform, channel)
```

#### 6. Monitor for 30+ Minutes

```bash
# Watch logs for errors or warnings
npm run brat -- fleet logs ingress-egress --context staging --level error --level warn --since 30m
```

**Red Flags**:
- ❌ `integration-bit.startup-failed`
- ❌ `connector.start-failed`
- ❌ Missing `connector.started` messages
- ❌ `started: false` in connector snapshots
- ❌ No incoming messages from any platform

**Green Lights**:
- ✅ All `connector.started` messages present
- ✅ `started: true` in all connector snapshots
- ✅ Incoming messages from all platforms
- ✅ Successful egress delivery
- ✅ No errors or warnings

---

## Edge Cases to Test

### 1. Restart During Initialization

```bash
# Start service, then immediately restart
docker restart ingress-egress

# Verify graceful handling
npm run brat -- fleet logs ingress-egress --context staging --since 2m
```

**Expected Behavior**:
- `integration-bit.awaiting-registration-completion` (if shutdown during init)
- `integration-bit.awaiting-egress-routing-completion` (if shutdown during init)
- Graceful restart without errors

### 2. Connector Failure During Startup

**Simulate**: Temporarily break Discord credentials

```bash
# Deploy with invalid Discord token
# Verify fail-open strategy
npm run brat -- fleet logs ingress-egress --context staging --since 2m
```

**Expected Behavior**:
- `connector.start-failed` (for Discord)
- `integration-bit.connectors-started` (still completes)
- Other connectors (Twitch, etc.) still start successfully

### 3. Graceful Shutdown

```bash
# Send SIGTERM to service
docker stop ingress-egress --time 30

# Verify graceful shutdown
npm run brat -- fleet logs ingress-egress --context staging --since 2m
```

**Expected Behavior**:
- `integration-bit.closing`
- `integration-bit.status-monitor-cleared`
- `integration-bit.stopping-connectors`
- `connector.stopped` (for each connector)
- `integration-bit.connectors-stopped`
- `integration-bit.closed`

---

## Comparison: Before vs After

### Before Fix

**Constructor**:
```typescript
// Fire-and-forget async calls (race conditions)
this.registerConnectors();  // No await
this.setupEgressRouting();  // No await
```

**Startup Hook**:
```typescript
// MISSING - connectorManager.start() never called
```

**Shutdown**:
```typescript
// Immediate stop without waiting for in-flight init
await this.connectorManager.stop();
```

**Logs** (Before):
```
integration-bit.initialized
integration-bit.registering-connectors
integration-bit.connectors-registered
# ❌ NO connector.started messages
# ❌ Connectors never actually started
```

### After Fix

**Constructor**:
```typescript
// Track promises for async initialization
this.registrationPromise = this.registerConnectors();
this.egressRoutingPromise = this.setupEgressRouting();

// Register startup hook
this.onStartup(async () => {
  await this.registrationPromise;
  await this.egressRoutingPromise;
  await this.connectorManager.start();  // ← NOW CALLED
});
```

**Shutdown**:
```typescript
// Wait for in-flight initialization before stopping
await this.registrationPromise?.catch(...);
await this.egressRoutingPromise?.catch(...);
await this.connectorManager.stop();
```

**Logs** (After):
```
integration-bit.initialized
integration-bit.registering-connectors
integration-bit.connectors-registered
integration-bit.awaiting-initialization  ← NEW
integration-bit.registration-complete    ← NEW
integration-bit.egress-routing-complete  ← NEW
integration-bit.starting-connectors      ← NEW
connector.started (for each connector)   ← NEW
integration-bit.connectors-started       ← NEW
```

---

## Success Criteria

### ✅ Deployment Success

- [ ] Build succeeds (0 TypeScript errors)
- [ ] Unit tests pass (28/28 for integration-bit.test.ts)
- [ ] Service tests pass (6/6 for ingress-egress-service.test.ts)
- [ ] Deploy to staging succeeds
- [ ] Service starts without errors

### ✅ Lifecycle Correctness

- [ ] All expected log messages appear in correct order
- [ ] `connector.started` messages appear for ALL enabled connectors
- [ ] `started: true` in all connector snapshots
- [ ] No race condition warnings or errors

### ✅ Functional Correctness

- [ ] Incoming messages received from ALL platforms (Twitch, Discord, Slack, Twilio)
- [ ] Messages published to `internal.ingress.v1`
- [ ] Egress routing works (responses delivered back to platforms)
- [ ] Debug endpoints return correct connector state

### ✅ Stability

- [ ] No errors or warnings during 30+ minute monitoring period
- [ ] Graceful restart works correctly
- [ ] Graceful shutdown works correctly
- [ ] Fail-open strategy works (connector failures don't crash service)

---

## Rollback Plan

If verification fails in staging:

1. **Identify Root Cause**:
   ```bash
   npm run brat -- fleet logs ingress-egress --context staging --level error --since 10m
   ```

2. **Revert to Previous Version**:
   ```bash
   git revert HEAD  # Revert lifecycle fixes
   npm run build
   npm run brat -- deploy service ingress-egress --context staging
   ```

3. **Document Issue**:
   - Add findings to `lifecycle-verification.md`
   - Create new issue in planning/sprint-12-fxes5l/

---

## Next Steps

1. ✅ Code implemented and committed
2. ✅ Build verified (0 TypeScript errors)
3. ✅ Tests verified (28/28 + 6/6 passing)
4. ⏳ Deploy to staging
5. ⏳ Verify startup sequence (log messages)
6. ⏳ Verify connector state (debug endpoints)
7. ⏳ Test message flow (all platforms)
8. ⏳ Monitor for 30+ minutes
9. ⏳ Deploy to production (after staging verification)
10. ⏳ Update HOTFIX document with verification results

---

## Related Files

- `src/common/integration-bit.ts` - Lifecycle implementation
- `src/services/ingress/core/connector-manager.ts` - Connector lifecycle
- `planning/sprint-12-fxes5l/HOTFIX-connectors-not-starting.md` - Original issue
- `planning/sprint-12-fxes5l/test-cleanup-summary.md` - Test cleanup

---

## Sign-Off

**Implemented By**: Claude
**Reviewed By**: TBD
**Verified in Staging**: TBD
**Approved for Production**: TBD
