# HOTFIX: Slack Egress Routing

**Date**: 2026-08-13
**Severity**: CRITICAL
**Status**: ✅ FIXED
**Affected Service**: ingress-egress (Slack connector)
**Deployment**: Staging (discovered), Production (not yet deployed)

---

## Problem

After deploying Sprint 12 IntegrationBit refactoring and publisher fixes to staging, Slack messages were reaching the end of the routing pipeline but failing to create egress events to send responses back to Slack.

### Symptoms

1. ❌ `routing.complete.no_egress` warning in reflex service logs
2. ❌ No responses sent back to Slack despite successful message processing
3. ✅ Messages were being processed through the routing pipeline correctly
4. ✅ Other integrations (Discord, Twitch) working correctly

### Error in Staging

```json
{
  "msg": "routing.complete.no_egress",
  "correlationId": "1e08d115-a7d6-4ef7-9027-baf48254b0bd",
  "traceId": "dddef6e4-00ac-45c5-98c2-5648b686a61a",
  "userId": "slack:U9S817Q3B",
  "stage": "contextualization"
}
```

---

## Root Cause

**Slack envelope builder was hardcoding `egress.destination` to empty string instead of using the dynamic egress topic.**

### Code Analysis

**File**: `src/services/ingress/slack/envelope-builder.ts`

**Before** (BROKEN):
```typescript
egress: {
  destination: '',  // ← PROBLEM: Hardcoded empty string
  connector: 'slack',
  channel: channelId,
},
```

**Comparison with Discord** (WORKING):
```typescript
egress: {
  destination: opts?.egressDestination || '',  // ✅ Uses parameter
  type: 'chat',
  connector: 'discord',
  channel: event.channelId
},
```

### Architecture Issue

The Slack integration was missing the complete egress routing plumbing:

1. ❌ `buildSlackEnvelope()` didn't accept `egressDestination` in opts
2. ❌ `SlackIngressClient` constructor didn't accept `egressDestinationTopic`
3. ❌ `SlackIngressClient` didn't pass destination to envelope builder
4. ❌ Factory had `egressDestinationTopic` but didn't pass it to client

Discord had all of these working correctly since Sprint 11.

---

## Fix

Updated all layers of the Slack integration to pass egress destination from factory → client → envelope builder.

### Files Modified

1. **src/services/ingress/slack/envelope-builder.ts**
   - Added `egressDestination?: string` to opts parameter
   - Changed `destination: ''` to `destination: opts?.egressDestination || ''`

2. **src/services/ingress/slack/slack-ingress-client.ts**
   - Added `egressDestinationTopic?: string` parameter to constructor
   - Stored it as private field
   - Passed it to `buildSlackEnvelope()` call: `egressDestination: this.egressDestinationTopic`

3. **src/services/ingress/slack/factory.ts**
   - Updated client instantiation to pass `egressDestinationTopic` parameter

### Code Changes

**1. Envelope Builder** (src/services/ingress/slack/envelope-builder.ts):
```typescript
export function buildSlackEnvelope(
  event: SlackEventMeta,
  opts?: {
    uuid?: () => string;
    nowIso?: () => string;
    egressDestination?: string; // ← ADDED
    correlationId?: string;
    debugMetadata?: DebugMetadata;
  }
): InternalEventV2 {
  // ...
  egress: {
    destination: opts?.egressDestination || '', // ← CHANGED
    connector: 'slack',
    channel: channelId,
  },
  // ...
}
```

**2. Client Constructor** (src/services/ingress/slack/slack-ingress-client.ts):
```typescript
export class SlackIngressClient {
  private readonly egressDestinationTopic?: string; // ← ADDED

  constructor(
    private readonly appToken: string,
    private readonly botToken: string,
    private readonly publisher: IngressPublisher,
    debugUsersSlack?: string,
    egressDestinationTopic?: string // ← ADDED
  ) {
    this.webClient = new WebClient(botToken);
    this.egressDestinationTopic = egressDestinationTopic; // ← ADDED
    // ...
  }
```

**3. Envelope Builder Call** (src/services/ingress/slack/slack-ingress-client.ts):
```typescript
const envelope = buildSlackEnvelope(
  {
    type: actualEvent.type,
    user: actualEvent.user,
    channel: actualEvent.channel,
    text: messageText,
    ts: actualEvent.ts,
    thread_ts: actualEvent.thread_ts,
    team: actualEvent.team || body?.team_id,
    event_ts: actualEvent.event_ts,
  },
  {
    egressDestination: this.egressDestinationTopic, // ← ADDED
    correlationId: debugCorrelationId,
    debugMetadata,
  }
);
```

**4. Factory** (src/services/ingress/slack/factory.ts):
```typescript
const client = new SlackIngressClient(
  slackAppToken,
  slackBotToken,
  publisher,
  config.debugUsersSlack,
  egressDestinationTopic // ← ADDED
);
```

---

## Testing

### Build Verification

```bash
$ npm run build
✅ SUCCESS (0 TypeScript errors)
```

### Expected Behavior After Fix

**Staging Environment**:

1. ✅ IntegrationBit passes `egressDestinationTopic` to factory (e.g., `internal.egress.v1.ingress-egress-abc123`)
2. ✅ Factory passes it to SlackIngressClient constructor
3. ✅ Client stores it and passes to envelope builder
4. ✅ Envelope builder sets `egress.destination` to the topic
5. ✅ When routing pipeline completes, reflex service publishes to egress topic
6. ✅ Ingress-egress service receives egress event
7. ✅ SlackConnectorAdapter sends response back to Slack channel
8. ✅ User receives response in Slack

### Log Messages to Verify

**On Slack message received**:
```json
{
  "msg": "slack.client.envelope_built",
  "correlationId": "...",
  "envelopeType": "chat.message.v1"
}
```

**On routing complete** (should NOT see):
```json
❌ NO "routing.complete.no_egress" warnings
```

**On egress published**:
```json
{
  "msg": "egress.published",
  "destination": "internal.egress.v1.ingress-egress-abc123",
  "connector": "slack",
  "channel": "C123456"
}
```

**On egress received**:
```json
{
  "msg": "slack.egress.sending",
  "channel": "C123456",
  "text": "Response from bot"
}
```

---

## Impact

### Before Fix

- **Slack Messages**: ❌ Processed but no responses sent
- **Egress Routing**: ❌ Missing destination (empty string)
- **User Experience**: ❌ Bot appears to ignore all messages

### After Fix

- **Slack Messages**: ✅ Processed AND responses sent
- **Egress Routing**: ✅ Destination set to instance-specific topic
- **User Experience**: ✅ Bot responds normally

---

## Related Issues

This is **issue #3** from the staging deployment. Previous issues were:

1. ✅ **FIXED**: Publisher interface mismatch (all platforms)
2. ✅ **FIXED**: Slack egress routing (this fix)

**Twitch credentials issue** (reported by user) was already fixed in the credentials audit work.

---

## Prevention

### How This Slipped Through

1. **Sprint 12 refactoring**: Extracted Slack connector from monolithic service
2. **Incomplete pattern copy**: Copied Discord patterns but missed egress routing
3. **No egress integration tests**: Tests don't verify end-to-end egress flow
4. **Working Discord example**: Discord was fixed in Sprint 11, should have been the reference

### Future Prevention

1. **Add Integration Test**:
   ```typescript
   it('should set egress destination from factory options', async () => {
     const egressTopic = 'internal.egress.v1.test-instance';
     const connector = await createSlackConnector(config, {
       egressDestinationTopic: egressTopic,
       publisherFactory: (topic) => mockPublisher,
     });

     // Send test message
     await connector.start();
     // ... trigger message ...

     // Verify envelope has correct egress destination
     expect(publishedEnvelope.egress.destination).toBe(egressTopic);
   });
   ```

2. **Pattern Checklist** (when adding new integration):
   - [ ] Envelope builder accepts `egressDestination` in opts
   - [ ] Client constructor accepts `egressDestinationTopic`
   - [ ] Client passes destination to envelope builder
   - [ ] Factory passes `egressDestinationTopic` to client
   - [ ] Integration test verifies egress routing

3. **Deployment Checklist**:
   - [ ] Build succeeds
   - [ ] Unit tests pass
   - [ ] Staging deployment succeeds
   - [ ] Send test message to each platform
   - [ ] **Verify bot responds** ← ADD THIS (would have caught the issue)
   - [ ] Monitor for `routing.complete.no_egress` warnings ← ADD THIS
   - [ ] Monitor for 30 minutes
   - [ ] Production deployment

---

## Sign-Off

**Identified By**: User report (staging deployment)
**Diagnosed By**: Claude (log analysis + code comparison with Discord)
**Fixed By**: Claude
**Verified By**: TBD (staging verification)
**Approved For Production**: TBD
