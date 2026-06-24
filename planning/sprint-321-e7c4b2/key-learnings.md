# Key Learnings – sprint-321-e7c4b2

Reusable lessons for future sprints.

## Architecture & patterns
- **Resolve runtime references at the single consumption point.** `env`/`args` interpolation lives in
  `McpClientManager.connectServer` only; the persisted Firestore `mcp_servers` document and the cached
  `serverConfigs` entry stay in their unresolved (safe-to-store) form. Keep secrets out of state.
- **Sign the resolved view for reconnect idempotency.** When a derived/resolved value drives a
  connection, compute the idempotency signature over the *resolved* value (post-interpolation) and
  cache it per-connection (`connectedSignatures`). This makes secret rotation reconnect exactly once
  without churning on volatile metadata writes.
- **Prefer one shared utility over scattered copies.** The `${VAR}` / `${VAR:-default}` syntax already
  existed in 3–4 places; new work should centralize (`src/common/env-interpolation.ts`) and future
  cleanup should migrate the legacy copies.

## Security
- Interpolation helpers should expose **names, not values** (`refsUsed` / `unresolved`) so callers can
  log/observe safely. Add an explicit test asserting secrets never appear in any log call.
- Unresolved references → empty string + a single names-only warning is a safe, predictable default
  (no throw, no partial secret exposure).

## Process / environment
- Don't assume a global Node toolchain — select an explicit nvm version (v20.19.3 here) in scripts.
- `gh` CLI may be absent; have a GitHub-API-with-token fallback ready for the Publication phase.
- Plan-first gating (AGENTS.md §2.4) reliably converts ambiguous one-liners ("envs") into confirmed
  decisions before code, eliminating rework.
