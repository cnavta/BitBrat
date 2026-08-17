# Key Learnings – sprint-196-8f2e1a

- Firebase Emulator CLI ignores services specified in `--only` if they are not present in the provided `firebase.json`.
- When running Firebase Emulators inside Docker, `host: "0.0.0.0"` is mandatory for cross-container or host-to-container access, as they default to `127.0.0.1`.
