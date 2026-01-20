# Key Learnings – sprint-200-f3e5d1

## Firebase Emulators
- Firebase Emulators bind to `127.0.0.1` by default. When running in Docker Compose, always set `"host": "0.0.0.0"` in `firebase.json` or use `--host 0.0.0.0`.
- Emulators must be explicitly listed with at least an empty object (e.g., `"pubsub": {}`) in the root of `firebase.json` for the CLI to start them.

## Docker Compose Healthchecks
- Be careful with healthchecks that only probe the "management" port (like Firebase UI 4000). Always probe the actual service ports (8080, 8085) to ensure readiness for dependencies.

## NATS JetStream
- When implementing a transport abstraction, ensure that core NATS features (like queue groups) are mapped correctly to JetStream consumer options to avoid double-delivery or subscription conflicts.
