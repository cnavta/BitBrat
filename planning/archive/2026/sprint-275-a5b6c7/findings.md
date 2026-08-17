# Discord Integration Analysis - sprint-275-a5b6c7

## Summary
The Discord integration in the `ingress-egress` service has two main issues:
1. It fails to connect when using the OAuth `accessToken` stored in Firestore.
2. It does not attempt to reconnect when the token is updated in Firestore because of early exits and delayed initialization.

## Findings

### 1. Inappropriate Token Type
The `discord.js` library `login()` method expects a **Bot Token**, not an **OAuth Access Token (Bearer)**.
- **DiscordAdapter Issue**: In `src/services/oauth/providers/discord-adapter.ts`, the `exchangeCodeForToken` method attempts to get the token from `json.token` but falls back to `json.access_token`. 
- **Bearer vs Bot**: Discord's OAuth2 response for the `bot` scope returns a user-level Bearer `access_token` and potentially a `bot` object, but it does NOT always return the bot token at the top-level `token` field.
- **Result**: `DiscordIngressClient` takes this `access_token` (which is a Bearer token) and passes it to `discord.js`, which then fails to connect with an "invalid token" error.

### 2. Reconnection Logic Failures
The `DiscordIngressClient` has several flaws that prevent it from recovering from an initial connection failure:
- **Polling Delay**: `startTokenPoll()` is only called at the end of `start()`. If the initial `this.client.login(token)` call fails, `start()` throws, and `startTokenPoll()` is never executed. Consequently, the service never polls for a new token even if one is provided in Firestore later.
- **Reconnect Early Exit**: The `reconnect()` method has a guard: `if (!this.client) return;`. If the initial connection failed, `this.client` is likely null (or destroyed), so `reconnect()` will never try to establish a new connection even when a new token is provided.
- **Error Propagation**: When `start()` fails, it doesn't currently allow for background recovery because it hasn't started the poll timer.

### 3. Missing Re-registration
If the token is rotated while the client is disconnected (e.g., during the `reconnect()` process), there might be a race condition where the `currentToken` is not updated correctly, or the client is recreated with old parameters.

## Proposed Fixes

### In `DiscordIngressClient`:
1. Move `startTokenPoll()` before `this.client.login(token)` in `start()`, or use a `finally` block to ensure polling starts regardless of the initial connection success.
2. Modify `reconnect()` to allow connecting even if `this.client` is currently null.
3. Ensure that if `start()` fails, the client stays in a state that allows the poll timer to trigger a `reconnect()` with a fresh token.

### In `DiscordAdapter` (or OAuth Flow):
1. Verify if the bot token is truly returned by the OAuth flow. If not, we should probably be storing a static Bot Token instead of trying to get it via OAuth, OR we need to find where Discord returns it in the OAuth response (e.g., `json.bot.token`).
2. Ensure `tokenType` is correctly set to distinguish between a Bearer token and a Bot token.

## Conclusion
The combination of using the wrong token type and having fragile reconnection guards makes the Discord ingress unreliable. Fixing the token resolution and ensuring the poll timer runs even after a failed start will resolve these issues.
