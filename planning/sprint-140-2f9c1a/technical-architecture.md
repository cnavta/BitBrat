# Technical Architecture — OAuth Multi‑Provider Extension (Add Discord)

## Objective
- Extend the existing oauth-flow service to support multiple OAuth providers beyond Twitch, starting with Discord.
- Provide a modular, provider‑agnostic architecture allowing future providers (e.g., YouTube, Kick) to be added with minimal work.
- Ensure the Discord ingress connector uses authenticated credentials sourced through the unified auth mechanism (not raw env vars), with secure storage and rotation.

## Current State (Summary)
- Service oauth-flow (src/apps/oauth-service.ts) mounts Twitch-only routes via mountTwitchOAuthRoutes for two identities: /oauth/twitch/bot and /oauth/twitch/broadcaster. Tokens are stored via FirestoreTokenStore.
- Discord ingress (src/services/ingress/discord/discord-ingress-client.ts) connects using cfg.discordBotToken directly from configuration.
- architecture.yaml: Cloud Run default, Node/TS, paths under /oauth/*, secrets include TWITCH_CLIENT_ID/SECRET and OAUTH_STATE_SECRET.

## Goals
- Introduce a provider‑agnostic OAuth layer and routing: /oauth/:provider/:identity/*.
- Implement Discord provider adapter; add Discord configuration and secrets.
- Normalize token models and storage scheme across providers and identities.
- Update Discord ingress to fetch credentials from the token store (with secure fallback) and honor rotation without restarts.

## Non‑Goals (This sprint)
- Full end‑user account linking UI.
- Advanced consent management or multi‑tenant orgs.
- Cross‑provider single sign‑on.

## High‑Level Design
1) Provider Abstraction
   - Define an OAuthProvider interface implemented by each provider adapter (twitch, discord, future: youtube, kick…).
   - Provider Registry resolves a provider key (e.g., "twitch", "discord") to a concrete adapter.
   - Route factory mounts /oauth/:provider/:identity endpoints using the registry and shared controllers.

2) Unified Routes (per provider + identity)
   - GET /oauth/:provider/:identity/start?mode=(json|redirect)
     • Builds provider authorize URL (supports PKCE where applicable). Returns JSON or 302 redirect.
   - GET /oauth/:provider/:identity/callback?code=…&state=…
     • Validates state, exchanges code, persists tokens, returns success page/JSON.
   - POST /oauth/:provider/:identity/refresh (internal/authenticated)
     • Refreshes tokens if supported.
   - GET /oauth/:provider/:identity/status
     • Returns token status (exists, expiresAt, scopes, lastValidatedAt).
   - POST /oauth/:provider/:identity/revoke (optional)
     • Revokes tokens if supported.

3) Token Storage Model
   - FirestoreTokenStore continues as the storage abstraction (ITokenStore).
   - Document keying expanded to include provider and identity.
     Path proposal: authTokens/{provider}/{identity}
     Document schema:
     {
       provider: "twitch" | "discord" | …,
       identity: "bot" | "broadcaster" | "system" | "user:{id}",
       tokenType: "oauth" | "bot-token",
       accessToken?: string,
       refreshToken?: string,
       expiresAt?: string,
       scope?: string[],
       providerUserId?: string,
       metadata?: object,
       updatedAt: string
     }
   - Backward compatibility: existing Twitch tokens can be migrated or read via a compatibility layer (e.g., default provider="twitch" when missing).

4) Discord Specifics
   - Gateway (bot) authentication uses a Bot Token (not obtained via OAuth code grant). We will store the bot token in the token store under provider=discord, identity=bot, tokenType=bot-token. Rotation handled by updating the doc.
   - Optional: Support Discord OAuth2 for user access tokens (e.g., for REST APIs) via provider=discord, identity=broadcaster or user:{id} using standard code grant. This lays groundwork for future features.
   - Discord Ingress Connector will:
     • Retrieve the token from ITokenStore on start and periodically (or subscribe to change notifications if available).
     • Fall back to cfg.discordBotToken only if the token store entry is absent (controlled via config flag for safe rollout).
     • On token change, re-login the Discord client with minimal disruption.

5) Configuration and Secrets
   - Add Discord client config to architecture.yaml/env:
     • DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI
     • DISCORD_OAUTH_SCOPES (for user flows), DISCORD_BOT_TOKEN (for bootstrap/fallback only)
     • OAUTH_STATE_SECRET remains shared.
   - Cloud Run/Build: wire these via env/prod/dev/local yaml and .cloudbuild kv files.

6) Security & Compliance
   - State validation (existing generateState). Add PKCE support where providers allow.
   - Encrypt tokens at rest (Firestore + KMS/Field‑level encryption if required). At minimum, secrets are not logged and are redacted in debug dumps.
   - Strict allowlist for redirect URIs per provider.
   - Principle of least privilege for scopes.

7) Observability
   - Structured logging through logging facade; trace every /oauth request segment (already partially present).
   - Emit counter metrics per provider/identity (tokens_saved, refresh_success, refresh_failed).

8) Failure & Recovery
   - Safe fallbacks for Discord connector (config token if store empty; feature flag to enforce store‑only once validated in prod).
   - Exponential backoff on token refresh failures.

## Provider Adapter Interface (TypeScript)
```ts
export interface OAuthProvider {
  readonly key: string; // "twitch" | "discord" | …
  readonly displayName: string;
  getAuthorizeUrl(params: { identity: string; state: string; mode?: "json" | "redirect"; scopes?: string[]; redirectUri?: string; }): Promise<string>;
  exchangeCodeForToken(params: { code: string; redirectUri: string; identity: string; }): Promise<TokenPayload>;
  refreshAccessToken?(token: TokenPayload): Promise<TokenPayload>;
  validateToken?(token: TokenPayload): Promise<ValidationResult>;
  revokeToken?(token: TokenPayload): Promise<void>;
}

type TokenPayload = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string; // ISO
  scope?: string[];
  tokenType?: string;
  providerUserId?: string;
};
```

## Routes and Controller Wiring
- New mountOAuthRoutes(app, cfg, tokenStore, basePath="/oauth") that:
  • Parses :provider and :identity
  • Looks up adapter in ProviderRegistry
  • Performs state/PKCE, calls adapter, persists via tokenStore under authTokens/{provider}/{identity}
  • Preserves existing Twitch endpoints under their current paths for compatibility, while also enabling new generic paths

## Discord Ingress Changes (Consumption of Auth)
- Introduce ITokenStore to the DiscordIngressClient constructor (or a small resolver abstraction) to fetch the bot token.
- Logic order:
  1) If cfg.discordUseTokenStore=true, attempt to read token from authTokens/discord/bot (tokenType=bot-token)
  2) If found, use it for client.login()
  3) Else if cfg.discordBotToken exists and fallback enabled, use that
  4) Otherwise set ERROR state
- Consider a lightweight cache with TTL and an endpoint or pub/sub signal to force reload on rotation.

## Data Flow (Discord)
- For gateway bot connection: token comes from token store (initially seeded from secret manager or admin endpoint), not via OAuth code grant.
- For optional user OAuth (future): standard code→token exchange via /oauth/discord/:identity endpoints; stored under the same collection.

## Backward Compatibility & Migration
- Keep existing /oauth/twitch/* routes intact.
- Add new generic /oauth/:provider/:identity/* routes; internally route Twitch through the twitch adapter.
- One‑time migration script (optional): copy existing token docs to the new authTokens schema with provider="twitch" keys.

## Acceptance Criteria
- Provider‑agnostic routing implemented and tested (unit + integration tests for Twitch paths unchanged and new generic Twitch paths).
- Discord OAuth adapter implemented (at least skeleton with authorize URL; full code/refresh optional if not required for bot flow).
- Discord ingress reads bot token from token store (feature‑flagged), with fallback to env.
- Documentation updated: architecture.yaml additions, env/* updated, Cloud Build KV updated.

## Risks & Mitigations
- Discord bot token isn’t retrievable via OAuth: treat as bot-token in store; seed from Secret Manager.
- Token rotation causing disconnects: add graceful reconnect and health reporting in DiscordIngressClient.
- Multi‑provider complexity: keep adapters thin; reuse shared controller logic.

## Open Questions
- Do we need user‑level Discord OAuth this sprint, or only bot gateway auth? (Proposed: bot gateway auth via token store; user OAuth optional groundwork.)
- Preferred token store collection path and naming? (Proposed: authTokens/{provider}/{identity})
- Owner for sprint manifest (GitHub handle)?

## Next Steps (pending approval)
1) Add implementation-plan.md for approval
2) Implement provider registry + routes
3) Add Discord adapter
4) Update Discord ingress to consume token from store (feature-flagged) and add rotation handling
5) Validation script and PR