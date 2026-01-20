# Key Learnings – sprint-202-b1c2d3

- `firebase-tools` (v13+) requires Java 21. Containers running older LTS versions (like Java 17) must be upgraded.
- When mocking NATS in Jest, always include `jetstreamManager` if the driver logic performs stream checks or setup during initialization.
- Bullseye-based Node images need external repositories (like Adoptium) for the latest Java JREs.
