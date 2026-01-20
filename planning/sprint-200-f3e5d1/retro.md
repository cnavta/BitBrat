# Retro – sprint-200-f3e5d1

## What Worked
- Explicitly enabling emulators in `firebase.json` finally allowed the `pubsub` emulator to start.
- Toughening the healthcheck ensures that dependent services wait until the database is actually ready, not just the UI.
- The NATS driver fix resolved a subtle bug where messages could be received twice (once via JetStream and once via core NATS) when using queue groups.

## What Didn't Work
- Initial attempts to rely on Firebase CLI defaults for host binding were unsuccessful; explicit `0.0.0.0` was required for cross-container connectivity.

## Future Pick-ups
- Monitor local startup times to see if the 30-retry limit on healthchecks remains sufficient as more services are added.
