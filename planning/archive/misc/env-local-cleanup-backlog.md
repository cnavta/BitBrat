# Environment Cleanup: `env/local` Analysis & Backlog

**Goal**: Make `env/local` a minimal, generic, newcomer-friendly baseline example that demonstrates the platform without user-specific configuration.

---

## Current State Analysis

### File Inventory (14 files)
```
global.yaml              (32 lines) - Core platform settings
infra.yaml               (11 lines) - Infrastructure (NATS, Postgres, Firebase emulator)
ingress-egress.yaml      (23 lines) - Chat platform credentials & config
llm-bot.yaml             (26 lines) - LLM provider & behavioral settings
auth.yaml                 (5 lines) - OAuth credentials
oauth-flow.yaml           (9 lines) - OAuth scopes & redirect URIs
context-pack.yaml         (8 lines) - RAG configuration
disposition-service.yaml  (7 lines) - Disposition engine config
query-analyzer.yaml       (5 lines) - Query analyzer LLM config
obs-mcp.yaml              (3 lines) - OBS WebSocket integration
api-gateway.yaml          (1 line)  - API gateway config
event-router.yaml         (1 line)  - Command sigil
persistence.yaml          (1 line)  - Empty placeholder
scheduler.yaml            (1 line)  - Empty placeholder
```

### Issues Identified

#### 🔴 **Critical - User-Specific Data**
1. **Twitch configuration** (ingress-egress.yaml, auth.yaml, oauth-flow.yaml)
   - Username: `bitbrat_the_ai`
   - Channel: `gonj_the_unjust`
   - Client IDs: `local-twitch-id` (placeholder but misleading)

2. **Discord configuration** (ingress-egress.yaml)
   - Guild ID: `1324629154695483422` (actual guild ID)
   - Channel IDs: `1324629154695483426,1492322791268159538` (actual channels)
   - Enabled by default: `DISCORD_ENABLED: "true"`

3. **Debug users** (global.yaml)
   - `DEBUG_USERS: "twitch:91960688,discord:gonj_the_unjust"`
   - Contains actual Twitch user ID

4. **OBS WebSocket** (obs-mcp.yaml)
   - URL: `ws://joepc.lan:4455` (personal network hostname)
   - Password: `password` (actual password, even if weak)

5. **Custom bot persona** (llm-bot.yaml)
   - System prompt: "You are BitBrat, a conversational, entertaining assistant..."
   - Personality traits reflect user's specific use case

6. **Query analyzer commented config** (query-analyzer.yaml)
   - IP address: `192.168.229.180` (internal network)
   - Ollama host: `195.168.229.157` (internal network)

#### 🟡 **Medium - Overly Specific Defaults**
7. **BOT_NAME** (global.yaml)
   - Value: `BitBrat_the_AI` (user-specific)

8. **Feature flags enabled** that may not apply to newcomers:
   - `RAG_CONTEXT_ENABLED: true` (requires vector DB setup)
   - `FF_LLM_PROMPT_LOGGING: true` (verbose debugging)
   - `DISCORD_ENABLED: "true"` (requires Discord bot setup)

9. **Twilio configuration** (ingress-egress.yaml)
   - Disabled but contains placeholder values that look like they need to be filled in

10. **Behavioral guidance** (llm-bot.yaml)
    - Multiple behavioral flags enabled (may be overwhelming for newcomers)
    - `LLM_BOT_RISK_RESPONSE_MODE: refuse`

#### 🟢 **Low - Minor Cleanup**
11. **Typo in llm-bot.yaml**
    - Line 10: `8000I` should be `8000`

12. **Empty/minimal files** that could be removed:
    - `persistence.yaml` (empty)
    - `scheduler.yaml` (empty comment)
    - `event-router.yaml` (only command sigil)
    - `api-gateway.yaml` (only `BOOGIE: "down"` - unclear purpose)

13. **Duplicate configuration**
    - RAG settings appear in both `global.yaml` and `context-pack.yaml`
    - Twitch credentials duplicated in `auth.yaml`, `oauth-flow.yaml`, and `ingress-egress.yaml`

14. **Missing .secure.local template**
    - No `.secure.local.example` file to guide users on secrets management

---

## Cleanup Backlog

### Phase 1: Remove User-Specific Data (Highest Priority)

#### BL-ENV-001: Sanitize Twitch Configuration
**Priority**: P0 (Critical)
**Effort**: 15 min

**Changes**:
- [ ] `ingress-egress.yaml`: Change `TWITCH_BOT_USERNAME` to `"your-bot-username"` or remove
- [ ] `ingress-egress.yaml`: Change `TWITCH_CHANNELS` to `"your-channel-name"` or `""`
- [ ] `auth.yaml`: Remove or keep as placeholder with comment
- [ ] `oauth-flow.yaml`: Remove or keep as placeholder with comment
- [ ] Add comment: `# See documentation/guides/twitch-integration.md for setup`

#### BL-ENV-002: Sanitize Discord Configuration
**Priority**: P0 (Critical)
**Effort**: 10 min

**Changes**:
- [ ] Remove actual guild ID and channel IDs
- [ ] Change `DISCORD_ENABLED` to `"false"` by default
- [ ] Replace with placeholders:
  ```yaml
  DISCORD_ENABLED: "false"
  # DISCORD_GUILD_ID: "your-guild-id"
  # DISCORD_CHANNELS: "channel-id-1,channel-id-2"
  ```
- [ ] Add comment: `# See documentation/guides/discord-integration.md for setup`

#### BL-ENV-003: Remove Debug Users
**Priority**: P0 (Critical)
**Effort**: 5 min

**Changes**:
- [ ] `global.yaml`: Remove or comment out `DEBUG_USERS` line
- [ ] Or change to: `DEBUG_USERS: ""`

#### BL-ENV-004: Sanitize OBS MCP Configuration
**Priority**: P0 (Critical)
**Effort**: 5 min

**Options**:
1. Remove `obs-mcp.yaml` entirely (if it's optional)
2. Convert to template:
   ```yaml
   MCP_TRANSPORT: sse
   # OBS_WEBSOCKET_URL: "ws://your-obs-host:4455"
   # OBS_WEBSOCKET_SELF_SIGNED: true
   # OBS_WEBSOCKET_PASSWORD: "your-password"
   ```

#### BL-ENV-005: Neutralize LLM Bot Persona
**Priority**: P0 (Critical)
**Effort**: 10 min

**Changes**:
- [ ] Replace custom system prompt with generic example or remove
- [ ] Example:
  ```yaml
  # LLM_BOT_SYSTEM_PROMPT: "You are a helpful AI assistant."
  ```
- [ ] Add comment explaining how to customize

#### BL-ENV-006: Remove Internal Network References
**Priority**: P0 (Critical)
**Effort**: 5 min

**Changes**:
- [ ] `query-analyzer.yaml`: Remove commented lines with internal IPs
- [ ] Remove `OLLAMA_HOST` or make it a placeholder

#### BL-ENV-007: Neutralize Bot Name
**Priority**: P0 (Critical)
**Effort**: 2 min

**Changes**:
- [ ] `global.yaml`: Change `BOT_NAME` to `"YourBot"` or `"BitBrat"` (generic)

---

### Phase 2: Simplify for Newcomers (High Priority)

#### BL-ENV-008: Create Minimal Platform-Only Defaults
**Priority**: P1 (High)
**Effort**: 30 min

**Changes**:
- [ ] Disable optional integrations by default:
  - `DISCORD_ENABLED: "false"`
  - `TWILIO_ENABLED: "false"`
  - `RAG_CONTEXT_ENABLED: false` (or add setup docs)
- [ ] Keep only NATS and Postgres enabled
- [ ] Add clear comments for each integration on how to enable

#### BL-ENV-009: Consolidate Duplicate Configuration
**Priority**: P1 (High)
**Effort**: 20 min

**Changes**:
- [ ] Consolidate Twitch credentials to single location (recommend: `.secure.local`)
- [ ] Remove RAG duplication (keep in `context-pack.yaml` only)
- [ ] Document single source of truth for each config category

#### BL-ENV-010: Simplify LLM Bot Configuration
**Priority**: P1 (High)
**Effort**: 15 min

**Changes**:
- [ ] Keep essential settings only:
  - Provider, model, timeout
  - Memory limits (with good defaults)
- [ ] Move advanced behavioral settings to documentation
- [ ] Or disable advanced features by default with clear enable instructions

#### BL-ENV-011: Create .secure.local.example
**Priority**: P1 (High)
**Effort**: 20 min

**File**: `env/local/.secure.local.example`

**Contents**:
```bash
# BitBrat Local Secrets Template
# Copy to .secure.local and fill in your values
# DO NOT commit .secure.local to git (already in .gitignore)

# OpenAI API Key (required for LLM bot)
OPENAI_API_KEY=sk-your-key-here

# Twitch OAuth (required for Twitch integration)
# Get from https://dev.twitch.tv/console/apps
TWITCH_CLIENT_ID=your-client-id
TWITCH_CLIENT_SECRET=your-client-secret
OAUTH_STATE_SECRET=random-secret-string

# Discord Bot Token (required for Discord integration)
# Get from https://discord.com/developers/applications
DISCORD_BOT_TOKEN=your-bot-token

# Optional: OBS WebSocket Password
# OBS_WEBSOCKET_PASSWORD=your-obs-password

# Optional: MCP Gateway Auth Token
# MCP_AUTH_TOKEN=your-auth-token
```

---

### Phase 3: Cleanup & Documentation (Medium Priority)

#### BL-ENV-012: Fix Typos and Formatting
**Priority**: P2 (Medium)
**Effort**: 5 min

**Changes**:
- [ ] `llm-bot.yaml` line 10: Fix `8000I` → `8000`
- [ ] Standardize YAML formatting (spacing, quotes)
- [ ] Fix any trailing whitespace

#### BL-ENV-013: Remove or Populate Empty Files
**Priority**: P2 (Medium)
**Effort**: 10 min

**Options**:
1. Remove empty files entirely (preferred):
   - `persistence.yaml`
   - `scheduler.yaml`
2. Or add meaningful defaults/examples

**Changes**:
- [ ] Decide on approach
- [ ] Update env loading logic if files are removed
- [ ] Test that services still load correctly

#### BL-ENV-014: Clarify Minimal Service Files
**Priority**: P2 (Medium)
**Effort**: 10 min

**Files**: `api-gateway.yaml`, `event-router.yaml`

**Changes**:
- [ ] Add comments explaining purpose
- [ ] `api-gateway.yaml`: Clarify what `BOOGIE: "down"` means (or remove if unused)
- [ ] `event-router.yaml`: Add comment about command sigil customization

#### BL-ENV-015: Create Quickstart Guide
**Priority**: P2 (Medium)
**Effort**: 60 min

**File**: `env/local/README.md`

**Contents**:
- What is the local execution context?
- Minimal setup steps (just platform, no integrations)
- How to enable optional integrations (Twitch, Discord, RAG)
- Secrets management with .secure.local
- Common customizations
- Troubleshooting

#### BL-ENV-016: Document Configuration Inheritance
**Priority**: P2 (Medium)
**Effort**: 30 min

**Goal**: Explain how env overlay works

**Add to README.md**:
- File loading order: `global.yaml` → `infra.yaml` → `{service}.yaml` → `.secure.local`
- Override precedence
- Service-specific vs global config
- When to use each file type

---

### Phase 4: Advanced Cleanup (Low Priority)

#### BL-ENV-017: Review Feature Flag Defaults
**Priority**: P3 (Low)
**Effort**: 20 min

**Review**:
- [ ] `FF_LLM_PROMPT_LOGGING: true` - Keep for local dev?
- [ ] `ENABLE_EVENT_RESPONSES: true` - Essential or optional?
- [ ] All behavioral flags in `llm-bot.yaml` - Which are core vs advanced?

**Decision**: Document rationale for each default in comments

#### BL-ENV-018: Consolidate LLM Configuration
**Priority**: P3 (Low)
**Effort**: 15 min

**Goal**: Reduce duplication between `llm-bot.yaml` and `query-analyzer.yaml`

**Options**:
1. Extract common LLM settings to `global.yaml`
2. Or document why each service needs separate config

#### BL-ENV-019: Review Persistence Configuration
**Priority**: P3 (Low)
**Effort**: 15 min

**Current**: Postgres is clearly the default (good!)

**Review**:
- [ ] Is `PERSISTENCE_SNAPSHOT_MODE: all` appropriate for local dev?
- [ ] Is `PERSISTENCE_TTL_DAYS: 7` a good default for newcomers?
- [ ] Document implications of each setting

#### BL-ENV-020: Evaluate Infrastructure Emulator Dependencies
**Priority**: P3 (Low)
**Effort**: 20 min

**Question**: Should local env require Firebase emulator if using Postgres?

**Review**:
- [ ] Can Firebase emulator be optional?
- [ ] Document which services still use Firestore (if any)
- [ ] Provide postgres-only docker-compose variant

---

## Recommended Execution Order

### Sprint 1 (Immediate - 2-3 hours)
**Goal**: Remove all user-specific data and secrets

1. BL-ENV-001: Sanitize Twitch Configuration
2. BL-ENV-002: Sanitize Discord Configuration
3. BL-ENV-003: Remove Debug Users
4. BL-ENV-004: Sanitize OBS MCP Configuration
5. BL-ENV-005: Neutralize LLM Bot Persona
6. BL-ENV-006: Remove Internal Network References
7. BL-ENV-007: Neutralize Bot Name
8. BL-ENV-011: Create .secure.local.example
9. BL-ENV-012: Fix Typos and Formatting

**Deliverable**: Clean `env/local` ready for public repository

### Sprint 2 (Simplification - 2-3 hours)
**Goal**: Make it newcomer-friendly

10. BL-ENV-008: Create Minimal Platform-Only Defaults
11. BL-ENV-009: Consolidate Duplicate Configuration
12. BL-ENV-010: Simplify LLM Bot Configuration
13. BL-ENV-013: Remove or Populate Empty Files
14. BL-ENV-014: Clarify Minimal Service Files
15. BL-ENV-015: Create Quickstart Guide
16. BL-ENV-016: Document Configuration Inheritance

**Deliverable**: Documented, minimal baseline example

### Sprint 3 (Polish - 1-2 hours)
**Goal**: Optimize and document decisions

17. BL-ENV-017: Review Feature Flag Defaults
18. BL-ENV-018: Consolidate LLM Configuration
19. BL-ENV-019: Review Persistence Configuration
20. BL-ENV-020: Evaluate Infrastructure Emulator Dependencies

**Deliverable**: Production-ready baseline with clear upgrade paths

---

## Success Criteria

After cleanup, a newcomer should be able to:

1. **Clone the repo**
2. **Copy `.secure.local.example` → `.secure.local`** and add only `OPENAI_API_KEY`
3. **Run `docker-compose up`** and have a working platform (no chat integrations)
4. **Optionally enable** Twitch/Discord/RAG by following clear docs
5. **Understand** what each config file does from comments and README

---

## Notes

- **Do not remove** configs entirely if they demonstrate platform capabilities
- **Do provide** clear comments and examples
- **Do separate** "core platform" from "optional integrations"
- **Do document** the upgrade path from minimal to full-featured

---

## Related Documentation

After cleanup, update/create:
- `documentation/guides/local-development.md`
- `documentation/guides/twitch-integration.md`
- `documentation/guides/discord-integration.md`
- `documentation/guides/environment-configuration.md`
