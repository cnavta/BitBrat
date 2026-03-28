# Key Learnings – sprint-261-c3d4e5

- Runtime emulator JAR downloads via `firebase-tools` are unreliable in Docker containers with restricted internet or proxy settings. Pre-downloading them during the image build using `firebase setup:emulators` is highly recommended.
- Explicitly set `HOME` in both `Dockerfile` and runtime scripts to ensure that `firebase-tools` consistently finds its cached emulators in the same location.
- Align `firebase.json` configuration with the specific emulators requested via `--only` or the default requested set to avoid initialization warnings or crashes.
- Eventarc and other newer emulators may have more complex dependencies (like functions or specific configuration stubs) compared to core emulators like Firestore and Pub/Sub.
