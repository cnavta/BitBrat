# Key Learnings – sprint-201-d8e2f3

- **Firestore Emulator in Docker**: Always set `"host": "0.0.0.0"` in `firebase.json` for all emulators that need to be accessed by other containers or from the host.
- **NATS JetStream Queue Groups**:
    - Avoid subscribing to the same subject with both JetStream and core NATS unless specifically intended.
    - When using queue groups with durables, include the queue name in the durable name to prevent collisions between different services subscribing to the same subject.
    - Use `opts.queue(group)` in `js.subscribe`.
