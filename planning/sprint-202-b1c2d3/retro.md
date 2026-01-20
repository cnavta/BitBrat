# Retro – sprint-202-b1c2d3

## What Worked
- Clear instruction from user about the specific port needed.
- Quick identification of missing configuration in `firebase.json`.
- `validate_deliverable.sh` provided a fast feedback loop for configuration changes.

## What Didn't Work
- Initial assumption that Docker port exposure was enough; `firebase.json` needs to know about the websocket port to bind it correctly to the intended host interface.

## Lessons Learned
- When working with Firebase emulators in Docker, all internal communication ports used by the UI (like websockets) must be explicitly configured and bound to `0.0.0.0`.
