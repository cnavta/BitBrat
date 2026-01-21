# Technical Architecture: MCP Administrative Capabilities for Auth Service

## 1. Objective
Enable administrative tasks via Model Context Protocol (MCP) in the Auth service. This allows the LLM bot to manage user roles and status (including banning) through natural language commands that map to MCP tool calls.

## 2. Component Changes

### 2.1 Auth Service (`src/apps/auth-service.ts`)
- Change `AuthServer` to extend `McpServer`.
- Register MCP tools:
    - `update_user`: General purpose tool for role management and status updates.
    - `ban_user`: Specialized tool for banning a user and triggering cross-platform effects.
- Ensure the service has a `Publisher` to emit moderation events.

### 2.2 User Repository (`src/services/auth/user-repo.ts`)
- Add `updateUser(id: string, update: Partial<AuthUserDoc>)` for direct modifications.
- Add `searchUsers(query: { displayName?: string, email?: string })` to support LLM lookup when an ID is not provided.

### 2.3 Ingress-Egress Service (`src/apps/ingress-egress-service.ts`)
- Subscribe to `moderation.action.v1` events.
- Dispatch ban requests to the appropriate platform connector.

### 2.4 Connectors (`src/services/ingress/`)
- **Twitch**: Implement `banUser` using `twurple` API client.
- **Discord**: Implement `banUser` using `discord.js`.

## 3. Interaction Flow (Ban Example)

1. **User Prompt**: "Ban @disturbing_user for spamming."
2. **LLM Bot**: Calls MCP tool `auth:ban_user({ displayName: "disturbing_user", reason: "spamming" })`.
3. **Auth Service**:
    - Finds user in Firestore.
    - Updates `status` to `"banned"`.
    - Publishes `moderation.action.v1` event with `platform` and `platformUserId`.
4. **Ingress-Egress Service**:
    - Receives `moderation.action.v1`.
    - Routes to Twitch connector.
    - Twitch connector calls Twitch API to ban the user on the platform.

## 4. Event Schema: `moderation.action.v1`
```json
{
  "v": "1",
  "source": "auth",
  "correlationId": "...",
  "type": "moderation.action.v1",
  "payload": {
    "action": "ban",
    "userId": "twitch:12345",
    "platform": "twitch",
    "platformUserId": "12345",
    "reason": "Spamming",
    "actor": "llm-bot"
  }
}
```

## 5. Security & Permissions
- Auth service requires a service account with Firestore write access.
- Twitch bot account requires `moderator:manage:banned_users` OAuth scope.
- Discord bot requires `BAN_MEMBERS` permission in the guild.
- MCP tools in Auth service should eventually have their own authorization check (e.g., only allowing certain roles to call them), but for this sprint, we assume the LLM bot is a trusted administrative agent.
