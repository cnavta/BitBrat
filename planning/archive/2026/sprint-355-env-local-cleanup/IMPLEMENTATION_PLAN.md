# Sprint 355: Implementation Plan

**Sprint**: Environment Local Cleanup
**Phase**: 1 (Data Sanitization)
**Estimated Effort**: 2-3 hours

---

## Implementation Tasks

### Task 1: BL-ENV-001 - Sanitize Twitch Configuration
**Files**: `env/local/ingress-egress.yaml`, `env/local/auth.yaml`, `env/local/oauth-flow.yaml`
**Effort**: 15 min

**Changes**:
1. `ingress-egress.yaml`:
   - Change `TWITCH_BOT_USERNAME: "bitbrat_the_ai"` → `TWITCH_BOT_USERNAME: ""` (or remove)
   - Change `TWITCH_CHANNELS: "gonj_the_unjust"` → `TWITCH_CHANNELS: ""`
   - Remove actual client IDs/secrets
   - Add comment: `# Configure in .secure.local - see .secure.local.example`

2. `auth.yaml`:
   - Remove or comment out credentials
   - Add setup instructions

3. `oauth-flow.yaml`:
   - Remove credentials
   - Keep scopes as example

---

### Task 2: BL-ENV-002 - Sanitize Discord Configuration
**File**: `env/local/ingress-egress.yaml`
**Effort**: 10 min

**Changes**:
1. Change `DISCORD_ENABLED: "true"` → `DISCORD_ENABLED: "false"`
2. Remove actual guild ID: `DISCORD_GUILD_ID: "1324629154695483422"`
3. Remove actual channel IDs: `DISCORD_CHANNELS: "1324629154695483426,1492322791268159538"`
4. Replace with commented placeholders:
   ```yaml
   # DISCORD_GUILD_ID: "your-discord-guild-id"
   # DISCORD_CHANNELS: "channel-id-1,channel-id-2"
   ```
5. Add comment: `# See documentation/guides/discord-integration.md for setup`

---

### Task 3: BL-ENV-003 - Remove Debug Users
**File**: `env/local/global.yaml`
**Effort**: 5 min

**Changes**:
1. Remove or comment out: `DEBUG_USERS: "twitch:91960688,discord:gonj_the_unjust"`
2. Replace with: `DEBUG_USERS: ""`
3. Add comment explaining DEBUG_USERS purpose

---

### Task 4: BL-ENV-004 - Sanitize OBS MCP Configuration
**File**: `env/local/obs-mcp.yaml`
**Effort**: 5 min

**Decision**: Convert to template (keep file as documentation)

**Changes**:
1. Comment out all actual values:
   ```yaml
   MCP_TRANSPORT: sse
   # Optional: OBS Studio WebSocket integration
   # OBS_WEBSOCKET_URL: "ws://your-obs-host:4455"
   # OBS_WEBSOCKET_SELF_SIGNED: true
   # Configure OBS_WEBSOCKET_PASSWORD in .secure.local
   ```

---

### Task 5: BL-ENV-005 - Neutralize LLM Bot Persona
**File**: `env/local/llm-bot.yaml`
**Effort**: 10 min

**Changes**:
1. Replace custom system prompt:
   ```yaml
   # Optional: Customize bot personality
   # LLM_BOT_SYSTEM_PROMPT: "You are a helpful AI assistant."
   ```
2. Add comment explaining how to customize
3. Keep all other LLM settings as-is (they're generic)

---

### Task 6: BL-ENV-006 - Remove Internal Network References
**File**: `env/local/query-analyzer.yaml`
**Effort**: 5 min

**Changes**:
1. Remove commented lines with internal IPs:
   - `#QUERY_ANALYZER_LLM_BASE_URL: http://192.168.229.180:8000/v1`
   - `OLLAMA_HOST: 195.168.229.157`
2. Replace with generic placeholders:
   ```yaml
   # Optional: Use local Ollama or vLLM
   # QUERY_ANALYZER_LLM_BASE_URL: http://localhost:8000/v1
   # OLLAMA_HOST: localhost
   ```

---

### Task 7: BL-ENV-007 - Neutralize Bot Name
**File**: `env/local/global.yaml`
**Effort**: 2 min

**Changes**:
1. Change `BOT_NAME: "BitBrat_the_AI"` → `BOT_NAME: "YourBot"`
2. Add comment: `# Customize your bot's display name`

---

### Task 8: BL-ENV-012 - Fix Typos and Formatting
**File**: `env/local/llm-bot.yaml`
**Effort**: 5 min

**Changes**:
1. Fix line 10: `8000I` → `8000`
2. Standardize YAML formatting (consistent spacing, quotes)
3. Remove trailing whitespace

---

### Task 9: BL-ENV-011 - Create .secure.local.example
**File**: `env/local/.secure.local.example`
**Effort**: 20 min

**Create new file**:
```bash
#!/bin/bash
# BitBrat Local Secrets Template
# ================================
#
# SETUP INSTRUCTIONS:
# 1. Copy this file: cp .secure.local.example .secure.local
# 2. Fill in your actual values below
# 3. DO NOT commit .secure.local to git (already in .gitignore)
#
# This file is sourced by docker-compose to provide sensitive credentials.

# ============================================================================
# REQUIRED: OpenAI API Key (for LLM bot functionality)
# ============================================================================
# Get your API key from: https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-your-openai-api-key-here

# ============================================================================
# OPTIONAL: Twitch Integration
# ============================================================================
# Only required if you want to connect to Twitch chat
# Get credentials from: https://dev.twitch.tv/console/apps
#
# TWITCH_CLIENT_ID=your-twitch-client-id
# TWITCH_CLIENT_SECRET=your-twitch-client-secret
# OAUTH_STATE_SECRET=random-secret-string-for-oauth-state

# ============================================================================
# OPTIONAL: Discord Integration
# ============================================================================
# Only required if you want to connect to Discord
# Get bot token from: https://discord.com/developers/applications
#
# DISCORD_BOT_TOKEN=your-discord-bot-token

# ============================================================================
# OPTIONAL: Twilio Integration
# ============================================================================
# Only required if you want SMS/Voice capabilities
#
# TWILIO_ACCOUNT_SID=your-twilio-account-sid
# TWILIO_AUTH_TOKEN=your-twilio-auth-token
# TWILIO_API_KEY=your-twilio-api-key
# TWILIO_API_SECRET=your-twilio-api-secret

# ============================================================================
# OPTIONAL: OBS Studio WebSocket
# ============================================================================
# Only required if you want OBS integration
#
# OBS_WEBSOCKET_PASSWORD=your-obs-websocket-password

# ============================================================================
# OPTIONAL: MCP Gateway Authentication
# ============================================================================
# Leave blank for local development (auto-discovery mode)
#
# MCP_AUTH_TOKEN=your-mcp-auth-token

# ============================================================================
# TIPS:
# ============================================================================
# - Lines starting with # are comments and will be ignored
# - Remove the # to enable a setting
# - For random secrets, use: openssl rand -hex 32
# - Keep this file secure - it contains sensitive credentials
```

---

## Testing Plan

After each task:
1. ✅ Verify file syntax (YAML valid)
2. ✅ Check for remaining user-specific data
3. ✅ Ensure comments are clear

Final validation:
1. ✅ Run `npm run build` (should pass)
2. ✅ Run `npm test` (should pass)
3. ✅ Create `.secure.local` with OPENAI_API_KEY
4. ✅ Verify `docker-compose config` (should parse)
5. ✅ Optionally: Start stack and verify basic functionality

---

## Rollback Plan

If issues arise:
1. All changes are in `env/local/*.yaml` - easily reverted
2. Git provides version history
3. Original backlog has full context

---

## Dependencies

None - all tasks are independent file edits.

---

## Risks

**Low Risk**: Simple file edits with no code changes
- Mitigation: Thorough review before commit

**Medium Risk**: May break existing local development workflow
- Mitigation: Test with `.secure.local` before finalizing
- Mitigation: Document migration path in commit message

---

## Execution Order

1. Create `.secure.local.example` first (BL-ENV-011) - provides context
2. Sanitize configs in order (BL-ENV-001 through BL-ENV-007)
3. Fix typos (BL-ENV-012)
4. Test and verify
5. Commit with clear migration instructions

---

## Post-Sprint

Document changes:
- Update any setup guides referencing old env values
- Add note to changelog about env cleanup
- Consider creating migration guide if needed
