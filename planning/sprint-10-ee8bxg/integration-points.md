# Ingress-Egress Integration Points

**Sprint**: sprint-10-ee8bxg
**Task**: P0-002
**Date**: 2026-08-11

---

## CRITICAL DISCOVERY

**TwitchConnectorAdapter already exists** at `src/services/ingress/twitch/connector-adapter.ts` (50 lines)

This changes our sprint scope from **CREATE** to **ENHANCE**.

---

## Current TwitchConnectorAdapter Status

### ✅ IMPLEMENTED (Already Done)
1. **IngressConnector interface** - implements correctly
2. **start()** - delegates to `client.start()`
3. **stop()** - delegates to `client.stop()`
4. **getSnapshot()** - delegates with state mapping (`TwitchConnectionState` → `ConnectorState`)
5. **banUser()** - delegates to `client.banUser()` (with safety check)
6. **Registered in ConnectorManager** - lines 170, 173, 176 in ingress-egress-service.ts

### ❌ MISSING (Need to Add)
1. **getMetadata()** - NOT implemented (critical gap)
2. **sendText()** - NOT implemented (egress functionality)
3. **sendWhisper()** - NOT implemented (whisper egress)
4. **IConfig parameter** - Constructor only takes `client`, not `config`
5. **WebhookConnector interface** - NOT implemented (optional, out of scope)

---

## Integration Points in ingress-egress-service.ts

### Line 5: Import TwitchIrcClient
```typescript
import {
  TwitchIrcClient,
  TwitchEnvelopeBuilder,
  ConfigTwitchCredentialsProvider,
  FirestoreTwitchCredentialsProvider,
  TwitchEventSubClient
} from '../services/ingress/twitch';
```

### Line 12: Import TwitchConnectorAdapter (ALREADY EXISTS)
```typescript
import { TwitchConnectorAdapter } from '../services/ingress/twitch/connector-adapter';
```

### Line 48-50: Client Field Declarations
```typescript
private twitchClient: TwitchIrcClient | null = null;
private twitchBroadcasterClient: TwitchIrcClient | null = null;
private twitchEventSubClient: TwitchEventSubClient | null = null;
```

### Line 142-147: Main Twitch IRC Client Creation
```typescript
this.twitchClient = new TwitchIrcClient(envelopeBuilder, publisher, cfg.twitchChannels, {
  cfg,
  credentialsProvider: credsProvider,
  egressDestinationTopic: egressTopic,
  debugUsers: cfg.debugUsers,
});
```

### Line 159-165: Broadcaster Client Creation
```typescript
this.twitchBroadcasterClient = new TwitchIrcClient(envelopeBuilder, publisher, cfg.twitchChannels, {
  cfg,
  credentialsProvider: broadcasterCredsProvider,
  egressDestinationTopic: egressTopic,
  disableIngress: true,
});
```

### Line 170-177: Adapter Registration (ALREADY DONE)
```typescript
if (this.twitchClient) {
  manager.register('twitch', new TwitchConnectorAdapter(this.twitchClient));
}
if (this.twitchBroadcasterClient) {
  manager.register('twitch-broadcaster', new TwitchConnectorAdapter(this.twitchBroadcasterClient));
}
if (this.twitchEventSubClient) {
  manager.register('twitch-eventsub', new TwitchConnectorAdapter(this.twitchEventSubClient as any));
}
```

### Line 540-542: Debug Endpoint (Direct Client Usage)
```typescript
this.onHTTPRequest('/_debug/twitch', (_req: Request, res: Response) => {
  const snapshot = this.twitchClient!.getSnapshot();
  res.status(200).json({ snapshot, egressTopic });
});
```
**NOTE**: Could use `manager.getConnector('twitch').getSnapshot()` instead.

### Line 782: Egress Account Type Selection (Direct Client Usage)
```typescript
const client = accountType === 'broadcaster' ? this.twitchBroadcasterClient : this.twitchClient;
```

### Line 838-841: Error Feedback Egress (Direct Client Usage)
```typescript
if (isTwitch && this.twitchClient) {
  const targetChannel = (evt.egress?.channel) ? evt.egress.channel : (evt.ingress?.channel || evt.channel);
  await this.twitchClient.sendText(errorFeedback, targetChannel);
}
```
**NOTE**: Should use `manager.getConnector('twitch').sendText()` instead (but adapter missing sendText method!).

---

## Current Direct Client Usage Summary

**Total Direct References**: 6 locations

1. **Line 540**: `this.twitchClient!.getSnapshot()` - debug endpoint
2. **Line 782**: Account type selection - broadcaster vs main
3. **Line 838**: `this.twitchClient.sendText()` - error feedback egress

**Broadcaster Client References**: 2 locations
1. **Line 782**: Account type selection
2. Implicitly via manager.register at line 173

**EventSub Client References**: 1 location
1. **Line 176**: Adapter registration only

---

## What's Left to Do (Revised Sprint Scope)

### Phase 1: Enhance TwitchConnectorAdapter (NOT Create)
1. ✅ ~~Create connector-adapter.ts skeleton~~ **ALREADY EXISTS**
2. ✅ ~~Implement IngressConnector interface~~ **ALREADY EXISTS**
3. ❌ **ADD sendText() method** - delegate to client
4. ❌ **ADD sendWhisper() method** - delegate to client
5. ❌ **ADD getMetadata() method** - return platform capabilities
6. ❌ **UPDATE constructor** - accept optional IConfig parameter

### Phase 2: Module Integration
1. ✅ ~~Export adapter from module~~ **ALREADY EXPORTED (inferred)**
2. ✅ ~~Import adapter in ingress-egress~~ **ALREADY IMPORTED**
3. ✅ ~~Create adapter instance~~ **ALREADY CREATED**
4. ✅ ~~Register with ConnectorManager~~ **ALREADY REGISTERED**

### Phase 3-4: Feature Parity Testing
- **NO CHANGES NEEDED** - adapter already registered, just need to verify functionality

### Phase 5: Egress Handler Migration
- **UPDATE Line 838-841**: Replace `this.twitchClient.sendText()` with `manager.getConnector('twitch').sendText()`
- **OPTIONAL Line 540-542**: Replace `this.twitchClient.getSnapshot()` with `manager.getConnector('twitch').getSnapshot()`

### Phase 6: Testing & Documentation
- **ADD unit tests** for new methods (sendText, sendWhisper, getMetadata)
- **UPDATE documentation** to reflect adapter completeness

### Phase 7: Build Verification
- **NO CHANGES** - standard verification

---

## Revised Timeline

**Original Estimate**: 8 hours (48 tasks)
**Revised Estimate**: **4-5 hours** (25-30 tasks)

**Reason**: Adapter already exists with core lifecycle methods implemented. We only need to:
1. Add missing egress methods (sendText, sendWhisper)
2. Add getMetadata() method
3. Migrate remaining direct client usage
4. Test and document

**Significant Time Savings**:
- ✅ Phase 1: Reduced from 1.5 hours to 30-45 minutes (no skeleton creation, just method addition)
- ✅ Phase 2: Reduced from 30 minutes to 5-10 minutes (already integrated)
- ✅ Phase 5: Minimal changes (only 1-2 direct usage locations to migrate)

---

## Integration Points Summary

| Location | Usage | Status | Action Needed |
|----------|-------|--------|---------------|
| Line 12 | Import TwitchConnectorAdapter | ✅ DONE | None |
| Line 48-50 | Field declarations | ✅ OK | Keep for dual support |
| Line 142-147 | Main client creation | ✅ OK | Keep (adapter wraps client) |
| Line 159-165 | Broadcaster client creation | ✅ OK | Keep (adapter wraps client) |
| Line 170-177 | Adapter registration | ✅ DONE | None |
| Line 540-542 | Debug endpoint | ⚠️ DIRECT | Optional: use manager |
| Line 782 | Account type selection | ⚠️ DIRECT | Keep (internal logic) |
| Line 838-841 | Error feedback egress | ❌ DIRECT | Migrate to manager.getConnector() |

---

## Next Steps (Revised)

1. **Update backlog** to reflect existing adapter (reduce Phase 1-2 tasks)
2. **Complete P0-003**: Create feature parity matrix
3. **Enhance adapter** (Phase 1): Add sendText, sendWhisper, getMetadata
4. **Test feature parity** (Phase 3-4): Verify all functionality works via adapter
5. **Migrate egress** (Phase 5): Update line 838-841 to use manager
6. **Test & document** (Phase 6-7): Standard verification

**Status**: P0-002 complete - integration points documented
**Next**: P0-003 - Create feature parity test matrix
