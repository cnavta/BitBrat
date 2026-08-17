# Platform Integration Migration Analysis
**Sprint 13: Event Gateway Framework**
**Date:** 2026-08-14
**Status:** Partial Migration

---

## Executive Summary

**All three platforms (Discord, Slack, Twitch) are currently using the OLD custom envelope builder approach for ingress event processing.** The new YAML-driven TranslationEngine framework from Sprint 13 is **NOT yet being used for ingress**, despite YAML config files existing for all platforms.

**Key Finding:** The Sprint 13 YAML configs and TranslationEngine are **inactive** for ingress. All platforms still use custom `buildXEnvelope()` functions that bypass the event gateway framework.

---

## Migration Status by Platform

### 🟡 **Discord** - Partial Custom Implementation

| Component | Status | Implementation |
|-----------|--------|----------------|
| **Ingress Method** | ❌ Custom Builder | Uses `buildDiscordEnvelope()` |
| **YAML Configs** | ✅ Exist (unused) | `config/platforms/discord/*.yaml` |
| **TranslationEngine** | ❌ Not integrated | Not used for ingress |
| **DM Detection** | ✅ Implemented | Custom logic in envelope builder |
| **DM Detection Method** | `channelType === 1` | Hardcoded in `buildDiscordEnvelope()` |
| **Priority Routing** | ❌ Not used | Would require TranslationEngine |
| **Egress** | ✅ Working | `sendDM()` implemented |

**DM Detection Logic (Custom Builder):**
```typescript
// src/services/ingress/discord/envelope-builder.ts:106-109
const isDM = event.channelType === 1;
const eventType = isDM ? 'dm.message.v1' : 'chat.message.v1';
const egressType = isDM ? 'dm' : 'chat';
```

**Issue:** DM detection works IN THEORY but may fail if:
- `msg.channel?.type` is not `1` in current Discord.js version
- `channelType` is `undefined` when passed to builder
- Discord.js API changed channel type enum values

---

### 🟢 **Slack** - Partial Custom Implementation (DMs Working)

| Component | Status | Implementation |
|-----------|--------|----------------|
| **Ingress Method** | ❌ Custom Builder | Uses `buildSlackEnvelope()` |
| **YAML Configs** | ✅ Exist (unused) | `config/platforms/slack/*.yaml` |
| **TranslationEngine** | ❌ Not integrated | Not used for ingress |
| **DM Detection** | ✅ Working | Custom logic in envelope builder |
| **DM Detection Method** | `channelId.startsWith('D')` | Simple string check |
| **Priority Routing** | ❌ Not used | Would require TranslationEngine |
| **Egress** | ✅ Working | Uses `sendText()` (Slack DMs are channels) |

**DM Detection Logic (Custom Builder):**
```typescript
// src/services/ingress/slack/envelope-builder.ts:92-94
const isDM = channelId.startsWith('D');
const eventType = isDM ? 'dm.message.v1' : 'chat.message.v1';
const egressType = isDM ? 'dm' : 'chat';
```

**Why It Works:** Slack's DM detection is simple and reliable - all DM channel IDs start with 'D'. This is a stable Slack API convention.

---

### 🔴 **Twitch** - Egress Only (No DM Ingress)

| Component | Status | Implementation |
|-----------|--------|----------------|
| **Ingress Method** | ❌ IRC Only | No whisper ingress |
| **YAML Configs** | ✅ Exist (unused) | `config/platforms/twitch/*.yaml` |
| **TranslationEngine** | ❌ Not integrated | Not used for ingress |
| **DM Detection** | ❌ Not implemented | No whisper listener |
| **DM Detection Method** | N/A | No ingress code |
| **Priority Routing** | ❌ Not used | Would require TranslationEngine |
| **Egress** | ✅ Working | `sendWhisper()` via Helix API |

**Missing Component:**
```typescript
// EventSub client has NO whisper subscription
// src/services/ingress/twitch/eventsub-client.ts
// Only subscribes to:
// - onChannelUpdate
// - onStreamOnline
// - onStreamOffline
// Missing: onChannelWhisper or equivalent
```

**Root Cause:** Twitch whispers were never implemented for INGRESS (receiving). Only EGRESS (sending) was implemented via `sendWhisper()`.

**Required for Twitch Whispers:**
1. Subscribe to Twitch EventSub `channel.whisper` topic
2. Implement whisper event handler in EventSub client
3. Add whisper-specific envelope builder logic
4. Or migrate to TranslationEngine + YAML configs

---

## Architecture Overview

### Current State (All Platforms)

```
┌──────────────────────────────────────────────────────────────┐
│                    Platform Client                            │
│   (discord-ingress-client.ts / slack-ingress-client.ts)      │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       │ Receives raw platform event
                       │ (msg.channel.type, event.channel, etc.)
                       ▼
┌──────────────────────────────────────────────────────────────┐
│              Custom Envelope Builder                          │
│        (buildDiscordEnvelope / buildSlackEnvelope)           │
│                                                               │
│  • Hardcoded DM detection logic                              │
│  • Direct InternalEventV2 construction                       │
│  • No YAML config usage                                      │
│  • No priority-based routing                                 │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       │ InternalEventV2
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Publisher                                  │
│              (publish to event-router)                        │
└──────────────────────────────────────────────────────────────┘
```

**NOT USED:**
- ❌ TranslationEngine
- ❌ ConfigRegistry
- ❌ YAML event mappings (`config/platforms/*/dm-message.v1.yaml`)
- ❌ Priority-based routing (`priority: 10` vs `priority: 0`)
- ❌ JSONLogic filters
- ❌ Generic envelope builder

---

### Target State (Sprint 13 Vision - Not Implemented)

```
┌──────────────────────────────────────────────────────────────┐
│                    Platform Client                            │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       │ Raw platform event
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                 TranslationEngine                             │
│                                                               │
│  1. ConfigRegistry.findByPlatformEvent()                     │
│     - Checks dm-message.v1.yaml (priority 10)               │
│     - Checks chat-message.v1.yaml (priority 0)              │
│                                                               │
│  2. Evaluates JSONLogic filter                               │
│     filter: {"==": [{"var": "channel.type"}, 1]}            │
│                                                               │
│  3. Generic envelope builder OR custom builder               │
│                                                               │
│  4. Returns InternalEventV2                                  │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       │ InternalEventV2
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Publisher                                  │
└──────────────────────────────────────────────────────────────┘
```

**This architecture would enable:**
- ✅ Priority-based DM detection (DM configs checked first)
- ✅ Declarative field mapping (no code changes for new fields)
- ✅ Runtime config updates (no redeployment)
- ✅ Unified testing (`brat integration test`)
- ✅ Generic builder for simple platforms

---

## YAML Config Status

### Files Created (But Unused)

```bash
config/platforms/discord/
├── chat-message.v1.yaml  ✅ Exists (priority: 0)
└── dm-message.v1.yaml    ✅ Exists (priority: 10, filter: channel.type == 1)

config/platforms/slack/
├── chat-message.v1.yaml  ✅ Exists (priority: 0)
└── dm-message.v1.yaml    ✅ Exists (priority: 10, filter: channel_type == "im")

config/platforms/twitch/
├── chat-message.v1.yaml  ✅ Exists (priority: 0)
└── dm-message.v1.yaml    ✅ Exists (priority: 10)
```

**All YAML configs are syntactically valid and would work IF TranslationEngine were integrated.**

---

## Why DMs Work/Don't Work

### ✅ **Slack DMs Work**

**Reason:** Simple, reliable detection in custom builder.

```typescript
const isDM = channelId.startsWith('D');
```

**Why it's reliable:**
- All Slack DM channels start with 'D' (stable API convention)
- Channel ID is always present
- No enum values to check
- No Discord.js version dependencies

---

### ❓ **Discord DMs Don't Work**

**Suspected Reasons:**

1. **Discord.js version mismatch**
   - Code checks: `channelType === 1`
   - Actual value might be different in deployed Discord.js version
   - Discord.js v13 vs v14 vs v15 have different `ChannelType` enums

2. **channelType undefined**
   - `msg.channel?.type` might return `undefined`
   - Safe navigation operator doesn't prevent this

3. **Discord.js changed enum values**
   - Old: `ChannelType.DM = 1`
   - New: `ChannelType.DM = 4` (hypothetical)

**Required Debug:**
```bash
# In staging logs, check:
grep "discord.message.received" | jq '.channelType'

# Expected: 1
# If undefined or different number, that's the issue
```

---

### ❌ **Twitch Whispers Don't Work**

**Reason:** Never implemented.

**Missing components:**
1. No EventSub subscription to `channel.whisper` events
2. No whisper event handler in `eventsub-client.ts`
3. No whisper-specific builder logic
4. Egress (`sendWhisper`) works, ingress doesn't exist

**EventSub client currently only handles:**
- `channel.update`
- `stream.online`
- `stream.offline`

---

## Feature Flag Status

### Flags Exist But Don't Apply to Ingress

```typescript
// src/services/ingress/core/feature-flags.ts
ENABLE_CONFIG_REGISTRY: boolean;    // Controls TranslationEngine
ENABLE_GENERIC_BUILDER: boolean;    // Controls generic vs custom builders
```

**Current behavior:**
- ✅ Flags are implemented and tested
- ✅ Flags work correctly (default: false)
- ❌ **Platforms don't use TranslationEngine**, so flags have no effect on ingress

**Where flags ARE used:**
- Integration tests (`brat integration test`)
- Egress translation (via EgressTranslator)
- Config validation (`brat integration validate`)

**Where flags are NOT used:**
- Discord ingress (uses `buildDiscordEnvelope` directly)
- Slack ingress (uses `buildSlackEnvelope` directly)
- Twitch ingress (uses `buildTwitchEnvelope` directly)

---

## Migration Roadmap

### Phase 1: Discord Fix (Immediate)

**Goal:** Get Discord DMs working without full migration.

**Option A: Debug current implementation**
1. Check staging logs for `channelType` value
2. Update `buildDiscordEnvelope` if enum changed
3. Add defensive checks for `undefined`

**Option B: Quick YAML migration**
1. Update factory to use TranslationEngine
2. Enable `ENABLE_CONFIG_REGISTRY=true`
3. YAML configs already exist and are correct

---

### Phase 2: Twitch Whispers (Next)

**Goal:** Implement whisper ingress.

**Option A: Add to EventSub client (legacy approach)**
1. Add `onChannelWhisper()` subscription
2. Add whisper builder logic
3. Test with Twitch EventSub

**Option B: Full TranslationEngine migration**
1. Migrate Twitch to use TranslationEngine
2. YAML configs already exist
3. Use priority routing for whispers vs chat

---

### Phase 3: Full Migration (Future)

**Goal:** All platforms use TranslationEngine + YAML configs.

**Benefits:**
- Runtime config updates
- No code changes for new fields
- Unified testing
- Priority-based routing
- JSONLogic filters

**Steps:**
1. Update each platform's factory to create TranslationEngine
2. Enable `ENABLE_CONFIG_REGISTRY=true` per platform
3. Gradually migrate (Slack → Discord → Twitch)
4. Remove custom builders once migrated
5. Update documentation

---

## Recommendations

### Immediate Actions

1. **Debug Discord DMs**
   ```bash
   # Check staging logs
   grep "discord.message.received" | jq '{channelType, isDM}'
   ```

2. **Decide on Twitch Whispers**
   - Is whisper ingress actually needed?
   - Or is egress-only sufficient?

3. **Consider Migration Priority**
   - Quick fix: Update custom builders
   - Long-term: Migrate to TranslationEngine

### Long-Term Strategy

**Option 1: Keep Custom Builders**
- ✅ Works now (except Discord DM bug)
- ✅ Simple, well-understood
- ❌ Code changes for new fields
- ❌ No runtime config
- ❌ Sprint 13 work unused

**Option 2: Migrate to TranslationEngine**
- ✅ Uses Sprint 13 infrastructure
- ✅ YAML configs already exist
- ✅ Runtime configuration
- ✅ Unified testing
- ❌ Requires factory updates
- ❌ Testing/validation work

---

## Testing Matrix

| Platform | Chat Ingress | DM Ingress | Chat Egress | DM Egress |
|----------|--------------|------------|-------------|-----------|
| **Discord** | ✅ Working | ❌ Not working | ✅ Working | ✅ Working |
| **Slack** | ✅ Working | ✅ Working | ✅ Working | ✅ Working |
| **Twitch** | ✅ Working | ❌ Not implemented | ✅ Working | ✅ Working |

---

## Conclusion

**Sprint 13's YAML-driven event gateway framework is complete and tested, but NOT integrated into production ingress paths.** All platforms still use Sprint 11/12 custom envelope builders.

**The DM detection issues are NOT due to missing YAML configs** (they exist) but due to:
1. **Discord:** Possible Discord.js API changes (`channelType` value)
2. **Twitch:** Never implemented whisper ingress
3. **Slack:** Working because simple string check

**Next Step:** Choose between:
- **Quick fix:** Debug/fix custom builders
- **Strategic fix:** Migrate to TranslationEngine

Both approaches are valid. Quick fix gets DMs working faster. Strategic fix makes Sprint 13 work actually used.
