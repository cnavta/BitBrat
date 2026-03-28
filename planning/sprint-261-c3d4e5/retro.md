# Retro – sprint-261-c3d4e5

## What worked
- Pre-downloading emulators during the Docker build phase significantly improved startup speed and reliability, and likely resolved the user's fatal 'unexpected error' caused by runtime download failures.
- Setting `HOME=/data` in the `Dockerfile` and `bootstrap.sh` ensured consistent configuration and emulator JAR locations.
- Explicitly configuring all requested emulators in `firebase.json` brought the configuration into alignment with the requested runtime state.

## What didn't work
- The `eventarc` emulator still shows a 'Failed to initialize' message. While this doesn't crash the stack, it may indicate a missing dependency or subtle configuration requirement that could be further investigated if Eventarc is actively used.
- `firebase emulators:start` continues to show a warning about not being authenticated even with ADC, though it functions correctly for the emulator purposes.

## Future Recommendations
- Consider pre-downloading all emulators in the base image used for Firebase development to avoid duplication across services.
- Investigate the specific requirements for the `eventarc` emulator to ensure it's fully functional.
