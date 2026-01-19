# Retro – sprint-195-b5a2c1

## What worked
- The assessment phase successfully identified why services were failing to start locally (missing env validation and YAML files).
- `merge-env.js` logic was easily corrected to avoid global namespace pollution.
- Optimizing the emulator Dockerfile significantly reduced startup time and improved reliability.
- Implementing `service_healthy` dependencies solved the race conditions between emulators and services.
- `gh` CLI was available for PR creation.

## What didn’t
- Initial `ls` didn't highlight the existence of `.env.example`, leading to a brief moment of confusion.
- `npm test` during validation produced some `ReferenceError` warnings about teardown, though tests ultimately passed. This might need investigation in a future sprint.

## Improvements for future sprints
- Add a pre-flight check in `deploy-local.sh` that explicitly warns about missing secrets listed in `architecture.yaml`.
- Standardize the emulator setup even further, perhaps by publishing a pre-built image to a registry.
