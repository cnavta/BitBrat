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

## Post-publication fixes (the cost of "no live stack at build time")
- The whole first wave of operator-reported defects (REQ-003…006) shared one root cause: the feature was
  validated entirely against mocks, so the gaps that only a **real local Docker stack** exposes slipped
  through — `--target` was ignored (read real GCP, not the emulator), service ports were assumed to be the
  internal `:3000` rather than the published host port, and the `mcp_servers` registry was treated as a
  pure "list of Bits" when it is really the gateway's upstream catalog (external MCP servers + the gateway
  itself included). Each fix was small; finding them required actually running the command.
- Good news: because everything was dependency-injected, every fix landed with focused unit tests and the
  suite grew cleanly from 978 → 1016 with zero regressions, all on the same branch / PR #250.

## Deferred / follow-ups
- TA §4.2 Option B (a gateway `fleet.call` façade) intentionally not built; revisit only if a single
  proxy tool is ever preferred over per-Bit qualified ids.
- A live end-to-end smoke (real gateway + emulator Firestore) was not run; the path is covered by mocked
  tests + the `validate_deliverable.sh` help-entrypoint check. A future sprint could add an emulator-backed
  integration test mirroring the backup round-trip harness.
