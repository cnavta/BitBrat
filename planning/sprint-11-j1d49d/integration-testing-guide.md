# Discord Integration Testing Guide

**Sprint 11: Discord Integration Modernization (DISC-013)**

This guide provides step-by-step instructions for integration testing the Discord connector adapter with a live Discord bot.

---

## Prerequisites

### 1. Discord Bot Setup

**Required Discord Configuration:**
- Discord bot token (stored in environment or token store)
- Discord guild ID (server to test in)
- Discord channel IDs (channels to listen in)
- Discord public key (for webhook signature verification)
- Discord authorized debug users (for `!debug` mode testing)

**Environment Variables:**
```yaml
# env/local/ingress-egress.yaml or .secure.local/.env
DISCORD_ENABLED: "true"
DISCORD_BOT_TOKEN: "your-bot-token-here"  # or use token store
DISCORD_GUILD_ID: "your-guild-id"
DISCORD_CHANNELS: "channel-id-1,channel-id-2"
DISCORD_PUBLIC_KEY: "your-public-key"
DEBUG_USERS_DISCORD: "user-id-1,user-id-2"

# Optional: Token store V2 configuration
DISCORD_USE_TOKEN_STORE: "true"
DISCORD_ALLOW_ENV_FALLBACK: "true"
DISCORD_TOKEN_POLL_MS: "60000"
```

### 2. Local Environment Setup

**Start the ingress-egress service:**
```bash
# Build the project
npm run build

# Start local Docker Compose stack
npm run local

# Or start just ingress-egress service
npm run brat -- deploy service ingress-egress --context local
```

**Verify service is running:**
```bash
# Check logs
npm run local:logs ingress-egress

# Expected output:
# [ingress-egress] ingress-egress.discord.connected
# [ingress-egress] ingress-egress.discord.ready
```

---

## Integration Test Checklist

### Phase 1: Basic Connectivity

- [ ] **IC-01: Discord Gateway Connection**
  - **Action**: Start ingress-egress service
  - **Expected**: Service logs show `discord.client.connected` and `discord.client.ready`
  - **Validation**: Check `ConnectorSnapshot.state === 'CONNECTED'`

- [ ] **IC-02: Channel Membership**
  - **Action**: Verify bot is in configured guild and channels
  - **Expected**: Bot appears in member list of each configured channel
  - **Validation**: Send test message in channel, verify bot receives it

- [ ] **IC-03: Bot Permissions**
  - **Action**: Check bot role and permissions in Discord server settings
  - **Expected**: Bot has required permissions (Read Messages, Send Messages, View Channels)
  - **Validation**: Send message, verify no permission errors in logs

### Phase 2: Message Processing

- [ ] **IC-04: Normal Message Receipt**
  - **Action**: Send regular message in configured channel: `Hello Discord bot!`
  - **Expected**:
    - Service logs show `discord.message.received`
    - Service logs show `ingress-egress.discord.message.published`
    - Envelope published to `internal.ingress.v1`
  - **Validation**: Check logs for correlation ID and envelope structure

- [ ] **IC-05: Message Filtering (Bot Messages)**
  - **Action**: Send message from another bot account
  - **Expected**: Service logs show `discord.message.filtered` with `reason: bot`
  - **Validation**: No envelope published for bot messages

- [ ] **IC-06: Message Filtering (Empty Content)**
  - **Action**: Send empty message or attachment-only message
  - **Expected**: Service logs show `discord.message.filtered` with `reason: non_text`
  - **Validation**: No envelope published for empty messages

- [ ] **IC-07: Message Filtering (Wrong Guild)**
  - **Action**: Send message in different guild (if bot is in multiple)
  - **Expected**: Message not processed (filtered by guild ID)
  - **Validation**: No logs for messages from other guilds

- [ ] **IC-08: Message Filtering (Wrong Channel)**
  - **Action**: Send message in non-configured channel in same guild
  - **Expected**: Message not processed (filtered by channel ID)
  - **Validation**: No logs for messages from unauthorized channels

### Phase 3: Debug Mode (!debug prefix)

- [ ] **IC-09: Debug Mode Authorized User**
  - **Action**: Send message from authorized debug user: `!debug Test debug mode`
  - **Expected**:
    - Service logs show `discord.debug.authorized`
    - Bot sends confirmation message with correlation ID
    - Message text is `Test debug mode` (prefix stripped)
    - Envelope published with `debugMetadata.enabled: true`
  - **Validation**:
    - Check confirmation message format: `🔍 **Debug mode ON**\n\`Correlation ID:\` \`...\`\n_Watching event flow..._`
    - Verify envelope has `debugMetadata` object

- [ ] **IC-10: Debug Mode Unauthorized User**
  - **Action**: Send message from non-authorized user: `!debug Unauthorized attempt`
  - **Expected**:
    - Service logs show `discord.debug.unauthorized`
    - No confirmation message sent
    - No envelope published
  - **Validation**: Check logs for unauthorized attempt warning

- [ ] **IC-11: Debug Mode Correlation ID Tracking**
  - **Action**: Send `!debug Track this message` and note correlation ID
  - **Expected**: Correlation ID appears in all subsequent log entries for this message
  - **Validation**: Search logs for correlation ID across all services

### Phase 4: Egress Responses

- [ ] **IC-12: Egress Text Message**
  - **Action**: Trigger event that generates egress response (e.g., command response)
  - **Expected**:
    - Service logs show `discord.adapter.text_sent`
    - Message appears in Discord channel
    - Message content matches envelope payload
  - **Validation**: Verify message delivery and content accuracy

- [ ] **IC-13: Egress DM Message**
  - **Action**: Trigger event that sends direct message to user
  - **Expected**:
    - Service logs show `discord.adapter.text_sent` with DM target
    - User receives direct message from bot
  - **Validation**: Check DM inbox for message

- [ ] **IC-14: Egress Error Handling**
  - **Action**: Attempt to send message to invalid channel ID
  - **Expected**:
    - Service logs show `discord.adapter.send_failed`
    - Error message logged with details
    - No crash or service interruption
  - **Validation**: Service continues running after error

### Phase 5: Deduplication

- [ ] **IC-15: Message Deduplication**
  - **Action**: Simulate Discord reconnect/resume (restart ingress-egress service)
  - **Expected**:
    - Service reconnects successfully
    - Duplicate messages logged as `discord.client.message_deduplicated`
    - `counters.deduplicated` increments
  - **Validation**: Check snapshot counters after reconnect

- [ ] **IC-16: Deduplication Cache Cleanup**
  - **Action**: Wait 60 seconds after sending messages
  - **Expected**: Service logs show `discord.client.dedup_cache_cleared`
  - **Validation**: Cache size reset in logs

### Phase 6: Webhook Handler (Interactions API)

**Note**: This section requires Discord Application Commands (slash commands) to be registered. Skip if not using Interactions API.

- [ ] **IC-17: Webhook Ping Verification**
  - **Action**: Discord sends ping to webhook endpoint (initial setup)
  - **Expected**:
    - Service logs show `discord.webhook.ping`
    - Response: `{ type: 1 }` returned within 3 seconds
  - **Validation**: Discord confirms webhook URL is valid

- [ ] **IC-18: Slash Command Handling**
  - **Action**: Use registered slash command (e.g., `/ping`)
  - **Expected**:
    - Service logs show `discord.webhook.command`
    - Ephemeral response sent immediately
    - Async processing logged via `setImmediate()`
  - **Validation**: User sees ephemeral message, logs show async processing

- [ ] **IC-19: Webhook Signature Verification**
  - **Action**: Send invalid signature to webhook endpoint (use curl with bad signature)
  - **Expected**:
    - Service logs show `discord.webhook.invalid_signature`
    - Request rejected (401 Unauthorized)
  - **Validation**: No envelope published for invalid signatures

### Phase 7: Error Recovery

- [ ] **IC-20: Connection Loss Recovery**
  - **Action**: Disconnect network temporarily (disable WiFi for 10 seconds)
  - **Expected**:
    - Service logs show connection loss
    - Service automatically reconnects
    - State transitions: CONNECTED → DISCONNECTED → CONNECTING → CONNECTED
  - **Validation**: Service resumes message processing after reconnection

- [ ] **IC-21: Token Rotation (if using token store)**
  - **Action**: Update Discord bot token in token store
  - **Expected**:
    - Service polls token store (default: every 60 seconds)
    - Service detects token change
    - Service reconnects with new token
  - **Validation**: Logs show token rotation and successful reconnection

- [ ] **IC-22: Graceful Shutdown**
  - **Action**: Stop ingress-egress service via `npm run local:down`
  - **Expected**:
    - Service logs show `discord.client.stopping`
    - Cleanup interval cleared
    - Discord client destroyed gracefully
    - No error messages during shutdown
  - **Validation**: Clean shutdown logs, no stack traces

### Phase 8: Observability

- [ ] **IC-23: Snapshot State Accuracy**
  - **Action**: Query `ConnectorSnapshot` via MCP or logs
  - **Expected**:
    - `state`: Current connection state (CONNECTED, DISCONNECTED, etc.)
    - `platform`: "discord"
    - `guildId`: Configured guild ID
    - `channelIds`: Array of configured channel IDs
    - `counters.received`: Count of messages received
    - `counters.published`: Count of envelopes published
    - `counters.deduplicated`: Count of duplicate messages
  - **Validation**: Counters match actual message activity

- [ ] **IC-24: Metadata Accuracy**
  - **Action**: Query `getMetadata()` via MCP or logs
  - **Expected**:
    - `platform`: "discord"
    - `version`: "1.0.0"
    - `authMethod`: "bot_token"
    - `capabilities.ingress.method`: "hybrid"
    - `capabilities.ingress.realtime`: true
    - `capabilities.egress.chat`: true
    - `capabilities.moderation.ban`: true
  - **Validation**: Metadata matches implementation capabilities

- [ ] **IC-25: Logging Coverage**
  - **Action**: Review all logs from test session
  - **Expected**:
    - No leaked secrets (bot token, public key redacted)
    - Structured logging with correlation IDs
    - Clear error messages with actionable context
    - Performance metrics (message processing time)
  - **Validation**: Logs are clean, informative, and secure

---

## Test Execution Workflow

### Step 1: Environment Setup (5 minutes)

```bash
# 1. Configure environment
cp .secure.local/.env.example .secure.local/.env
# Edit .secure.local/.env with Discord credentials

# 2. Build project
npm run build

# 3. Start local stack
npm run local

# 4. Verify ingress-egress is running
npm run local:logs ingress-egress | grep discord
```

### Step 2: Execute Test Checklist (30-45 minutes)

Work through each phase sequentially:
1. **Phase 1: Basic Connectivity** (5 min) - Verify connection and permissions
2. **Phase 2: Message Processing** (10 min) - Test message receipt and filtering
3. **Phase 3: Debug Mode** (5 min) - Test `!debug` prefix and RBAC
4. **Phase 4: Egress Responses** (5 min) - Test message sending
5. **Phase 5: Deduplication** (5 min) - Test duplicate detection
6. **Phase 6: Webhook Handler** (5 min, optional) - Test Interactions API
7. **Phase 7: Error Recovery** (10 min) - Test reconnection and shutdown
8. **Phase 8: Observability** (5 min) - Verify metrics and logging

### Step 3: Document Results (10 minutes)

Create `integration-test-results.md` with:
- Test execution date and environment
- Checklist completion status (✅ Pass, ❌ Fail, ⏭️ Skipped)
- Screenshots of Discord bot interactions
- Log excerpts for key test cases
- Any issues or anomalies observed

### Step 4: Validation (5 minutes)

```bash
# Run final validation
npm test -- discord  # All unit tests should still pass
npm run build        # Clean build
npm run lint         # No lint errors
```

---

## Expected Test Results

### Success Criteria

✅ **All IC-01 through IC-25 tests pass** (excluding optional webhook tests if not using Interactions API)

✅ **No errors in production logs** during normal operation

✅ **Debug mode works correctly** with proper RBAC enforcement

✅ **Egress responses delivered** to Discord channels

✅ **Service recovers gracefully** from connection loss

✅ **Metadata and snapshots accurate** reflecting actual capabilities

### Common Issues and Troubleshooting

#### Issue: Bot doesn't connect

**Symptoms**: No `discord.client.connected` log, service shows ERROR state

**Causes**:
- Invalid bot token
- Bot not invited to guild
- Network connectivity issues

**Solutions**:
1. Verify `DISCORD_BOT_TOKEN` is correct
2. Check bot invite URL: `https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=3072&scope=bot`
3. Test network connectivity to Discord API

#### Issue: Messages not processed

**Symptoms**: Messages sent but no `discord.message.received` logs

**Causes**:
- Wrong guild ID or channel IDs configured
- Bot missing permissions in channel
- Message content filtering (bot messages, empty messages)

**Solutions**:
1. Verify `DISCORD_GUILD_ID` and `DISCORD_CHANNELS` match test server
2. Check bot has Read Messages and View Channel permissions
3. Ensure messages are from human users with text content

#### Issue: Debug mode not working

**Symptoms**: `!debug` messages not triggering debug confirmation

**Causes**:
- User ID not in `DEBUG_USERS_DISCORD`
- Incorrect user ID format (snowflakes, not usernames)

**Solutions**:
1. Get Discord user ID via Developer Mode → Right-click user → Copy ID
2. Add user ID to `DEBUG_USERS_DISCORD` (comma-separated)
3. Restart service after config change

#### Issue: Webhook signature verification fails

**Symptoms**: `discord.webhook.invalid_signature` logs for all webhook requests

**Causes**:
- Incorrect `DISCORD_PUBLIC_KEY`
- Timestamp out of valid range (replay attack prevention)
- Request body modified in transit

**Solutions**:
1. Verify `DISCORD_PUBLIC_KEY` from Discord Developer Portal
2. Ensure system clock is synchronized (NTP)
3. Check for proxies/middleware modifying request body

---

## Appendix: Manual Test Scripts

### Script 1: Basic Message Flow Test

```bash
#!/bin/bash
# test-basic-flow.sh

echo "Starting Discord integration test..."

# 1. Check service status
echo "Checking service status..."
curl -s http://localhost:3001/health | jq .

# 2. Send test message via Discord
echo "Send this message in Discord: 'Hello integration test'"
read -p "Press Enter after sending message..."

# 3. Check logs for message receipt
echo "Checking logs for message..."
docker logs bitbrat-ingress-egress-1 2>&1 | grep "discord.message.received" | tail -5

echo "Integration test complete!"
```

### Script 2: Debug Mode Test

```bash
#!/bin/bash
# test-debug-mode.sh

echo "Testing Discord debug mode..."

# 1. Check debug users configuration
echo "Configured debug users:"
docker exec bitbrat-ingress-egress-1 printenv DEBUG_USERS_DISCORD

# 2. Send debug message
echo "Send this message in Discord from authorized user: '!debug Test correlation tracking'"
read -p "Press Enter after sending message..."

# 3. Check for correlation ID
echo "Checking for debug activation..."
docker logs bitbrat-ingress-egress-1 2>&1 | grep "discord.debug.authorized" | tail -1

echo "Debug mode test complete!"
```

---

## Sign-Off

**Integration testing completed by**: [Your Name]

**Date**: [YYYY-MM-DD]

**Test Results Summary**:
- Total tests: 25
- Passed: __
- Failed: __
- Skipped: __

**Issues Found**: [List any issues discovered during testing]

**Sign-Off**: ✅ Discord connector adapter ready for production deployment

---

**End of Integration Testing Guide**
