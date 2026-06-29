# Deliverable Verification – sprint-330-91f8ad

- **Sprint:** sprint-330-91f8ad
- **Date:** 2026-06-29
- **Branch:** `feature/sprint-330-91f8ad-active-deploy-dup-fleet-restart`

## Completed

### Item 1 — Deploy honors `active:false` (BL-330-101, BL-330-102)
- [x] `resolveServices` (tools/brat/src/config/loader.ts) now resolves a canonical `active` boolean
  (`svc.active ?? defaults.services.active ?? false` → only explicit `true` enables).
- [x] New exported `selectDeployableServices()` (tools/brat/src/cli/index.ts) filters `--all` to active
  services (structured `deploy.service status=skipped reason=inactive` log) and fails fast with a
  `ConfigurationError` when an inactive service is named explicitly. `cmdDeployServices` uses it.
- [x] Unit tests: tools/brat/src/cli/__tests__/deploy-active-filter.test.ts (omit inactive on `--all`,
  explicit-inactive → ConfigurationError, unknown → ConfigurationError, active still selected).

### Item 2 — Slow-Bit duplicate responses (BL-330-201, BL-330-202, BL-330-203)
- [x] Root cause: at-least-once redelivery + a consumer dedupe keyed ONLY on idempotencyKey/correlationId
  (pubsub-driver.ts) — slow Bits whose messages lacked those attrs had no redelivery protection; NATS had
  no dedupe at all. Documented with file/line evidence in the execution plan §3.
- [x] New shared module src/services/message-bus/dedupe.ts: `buildDedupeKey` (idempotencyKey →
  correlationId+step+attempt → transport message-id fallback) + `dedupeShouldDrop` (TTL/size-bounded).
- [x] Pub/Sub driver uses the shared dedupe with `message.id` fallback and sets an explicit, configurable
  `maxExtensionTime` (`PUBSUB_MAX_ACK_EXTENSION_SECONDS`, default 600s) so a slow handler keeps its lease.
- [x] NATS driver mirrors: shared dedupe (stream-sequence fallback), `ackWait` (`NATS_ACK_WAIT_SECONDS`,
  default 60s) and periodic `msg.working()` to reset the ack timer during long handlers.
- [x] Tests: dedupe.test.ts (key construction + TTL/redelivery), pubsub-subscriber.dedupe.test.ts (slow
  message processed once, redelivery dropped → single egress; messageId-fallback dedupe; lease config
  present). Existing pubsub/nats driver tests updated for the new option shapes.

### Item 3 — `brat fleet restart <bit>` (BL-330-301, BL-330-302)
- [x] `bit.restart` universal control-plane tool registered in src/common/base-server.ts (scope
  `bit:operate`), returns `{ restarting: true, reason }`; new overridable `restart()` = `close(reason)`
  then `process.exit(0)` (guarded by `BIT_RESTART_NO_EXIT=1` for tests) so the orchestrator respawns.
- [x] `tests/common/bit-conformance.spec.ts` mandatory tool set + scope assertion include `bit.restart`.
- [x] Fleet CLI: `restart` added to dispatch (→ `mutate('bit.restart')`), MUTATING_SUBS, and help text.
  Specs: restart `<bit>`, `--all` refused without `--confirm`, `--all --confirm` sequential, RBAC Forbidden.

### Docs (BL-330-303)
- [x] documentation/reference/bit-control-plane.md (bit.restart row + RBAC list + subcommand mapping).
- [x] documentation/tools/brat.md (fleet restart subcommand + active-deploy behavior note).
- [x] CHANGELOG.md `[Unreleased]` (Added/Changed/Fixed for the three items).
- [x] architecture.yaml (canonical): messaging.transport.tuning env knobs documenting the duplicate fix.

## Validation
- `npm run build` (tsc): clean.
- `npm test`: **284 of 285 suites passed (1 skipped), 1120 tests passed, 2 skipped** — green.
- `npm run release:dry -- patch`: OK (0.7.3 → 0.7.4 dry-run; three version sources agree).

## Partial / Deferred
- BL-330-204 (persistent cross-instance dedupe store): **Deferred** (P3) — not required; in-handler lease
  extension + idempotency dedupe resolves the reported duplicates. Tracked for a future sprint if a
  multi-replica scenario ever proves the per-process cache insufficient.

## Alignment Notes
- Added a `BIT_RESTART_NO_EXIT` env escape hatch (not in the original plan) so `restart()` is testable and
  overridable without killing the test runner.
- Pub/Sub lease extension was already auto-enabled by the client library; we made it explicit/configurable
  rather than introducing new modAck plumbing — the decisive duplicate fix was the dedupe messageId fallback.
