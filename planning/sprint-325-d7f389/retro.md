# Retro – sprint-325-d7f389 (BL-204 — Brat as a Fleet MCP Client)

## What went well
- **Gateway-first sequencing paid off.** Closing the addressing gap (BL2-100) was a tiny, surgical change
  in `McpBridge.translateTool` — qualify only `bit.*` ids — that the whole fabric (CallTool + REST + RBAC)
  picked up for free because routing is keyed on the registry id.
- **Dependency injection everywhere** (transport factories, fetch, registry reader, identity resolver)
  made the entire fleet client + command surface unit-testable with zero real network/Firestore — 44 new
  focused tests, fast and deterministic.
- **Consumer-only discipline held**: no `bit.*` toolset change and no `architecture.yaml` change (Law #2);
  the one platform change was additive and read-path only.
- Full suite stayed green (978 passed) — no regressions from the bridge id change.

## What didn't / friction
- The REST mirror's `:id` segment can't contain a raw `/`, so qualified ids must be URL-encoded by the
  client. Easy once spotted, but a quiet trap — captured explicitly in tests.
- `node`/`npm` weren't on the bare PATH; had to mirror `validate_deliverable.sh`'s `/opt/homebrew/bin`
  fix for every command.
- Full-suite runs emit a lot of intentional error/open-handle log noise, which makes "did it pass?" a
  grep-for-the-summary exercise rather than an at-a-glance read.

## Deferred / follow-ups
- TA §4.2 Option B (a gateway `fleet.call` façade) intentionally not built; revisit only if a single
  proxy tool is ever preferred over per-Bit qualified ids.
- A live end-to-end smoke (real gateway + emulator Firestore) was not run; the path is covered by mocked
  tests + the `validate_deliverable.sh` help-entrypoint check. A future sprint could add an emulator-backed
  integration test mirroring the backup round-trip harness.
