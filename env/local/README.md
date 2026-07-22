# BitBrat Local Development Environment

This directory contains configuration files for running BitBrat locally using Docker Compose. These settings provide a **platform-only baseline** with minimal external dependencies - perfect for newcomers getting started.

---

## Quick Start (5 Minutes)

### 1. Copy the Secrets Template

```bash
cp .secure.local.example .secure.local
```

### 2. Add Your OpenAI API Key

Edit `.secure.local` and set:

```bash
OPENAI_API_KEY=sk-your-actual-key-here
```

**Don't have an API key?** Get one at https://platform.openai.com/api-keys

### 3. Start the Platform

```bash
npm run local
```

This starts the core services:
- PostgreSQL (persistence)
- NATS (message bus)
- API Gateway
- Event Router
- LLM Bot
- Query Analyzer
- Persistence Service
- Ingress/Egress (no platforms enabled yet)

### 4. Verify It's Running

```bash
# Check service health
npm run brat -- fleet list

# Interactive chat (tests end-to-end flow)
npm run brat -- chat
```

When you see the chat prompt, try:
```
You: Hello!
Bot: [Response from GPT-4.1-mini]
```

Type `exit` to quit.

---

## Configuration Files

| File | Purpose | Required? | Modify? |
|------|---------|-----------|---------|
| `global.yaml` | Baseline settings for all services | **Yes** | Rarely |
| `infra.yaml` | Message bus and database connections | **Yes** | Rarely |
| `llm-bot.yaml` | Conversational AI configuration | **Yes** | Sometimes |
| `query-analyzer.yaml` | Routing hint analysis | **Yes** | Rarely |
| `event-router.yaml` | Event orchestration rules | **Yes** | Rarely |
| `api-gateway.yaml` | HTTP/WebSocket API | **Yes** | Rarely |
| `persistence.yaml` | Event storage overrides | No | Rarely |
| `ingress-egress.yaml` | Chat platform integrations (Twitch, Discord, Twilio) | No | **Yes** (to enable integrations) |
| `auth.yaml` | User authentication | No | Only if using Twitch/Discord auth |
| `oauth-flow.yaml` | OAuth 2.0 flows | No | Only if using Twitch/Discord |
| `disposition-service.yaml` | Moderation and safety | No | Rarely |
| `context-pack.yaml` | RAG context enrichment | No | Only if enabling RAG |
| `obs-mcp.yaml` | OBS Studio integration | No | Only if using OBS |
| `scheduler.yaml` | Scheduled tasks | No | Only if using scheduler |

**Note**: Files marked "Required: No" are for **optional features** that are disabled by default.

---

## Enabling Optional Integrations

All integrations are **disabled by default**. The platform runs with just OpenAI integration.

### Discord Integration

**Prerequisites**:
1. Discord Bot (https://discord.com/developers/applications)
2. Invite bot to your server with required permissions

**Setup**:

1. Add bot token to `.secure.local`:
   ```bash
   DISCORD_BOT_TOKEN=your-bot-token-here
   ```

2. Edit `ingress-egress.yaml`:
   ```yaml
   DISCORD_ENABLED: "true"
   DISCORD_GUILD_ID: "your-guild-id"
   DISCORD_CHANNELS: "channel-id-1,channel-id-2"
   ```

3. Restart services:
   ```bash
   npm run local:down
   npm run local
   ```

**Documentation**: `documentation/guides/discord-integration.md`

---

### Twitch Integration

**Prerequisites**:
1. Twitch Developer App (https://dev.twitch.tv/console/apps)
2. OAuth redirect URI: `http://localhost:3001/callback`

**Setup**:

1. Add credentials to `.secure.local`:
   ```bash
   TWITCH_CLIENT_ID=your-client-id
   TWITCH_CLIENT_SECRET=your-client-secret
   OAUTH_STATE_SECRET=$(openssl rand -hex 32)
   ```

2. Edit `ingress-egress.yaml`:
   ```yaml
   TWITCH_BOT_USERNAME: "your_bot_username"
   TWITCH_CHANNELS: "channel1,channel2"
   ```

3. Run OAuth flow:
   ```bash
   npm run brat -- oauth twitch
   ```

4. Restart services:
   ```bash
   npm run local:down
   npm run local
   ```

**Documentation**: `documentation/guides/twitch-integration.md`

---

### RAG (Vector Search)

**Prerequisites**:
1. Vector database (Pinecone, Weaviate, or local ChromaDB)
2. API keys for hosted vector DB (if not using ChromaDB)

**Setup**:

1. Configure vector DB connection in `context-pack.yaml` or `.secure.local`

2. Enable RAG in `global.yaml`:
   ```yaml
   RAG_CONTEXT_ENABLED: true
   ```

3. Seed initial context:
   ```bash
   npm run brat -- rag seed
   ```

4. Restart services:
   ```bash
   npm run local:down
   npm run local
   ```

**Documentation**: `documentation/guides/rag-setup.md`

---

### OBS Studio Integration

**Prerequisites**:
1. OBS Studio running with WebSocket server enabled
2. WebSocket password configured in OBS

**Setup**:

1. Add password to `.secure.local`:
   ```bash
   OBS_WEBSOCKET_PASSWORD=your-obs-password
   ```

2. Uncomment and configure `obs-mcp.yaml`:
   ```yaml
   OBS_WEBSOCKET_URL: "ws://localhost:4455"
   OBS_WEBSOCKET_SELF_SIGNED: true
   ```

3. Restart services:
   ```bash
   npm run local:down
   npm run local
   ```

**Documentation**: `documentation/guides/obs-integration.md`

---

### Twilio Integration

**Prerequisites**:
1. Twilio Account (https://www.twilio.com/console)
2. Phone number configured for messaging

**Setup**:

1. Add credentials to `.secure.local`:
   ```bash
   TWILIO_ACCOUNT_SID=your-account-sid
   TWILIO_AUTH_TOKEN=your-auth-token
   ```

2. Enable in `ingress-egress.yaml`:
   ```yaml
   TWILIO_ENABLED: "true"
   ```

3. Configure webhook in Twilio Console:
   - URL: `https://your-public-url/webhooks/twilio`
   - Method: POST

4. Restart services:
   ```bash
   npm run local:down
   npm run local
   ```

**Documentation**: `documentation/guides/twilio-integration.md`

---

## Configuration Inheritance

Configuration files are loaded in this order (later files override earlier):

```
1. global.yaml           ← Baseline for all services
2. infra.yaml            ← Infrastructure (NATS, PostgreSQL)
3. {service}.yaml        ← Service-specific overrides
4. .secure.local         ← Secrets (never committed)
```

**Example Override**:

```yaml
# global.yaml
LOG_LEVEL: info

# llm-bot.yaml (service-specific override)
LOG_LEVEL: debug

# Result: llm-bot service uses debug, all others use info
```

**Environment Variable Interpolation**:

You can reference environment variables using `${VAR_NAME}`:

```yaml
# In any .yaml file:
DATABASE_URL: ${DATABASE_URL}

# Resolved from:
# 1. .secure.local
# 2. Shell environment
# 3. Docker Compose .env file
```

**See Also**: `documentation/reference/configuration-loading.md` (detailed reference)

---

## Troubleshooting

### Build Failures

**Error**: `Cannot find module '@/common/config'`

**Fix**: Run TypeScript build first:
```bash
npm run build
```

---

### OpenAI API Errors

**Error**: `Unauthorized - Invalid API key`

**Cause**: Missing or incorrect `OPENAI_API_KEY` in `.secure.local`

**Fix**:
1. Verify `.secure.local` exists and contains your API key
2. Restart services: `npm run local:down && npm run local`

---

### Service Won't Start

**Error**: `Error: connect ECONNREFUSED 127.0.0.1:5432`

**Cause**: PostgreSQL not running

**Fix**:
```bash
# Check if postgres container is running
docker ps | grep postgres

# If not running, start full stack
npm run local
```

---

### Chat Returns No Response

**Symptoms**: Bot receives message but doesn't respond

**Debug**:
```bash
# Check service logs
npm run local:logs

# Verify event flow
npm run brat -- fleet list
npm run brat -- fleet info llm-bot
```

**Common causes**:
- OpenAI API key missing/invalid
- Event router rules not seeded (run `npm run brat -- setup`)
- NATS not running

---

### Discord Bot Not Responding

**Symptoms**: Bot online in Discord but doesn't respond to messages

**Debug**:
1. Verify `DISCORD_ENABLED: "true"` in `ingress-egress.yaml`
2. Check `DISCORD_CHANNELS` includes the channel ID where you're testing
3. Verify bot has required permissions (Read Messages, Send Messages)
4. Check logs: `npm run local:logs | grep discord`

---

### Twitch Bot Not Joining Channel

**Symptoms**: Bot doesn't appear in Twitch chat

**Debug**:
1. Verify OAuth flow completed: `npm run brat -- oauth twitch`
2. Check `TWITCH_CHANNELS` is set correctly
3. Verify bot account has no chat bans
4. Check logs: `npm run local:logs | grep twitch`

---

## Common Customizations

### Change Bot Name

Edit `global.yaml`:
```yaml
BOT_NAME: "YourCustomName"
```

### Use Different LLM Provider

**Note**: LLM Bot and Query Analyzer have **separate LLM configurations** (intentional design choice).

- **LLM Bot** (`llm-bot.yaml`): Conversational models optimized for quality
- **Query Analyzer** (`query-analyzer.yaml`): Fast, cheap models for routing hints

This separation allows independent provider/model selection and cost control in production.

**Change LLM Bot provider** (edit `llm-bot.yaml`):
```yaml
# For local Ollama
LLM_BOT_LLM_PROVIDER: ollama
LLM_BOT_LLM_MODEL: llama3.2
LLM_BOT_LLM_BASE_URL: http://localhost:11434/v1

# For vLLM (OpenAI-compatible endpoint)
LLM_BOT_LLM_PROVIDER: openai
LLM_BOT_LLM_MODEL: meta-llama/Llama-3.2-8B
LLM_BOT_LLM_BASE_URL: http://localhost:8000/v1
```

**Change Query Analyzer provider** (edit `query-analyzer.yaml`):
```yaml
# Use local Ollama for routing hints (faster, no API costs)
QUERY_ANALYZER_LLM_PROVIDER: ollama
QUERY_ANALYZER_LLM_MODEL: llama3.2
QUERY_ANALYZER_LLM_BASE_URL: http://localhost:11434/v1
```

**Example: Mixed providers** (Query Analyzer on Ollama, LLM Bot on OpenAI):
- Cost savings: Routing hints are free (Ollama local)
- Quality responses: Conversational replies use GPT-4.1-mini (OpenAI)

### Adjust Conversation Memory

Edit `llm-bot.yaml`:
```yaml
# Increase memory for longer conversations
LLM_BOT_MEMORY_MAX_MESSAGES: 16
LLM_BOT_MEMORY_MAX_CHARS: 16000
```

### Enable Debug Logging for Specific User

Edit `global.yaml`:
```yaml
# Format: "platform:user-id,platform:username"
DEBUG_USERS: "twitch:123456789,discord:username#1234"
```

### Running Without Firebase Emulator

**Good news**: The default configuration (NATS + PostgreSQL) **does not require Firebase emulator**!

Firebase emulator is only needed for legacy drivers (deprecated):
- `PERSISTENCE_DRIVER=firestore` (deprecated, GCP-specific)
- `MESSAGE_BUS_DRIVER=pubsub` (deprecated, GCP-specific)

**Current defaults** (no Firebase needed):
- Message Bus: NATS (`MESSAGE_BUS_DRIVER=nats` in `global.yaml`)
- Persistence: PostgreSQL (`PERSISTENCE_DRIVER=postgres` in `global.yaml`)

**To disable Firebase emulator** (reduce resource usage):

1. Create `docker-compose.override.yaml` in project root:
   ```yaml
   services:
     firebase-emulator:
       profiles:
         - legacy  # Only start with: docker compose --profile legacy up
   ```

2. Restart stack:
   ```bash
   npm run local:down
   npm run local
   ```

Firebase emulator will no longer start, saving ~500MB RAM.

**When to keep Firebase emulator**:
- You're using `PERSISTENCE_DRIVER=firestore` (migration to Postgres recommended)
- You're debugging legacy Firestore code

**Migration guide**: See `documentation/guides/postgres-migration.md`

---

## Next Steps

**Learn Core Concepts**:
- [Platform Overview](../../README.md)
- [5-Stage Agent Flow](../../documentation/concepts/agent-flow-stages.md)
- [Event Router Rules](../../documentation/concepts/event-router-rules.md)

**Build Your First Integration**:
- [Adding a New Ingress Platform](../../documentation/guides/adding-ingress-platform.md)
- [Creating Custom Commands](../../documentation/guides/creating-commands.md)
- [Building an Enrichment Bit](../../documentation/tutorials/building-an-enrichment-bit.md)

**Deploy to Production**:
- [Deployment Guide](../../documentation/guides/deployment.md)
- [Execution Contexts](../../documentation/concepts/execution-contexts.md)
- [Security Best Practices](../../documentation/guides/security.md)

---

## Getting Help

**Documentation**: `documentation/`
**GitHub Issues**: https://github.com/anthropics/bitbrat/issues
**Community**: [Discord/Slack link if available]

**Common Commands**:
```bash
npm run brat -- help                  # CLI help
npm run brat -- doctor                # Verify prerequisites
npm run brat -- config show           # View resolved config
npm run brat -- fleet list            # List running services
npm run brat -- fleet logs <service>  # View service logs
```
