# Twitch EventSub Event Catalog

> **Sprint:** 16
> **Total Events:** 22 (4 core + 13 Tier 1 + 5 Tier 2)
> **Status:** Production-ready
> **Config:** `config/twitch-eventsub/subscriptions.yaml`

Complete reference for all supported Twitch EventSub event types in the BitBrat platform.

---

## Quick Reference

| Category | Count | Enabled by Default | Volume | OAuth Scope Required |
|----------|-------|-------------------|--------|---------------------|
| **Core** | 4 | ✅ Yes | Low-Medium | Some |
| **Tier 1: Engagement** | 13 | ❌ No (opt-in) | Low-Medium | Some |
| **Tier 2: Moderation** | 5 | ❌ No (opt-in) | HIGH | Yes |

---

## Core Events (4)

**Status:** Enabled by default
**Purpose:** Platform essentials (follows, channel updates, stream state)

| Event Type | Internal Type | OAuth Scope | Priority | Volume | Description |
|------------|---------------|-------------|----------|--------|-------------|
| `channel.follow` | `system.twitch.follow` | `moderator:read:followers` | high | Low | New follower (requires moderator scope) |
| `channel.update` | `system.twitch.update` | None | high | Low | Channel metadata changes (title, category, language, mature flag) |
| `stream.online` | `system.stream.online` | None | critical | Low | Stream goes live - triggers state mutation (`stream.state=on`) |
| `stream.offline` | `system.stream.offline` | None | critical | Low | Stream goes offline - triggers state mutation (`stream.state=off`) |

### Core Event Details

#### channel.follow (v2)

**Trigger:** User follows the channel
**Builder:** `buildFollow`
**OAuth Scope:** `moderator:read:followers` (must be channel owner or moderator)
**State Mutation:** None

**Fields:**
- `userId`, `userName`, `userDisplayName` - Follower identity
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `followDate` - When follow occurred

**Use Cases:**
- Thank followers in chat
- Track follower growth
- Alert on new follows

---

#### channel.update (v2)

**Trigger:** Broadcaster changes channel metadata
**Builder:** `buildUpdate`
**OAuth Scope:** None
**State Mutation:** None

**Fields:**
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `streamTitle` - New stream title
- `streamLanguage` - Stream language
- `categoryId`, `categoryName` - Game/category
- `isMature` - Mature content flag

**Use Cases:**
- Announce game changes
- Track stream categories
- Monitor title updates

---

#### stream.online (v1)

**Trigger:** Stream goes live
**Builder:** `buildStreamOnline`
**OAuth Scope:** None
**State Mutation:** YES (`stream.state` → `on`, TTL: 6 hours)

**Fields:**
- `id` - Stream ID
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `type` - Stream type (`live`, `playlist`, `watch_party`, `premiere`, `rerun`)
- `title` - Stream title (optional)
- `startDate` - When stream started

**Use Cases:**
- Stream online notifications
- State tracking (stream on/off)
- Trigger stream-start workflows

---

#### stream.offline (v1)

**Trigger:** Stream goes offline
**Builder:** `buildStreamOffline`
**OAuth Scope:** None
**State Mutation:** YES (`stream.state` → `off`, TTL: 6 hours)

**Fields:**
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity

**Use Cases:**
- Stream offline notifications
- State tracking (stream on/off)
- Trigger stream-end workflows

---

## Tier 1: Engagement & Monetization (13)

**Status:** Disabled by default (opt-in)
**Purpose:** High-value community engagement and monetization events
**Volume:** Low-Medium (safe for most channels)

| Event Type | Internal Type | OAuth Scope | Priority | Volume | Description |
|------------|---------------|-------------|----------|--------|-------------|
| `channel.raid` | `system.twitch.raid` | None | high | Low | Broadcaster raids another channel |
| `channel.subscribe` | `system.twitch.subscribe` | `channel:read:subscriptions` | high | Low | New subscription (not resubscriptions) |
| `channel.subscription.message` | `system.twitch.subscription.message` | `channel:read:subscriptions` | high | Low | Resubscription with message |
| `channel.subscription.gift` | `system.twitch.subscription.gift` | `channel:read:subscriptions` | high | Low | Gift subscription |
| `channel.cheer` | `system.twitch.cheer` | `bits:read` | high | Low | User cheers with bits |
| `channel.channel_points_custom_reward_redemption.add` | `system.twitch.channelpoints.redemption` | `channel:read:redemptions` | high | Medium | Channel points redemption |
| `channel.hype_train.begin` | `system.twitch.hype_train.begin` | None | medium | Low | Hype Train starts |
| `channel.hype_train.progress` | `system.twitch.hype_train.progress` | None | low | **HIGH** | Hype Train progress updates |
| `channel.hype_train.end` | `system.twitch.hype_train.end` | None | medium | Low | Hype Train ends |
| `channel.poll.begin` | `system.twitch.poll.begin` | None | medium | Low | Poll starts |
| `channel.poll.end` | `system.twitch.poll.end` | None | medium | Low | Poll ends |
| `channel.prediction.begin` | `system.twitch.prediction.begin` | None | medium | Low | Prediction starts |
| `channel.prediction.end` | `system.twitch.prediction.end` | None | medium | Low | Prediction ends |

### Tier 1 Event Details

#### Community Engagement

##### channel.raid (v1)

**Trigger:** Broadcaster raids another channel
**Builder:** `buildRaid`
**OAuth Scope:** None
**Volume:** Low

**Fields:**
- `raidingBroadcasterId`, `raidingBroadcasterName`, `raidingBroadcasterDisplayName` - Raiding channel
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Target channel
- `viewers` - Number of viewers in raid

**Use Cases:**
- Thank raiders
- Announce incoming raids
- Track raid network

---

#### Subscription Events

##### channel.subscribe (v1)

**Trigger:** New subscription (NOT resubscriptions)
**Builder:** `buildSubscribe`
**OAuth Scope:** `channel:read:subscriptions`
**Volume:** Low

**Fields:**
- `userId`, `userName`, `userDisplayName` - Subscriber identity
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `tier` - Subscription tier (`1000`, `2000`, `3000`, `Prime`)
- `isGift` - Whether subscription is a gift

**Use Cases:**
- Thank new subscribers
- Track subscription tier distribution
- Monetization tracking

---

##### channel.subscription.message (v1)

**Trigger:** Resubscription with message (resub share)
**Builder:** `buildSubscriptionMessage`
**OAuth Scope:** `channel:read:subscriptions`
**Volume:** Low

**Fields:**
- `userId`, `userName`, `userDisplayName` - Subscriber identity
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `tier` - Subscription tier
- `message` - Resub message text
- `cumulativeMonths` - Total months subscribed
- `streakMonths` - Consecutive months (can be null)
- `durationMonths` - Duration of current subscription period

**Use Cases:**
- Announce resubs with messages
- Celebrate subscriber milestones
- Community engagement

---

##### channel.subscription.gift (v1)

**Trigger:** Gift subscription (single or mass gift)
**Builder:** `buildSubscriptionGift`
**OAuth Scope:** `channel:read:subscriptions`
**Volume:** Low

**Fields:**
- `userId`, `userName`, `userDisplayName` - Gifter identity (null if anonymous)
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `tier` - Subscription tier
- `total` - Number of gifts in this event
- `cumulativeTotal` - Total gifts by this user (all time)
- `isAnonymous` - Whether gift is anonymous

**Use Cases:**
- Thank gift subbers
- Track gift sub patterns
- Monetization tracking

---

#### Monetization Events

##### channel.cheer (v1)

**Trigger:** User cheers with bits
**Builder:** `buildCheer`
**OAuth Scope:** `bits:read`
**Volume:** Low

**Fields:**
- `userId`, `userName`, `userDisplayName` - Cheerer identity (null if anonymous)
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `bits` - Amount of bits
- `message` - Cheer message
- `isAnonymous` - Whether cheer is anonymous

**Use Cases:**
- Thank bit donors
- Display bit leaderboard
- Monetization tracking

---

##### channel.channel_points_custom_reward_redemption.add (v1)

**Trigger:** User redeems channel points reward
**Builder:** `buildChannelPointsRedemption`
**OAuth Scope:** `channel:read:redemptions`
**Volume:** Medium (depends on channel size and reward popularity)

**Fields:**
- `userId`, `userName`, `userDisplayName` - Redeemer identity
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `rewardId`, `rewardTitle`, `rewardCost`, `rewardPrompt` - Reward details
- `userInput` - User-provided text (if reward requires input)
- `status` - Redemption status (`unfulfilled`, `fulfilled`, `canceled`)

**Use Cases:**
- Trigger custom actions (TTS, sound effects, etc.)
- Channel points integrations
- Community engagement

---

#### Hype Train Events

##### channel.hype_train.begin (v2)

**Trigger:** Hype Train starts
**Builder:** `buildHypeTrainBegin`
**OAuth Scope:** None
**Volume:** Low

**Fields:**
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `level` - Current level
- `progress`, `goal` - Progress toward next level
- `startedAt` - When hype train started
- `topContributions` - Top contributors (array)

**Use Cases:**
- Announce hype train start
- Display progress bar
- Community engagement

---

##### channel.hype_train.progress (v2)

**Trigger:** Hype Train level or progress changes
**Builder:** `buildHypeTrainProgress`
**OAuth Scope:** None
**Volume:** **HIGH** (updates every few seconds during hype train)

⚠️ **WARNING:** HIGH VOLUME EVENT - Enable per-channel only, not globally.

**Fields:**
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `level` - Current level
- `progress`, `goal` - Progress toward next level
- `topContributions` - Top contributors (array)

**Use Cases:**
- Real-time progress updates (use sparingly)
- Avoid for most channels (high message volume)

---

##### channel.hype_train.end (v2)

**Trigger:** Hype Train ends
**Builder:** `buildHypeTrainEnd`
**OAuth Scope:** None
**Volume:** Low

**Fields:**
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `level` - Final level achieved
- `cooldownEndsAt` - When next hype train can start
- `topContributions` - Top contributors (array)

**Use Cases:**
- Announce hype train completion
- Celebrate final level
- Community engagement

---

#### Interactive Events

##### channel.poll.begin (v1)

**Trigger:** Poll starts
**Builder:** `buildPollBegin`
**OAuth Scope:** None
**Volume:** Low

**Fields:**
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `pollId`, `title` - Poll identity and question
- `choices` - Array of poll choices
- `channelPointsVoting` - Channel points voting settings
- `startsAt`, `endsAt` - Poll timing

**Use Cases:**
- Announce poll start
- Display poll options
- Community engagement

---

##### channel.poll.end (v1)

**Trigger:** Poll ends (completed, archived, or terminated)
**Builder:** `buildPollEnd`
**OAuth Scope:** None
**Volume:** Low

**Fields:**
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `pollId`, `title` - Poll identity and question
- `choices` - Array of choices with vote counts
- `status` - Poll status (`completed`, `archived`, `terminated`)
- `endedAt` - When poll ended

**Use Cases:**
- Announce poll results
- Display winning choice
- Community engagement

---

##### channel.prediction.begin (v1)

**Trigger:** Prediction starts
**Builder:** `buildPredictionBegin`
**OAuth Scope:** None
**Volume:** Low

**Fields:**
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `predictionId`, `title` - Prediction identity and question
- `outcomes` - Array of prediction outcomes
- `locksAt` - When prediction locks (no more votes)

**Use Cases:**
- Announce prediction start
- Display prediction options
- Community engagement

---

##### channel.prediction.end (v1)

**Trigger:** Prediction ends (resolved or canceled)
**Builder:** `buildPredictionEnd`
**OAuth Scope:** None
**Volume:** Low

**Fields:**
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `predictionId`, `title` - Prediction identity and question
- `outcomes` - Array of outcomes with channel points totals
- `winningOutcomeId` - Winning outcome ID (if resolved)
- `status` - Prediction status (`resolved`, `canceled`)

**Use Cases:**
- Announce prediction results
- Display winning outcome
- Community engagement

---

## Tier 2: Moderation & Chat (5)

**Status:** Disabled by default (HIGH VOLUME, opt-in only)
**Purpose:** Moderation actions and chat events
**Volume:** HIGH (use per-channel overrides only)
**OAuth Scope:** All require `channel:moderate` or `user:read:chat`

| Event Type | Internal Type | OAuth Scope | Priority | Volume | Description |
|------------|---------------|-------------|----------|--------|-------------|
| `channel.ban` | `system.twitch.moderation.ban` | `channel:moderate` | medium | **HIGH** | User timeout or permanent ban |
| `channel.unban` | `system.twitch.moderation.unban` | `channel:moderate` | medium | Medium | User unbanned |
| `channel.moderate` | `system.twitch.moderation.action` | `channel:moderate` | medium | **HIGH** | All moderation actions (includes warnings in v2) |
| `channel.chat.message` | `chat.message.v1` | `user:read:chat` | low | **VERY HIGH** | All chat messages (overlaps with IRC) |
| `channel.chat.message_delete` | `system.twitch.chat.message_delete` | `user:read:chat` | medium | Medium | Message deletions |

⚠️ **WARNING:** Tier 2 events generate high message volume. Enable per-channel only using `channelOverrides`.

### Tier 2 Event Details

#### channel.ban (v1)

**Trigger:** User timeout or permanent ban
**Builder:** `buildBan`
**OAuth Scope:** `channel:moderate`
**Volume:** HIGH (active moderation channels)

**Fields:**
- `userId`, `userName`, `userDisplayName` - Banned user
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `moderatorUserId`, `moderatorUserName`, `moderatorUserDisplayName` - Moderator
- `reason` - Ban reason (can be empty)
- `endsAt` - When ban expires (null for permanent)
- `isPermanent` - Whether ban is permanent

**Use Cases:**
- Moderation logging
- Ban notification systems
- Moderation analytics

---

#### channel.unban (v1)

**Trigger:** User unbanned
**Builder:** `buildUnban`
**OAuth Scope:** `channel:moderate`
**Volume:** Medium

**Fields:**
- `userId`, `userName`, `userDisplayName` - Unbanned user
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `moderatorUserId`, `moderatorUserName`, `moderatorUserDisplayName` - Moderator

**Use Cases:**
- Moderation logging
- Unban notification systems

---

#### channel.moderate (v2)

**Trigger:** Any moderation action (ban, timeout, delete, warn, etc.)
**Builder:** `buildModerate`
**OAuth Scope:** `channel:moderate`
**Volume:** **HIGH** (v2 includes warnings)

⚠️ **NOTE:** v2 includes warning actions which are very frequent.

**Fields:**
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `moderatorUserId`, `moderatorUserName`, `moderatorUserDisplayName` - Moderator
- `action` - Moderation action type
- Additional fields depend on action type

**Use Cases:**
- Comprehensive moderation logging
- Moderation analytics
- **Avoid if only need ban/unban** (use channel.ban/channel.unban instead)

---

#### channel.chat.message (v1)

**Trigger:** Every chat message
**Builder:** `buildChatMessage`
**OAuth Scope:** `user:read:chat`
**Volume:** **VERY HIGH**
**Internal Type:** `chat.message.v1` (same as IRC chat messages)

⚠️ **WARNING:** OVERLAPS WITH IRC. Use IRC for chat messages, not EventSub.

**Fields:**
- `userId`, `userName`, `userDisplayName` - Sender identity
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `message` - Message text and fragments
- `badges`, `color`, `emotes` - Chat metadata

**Use Cases:**
- **NOT RECOMMENDED** - Use IRC chat integration instead
- Only use if IRC connection not available

---

#### channel.chat.message_delete (v1)

**Trigger:** Moderator deletes specific message
**Builder:** `buildChatMessageDelete`
**OAuth Scope:** `user:read:chat`
**Volume:** Medium

**Fields:**
- `broadcasterId`, `broadcasterName`, `broadcasterDisplayName` - Channel identity
- `messageId` - Deleted message ID
- `userId`, `userName`, `userDisplayName` - Original message sender

**Use Cases:**
- Message deletion tracking
- Moderation logging
- Clean up displayed messages

---

## Event Selection Guide

### Always Enable (Core Events)

✅ `channel.follow` - Track followers
✅ `channel.update` - Monitor channel changes
✅ `stream.online` - Stream state management
✅ `stream.offline` - Stream state management

### High Value, Low Risk (Tier 1 - Recommended)

✅ `channel.raid` - Community engagement
✅ `channel.subscribe` - Monetization tracking
✅ `channel.subscription.gift` - Gift subs
✅ `channel.cheer` - Bit donations
✅ `channel.prediction.end` - Prediction results
✅ `channel.poll.end` - Poll results

### Use with Caution (High Volume)

⚠️ `channel.hype_train.progress` - Updates every few seconds
⚠️ `channel.moderate` - Very frequent (includes warnings)
⚠️ `channel.chat.message` - Every chat message (use IRC instead)

### Per-Channel Only (Tier 2 - Moderation)

🔒 Enable via `channelOverrides` only:
- `channel.ban`
- `channel.unban`
- `channel.moderate`
- `channel.chat.message_delete`

---

## OAuth Scope Summary

| Scope | Required For | Events Count |
|-------|--------------|--------------|
| None | Most events | 11 events |
| `moderator:read:followers` | Follow events | 1 event |
| `channel:read:subscriptions` | Subscription events | 3 events |
| `bits:read` | Cheer events | 1 event |
| `channel:read:redemptions` | Channel points | 1 event |
| `channel:moderate` | Moderation events | 3 events |
| `user:read:chat` | Chat events | 2 events |

**Total unique scopes:** 7

---

## Related Documentation

- [EventSub Configuration Guide](../guides/twitch-eventsub-config.md)
- [Adding EventSub Events](../guides/adding-eventsub-events.md)
- [MCP Tools Reference](./mcp-tools-twitch.md)
- [Migration Guide](../../planning/sprint-16-aalwmj/migration-guide.md)

---

**Last Updated:** Sprint 16
**Total Events:** 22
**Status:** Production-ready
