# Request Log – sprint-261-c3d4e5

- 2026-03-21T16:45:00Z: User reports 'unexpected error' during firebase emulator startup in Docker.
- 2026-03-21T16:45:00Z: Initialized sprint 261-c3d4e5.
- 2026-03-21T16:50:00Z: Analyzing `firebase.json` and identifying discrepancies between requested and configured emulators.
- 2026-03-21T17:00:00Z: Updated `firebase.json` to include `pubsub` and `eventarc` emulators with correct ports.
- 2026-03-21T17:05:00Z: Updated `Dockerfile.emulator` to pre-download firestore, pubsub, and UI emulators during build for reliability.
- 2026-03-21T17:10:00Z: Added `procps` to the emulator image and exposed eventarc port 9299 in `docker-compose.local.yaml`.
- 2026-03-21T17:15:00Z: Successfully verified that emulators start and reach 'ready' state without crashing.
