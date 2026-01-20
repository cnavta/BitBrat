# Retro – sprint-196-8f2e1a

## What worked
- Quick identification of the missing configuration in `firebase.json`.
- Understanding of Docker networking and default Firebase emulator behavior (binding to localhost).

## What didn't
- The `npm run local` command is complex and hard to fully simulate in a restricted environment, but the dry-run and config checks provided sufficient confidence.

## Future improvements
- Ensure all required emulators are explicitly defined in `firebase.json` from the start.
- Add a check to `deploy-local.sh` or a similar tool to verify emulator accessibility.
