# Deliverable Verification – sprint-263-60adf2

## Completed
- [x] BL-263-001 / BL-263-002 — Added the `BehaviorProfile` contract, rollout flags, shared annotation normalizer, and precedence/unit coverage in `llm-bot`.
- [x] BL-263-003 / BL-263-004 — Integrated behavioral guidance into prompt assembly, candidate/prompt-log metadata, gating, safe refusals, behavioral tool filtering, and decision annotations/logs.
- [x] BL-263-005 / BL-263-006 — Preserved `query-analyzer` annotation/short-circuit behavior with tests and added router examples/tests for `spam`, `high-risk`, and `meta` annotation branches.
- [x] BL-263-007 — Documented rollout flags/policy notes and added a `behavioral-control` validation scope to `validate_deliverable.sh`.
- [x] BL-263-009 — Restored `docker-compose.local.yaml` to treat `bitbrat-network` as the pre-created external shared network, attached `nats-box` to it, and added regression coverage for the local network contract.
- [x] Sprint publication/retro/closure — Added `retro.md` and `key-learnings.md`, pushed branch `feature/sprint-263-60adf2-behavioral-control-planning`, and created PR `https://github.com/cnavta/BitBrat/pull/177`.

## Partial
- [ ] None.

## Deferred
- [ ] Phase 4 policy externalization (Firestore-backed policy packs and dynamic safety-policy loading) remains a follow-up outside this sprint's approved scope.

## Alignment Notes
- Validation evidence: `./validate_deliverable.sh --scope behavioral-control` completed successfully with install/build/lint plus 9 targeted suites (30 tests); infra/deploy steps were skipped because `PROJECT_ID` was not set.
- Router support was improved by extending `has_annotation(...)` to match both legacy label/value enrichments and the current query-analyzer `kind` + `label/value` behavioral annotations without changing `InternalEventV2`.
- Additional local-compose validation evidence: `npm test -- --runInBand tests/infrastructure/docker-compose.local.spec.ts` passed (2 tests), and `docker compose -f infrastructure/docker-compose/docker-compose.local.yaml config` now renders `bitbrat-network` as `external: true` with `nats-box` on the shared network.