# Retro – sprint-198-a1b2c3

## What Worked
- Explicitly enabling service keys in `firebase.json` (e.g., `"pubsub": {}`) is crucial for Firebase emulators to start those services.
- Auto-provisioning NATS streams simplifies local onboarding and prevents "no stream matches subject" errors.
- Relaxing environment validation for local dev prevents blocking startup on optional integrations.

## What Didn't
- Identifying why `pubsub` wasn't starting was tricky without the explicit top-level key in `firebase.json`.

## Key Learnings
- Firebase emulators require both a listener config in `emulators` and a top-level service key to be fully active.
- JetStream streams must exist before durable consumers can be created.
