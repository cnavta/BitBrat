# Retro – sprint-201-d8e2f3

## What worked
- Quick identification of `127.0.0.1` vs `0.0.0.0` in `firebase.json` for Docker connectivity.
- Root cause analysis of NATS JetStream error revealed both a double-subscription bug and a durable name collision issue.

## What didn’t
- Initial confusion about the state of the repo due to uncommitted changes from a previous session and complex branching.

## Learnings
- In Docker Compose, emulators MUST listen on `0.0.0.0`.
- NATS JetStream shared durables require careful naming and options (durable + queue group).
