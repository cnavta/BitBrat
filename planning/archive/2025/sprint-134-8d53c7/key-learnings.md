# Key Learnings – sprint-134-8d53c7

- Designing the user-context composer as a standalone module simplified testing and reuse.
- TTL caches for both roles and user docs reduced Firestore coupling and kept logic deterministic in tests.
- Keeping injection behind flags (mode + enable) provides safe rollout and A/B experimentation.
- Building input as flattened messages made truncation policies straightforward and observable.
