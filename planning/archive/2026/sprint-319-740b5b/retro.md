# Retro – sprint-319-740b5b (`brat backup`)

## What worked
- The **allowlist registry + `FORBIDDEN_PREFIXES` guard** made the brief's hard requirement ("never
  export events/logs") trivially testable, and the guard test was written first (Gate G0).
- Decomposing into small gated phases (registry → serializer → provider → export → import →
  target-aware → validate) let each layer be unit/integration tested in isolation before wiring the
  CLI; the build stayed green throughout.
- Mirroring `src/common/firebase.ts` in the new provider (ADC + multi-db + `FIRESTORE_EMULATOR_HOST`)
  meant the same code path serves real GCP and the emulator — no special-casing in export/import.
- Running a real Firestore emulator let us prove the export→wipe→import round-trip end-to-end
  (IDs + subcollections preserved, volatile fields stripped, logs excluded).

## What didn't / friction
- The Node runtime wasn't on the default non-login PATH (`node`/`npx` not found); had to use
  `/opt/homebrew/bin`. Worth standardising in CI/runbooks.
- The default emulator port **8080** was occupied by an unrelated nginx, so the emulator ran on 8088;
  tests use `BRAT_TEST_EMULATOR_HOST` to override.
- A test helper placed inside `__tests__/` was picked up by jest as an empty suite — moved to
  `backup/testing/`.
- The remote `--target staging` SSH tunnel can't be validated without a remote host; only the
  resolution logic + direct fallback are unit-tested.

## Follow-ups
- Validate the remote `--target staging` SSH-tunnel path against the real staging engine.
- Consider a `--format ndjson` / per-collection-file option for very large configs (left as an
  extension point in the TA).
