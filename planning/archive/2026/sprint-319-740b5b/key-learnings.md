# Key Learnings – sprint-319-740b5b

- **Fail-safe by allowlist.** For "export config, never logs", an explicit allowlist registry plus a
  `FORBIDDEN_PREFIXES` guard (checked on export AND import, including nested paths) is far safer than
  a denylist: new log collections are excluded by default and a hand-edited backup can't smuggle them
  back in.
- **One connection path for GCP + emulator.** Building the provider on `FIRESTORE_EMULATOR_HOST`
  (mirroring `src/common/firebase.ts`) means the docker-stack emulator and real GCP share the exact
  same export/import/serializer code — the `--target` resolver only has to produce a host:port.
- **Typed JSON wrapper round-trips Firestore types.** A `{ "__type": ... }` convention (+ `__escaped`
  for literal maps containing the reserved key) cleanly preserves Timestamp/GeoPoint/Ref/Bytes and
  survives `JSON.stringify`/`parse`; decode needs the `Firestore` instance only to rebuild refs.
- **Safe-by-default UX.** Import dry-run-by-default + `--confirm` + explicit `--project-id` for real
  GCP writes + always echoing the resolved target prevents "wrote config into the wrong instance".
- **Test-runtime hygiene.** Keep non-test helpers out of `__tests__/` (jest matches everything there);
  gate emulator-dependent tests behind a TCP reachability probe so the suite is logically passable
  without a runtime; use a transient `firebase-tools` install for verification without adding a repo
  dependency.
- **Emulator ≠ durable store.** The emulator's data lives in the `firebase-data-v2` volume and is
  wiped by `down -v`; great for seeding a blank instance (the brief), but call this out for operators.
