# Deliverable Verification – sprint-321-e7c4b2

Feature: tool-gateway env-var references in MCP server config (`env`/`args`).

## Approved decisions (REQ-002)
1. **Field name:** implemented on the canonical `env` field only (no `envs` alias).
2. **Unresolved references:** empty-string substitution + a single `mcp.config.env_ref.unresolved`
   warning listing the missing names.
3. **Rotation vs. idempotency:** `env`/`args` are resolved **before** `connectionSignature()` is
   computed, so a rotated underlying value triggers exactly one reconnect.

## Completed
- [x] **BL-001** Open questions confirmed and recorded (request-log REQ-002; plan/backlog amended).
- [x] **BL-002** Shared utility `src/common/env-interpolation.ts` (`${VAR}` / `${VAR:-default}`;
      string / string[] / Record resolution; returns `refsUsed` + `unresolved` name metadata; never
      logs values; identity transform for literals).
- [x] **BL-003** `tests/common/env-interpolation.spec.ts` (10 cases) — passing.
- [x] **BL-004** `McpClientManager.connectServer` resolves `env`/`args` via the utility for both
      transports (SSE headers; stdio `args` + merged child `env`); cached/persisted config stays
      unresolved; `mcp.config.env_ref.resolved` (names only) emitted.
- [x] **BL-005** Resolution ordered before `connectionSignature()`; new `connectedSignatures` map
      stores the resolved signature at connect time — benign metadata rewrites don't churn, rotation
      reconnects exactly once. Signature cleared on disconnect.
- [x] **BL-006** `tests/common/mcp/env-refs.spec.ts` (7 cases) — stdio env/args, SSE headers,
      literal-unchanged, unresolved→empty+warn (no throw), no-secret-in-logs, idempotency, rotation.
- [x] **BL-007** `documentation/guides/mcp-config-env-references.md`.
- [x] **BL-008** `planning/sprint-321-e7c4b2/validate_deliverable.sh` (build + suites + regression);
      logically passable per AGENTS.md §2.6.

## Validation results
- `npm run build` (tsc) — clean.
- env-interpolation suite: 10/10 passing.
- MCP env-refs suite: 7/7 passing.
- MCP suite + `src/apps/tool-gateway.test.ts` regression: 54/54 passing.
- `validate_deliverable.sh`: passes end-to-end.

## Partial
- None.

## Deferred
- Sprint close-out artifacts (`retro.md`, `key-learnings.md`) and the GitHub PR (`publication.yaml`,
  Rules S12/S13) are intentionally held until the user issues **"Sprint complete."** per Rule S2.

## Alignment Notes
- `architecture.yaml` unchanged (internal tool-gateway behavior; no canonical schema change).
- No `envs` alias added; `McpServerConfig` schema unchanged.
- The existing duplicated `interpolateEnv` helpers were left in place (out of scope); the new shared
  utility is available for future consolidation.
