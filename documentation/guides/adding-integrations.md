# Adding New Platform Integrations

**Audience**: Developers integrating new chat platforms (Telegram, WhatsApp, Matrix, etc.)
**Prerequisites**: TypeScript, understanding of target platform's API, BitBrat running locally
**Sprint**: 13 - YAML-Driven Integration Framework

---

## Overview

Sprint 13 introduced a **declarative, YAML-driven approach** for integrating new chat platforms into BitBrat. Instead of manually implementing translation logic in code, you define field mappings in YAML configuration files and use CLI commands to scaffold, validate, and test your integration.

**What changed in Sprint 13:**
- ✅ **YAML Event Mappings**: Declarative field mapping with fallbacks, filters, priorities
- ✅ **CLI Scaffolding**: `brat integration create` generates all boilerplate
- ✅ **Automated Testing**: `brat integration test` validates mappings without writing tests
- ✅ **Egress Support**: Bidirectional translation (ingress + egress) in one config file

**Migration Note**: If you have existing integrations from Sprint 342 (manual approach), they continue to work. New integrations should use the Sprint 13 approach documented here. See [Adding Ingress Platform (Sprint 342)](./adding-ingress-platform.md) for legacy approach.

---

## Quick Start (5 Minutes)

```bash
# 1. Scaffold a new integration
npm run brat -- integration create telegram \
  --api-client telegraf \
  --docs https://core.telegram.org/bots/api

# 2. Update YAML event mappings
vim config/platforms/telegram/chat-message.v1.yaml

# 3. Validate configuration
npm run brat -- integration validate telegram

# 4. Test with sample data
npm run brat -- integration test telegram --event chat-message.v1 \
  --fixture ./test/fixtures/telegram-message.json

# 5. Test egress translation
npm run brat -- integration test-egress telegram \
  --event chat-message.v1 \
  --fixture ./test/fixtures/internal-event.json

# 6. Implement client logic
vim src/services/ingress/telegram/telegram-ingress-client.ts

# 7. Register connector
# (see Step 5 below)
```

---

## Architecture: Sprint 13 vs Sprint 342

### Sprint 342 Approach (Legacy)

```typescript
// Manual translation in code (verbose, error-prone)
export class PlatformTranslator {
  translate(platformEvent: any): InternalEventV2 {
    return {
      identity: {
        external: {
          id: platformEvent.author?.id || platformEvent.user?.id,
          platform: 'platform-name'
        }
      },
      message: {
        text: platformEvent.content || platformEvent.text || ''
      }
      // ... 50+ more lines of mapping logic
    };
  }
}
```

**Problems:**
- ❌ Translation logic scattered across codebase
- ❌ No validation until runtime
- ❌ Hard to debug field mapping issues
- ❌ Requires TypeScript knowledge to add new platforms

### Sprint 13 Approach (Current)

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
```

**Benefits:**
- ✅ Declarative, self-documenting
- ✅ Validated at build time (`brat integration validate`)
- ✅ Tested without code (`brat integration test`)
- ✅ Non-developers can add platforms

---

## Step-by-Step Implementation

### Step 1: Scaffold the Integration

Use the `brat integration create` command to generate all boilerplate:

```bash
npm run brat -- integration create telegram \
  --api-client telegraf \
  --docs https://core.telegram.org/bots/api
```

**What this generates:**

```
src/services/ingress/telegram/
├── connector-adapter.ts           # IngressConnector + WebhookConnector implementation
├── telegram-ingress-client.ts     # Real-time client (YOU IMPLEMENT)
└── connector-adapter.test.ts      # Jest tests

config/platforms/telegram/
└── chat-message.v1.yaml           # YAML event mapping (YOU CUSTOMIZE)
```

**CLI Output:**
```
✔ Created src/services/ingress/telegram/connector-adapter.ts
✔ Created src/services/ingress/telegram/telegram-ingress-client.ts
✔ Created src/services/ingress/telegram/connector-adapter.test.ts
✔ Created config/platforms/telegram/chat-message.v1.yaml

Next steps:
1. npm install telegraf
2. Update config/platforms/telegram/chat-message.v1.yaml with Telegram's actual event structure
3. Implement src/services/ingress/telegram/telegram-ingress-client.ts
4. Validate: npm run brat -- integration validate telegram
5. Test: npm run brat -- integration test telegram --event chat-message.v1
6. Register in src/apps/ingress-egress-service.ts
```

**Dry-Run Mode:**
```bash
npm run brat -- integration create telegram --dry-run
# Shows what files would be created without modifying filesystem
```

---

### Step 2: Customize YAML Event Mappings

Open `config/platforms/telegram/chat-message.v1.yaml` and customize field mappings to match Telegram's actual event structure.

**Example: Telegram Chat Message**

```yaml
# config/platforms/telegram/chat-message.v1.yaml
platformEvent: message
internalEventType: chat.message.v1
priority: 0

# Filter: Only process text messages (exclude photos, stickers, etc.)
filter:
  "!":
    var: photo

fieldMapping:
  # User identity
  userId: from.id
  userName:
    path: from.username
    fallbacks:
      - from.first_name
      - from.id

  # Message content
  messageText: text
  messageId: message_id
  timestamp: date

  # Channel/chat metadata
  channelId: chat.id

  # Custom fields (Telegram-specific)
  custom:
    chatType: chat.type
    isBot: from.is_bot
    languageCode: from.language_code

# Egress mapping (for sending messages back to Telegram)
egress:
  method: sendText
  fieldMapping:
    chat_id: egress.channel
    text: message.text

metadata:
  description: Telegram chat message
  platformDocUrl: https://core.telegram.org/bots/api#message
  createdBy: Platform Team
  createdAt: "2026-08-14"
```

**Key Concepts:**

| Field | Description | Example |
|-------|-------------|---------|
| `platformEvent` | Platform-specific event name | `message`, `MESSAGE_CREATE`, `message.new` |
| `internalEventType` | BitBrat event type | `chat.message.v1`, `dm.message.v1` |
| `priority` | Disambiguation priority (higher = checked first) | `10` (DM), `0` (chat) |
| `filter` | JSONLogic filter for event selection | Exclude bots, match event type |
| `fieldMapping` | Field extraction with fallbacks | See below |
| `egress` | Reverse mapping (InternalEventV2 → Platform) | Optional |

**Field Mapping Patterns:**

```yaml
# Simple path
userId: from.id

# Path with fallbacks (first non-null value wins)
userName:
  path: from.username
  fallbacks:
    - from.first_name
    - from.id

# Required field (throws error if missing)
messageText:
  path: text
  required: true

# Custom nested fields (stored in event.custom)
custom:
  chatType: chat.type
  threadId: message_thread_id
```

**Filter Examples (JSONLogic):**

```yaml
# Exclude bot messages
filter:
  "!":
    var: from.is_bot

# Match specific event type
filter:
  "==":
    - var: type
    - message

# Complex AND filter
filter:
  and:
    - "==":
        - var: type
        - message
    - "!":
        var: from.is_bot
    - var: text  # Ensure text field exists
```

See [Event Config Schema Reference](../reference/event-config-schema.md) for complete syntax.

---

### Step 3: Validate Configuration

Use `brat integration validate` to check YAML syntax, schema compliance, and field references:

```bash
npm run brat -- integration validate telegram
```

**Output (Success):**
```
✔ Validating telegram integration...

Platform: telegram
Events:
  ✔ chat-message.v1
    - platformEvent: message
    - internalEventType: chat.message.v1
    - Fields: userId, userName, messageText, messageId, channelId
    - Filter: Excludes photos
    - Egress: sendText (chat_id, text)

Validation passed: 1 event(s), 0 error(s), 0 warning(s)
```

**Output (Errors):**
```
✖ Validating telegram integration...

Errors:
  - chat-message.v1: Missing required field 'userId'
  - chat-message.v1: Invalid filter syntax (line 12)
  - chat-message.v1: Unknown internalEventType 'chat.message.v2'

Validation failed: 3 error(s)
```

**Common Validation Errors:**

| Error | Cause | Fix |
|-------|-------|-----|
| `Missing required field 'X'` | Field not mapped | Add `X: path.to.field` in `fieldMapping` |
| `Invalid filter syntax` | JSONLogic syntax error | Check JSONLogic structure |
| `Unknown internalEventType` | Event type not defined | Use existing type or define in `config/events/` |
| `Duplicate platformEvent` | Same event mapped twice | Use `priority` or `filter` to disambiguate |

---

### Step 4: Test with Sample Data

Create test fixtures and validate end-to-end translation:

**4a. Create Ingress Test Fixture**

```bash
mkdir -p test/fixtures/telegram-events
cat > test/fixtures/telegram-events/chat-message.json <<'EOF'
{
  "message_id": 123,
  "from": {
    "id": 987654321,
    "is_bot": false,
    "first_name": "Alice",
    "username": "alice_tg",
    "language_code": "en"
  },
  "chat": {
    "id": -1001234567890,
    "type": "supergroup",
    "title": "Test Group"
  },
  "date": 1723680000,
  "text": "Hello from Telegram!"
}
EOF
```

**4b. Run Ingress Test**

```bash
npm run brat -- integration test telegram \
  --event chat-message.v1 \
  --fixture ./test/fixtures/telegram-events/chat-message.json
```

**Output:**
```
✔ Testing telegram integration (chat-message.v1)

Input (Telegram):
{
  "message_id": 123,
  "from": { "id": 987654321, "username": "alice_tg" },
  "text": "Hello from Telegram!"
}

Output (InternalEventV2):
{
  "identity": {
    "external": { "id": "987654321", "platform": "telegram" }
  },
  "message": { "text": "Hello from Telegram!" },
  "ingress": { "connector": "telegram", "channel": "-1001234567890" },
  "custom": { "chatType": "supergroup", "isBot": false }
}

✔ Test passed: All required fields present
```

**4c. Test Egress (Reverse Translation)**

Create an internal event fixture:

```bash
cat > test/fixtures/internal-events/chat-message.json <<'EOF'
{
  "identity": { "external": { "id": "987654321", "platform": "telegram" } },
  "message": { "text": "Reply from BitBrat" },
  "egress": { "channel": "-1001234567890" }
}
EOF
```

Test egress translation:

```bash
npm run brat -- integration test-egress telegram \
  --event chat-message.v1 \
  --fixture ./test/fixtures/internal-events/chat-message.json
```

**Output:**
```
✔ Testing telegram egress (chat-message.v1)

Input (InternalEventV2):
{
  "message": { "text": "Reply from BitBrat" },
  "egress": { "channel": "-1001234567890" }
}

Output (Telegram API):
{
  "chat_id": "-1001234567890",
  "text": "Reply from BitBrat"
}

✔ Egress test passed
```

---

### Step 5: Implement Platform Client

Open the generated client file and implement the TODO sections:

**File:** `src/services/ingress/telegram/telegram-ingress-client.ts`

```typescript
import { Telegraf, Context } from 'telegraf';
import { Message } from 'telegraf/typings/core/types/typegram';
import { EventEmitter } from 'events';

export interface TelegramIngressClientConfig {
  botToken: string;
}

export class TelegramIngressClient extends EventEmitter {
  private bot: Telegraf | null = null;
  private state: 'STOPPED' | 'STARTING' | 'CONNECTED' | 'ERROR' = 'STOPPED';
  private messageCount = 0;
  private lastError?: string;
  private lastMessageAt?: string;

  constructor(private readonly config: TelegramIngressClientConfig) {
    super();
  }

  async start(): Promise<void> {
    if (this.state !== 'STOPPED') {
      throw new Error('telegram_client.already_started');
    }

    this.state = 'STARTING';

    try {
      // Initialize Telegraf bot
      this.bot = new Telegraf(this.config.botToken);

      // Register message handler
      this.bot.on('message', async (ctx: Context) => {
        if ('text' in ctx.message) {
          await this.handleMessage(ctx.message);
        }
      });

      // Start polling
      await this.bot.launch();
      this.state = 'CONNECTED';
      this.emit('connected');
    } catch (error) {
      this.state = 'ERROR';
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
    }
    this.state = 'STOPPED';
  }

  private async handleMessage(message: Message.TextMessage): Promise<void> {
    this.messageCount++;
    this.lastMessageAt = new Date().toISOString();

    // Emit normalized event (ConnectorAdapter will handle translation)
    this.emit('message', {
      message_id: message.message_id,
      from: message.from,
      chat: message.chat,
      date: message.date,
      text: message.text
    });
  }

  async sendText(text: string, chatId: string): Promise<void> {
    if (!this.bot) {
      throw new Error('telegram_client.not_started');
    }
    await this.bot.telegram.sendMessage(chatId, text);
  }

  getSnapshot() {
    return {
      state: this.state,
      identity: this.config.botToken ? 'telegram-bot' : 'unknown',
      displayName: 'Telegram Bot',
      lastError: this.lastError,
      counters: { messageCount: this.messageCount },
      lastMessageAt: this.lastMessageAt
    };
  }
}
```

**Key Implementation Points:**
- **Extend EventEmitter**: Emit `'message'` events for ConnectorAdapter
- **State Management**: Track connection state (STOPPED → STARTING → CONNECTED)
- **Error Handling**: Set `this.lastError` on failures
- **Counters**: Track `messageCount`, `lastMessageAt` for diagnostics
- **Graceful Shutdown**: Implement `stop()` for clean disconnection

---

### Step 6: Register Connector

Update `src/apps/ingress-egress-service.ts` to register your connector:

```typescript
import { TelegramIngressClient } from '../services/ingress/telegram/telegram-ingress-client';
import { TelegramConnectorAdapter } from '../services/ingress/telegram/connector-adapter';

export class IngressEgressService extends Bit {
  async setup(): Promise<void> {
    const cfg = this.getConfig();
    const manager = new ConnectorManager();

    // ... existing connectors (Discord, Slack, etc.) ...

    // Register Telegram connector
    if (cfg.telegramEnabled) {
      const telegramClient = new TelegramIngressClient({
        botToken: cfg.telegramBotToken!
      });
      manager.register('telegram', new TelegramConnectorAdapter(telegramClient, cfg));
      this.logger.info('telegram.init_ok');
    }

    await manager.startAll();
  }
}
```

---

### Step 7: Add Configuration

**architecture.yaml:**
```yaml
services:
  ingress-egress:
    env:
      TELEGRAM_ENABLED: "true"
    secrets:
      TELEGRAM_BOT_TOKEN: telegram-bot-token
```

**src/types/config.ts:**
```typescript
export interface IConfig {
  // ... existing fields ...

  // Telegram Configuration
  telegramEnabled: boolean;
  telegramBotToken?: string;
}
```

**Local Development (.env):**
```bash
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

---

### Step 8: Build and Test End-to-End

```bash
# Install dependencies
npm install telegraf

# Build TypeScript
npm run build

# Run tests
npm test -- telegram

# Start local stack
npm run local

# Test with brat chat
npm run brat -- chat
```

Send a message from Telegram and verify it appears in `brat chat`.

---

## Advanced Features

### Priority and Disambiguation

Use `priority` to handle platforms with overlapping event types:

```yaml
# config/platforms/telegram/dm-message.v1.yaml
platformEvent: message
internalEventType: dm.message.v1
priority: 10  # Higher priority = checked first

filter:
  "==":
    - var: chat.type
    - private  # Only DMs
```

```yaml
# config/platforms/telegram/chat-message.v1.yaml
platformEvent: message
internalEventType: chat.message.v1
priority: 0  # Lower priority = fallback

# No filter = matches all messages not matched by higher priority mappings
```

### Nested Custom Fields

Store platform-specific metadata in `custom`:

```yaml
fieldMapping:
  custom:
    # Simple fields
    chatType: chat.type
    isBot: from.is_bot

    # Nested objects
    sticker.emoji: sticker.emoji
    sticker.setName: sticker.set_name

    # Arrays (first element)
    entities[0].type: entities.0.type
```

### Feature Flags

Gate features behind runtime flags:

```yaml
# config/platforms/telegram/inline-query.v1.yaml
platformEvent: inline_query
internalEventType: bot.inline_query.v1

# Metadata for feature flag
metadata:
  featureFlag: telegram.inline_queries
  description: Telegram inline queries (@botname search)
```

Check flag in connector:

```typescript
async handleInlineQuery(query: InlineQuery): Promise<void> {
  if (!this.config.telegramInlineQueriesEnabled) {
    return; // Feature disabled
  }
  // ... handle inline query ...
}
```

---

## Troubleshooting

### Validation Errors

**Problem:** `Missing required field 'userId'`

**Solution:** Ensure field is mapped in `fieldMapping`:
```yaml
fieldMapping:
  userId: from.id  # ← Add this
```

---

**Problem:** `Invalid filter syntax`

**Solution:** Validate JSONLogic structure at https://jsonlogic.com/

```yaml
# ❌ Invalid
filter:
  var: from.is_bot

# ✅ Valid
filter:
  "!":
    var: from.is_bot
```

---

### Test Failures

**Problem:** `Test passed but output missing 'message.text'`

**Solution:** Check field path in fixture:
```bash
# Fixture has wrong field name
{ "message": "Hello" }  # ❌

# Should be:
{ "text": "Hello" }  # ✅
```

---

### Runtime Errors

**Problem:** `TypeError: Cannot read property 'id' of undefined`

**Solution:** Use fallbacks for optional fields:
```yaml
# ❌ Fragile
userId: from.id

# ✅ Resilient
userId:
  path: from.id
  fallbacks:
    - user.id
    - author.id
```

---

## Migration from Sprint 342

If you have existing integrations from Sprint 342, migration is optional but recommended:

**Before (Sprint 342):**
```typescript
// src/services/ingress/platform/translator.ts
export class PlatformTranslator {
  translate(event: any): InternalEventV2 {
    return {
      identity: { external: { id: event.user.id, platform: 'platform' } },
      message: { text: event.text }
    };
  }
}
```

**After (Sprint 13):**
```yaml
# config/platforms/platform/chat-message.v1.yaml
platformEvent: message
internalEventType: chat.message.v1
fieldMapping:
  userId: user.id
  messageText: text
```

**Migration Steps:**
1. Run `brat integration create` for your platform
2. Copy field mappings from TypeScript to YAML
3. Test with `brat integration test`
4. Remove old translator class
5. Update ConnectorAdapter to use TranslationEngine

See [Migration Guide](../planning/sprint-13-eahhvf/migration-guide.md) for detailed instructions.

---

## Related Documentation

- **[Event Config Schema Reference](../reference/event-config-schema.md)** - Complete YAML syntax
- **[Telegram Integration Tutorial](../tutorials/telegram-integration-10-minutes.md)** - 10-minute quickstart
- **[Adding Ingress Platform (Sprint 342)](./adding-ingress-platform.md)** - Legacy manual approach
- **[Translation Engine Architecture](../concepts/translation-engine.md)** - Technical deep dive

---

## Next Steps

After completing your integration:

1. **Run validation suite:**
   ```bash
   npm run brat -- integration validate telegram
   npm run brat -- integration test telegram --all-events
   ```

2. **Add comprehensive tests:**
   ```bash
   npm test -- telegram
   ```

3. **Deploy to staging:**
   ```bash
   npm run brat -- deploy service ingress-egress --env staging
   ```

4. **Monitor logs:**
   ```bash
   npm run brat -- fleet logs ingress-egress --level info
   ```

5. **Document platform-specific quirks** in `config/platforms/telegram/README.md`

---

**Questions?** Consult existing integrations in `config/platforms/` or reach out to the Platform Team.
