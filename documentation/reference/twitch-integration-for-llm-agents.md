# Twitch Integration Modules — Portable Guide for LLM Coding Agents

Author: Junie (Lead Implementor)
Date: 2025-11-19
Sprint: 96
Status: Ready for review

llm_prompt: When adopting these modules in another LLM agent project, keep interfaces stable. Prefer pluggable stores via ITokenStore, keep OAuth state HMAC secret distinct per environment, and persist userId with tokens to avoid repeated validate calls. Do not duplicate token storage mechanisms.

---

## Scope

This document explains how to reuse BitBrat’s Twitch integration modules in a different LLM coding agent project. It is implementation‑backed and references code line numbers from the repository for traceability.

Covered modules (files):
- OAuth endpoints and helpers: `src/services/twitch-oauth.ts`
- Firestore-backed token store: `src/services/firestore-token-store.ts`
- Token freshness/refresh manager: `src/services/twitch-token-manager.ts`
- EventSub WebSocket controller: `src/services/twitch-eventsub.ts`

You can adopt these modules wholesale or as patterns to implement equivalents for your infrastructure. The only hard external dependencies are Express (for OAuth routes), a token store that conforms to `ITokenStore`, and Twurple libraries for EventSub.

---

## Quickstart (drop-in usage)

1) Provide configuration and secrets via environment variables or your config system:
- TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET
- OAUTH_STATE_SECRET (HMAC secret for OAuth state)
- Optional: TWITCH_OAUTH_SCOPES (space or comma separated), TWITCH_REDIRECT_URI
- Firestore (if using FirestoreTokenStore): ADC credentials and FIRESTORE_DATABASE_ID

2) Choose a token store implementation:
- Use the provided FirestoreTokenStore, or implement your own ITokenStore with the same contract.

3) Mount OAuth endpoints in your Express app for Bot and/or Broadcaster identities:
- `/oauth/twitch/bot/start` → `/oauth/twitch/bot/callback`
- `/oauth/twitch/broadcaster/start` → `/oauth/twitch/broadcaster/callback`

4) Start EventSub using the broadcaster token:
- Provide channel login(s), clientId/secret, and the tokenStore for broadcaster.
- Register handlers for follows, subs, raids, redemptions, and stream online/offline.

5) For Helix or other API use outside Twurple’s RefreshingAuthProvider, use TwitchTokenManager to keep a valid access token available.

---

## Module Reference

### 1) OAuth helpers and routes — `src/services/twitch-oauth.ts`

Responsibilities:
- Build Twitch authorization URL with requested scopes and a signed state parameter.
- Verify state on callback with HMAC, exchange code for tokens, optionally validate the token to discover userId, and persist via ITokenStore.

Key APIs:
- `generateState(cfg: IConfig, nonce?: string): string` (lines 23–29) — HMAC-SHA256 over `nonce.timestamp` using `cfg.oauthStateSecret`.
- `verifyState(cfg: IConfig, state?: string, maxAgeMs=600000): boolean` (31–41) — constant‑time HMAC check, age bounded.
- `getAuthUrl(cfg: IConfig, req, basePath='/oauth/twitch'): string` (51–59) — computes redirectUri (using X‑Forwarded headers if present) and returns the Twitch authorize URL.
- `exchangeCodeForToken(cfg, code, redirectUri): Promise<TwitchTokenData>` (61–108) — calls Twitch token endpoint, returns `TwitchTokenData`, best‑effort calls `/oauth2/validate` to populate `userId`.
- `mountTwitchOAuthRoutes(app, cfg, tokenStore, basePath)` (110–148) — mounts `GET {basePath}/start` and `GET {basePath}/callback`. On success, stores token via `tokenStore.setToken()`.

Security notes:
- State token is signed with HMAC (lines 23–41). Set a strong `OAUTH_STATE_SECRET` per environment. The callback rejects invalid/expired states.
- `computeBaseUrl` (43–49) respects `x-forwarded-proto`/`x-forwarded-host` for correct redirect URI behind load balancers.

Adoption tips:
- If your reverse proxy standardizes different header names, adapt `computeBaseUrl` accordingly.
- You may provide `cfg.twitchRedirectUri` to bypass auto detection if you have a fixed callback URL.

---

### 2) Token persistence — `src/services/firestore-token-store.ts`

Responsibilities:
- Persist and retrieve `TwitchTokenData` in Firestore.

Path convention:
- Construct with a logical path like `oauth/twitch/bot` or `oauth/twitch/broadcaster`. The actual document used is `{path}/token` (lines 13–15).

Schema written/read (lines 41–57 and 17–35):
- `accessToken: string`
- `refreshToken: string | null`
- `scope: string[]` (defaults to [])
- `expiresIn: number | null` (seconds)
- `obtainmentTimestamp: number | null` (epoch ms)
- `userId: string | null`
- `updatedAt: number` (epoch ms)

Error handling:
- Missing doc or fields → returns null (17–26).
- Writes use `{ merge: true }` to preserve unspecified fields and stamp `updatedAt` (41–57).

Portability:
- If not using Firestore, implement your own `ITokenStore` with the same method signatures.

---

### 3) Programmatic refresh — `src/services/twitch-token-manager.ts`

Responsibilities:
- Provide a simple, provider‑agnostic refresh flow for access tokens using the OAuth refresh token grant.

Key APIs:
- `getValidAccessToken(): Promise<string|null>` (20–28) — returns a valid access token, refreshing if needed.
- `getValidToken(): Promise<TwitchTokenData|null>` (30–43) — same as above but returns the full token.
- `forceRefresh(): Promise<TwitchTokenData|null>` (45–49) — always refreshes if possible.

Expiry logic:
- `isExpiredOrStale` (51–57) computes `expiresAt = obtainmentTimestamp + expiresIn*1000` and applies a skew window (default 120s).

Refresh logic (59–111):
- If no `refreshToken`, logs and returns current token.
- Otherwise POSTs to `https://id.twitch.tv/oauth2/token` with grant_type=refresh_token, updates fields, and persists via `tokenStore.setToken`.

Use cases:
- Background pollers or API clients that need a bearer token without initializing Twurple’s `RefreshingAuthProvider`.

---

### 4) EventSub WebSocket controller — `src/services/twitch-eventsub.ts`

Responsibilities:
- Initialize a Twurple `RefreshingAuthProvider` from stored tokens; ensure `userId` is present (persist it after validate if missing).
- Connect an EventSub WS listener and subscribe to Twitch events with resilience to pacing, rate limits, and transient WS session issues.

Auth provider bootstrap (34–123):
- Loads token via `ITokenStore.getToken()`.
- If `userId` is missing, validates the token (`/oauth2/validate`) and writes back `userId` (45–71). Throws if `userId` cannot be determined (73–76).
- Configures `RefreshingAuthProvider`, seeds user, and on refresh persists updated token with `userId` (80–119).

Subscription orchestration:
- Pacing and retries with exponential backoff (140–195).
- Startup jitter to avoid herd effects (197–205).
- Preloads existing subscriptions to avoid duplicates (207–237).
- Resolves channel logins to IDs (239–254) and enforces that the token’s user matches the broadcaster (326–339).

Subscriptions supported out of the box:
- Follow (341–393) — requires `moderator:read:followers`.
- Subscriptions (395–446) — requires `channel:read:subscriptions`.
- Raids (448–495) — behind feature flag `eventsub.raids.enabled`.
- Redemptions (497–549) — behind feature flag `eventsub.redemptions.enabled` and scope `channel:read:redemptions`.
- Stream Online/Offline (551–616) — with resilience to WS session readiness.

Targeted WS session fix (289–322):
- Detects specific HTTP 400 error “websocket transport session does not exist or has already disconnected”, restarts the listener, and retries the subscription once.

Return value:
- On success, returns a controller with `stop(): Promise<void>` and diagnostic `summary`, `lastConnectTs`, and `tokenDiag` (618–628).

Adoption tips:
- Provide `channels` as login names (e.g., `['#mychannel']`). The module resolves these to broadcaster IDs.
- Implement your own `EventHandlers` to integrate with your agent’s event pipeline.
- Feature flag controls can be replaced with your own configuration system; the defaults are safe.

---

## Configuration & Environment

Required secrets:
- TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET — from your Twitch application.
- OAUTH_STATE_SECRET — random secret for state HMAC.

Common optional settings:
- TWITCH_OAUTH_SCOPES — space‑separated string; defaults include `chat:read chat:edit channel:read:subscriptions user:read:follows moderator:read:followers channel:read:vips channel:read:redemptions` (twitch-oauth.ts 10–21).
- TWITCH_REDIRECT_URI — override for callback URL (otherwise auto‑computed from request headers).
- TOKEN_DOC_PATH — default `oauth/twitch/bot`.
- BROADCASTER_TOKEN_DOC_PATH — default `oauth/twitch/broadcaster`.
- EVENTSUB_MIN_INTERVAL_MS, EVENTSUB_MAX_ATTEMPTS, EVENTSUB_BACKOFF_BASE_MS, EVENTSUB_BACKOFF_CAP_MS — pacing knobs if you expose them.

---

## Security, Privacy, and Compliance

- OAuth state HMAC: Required to prevent CSRF. Keep `OAUTH_STATE_SECRET` unique per environment.
- Refresh tokens: Persist securely. The reference implementation stores them in Firestore with `{ merge: true }` and relies on GCP IAM and at‑rest encryption. Consider KMS envelope encryption if your threat model requires it.
- Token validation: Best‑effort calls to `/oauth2/validate` exist in both OAuth exchange and token refresh flows to populate `userId` for principal binding.
- Least privilege: Only request scopes you need. EventSub sections check for scopes and skip subscriptions when missing, logging helpful messages.
- Behind proxies: `computeBaseUrl` respects `x-forwarded-*` headers. Ensure your proxy sets them correctly.

---

## Integration Recipes

1) Express OAuth wiring (Bot + Broadcaster):
```ts
import express from 'express';
import { mountTwitchOAuthRoutes } from '../services/twitch-oauth';
import { FirestoreTokenStore } from '../services/firestore-token-store';

const app = express();
const cfg = { twitchClientId: process.env.TWITCH_CLIENT_ID, twitchClientSecret: process.env.TWITCH_CLIENT_SECRET, oauthStateSecret: process.env.OAUTH_STATE_SECRET, twitchScopes: [] } as any;
const botStore = new FirestoreTokenStore(process.env.TOKEN_DOC_PATH || 'oauth/twitch/bot');
const broadcasterStore = new FirestoreTokenStore(process.env.BROADCASTER_TOKEN_DOC_PATH || 'oauth/twitch/broadcaster');

mountTwitchOAuthRoutes(app, cfg, botStore, '/oauth/twitch/bot');
mountTwitchOAuthRoutes(app, cfg, broadcasterStore, '/oauth/twitch/broadcaster');

app.listen(8080);
```

2) EventSub startup:
```ts
import { startTwitchEventSub } from '../services/twitch-eventsub';

const ctl = await startTwitchEventSub({
  clientId: process.env.TWITCH_CLIENT_ID!,
  clientSecret: process.env.TWITCH_CLIENT_SECRET!,
  channels: ['#yourchannel'],
  tokenStore: broadcasterStore,
  minIntervalMs: 1500,
}, {
  onFollow: async (channel, user) => {/* your pipeline */},
  onSub: async (channel, user) => {/* your pipeline */},
  onRaid: async (channel, raid) => {/* your pipeline */},
  onRedemption: async (channel, r) => {/* your pipeline */},
});
// later: await ctl?.stop();
```

3) Helix bearer token for custom HTTP calls:
```ts
import { TwitchTokenManager } from '../services/twitch-token-manager';
const tm = new TwitchTokenManager({ clientId: process.env.TWITCH_CLIENT_ID!, clientSecret: process.env.TWITCH_CLIENT_SECRET!, tokenStore: broadcasterStore });
const token = await tm.getValidAccessToken();
if (token) {
  await fetch('https://api.twitch.tv/helix/some/endpoint', { headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${token}` } });
}
```

---

## Portability Notes

- Token storage is abstracted: implement `ITokenStore` against your DB or secret store (Redis, DynamoDB, Cloud SQL) if you don’t use Firestore. Maintain the same schema keys for best compatibility.
- Twurple dependencies are dynamically imported in EventSub to avoid hard compile‑time coupling; this eases testing or alternate builds.
- Feature flags in BitBrat use a small `features` helper. In your project, wire equivalent booleans through your config system.

---

## Known Edge Cases and Resilience

- EventSub 400 “websocket transport session does not exist…” during subscribe: handled by a one‑time reconnect + retry path (289–322). This was observed in production and mitigated here.
- Duplicate subscriptions: prefetch existing subs to avoid 409s (207–237). Additionally, error parsing treats 409/“already subscribed” as non‑fatal.
- Missing `userId` in tokens: proactively validate and persist; EventSub cannot add a user without it (73–76).
- Tokens without expiry metadata: modules treat them as non‑expiring and skip refresh (twitch-token-manager.ts 51–57).

---

## Type Contracts

- `ITokenStore` (src/types/index.ts 63–66):
  - `getToken(): Promise<TwitchTokenData|null>`
  - `setToken(token: TwitchTokenData): Promise<void>`
- `TwitchTokenData` (54–61): `accessToken`, optional `refreshToken`, `scope[]`, `expiresIn`, `obtainmentTimestamp`, `userId`.

---

## Traceability

Source code references used throughout this document:
- twitch-oauth.ts: 9–21, 23–41, 51–59, 61–108, 110–148
- firestore-token-store.ts: 13–15, 17–35, 41–57
- twitch-token-manager.ts: 20–28, 30–57, 59–111
- twitch-eventsub.ts: 34–123, 140–195, 197–237, 239–339, 341–616, 618–628, 289–322

---

## Checklist for Adoption

- [ ] Configure TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET
- [ ] Set OAUTH_STATE_SECRET with a strong random value
- [ ] Decide on token store (FirestoreTokenStore or your own ITokenStore)
- [ ] Mount OAuth routes and verify callback works end‑to‑end
- [ ] Confirm tokens persist with `userId` populated
- [ ] Enable EventSub and verify subscriptions come up without 400/409 noise
- [ ] Add telemetry/log shipping for `eventsub.*` and `oauth.*` log keys
