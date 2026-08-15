---
title: "Telegram Integration in 10 Minutes"
audience: [ai-agents, developers]
difficulty: beginner
prerequisites:
  - "BitBrat platform running locally (see Quickstart)"
  - "Telegram account + bot token"
  - "Basic command-line familiarity"
related:
  - "../guides/adding-integrations.md"
  - "../reference/event-config-schema.md"
estimated_time: "10 minutes"
---

# Tutorial: Add Telegram Integration in 10 Minutes

This tutorial walks you through adding a complete Telegram integration to BitBrat using the Sprint 13 YAML-driven approach.

## Objective

By the end of this tutorial, you will have:
1. ✅ Scaffolded a Telegram integration using CLI commands
2. ✅ Configured YAML event mappings for chat messages
3. ✅ Validated the configuration
4. ✅ Tested ingress/egress translation
5. ✅ Connected your Telegram bot to BitBrat

---

## Prerequisites

**Required:**
- BitBrat running locally (`npm run local`)
- Telegram bot token (get one from [@BotFather](https://t.me/botfather))
- 10 minutes

**Optional:**
- Telegram account for testing

**RULE:** Complete prerequisites before starting.

---

## Step 1: Get Telegram Bot Token (2 minutes)

If you don't have a Telegram bot token:

1. Open Telegram and message [@BotFather](https://t.me/botfather)
2. Send `/newbot`
3. Follow prompts to create your bot:
   - **Bot name:** `BitBrat Test Bot`
   - **Username:** `bitbrat_test_bot` (must be unique)
4. Copy the bot token (looks like `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`)

**Save your token:**
```bash
export TELEGRAM_BOT_TOKEN="your_token_here"
```

---

## Step 2: Scaffold the Integration (30 seconds)

Run the scaffold command:

```bash
npm run brat -- integration create telegram \
  --api-client telegraf \
  --docs https://core.telegram.org/bots/api
```

**Expected output:**
```
✔ Created src/services/ingress/telegram/connector-adapter.ts
✔ Created src/services/ingress/telegram/telegram-ingress-client.ts
✔ Created src/services/ingress/telegram/connector-adapter.test.ts
✔ Created config/platforms/telegram/chat-message.v1.yaml

Next steps:
1. npm install telegraf
2. Update config/platforms/telegram/chat-message.v1.yaml
```

---

## Step 3: Install Telegram SDK (30 seconds)

```bash
npm install telegraf
npm run build
```

---

## Step 4: Configure Event Mapping (2 minutes)

Open `config/platforms/telegram/chat-message.v1.yaml` and **replace** its contents with:

```yaml
# Telegram Chat Message Mapping
platformEvent: message
internalEventType: chat.message.v1
priority: 0

# Filter: Only process text messages in groups/channels
filter:
  and:
    - var: text
    - "!=":
        - var: chat.type
        - private

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

  # Channel metadata
  channelId: chat.id

  # Custom Telegram-specific fields
  custom:
    chatType: chat.type
    chatTitle: chat.title
    isBot: from.is_bot
    languageCode: from.language_code

# Egress configuration (sending messages back)
egress:
  method: sendText
  fieldMapping:
    chat_id: egress.channel
    text: message.text

metadata:
  description: Telegram group/channel chat message
  platformDocUrl: https://core.telegram.org/bots/api#message
  createdBy: Tutorial
  createdAt: "2026-08-14"
```

**Save the file.**

---

## Step 5: Validate Configuration (30 seconds)

```bash
npm run brat -- integration validate telegram
```

**Expected output:**
```
✔ Validating telegram integration...

Platform: telegram
Events:
  ✔ chat-message.v1
    - platformEvent: message
    - internalEventType: chat.message.v1
    - Fields: userId, userName, messageText, messageId, channelId
    - Filter: Text messages in groups

Validation passed: 1 event(s), 0 error(s)
```

---

## Step 6: Test with Sample Data (1 minute)

Create a test fixture:

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
    "title": "BitBrat Test Group"
  },
  "date": 1723680000,
  "text": "Hello from Telegram!"
}
EOF
```

Run ingress test:

```bash
npm run brat -- integration test telegram \
  --event chat-message.v1 \
  --fixture ./test/fixtures/telegram-events/chat-message.json
```

**Expected output:**
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
  "ingress": { "connector": "telegram", "channel": "-1001234567890" }
}

✔ Test passed: All required fields present
```

---

## Step 7: Implement Client (3 minutes)

Open `src/services/ingress/telegram/telegram-ingress-client.ts` and **replace** its contents with:

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
      this.bot = new Telegraf(this.config.botToken);

      // Handle text messages
      this.bot.on('message', async (ctx: Context) => {
        if ('text' in ctx.message) {
          await this.handleMessage(ctx.message);
        }
      });

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

    // Emit message event for ConnectorAdapter
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
      identity: 'telegram-bot',
      displayName: 'Telegram Bot',
      lastError: this.lastError,
      counters: { messageCount: this.messageCount },
      lastMessageAt: this.lastMessageAt
    };
  }
}
```

**Save the file.**

---

## Step 8: Register Connector (1 minute)

Open `src/apps/ingress-egress-service.ts` and add Telegram registration:

**Find this section** (around line 50):
```typescript
// Register Discord connector
if (cfg.discordEnabled && cfg.discordBotToken) {
  // ... existing Discord code ...
}
```

**Add AFTER the Discord block:**
```typescript
// Register Telegram connector
if (cfg.telegramEnabled && cfg.telegramBotToken) {
  const { TelegramIngressClient } = await import('../services/ingress/telegram/telegram-ingress-client');
  const { TelegramConnectorAdapter } = await import('../services/ingress/telegram/connector-adapter');

  const telegramClient = new TelegramIngressClient({
    botToken: cfg.telegramBotToken
  });
  manager.register('telegram', new TelegramConnectorAdapter(telegramClient, cfg));
  this.logger.info('telegram.init_ok');
}
```

**Save the file.**

---

## Step 9: Add Configuration (1 minute)

**Update TypeScript config:**

Open `src/types/config.ts` and add to the `IConfig` interface:

```typescript
export interface IConfig {
  // ... existing fields ...

  // Telegram Configuration
  telegramEnabled: boolean;
  telegramBotToken?: string;
}
```

**Update environment config:**

Create/edit `.env` file in repo root:

```bash
# Telegram
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your_token_here
```

**Replace `your_token_here` with your actual bot token from Step 1.**

---

## Step 10: Build and Run (1 minute)

```bash
# Compile TypeScript
npm run build

# Start local stack
npm run local
```

**Watch for this log line:**
```
[ingress-egress] telegram.init_ok
[ingress-egress] telegram_client.connected
```

---

## Step 11: Test End-to-End (1 minute)

**In Telegram:**
1. Create a new group or use an existing one
2. Add your bot to the group:
   - Group settings → Add members → Search for your bot username
   - Send a message: `Hello BitBrat!`

**In BitBrat logs:**
```bash
npm run local:logs
```

**Expected output:**
```
[ingress-egress] telegram.message.received correlationId=abc123
[event-router] routing_slip.attached correlationId=abc123
[llm-bot] llm.processing correlationId=abc123
[ingress-egress] egress.sent platform=telegram correlationId=abc123
```

**In Telegram:**
You should see a reply from your bot!

---

## Troubleshooting

### Bot doesn't respond

**Check logs:**
```bash
npm run local:logs | grep telegram
```

**Common issues:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `telegram_client.auth_failed` | Invalid bot token | Double-check token in `.env` |
| No `telegram.init_ok` log | `telegramEnabled=false` | Set `TELEGRAM_ENABLED=true` in `.env` |
| `Cannot find module 'telegraf'` | SDK not installed | Run `npm install telegraf` |

---

### Validation errors

```bash
npm run brat -- integration validate telegram
```

**Common errors:**

| Error | Fix |
|-------|-----|
| `Missing required field 'userId'` | Add `userId: from.id` to `fieldMapping` |
| `Invalid filter syntax` | Check JSONLogic at https://jsonlogic.com |

---

## Next Steps

Congratulations! You've successfully integrated Telegram with BitBrat. 🎉

**Extend your integration:**

1. **Add DM support:**
   - Create `config/platforms/telegram/dm-message.v1.yaml`
   - Use `priority: 10` and `filter: { "==": [{"var": "chat.type"}, "private"] }`

2. **Add webhook support:**
   - Implement `WebhookConnector` in `connector-adapter.ts`
   - Configure webhook URL in Telegram

3. **Add rich media:**
   - Create mappings for photos: `photo-message.v1.yaml`
   - Create mappings for stickers: `sticker-message.v1.yaml`

4. **Add moderation:**
   - Implement `ban()` and `timeout()` in client
   - Update `ConnectorMetadata` capabilities

5. **Deploy to production:**
   ```bash
   npm run brat -- deploy service ingress-egress --env staging
   ```

---

## What You Learned

- ✅ **CLI Scaffolding:** `brat integration create` generates boilerplate
- ✅ **YAML Mapping:** Declarative field mapping with fallbacks and filters
- ✅ **Validation:** `brat integration validate` catches errors early
- ✅ **Testing:** `brat integration test` validates without code
- ✅ **Client Implementation:** EventEmitter-based platform client
- ✅ **Connector Registration:** Plug-and-play connector architecture

---

## Related Documentation

- **[Adding Integrations Guide](../guides/adding-integrations.md)** - Comprehensive reference
- **[Event Config Schema](../reference/event-config-schema.md)** - YAML syntax reference
- **[Telegram Bot API](https://core.telegram.org/bots/api)** - Official Telegram docs
- **[Telegraf Documentation](https://telegraf.js.org/)** - Telegram SDK docs

---

**Questions?** See existing integrations in `config/platforms/` or consult the Platform Team.
