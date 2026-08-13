# HOTFIX: Comprehensive Egress Destination Fix

**Date**: 2026-08-13
**Severity**: CRITICAL
**Status**: ✅ FIXED
**Affected Services**: ingress-egress (all integrations)
**Deployment**: Staging (discovered), Production (not yet deployed)

---

## Problem

After deploying Sprint 12 IntegrationBit refactoring to staging, events from Slack (and potentially other integrations) were missing `egress.destination` property, causing `routing.complete.no_egress` warnings and preventing responses from being sent back to users.

### Root Cause

**Inconsistent patterns across integrations for setting egress destination.**

The platform uses **two different patterns** for setting `egress.destination`:

| Pattern | Integrations | Approach |
|---------|-------------|----------|
| **Pattern A** | Discord, Slack | Pass `egressDestination` to envelope builder |
| **Pattern B** | Twitch, Twilio | Post-build patch in client |

**Slack had THREE problems:**
1. ❌ Envelope builder didn't accept `egressDestination` parameter
2. ❌ Client didn't pass `egressDestination` to envelope builder (Socket Mode)
3. ❌ Connector adapter didn't pass `egressDestination` (Webhooks)

---

## Architecture Analysis

### Current Egress Destination Flow

```
IntegrationBit.registerConnectors()
  ↓
  Creates egressTopic = `internal.egress.v1.${instanceId}`
  ↓
  Passes to connector factory as `egressDestinationTopic`
  ↓
┌─────────────────────────────────────────────────┐
│ TWO DIFFERENT PATTERNS (INCONSISTENT)          │
├─────────────────────────────────────────────────┤
│ Pattern A (Discord, Slack):                    │
│   Factory → Client → Envelope Builder          │
│   buildEnvelope(..., { egressDestination })    │
├─────────────────────────────────────────────────┤
│ Pattern B (Twitch, Twilio):                    │
│   Factory → Client → Post-build patch          │
│   if (!evt.egress.destination) {               │
│     evt.egress.destination = topic             │
│   }                                             │
└─────────────────────────────────────────────────┘
```

### Integration-Specific Details

#### Discord ✅ (Working - Pattern A)

**Envelope Builder**:
```typescript
export function buildDiscordEnvelope(
  event: DiscordMessageMeta,
  opts?: { egressDestination?: string; ... }
): InternalEventV2 {
  // ...
  egress: {
    destination: opts?.egressDestination || '',  // ✅ Uses parameter
    type: 'chat',
    connector: 'discord',
    channel: event.channelId
  },
}
```

**Client** (passes to builder):
```typescript
const envelope = buildDiscordEnvelope(event, {
  egressDestination: this.egressDestinationTopic  // ✅ Passed
});
```

**Factory** (passes to client):
```typescript
const client = new DiscordIngressClient(
  buildDiscordEnvelope,
  publisher,
  config,
  { egressDestinationTopic }  // ✅ Passed
);
```

#### Slack ❌ → ✅ (FIXED - Pattern A)

**Problem 1: Envelope Builder** (FIXED):
```typescript
// BEFORE:
egress: {
  destination: '',  // ❌ Hardcoded empty
  connector: 'slack',
  channel: channelId,
}

// AFTER:
egress: {
  destination: opts?.egressDestination || '',  // ✅ Uses parameter
  connector: 'slack',
  channel: channelId,
}
```

**Problem 2: Client** (FIXED):
```typescript
// BEFORE:
const envelope = buildSlackEnvelope({ ... });  // ❌ No options

// AFTER:
const envelope = buildSlackEnvelope(
  { ... },
  {
    egressDestination: this.egressDestinationTopic  // ✅ Passed
  }
);
```

**Problem 3: Connector Adapter Webhook Handler** (FIXED):
```typescript
// BEFORE:
const envelope = buildSlackEnvelope({
  type: event.type,
  user: event.user,
  // ...
});  // ❌ No options

// AFTER:
const envelope = buildSlackEnvelope(
  {
    type: event.type,
    user: event.user,
    // ...
  },
  {
    egressDestination: (this.client as any).egressDestinationTopic  // ✅ Passed
  }
);
```

**Problem 4: Factory** (FIXED):
```typescript
// BEFORE:
const client = new SlackIngressClient(
  slackAppToken,
  slackBotToken,
  publisher,
  config.debugUsersSlack
);  // ❌ No egressDestinationTopic

// AFTER:
const client = new SlackIngressClient(
  slackAppToken,
  slackBotToken,
  publisher,
  config.debugUsersSlack,
  egressDestinationTopic  // ✅ Passed
);
```

#### Twitch ✅ (Working - Pattern B)

**Envelope Builder** (leaves empty):
```typescript
egress: { destination: '', connector: 'twitch', channel }, // populated by client
```

**Client** (patches after build):
```typescript
const evtV2: InternalEventV2 = this.builder.build(msg);

// Post-build patch
if ((!evtV2.egress || !evtV2.egress.destination) && this.egressDestinationTopic) {
  evtV2.egress = {
    destination: this.egressDestinationTopic,  // ✅ Patched
    type: 'chat',
    connector: 'twitch'
  };
}
```

#### Twilio ✅ (Working - Pattern B)

**Client** (patches after build):
```typescript
const evt: InternalEventV2 = this.builder.build(enrichedMessage);

// Post-build patch
if (this.options.egressDestinationTopic) {
  evt.egress = {
    destination: this.options.egressDestinationTopic,  // ✅ Patched
    type: 'chat',
    connector: 'twilio'
  };
}
```

---

## Fixes Applied

### Files Modified

1. **src/services/ingress/slack/envelope-builder.ts**
   - Added `egressDestination?: string` to opts parameter
   - Changed `destination: ''` to `destination: opts?.egressDestination || ''`

2. **src/services/ingress/slack/slack-ingress-client.ts**
   - Added `egressDestinationTopic?: string` parameter to constructor
   - Stored as private field
   - Passed to `buildSlackEnvelope()` call: `egressDestination: this.egressDestinationTopic`

3. **src/services/ingress/slack/factory.ts**
   - Updated client instantiation to pass `egressDestinationTopic` parameter

4. **src/services/ingress/slack/connector-adapter.ts**
   - Updated webhook handler to pass egress destination:
     ```typescript
     const envelope = buildSlackEnvelope(
       { ... },
       { egressDestination: (this.client as any).egressDestinationTopic }
     );
     ```

---

## IntegrationBit Improvement Recommendations

### Problem: Inconsistent Patterns

Currently, each integration handles egress destination differently:
- Pattern A: Pass to envelope builder
- Pattern B: Post-build patch in client

This creates:
1. **Maintenance burden**: Each integration implements differently
2. **Bug risk**: Easy to forget in one code path (Slack webhook example)
3. **No central validation**: No guarantee `egress.destination` is set

### Recommended Solution: Centralized Egress Injection

**Add `injectEgressDestination()` helper to IntegrationBit**:

```typescript
/**
 * Ensures egress.destination is set on an event.
 *
 * This is a critical field for routing responses back to the correct instance.
 * If missing or empty, injects the instance's egress topic.
 *
 * @param event - Event to inject egress destination into
 * @param egressTopic - Egress topic to inject (typically internal.egress.v1.{instanceId})
 * @returns Modified event (mutates in place for performance)
 */
export function injectEgressDestination(
  event: InternalEventV2,
  egressTopic: string
): InternalEventV2 {
  // Only inject if destination is missing or empty
  if (!event.egress?.destination) {
    if (!event.egress) {
      event.egress = {
        destination: egressTopic,
        connector: event.ingress.connector,
        channel: event.ingress.channel,
      };
    } else {
      event.egress.destination = egressTopic;
    }
  }

  return event;
}
```

**Usage in connectors**:

```typescript
// In client (before publishing):
const envelope = buildSlackEnvelope({ ... });
injectEgressDestination(envelope, this.egressDestinationTopic);
await this.publisher.publish(envelope);
```

**Or better: IntegrationBit could wrap the publisher**:

```typescript
// In IntegrationBit.registerConnectors():
const wrappedPublisher = {
  publish: async (event: InternalEventV2) => {
    // Automatically inject egress destination
    injectEgressDestination(event, this.egressTopic);
    return originalPublisher.publish(event);
  }
};
```

This would:
- ✅ **Eliminate pattern inconsistency**: All integrations use same approach
- ✅ **Reduce boilerplate**: No need to pass through factory → client → builder
- ✅ **Guarantee correctness**: Every event gets egress destination
- ✅ **Centralized validation**: Single place to enforce rules

---

## Testing

### Build Verification

```bash
$ npm run build
✅ SUCCESS (0 TypeScript errors)
```

### Expected Behavior After Fix

**Slack Socket Mode Messages**:
1. ✅ User sends message in Slack channel
2. ✅ SlackIngressClient receives via Socket Mode
3. ✅ Calls `buildSlackEnvelope()` with `egressDestination`
4. ✅ Envelope has `egress.destination = "internal.egress.v1.ingress-egress-{instanceId}"`
5. ✅ Event processed through routing pipeline
6. ✅ Response published to egress topic
7. ✅ Slack connector sends response back to user

**Slack Webhook Messages**:
1. ✅ Slack sends webhook to `/webhooks/slack`
2. ✅ SlackConnectorAdapter.handleWebhook() receives it
3. ✅ Calls `buildSlackEnvelope()` with `egressDestination` from client
4. ✅ Envelope has correct egress destination
5. ✅ Event processed and response sent back

### Log Messages to Verify

**Should NOT see**:
```json
❌ "routing.complete.no_egress"
❌ "egress.destination.missing"
```

**Should see**:
```json
✅ "slack.client.envelope_built" (with egressDestination set)
✅ "egress.published" (destination: internal.egress.v1.{instanceId})
✅ "slack.egress.sending" (response sent to channel)
```

---

## Impact

### Before Fix

| Integration | Socket Mode/IRC | Webhooks | Overall Status |
|-------------|----------------|----------|----------------|
| Discord | ✅ Working | ⚠️ Not implemented | ✅ OK |
| Slack | ❌ Missing | ❌ Missing | ❌ BROKEN |
| Twitch | ✅ Working | N/A | ✅ OK |
| Twilio | ✅ Working | ✅ Working | ✅ OK |

### After Fix

| Integration | Socket Mode/IRC | Webhooks | Overall Status |
|-------------|----------------|----------|----------------|
| Discord | ✅ Working | ⚠️ Not implemented | ✅ OK |
| Slack | ✅ FIXED | ✅ FIXED | ✅ OK |
| Twitch | ✅ Working | N/A | ✅ OK |
| Twilio | ✅ Working | ✅ Working | ✅ OK |

---

## Prevention

### How This Slipped Through

1. **Inconsistent patterns**: Two different approaches across integrations
2. **Multiple code paths**: Socket Mode + Webhooks both create envelopes
3. **No central validation**: No guarantee egress.destination is set
4. **Pattern A complexity**: Requires 4-layer plumbing (factory → client → builder → opts)

### Recommended Changes

1. **Implement IntegrationBit centralized injection** (see recommendations above)
2. **Add integration test**:
   ```typescript
   it('should inject egress destination on all events', async () => {
     const publishedEvents: InternalEventV2[] = [];
     const mockPublisher = {
       publish: jest.fn(async (evt) => { publishedEvents.push(evt); })
     };

     // Create connector with mock publisher
     const connector = await createSlackConnector(config, {
       egressDestinationTopic: 'internal.egress.v1.test-instance',
       publisherFactory: () => mockPublisher,
     });

     // Start connector
     await connector.start();

     // Trigger event (Socket Mode or Webhook)
     // ...

     // Verify egress destination is set
     expect(publishedEvents).toHaveLength(1);
     expect(publishedEvents[0].egress.destination).toBe('internal.egress.v1.test-instance');
   });
   ```

3. **Deployment checklist addition**:
   - [ ] Send test message on each platform
   - [ ] **Verify bot responds** (tests full round-trip)
   - [ ] Monitor for `routing.complete.no_egress` warnings
   - [ ] Monitor for `egress.destination.missing` errors

---

## Sign-Off

**Identified By**: User report (staging deployment - multiple Slack messages)
**Diagnosed By**: Claude (log analysis + code comparison with Discord/Twitch)
**Fixed By**: Claude
**Pattern Recommendations**: Claude
**Verified By**: TBD (staging verification)
**Approved For Production**: TBD
