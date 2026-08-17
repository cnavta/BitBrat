# Execution Plan – tool-gateway env-var references in MCP server config (env/args)

- **Sprint:** sprint-321-e7c4b2
- **Role:** Lead Implementor
- **Date:** 2026-06-23
- **Source of truth:** `architecture.yaml` (tool-gateway service) + this sprint's `sprint-manifest.yaml`
- **Status:** Awaiting user approval — **no implementation begins until approved (AGENTS.md §2.4).**

## 1. Purpose

Decompose, into a sequenced and gated set of accomplishable tasks (with the companion Trackable
Prioritized YAML Backlog `backlog.yaml`), the feature that lets an **MCP server configuration's `env`
and `args` values reference environment variables available to the tool-gateway container**.

The primary use case is **secret hygiene**: instead of storing a secret (e.g. an API key) as a literal
value inside the Firestore `mcp_servers` document, an operator stores a *reference* (e.g.
`${OPENAI_API_KEY}`) and the tool-gateway substitutes the real value — drawn from its own process
environment / mounted secret — at connection time. A secondary, forward-looking use case is referencing
non-secret runtime configuration (e.g. `${ENV}`, `${GCS_BUCKET_NAME}`).

## 2. Guiding Constraints

- **Reuse the established syntax (DRY):** the platform already interpolates `${VAR}` and
  `${VAR:-default}` via a duplicated `interpolateEnv` helper (`src/services/twitch-oauth.ts`,
  `src/services/oauth/providers/twitch-adapter.ts`, `src/services/oauth/providers/discord-adapter.ts`)
  and `tools/brat/src/config/loader.ts#interpolateString`. This feature MUST reuse the **same syntax**
  and SHOULD extract a single shared `src/common` utility rather than add a fourth copy.
- **Single source of truth for values:** references resolve **only** from the tool-gateway's own
  `process.env`. No Firestore lookups, no remote secret fetches in this sprint.
- **Resolve at the consumption boundary:** substitution happens in `McpClientManager.connectServer`
  (`src/common/mcp/client-manager.ts`), the one place `config.env`/`config.args` are turned into a live
  transport (SSE headers; stdio `args` + merged `env`). This keeps the Firestore document, the
  `RegistryWatcher`, and the cached `serverConfigs` holding the *unresolved* (safe-to-persist) form.
- **Security — never log resolved secrets:** logs may record the **names** of referenced variables and
  any **unresolved** names, but never resolved values. Existing connect logs must not begin echoing the
  resolved `env`.
- **No behavior change for literals:** a config with no `${...}` tokens behaves exactly as today; the
  resolver is an identity transform on plain strings.
- **Backward compatible & opt-in:** existing `mcp_servers` documents keep working unchanged.
- **Idempotency correctness:** `connectionSignature()` currently hashes raw `env`/`args`. The resolver's
  placement must be chosen so that (a) benign Firestore rewrites still don't churn connections, and
  (b) a rotated underlying secret/value is handled per an explicit, documented decision (see Phase 2).
- **`architecture.yaml` unchanged:** this is an internal behavior of the tool-gateway; no canonical
  schema change is anticipated (surface to the user if discovery proves otherwise).
- **WIP limit = 3** in-progress items at a time.

## 3. Open Questions (to confirm at approval)

1. **Field name:** the issue says `envs`; the code field is `env` (`McpServerConfig.env`). Plan of
   record: implement on the canonical `env` field. Optionally also accept an `envs` alias — **confirm**.
2. **Unresolved reference policy:** when `${MISSING_VAR}` has no value and no default, choose between
   (a) substitute empty string (matches existing `interpolateEnv`), or (b) skip the connection and log
   a warning for **secret-bearing** stdio `env`. Plan of record: empty-string substitution + a single
   `mcp.config.env_ref.unresolved` warning listing the missing names — **confirm**.
3. **Rotation vs. idempotency:** plan of record is to resolve **before** computing
   `connectionSignature()` so a changed underlying value triggers a reconnect; alternative is to sign
   the unresolved form (no reconnect on rotation). **Confirm** desired behavior.

## 4. Phases & Gates

### Phase 0 — Shared interpolation utility (foundation)
- Add `src/common/env-interpolation.ts` exposing a small, well-typed API, e.g.
  `interpolateEnvString(input, env = process.env)` and `resolveEnvRefs(value, env)` for strings,
  string arrays, and `Record<string,string>`; supports `${VAR}` and `${VAR:-default}` (mirrors the
  existing regex `/\$\{([A-Z0-9_]+)(?::-(.*?))?\}/gi`).
- Return metadata for observability: the set of referenced var names and the set of unresolved names
  (values excluded), so callers can log safely.
- Add focused unit tests (`tests/common/env-interpolation.test.ts`): literal passthrough, single/multi
  refs, default fallback, missing var, mixed literal+ref, non-string safety.
- **Gate G0:** utility compiles, is fully unit-tested, and contains no logging of resolved values.

### Phase 1 — Resolve `env`/`args` in MCP config (core feature)
- In `src/common/mcp/client-manager.ts#connectServer`, build a resolved view of the config using the
  Phase-0 utility: resolve every value in `config.env` (Record) and every element of `config.args`
  (string[]) against `process.env`, leaving the cached/persisted config unmodified (resolve into locals
  or a shallow clone used only for transport construction).
- Apply to **both** transports: SSE (`requestInit.headers` from resolved `env`) and stdio
  (`args` from resolved `args`; `{ ...process.env, ...resolvedEnv }` for the child env).
- Emit one structured log (`mcp.config.env_ref.resolved`) with `{ name, refsUsed: string[],
  unresolved: string[] }` — **names only**.
- **Gate G1:** for a config containing `${VAR}`/`${VAR:-default}` in `env`/`args`, the live transport
  receives the resolved values; a literal-only config is byte-for-byte unchanged; no secret value is
  logged.

### Phase 2 — Reconnect idempotency & rotation semantics
- Decide and implement the ordering of resolution relative to `connectionSignature()` per Open Question 3
  (plan of record: sign the **resolved** env/args so a rotated value reconnects, while volatile metadata
  exclusion still prevents benign churn).
- Add/adjust the signature computation accordingly and document the decision inline + in the doc (Phase 4).
- **Gate G2:** unchanged Firestore doc + unchanged env → no reconnect churn (idempotency preserved);
  changed underlying value → exactly one reconnect with the new resolved value.

### Phase 3 — Tests (unit + integration of the MCP path)
- Extend/Add `tests/common/mcp/client-manager.*test.ts` (mock `StdioClientTransport`/`SSEClientTransport`,
  `process.env`): (a) stdio `env`/`args` refs resolved into the transport; (b) SSE header refs resolved;
  (c) literal config unchanged; (d) unresolved ref → empty value + warning, no thrown error;
  (e) idempotency/rotation per Phase 2; (f) assertion that resolved secret values never appear in logs.
- Ensure existing tool-gateway / client-manager suites stay green (`src/apps/tool-gateway.test.ts`).
- **Gate G3:** new cases pass; existing MCP/tool-gateway suites remain green; no live network/process
  spawns in tests.

### Phase 4 — Documentation, validation harness & close-out
- Document the feature where MCP server registration is described (e.g. a tool-gateway / MCP config
  section under `documentation/`): supported syntax (`${VAR}`, `${VAR:-default}`), that resolution is
  from the tool-gateway container env, the secret-hygiene use case with a Firestore example
  (`env: { OPENAI_API_KEY: "${OPENAI_API_KEY}" }`), the unresolved-reference policy, and the
  rotation/idempotency note.
- Provide/extend `validate_deliverable.sh`: `npm run build` + the new env-interpolation and MCP
  client-manager suites (+ a tool-gateway regression check); logically passable per AGENTS.md §2.6.
- Produce `verification-report.md`, `retro.md`, `key-learnings.md`; open PR and record in
  `publication.yaml` (Rules S12/S13).
- **Gate G4:** `validate_deliverable.sh` is logically passable and DoD (AGENTS.md §3) is met.

## 5. Sequencing & Dependencies (summary)

```
Phase0(G0 shared interpolation util)
  -> Phase1(G1 resolve env/args in connectServer)
    -> Phase2(G2 signature/rotation semantics)
      -> Phase3(G3 tests)
        -> Phase4(G4 docs + validate + close)
```

The detailed, trackable breakdown (IDs, priorities, effort, deps, acceptance criteria) lives in
`backlog.yaml` (BL-001 … BL-008).

## 6. Definition of Done (this artifact)
- [x] Feature decomposed into phased, gated, accomplishable tasks.
- [x] Companion Trackable Prioritized YAML Backlog produced (`backlog.yaml`).
- [x] Constraints (syntax reuse, resolve-at-boundary, no secret logging, idempotency) explicit.
- [x] Open questions surfaced for approval (`envs` vs `env`, unresolved policy, rotation semantics).
- [ ] **User approval to begin implementation (pending).**
