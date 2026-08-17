# Event Config Schema Reference

**Version**: 1.0 (Sprint 13)
**Audience**: Integration developers
**Related**: [Adding Integrations Guide](../guides/adding-integrations.md)

---

## Overview

Event configuration files define **declarative mappings** between platform-specific events and BitBrat's internal event types. These YAML files are stored in `config/platforms/{platform}/{eventType}.yaml` and processed by the TranslationEngine at runtime.

**Purpose:**
- Map platform event fields to `InternalEventV2` schema
- Define filters for event disambiguation (DM vs chat, bot vs human)
- Configure priority for overlapping event types
- Specify bidirectional translation (ingress + egress)

**Location:**
```
config/
├── platforms/           # Platform-specific mappings
│   ├── discord/
│   │   ├── chat-message.v1.yaml
│   │   └── dm-message.v1.yaml
│   ├── slack/
│   │   └── chat-message.v1.yaml
│   └── telegram/
│       └── chat-message.v1.yaml
└── events/              # Event type definitions
    ├── chat-message.v1.yaml
    └── dm-message.v1.yaml
```

---

## Schema Definition

### Root Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platformEvent` | string | Yes | Platform-specific event name (e.g., `MESSAGE_CREATE`, `message`, `new_message`) |
| `internalEventType` | string | Yes | BitBrat internal event type (e.g., `chat.message.v1`, `dm.message.v1`) |
| `priority` | number | No | Disambiguation priority (higher = checked first). Default: `0` |
| `filter` | object | No | JSONLogic filter for event selection (see [Filters](#filters)) |
| `fieldMapping` | object | Yes | Field extraction configuration (see [Field Mapping](#field-mapping)) |
| `egress` | object | No | Reverse translation config for outbound messages (see [Egress](#egress-configuration)) |
| `metadata` | object | No | Documentation metadata (description, URLs, timestamps) |

---

### platformEvent

**Type:** `string`
**Required:** Yes
**Description:** Platform's native event type identifier.

**Examples:**

```yaml
# Discord
platformEvent: MESSAGE_CREATE

# Slack
platformEvent: message

# Twilio
platformEvent: onMessageAdded

# Telegram
platformEvent: message

# Twitch (IRC)
platformEvent: PRIVMSG
```

**Rules:**
- Must match platform's exact event type string
- Case-sensitive
- Can be shared across multiple mappings (use `filter` to disambiguate)

---

### internalEventType

**Type:** `string`
**Required:** Yes
**Description:** BitBrat's normalized event type. Must correspond to a defined event in `config/events/`.

**Format:** `{domain}.{action}.v{version}`

**Standard Event Types:**

| Event Type | Description | Use Case |
|------------|-------------|----------|
| `chat.message.v1` | Public/group chat message | Channels, servers, groups |
| `dm.message.v1` | Direct message (1-on-1) | Private conversations |
| `chat.sent.v1` | Message delivery confirmation | Egress acknowledgment |
| `chat.deleted.v1` | Message deletion event | Moderation |
| `user.joined.v1` | User joined channel/server | Onboarding |
| `user.left.v1` | User left channel/server | Offboarding |

**Example:**
```yaml
internalEventType: chat.message.v1
```

**Rules:**
- Must exist in `config/events/{eventType}.yaml`
- Version number required (enables breaking changes)
- Immutable (never change existing event types, create new versions)

---

### priority

**Type:** `number`
**Required:** No
**Default:** `0`
**Description:** Disambiguation priority for overlapping `platformEvent` values. Higher priority mappings are evaluated first.

**Use Cases:**
- **DM vs Chat**: Telegram uses `message` for both DMs and group chats
- **Event Type Variants**: Discord `MESSAGE_CREATE` can be DM, guild chat, thread, etc.

**Example:**

```yaml
# config/platforms/telegram/dm-message.v1.yaml
platformEvent: message
internalEventType: dm.message.v1
priority: 10  # Checked first

filter:
  "==":
    - var: chat.type
    - private
```

```yaml
# config/platforms/telegram/chat-message.v1.yaml
platformEvent: message
internalEventType: chat.message.v1
priority: 0  # Fallback (checked after priority 10)

# No filter = matches all messages not caught by higher priority
```

**Priority Levels (Convention):**

| Priority | Use Case | Example |
|----------|----------|---------|
| `100` | Critical overrides | Admin commands |
| `10` | Specific filters | DMs, bot messages |
| `0` | Default mappings | Standard chat messages |
| `-10` | Catch-all fallbacks | Unknown event types |

---

### filter

**Type:** `object` (JSONLogic)
**Required:** No
**Description:** JSONLogic expression to determine if event matches this mapping. Evaluated against the raw platform event payload.

**JSONLogic Syntax:** See https://jsonlogic.com for complete reference.

#### Common Patterns

**1. Exclude Bot Messages**

```yaml
filter:
  "!":
    var: from.is_bot
```

**2. Match Specific Event Type**

```yaml
filter:
  "==":
    - var: type
    - message
```

**3. Match Channel Type (DM Detection)**

```yaml
filter:
  "==":
    - var: chat.type
    - private
```

**4. Complex AND Conditions**

```yaml
filter:
  and:
    - "==":
        - var: type
        - message
    - "!":
        var: from.is_bot
    - var: text  # Ensure text field exists
```

**5. OR Conditions**

```yaml
filter:
  or:
    - "==":
        - var: chat.type
        - private
    - "==":
        - var: chat.type
        - direct
```

**6. Field Existence**

```yaml
filter:
  var: sticker  # True if 'sticker' field exists
```

**7. Negation (Field Does NOT Exist)**

```yaml
filter:
  "!":
    var: bot_id  # True if 'bot_id' is null/undefined
```

**8. Numeric Comparison**

```yaml
filter:
  ">":
    - var: message_length
    - 0
```

#### JSONLogic Reference Table

| Operator | Description | Example |
|----------|-------------|---------|
| `var` | Access field | `{ "var": "user.id" }` |
| `==` | Equality | `{ "==": [{"var": "type"}, "message"] }` |
| `!=` | Inequality | `{ "!=": [{"var": "status"}, "deleted"] }` |
| `!` | Negation | `{ "!": {"var": "is_bot"} }` |
| `and` | Logical AND | `{ "and": [...conditions] }` |
| `or` | Logical OR | `{ "or": [...conditions] }` |
| `>`, `<`, `>=`, `<=` | Comparison | `{ ">": [{"var": "age"}, 18] }` |
| `in` | Array contains | `{ "in": ["admin", {"var": "roles"}] }` |

---

### fieldMapping

**Type:** `object`
**Required:** Yes
**Description:** Maps platform event fields to `InternalEventV2` schema.

#### Standard Fields

These fields map to top-level `InternalEventV2` properties:

| Field | Type | Required | Maps To |
|-------|------|----------|---------|
| `userId` | string | Yes | `identity.external.id` |
| `userName` | string | Yes | `identity.external.displayName` |
| `messageText` | string | Yes* | `message.text` |
| `messageId` | string | Yes | `message.id` |
| `channelId` | string | Yes | `ingress.channel` |
| `timestamp` | string/number | No | `message.timestamp` |
| `threadId` | string | No | `ingress.thread` |
| `teamId` | string | No | `ingress.team` |

\* Required for message events, optional for others.

#### Simple Path Mapping

```yaml
fieldMapping:
  userId: from.id
  userName: from.username
  messageText: text
  messageId: message_id
  channelId: chat.id
```

**Syntax:** `fieldName: path.to.value`
**Path Notation:** Use dot notation for nested fields (e.g., `from.id`)

#### Fallback Mapping

Specify multiple candidate paths; first non-null value wins.

```yaml
fieldMapping:
  userName:
    path: from.username
    fallbacks:
      - from.first_name
      - from.display_name
      - from.id
```

**Evaluation:**
1. Try `from.username`
2. If null/undefined, try `from.first_name`
3. If null/undefined, try `from.display_name`
4. If null/undefined, use `from.id`

#### Required Fields

Mark fields as required to fail fast on missing data:

```yaml
fieldMapping:
  userId:
    path: from.id
    required: true  # Throws error if missing

  userName:
    path: from.username
    required: false  # Optional
```

**Default:** `required: false`

#### Custom Fields

Store platform-specific metadata in `custom`:

```yaml
fieldMapping:
  # Standard fields
  userId: from.id
  messageText: text

  # Custom fields (nested under event.custom)
  custom:
    chatType: chat.type
    isBot: from.is_bot
    languageCode: from.language_code
    sticker.emoji: sticker.emoji
    entities[0].type: entities.0.type
```

**Access in Code:**
```typescript
const chatType = event.custom?.chatType;
const isBot = event.custom?.isBot;
```

#### Array Indexing

Access array elements using bracket notation:

```yaml
fieldMapping:
  custom:
    firstEntityType: entities.0.type
    secondEntityUrl: entities.1.url
```

**Platform Event:**
```json
{
  "entities": [
    { "type": "mention", "user_id": 123 },
    { "type": "url", "url": "https://example.com" }
  ]
}
```

**Result:**
```typescript
event.custom = {
  firstEntityType: "mention",
  secondEntityUrl: "https://example.com"
}
```

---

### egress

**Type:** `object`
**Required:** No
**Description:** Reverse translation configuration for sending messages back to the platform (InternalEventV2 → Platform API).

#### Structure

```yaml
egress:
  method: sendText           # Connector method name
  fieldMapping:
    chat_id: egress.channel  # Platform field: InternalEventV2 path
    text: message.text
    parse_mode: egress.parseMode
```

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | string | Yes | Connector method to call (e.g., `sendText`, `sendMessage`) |
| `fieldMapping` | object | Yes | Maps InternalEventV2 fields to platform API parameters |

#### Example: Telegram Egress

```yaml
# config/platforms/telegram/chat-message.v1.yaml
egress:
  method: sendText
  fieldMapping:
    chat_id: egress.channel       # InternalEventV2.egress.channel → Telegram chat_id
    text: message.text             # InternalEventV2.message.text → Telegram text
    parse_mode: egress.parseMode   # Optional: Markdown/HTML
```

**InternalEventV2 (Input):**
```typescript
{
  message: { text: "Hello from BitBrat!" },
  egress: { channel: "-1001234567890", parseMode: "Markdown" }
}
```

**Telegram API Call (Output):**
```typescript
bot.telegram.sendMessage({
  chat_id: "-1001234567890",
  text: "Hello from BitBrat!",
  parse_mode: "Markdown"
})
```

#### Example: Discord Egress (DM)

```yaml
# config/platforms/discord/dm-message.v1.yaml
egress:
  method: sendDirectMessage
  fieldMapping:
    userId: egress.userId         # Discord user ID
    content: message.text          # Message content
```

**InternalEventV2 (Input):**
```typescript
{
  message: { text: "DM reply" },
  egress: { userId: "123456789012345678" }
}
```

**Discord API Call (Output):**
```typescript
client.users.send("123456789012345678", "DM reply")
```

---

### metadata

**Type:** `object`
**Required:** No
**Description:** Documentation and tracking metadata. Not used by TranslationEngine; purely informational.

#### Fields

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Human-readable event description |
| `platformDocUrl` | string | Link to platform's official event documentation |
| `createdBy` | string | Team/person who created this mapping |
| `createdAt` | string | ISO 8601 date (YYYY-MM-DD) |
| `lastModified` | string | ISO 8601 date of last edit |
| `notes` | string | Implementation notes, caveats, TODOs |
| `featureFlag` | string | Feature flag name (if gated) |

#### Example

```yaml
metadata:
  description: Telegram chat message (groups, channels)
  platformDocUrl: https://core.telegram.org/bots/api#message
  createdBy: Platform Team
  createdAt: "2026-08-14"
  lastModified: "2026-08-14"
  notes: |
    This mapping excludes photo/video messages.
    Text-only messages are processed.
  featureFlag: telegram.chat_messages
```

---

## Complete Examples

### Example 1: Discord Guild Chat

```yaml
# config/platforms/discord/chat-message.v1.yaml
platformEvent: MESSAGE_CREATE
internalEventType: chat.message.v1
priority: 0

fieldMapping:
  userId: author.id
  userName:
    path: author.username
    fallbacks:
      - author.global_name
      - author.id
  messageText: content
  messageId: id
  channelId: channel.id
  timestamp: timestamp

  custom:
    guildId: guild_id
    channelType: channel.type
    identity.discriminator: author.discriminator
    identity.avatarUrl: author.avatar
    identity.isBot: author.bot

metadata:
  description: Discord guild/server chat message
  platformDocUrl: https://discord.com/developers/docs/resources/channel#message-object
  createdBy: Platform Team
  createdAt: "2026-01-15"
```

---

### Example 2: Slack Chat with Filter

```yaml
# config/platforms/slack/chat-message.v1.yaml
platformEvent: message
internalEventType: chat.message.v1
priority: 0

# Filter: Exclude bot messages and ensure correct type
filter:
  and:
    - "==":
        - var: type
        - message
    - "!":
        var: bot_id

fieldMapping:
  userId:
    path: user
    required: true
  channelId:
    path: channel
    required: true
  messageText:
    path: text
    required: true
  messageId:
    path: ts
    required: true
  userName:
    path: user
    fallbacks:
      - user
  teamId: team
  threadTs: thread_ts

egress:
  method: sendText
  fieldMapping:
    channel: egress.channel
    text: message.text
```

---

### Example 3: Telegram DM (High Priority)

```yaml
# config/platforms/telegram/dm-message.v1.yaml
platformEvent: message
internalEventType: dm.message.v1
priority: 10  # Higher priority = checked before chat-message.v1

# Filter: Only private chats (DMs)
filter:
  "==":
    - var: chat.type
    - private

fieldMapping:
  userId: from.id
  userName:
    path: from.username
    fallbacks:
      - from.first_name
      - from.id
  messageText: text
  messageId: message_id
  channelId: chat.id
  timestamp: date

  custom:
    isBot: from.is_bot
    languageCode: from.language_code

egress:
  method: sendText
  fieldMapping:
    chat_id: egress.channel
    text: message.text

metadata:
  description: Telegram direct message (1-on-1)
  platformDocUrl: https://core.telegram.org/bots/api#message
  createdBy: Platform Team
  createdAt: "2026-08-14"
```

---

## Validation

Use `brat integration validate` to check YAML syntax and schema compliance:

```bash
npm run brat -- integration validate telegram
```

**Validation Checks:**
- ✓ Valid YAML syntax
- ✓ Required fields present (`platformEvent`, `internalEventType`, `fieldMapping`)
- ✓ `internalEventType` exists in `config/events/`
- ✓ `filter` has valid JSONLogic syntax
- ✓ Standard field mappings reference valid `InternalEventV2` paths
- ✓ No duplicate `platformEvent` + `priority` combinations

**Common Errors:**

| Error | Fix |
|-------|-----|
| `Missing required field 'platformEvent'` | Add `platformEvent: <name>` |
| `Invalid JSONLogic syntax` | Validate at https://jsonlogic.com |
| `Unknown internalEventType 'chat.message.v2'` | Use existing type or define in `config/events/` |
| `Duplicate mapping for 'MESSAGE_CREATE' with priority 0` | Use `filter` or different `priority` |

---

## Best Practices

### 1. Use Fallbacks for Optional Fields

```yaml
# ❌ Fragile (breaks if username missing)
userName: author.username

# ✅ Resilient (graceful degradation)
userName:
  path: author.username
  fallbacks:
    - author.global_name
    - author.display_name
    - author.id
```

### 2. Explicit Filters for Disambiguation

```yaml
# ❌ Ambiguous (DMs and chats both match)
platformEvent: message
internalEventType: chat.message.v1

# ✅ Clear (filter excludes DMs)
platformEvent: message
internalEventType: chat.message.v1
filter:
  "!=":
    - var: chat.type
    - private
```

### 3. Document Platform-Specific Quirks

```yaml
metadata:
  notes: |
    Slack doesn't include user display names in message events.
    Use the 'users.info' API to resolve user IDs to names.

    Event timestamp 'ts' is a string like "1723680000.123456".
```

### 4. Mark Required Fields Explicitly

```yaml
fieldMapping:
  userId:
    path: from.id
    required: true  # Fail fast if missing
```

### 5. Use Custom Fields for Platform-Specific Data

```yaml
custom:
  # Telegram-specific
  forwardFrom: forward_from.id
  replyToMessage: reply_to_message.id

  # Discord-specific
  guildId: guild_id
  mentions: mentions
```

---

## Migration from Code-Based Translation

**Before (TypeScript):**
```typescript
export class TelegramTranslator {
  translate(event: TelegramMessage): InternalEventV2 {
    return {
      identity: {
        external: {
          id: event.from.id.toString(),
          platform: 'telegram',
          displayName: event.from.username || event.from.first_name || event.from.id.toString()
        }
      },
      message: {
        text: event.text || '',
        id: event.message_id.toString(),
        timestamp: new Date(event.date * 1000).toISOString()
      },
      ingress: {
        connector: 'telegram',
        channel: event.chat.id.toString()
      }
    };
  }
}
```

**After (YAML):**
```yaml
# config/platforms/telegram/chat-message.v1.yaml
platformEvent: message
internalEventType: chat.message.v1

fieldMapping:
  userId: from.id
  userName:
    path: from.username
    fallbacks:
      - from.first_name
      - from.id
  messageText: text
  messageId: message_id
  channelId: chat.id
  timestamp: date
```

**Benefits:**
- ✅ 70% less code
- ✅ No TypeScript compilation required
- ✅ Validated at build time
- ✅ Testable without code (`brat integration test`)

---

## Related Documentation

- **[Adding Integrations Guide](../guides/adding-integrations.md)** - Step-by-step implementation
- **[Telegram Integration Tutorial](../tutorials/telegram-integration-10-minutes.md)** - 10-minute quickstart
- **[Translation Engine Architecture](../concepts/translation-engine.md)** - Technical deep dive
- **[JSONLogic Documentation](https://jsonlogic.com)** - Filter syntax reference

---

## Schema Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-08-14 | Initial Sprint 13 release |

---

**Questions?** See existing configurations in `config/platforms/` or consult the Platform Team.
