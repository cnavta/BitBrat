# Retro – sprint-211-a8d2f3

## What Worked
- Quickly identifying the platform mismatch as the cause of the `obs-mcp` failure.
- Automating the fix via the `bootstrap-service.js` script to ensure all future image-based services also get the `platform` field.

## What Didn't Work
- `validate_deliverable.sh` takes a long time because it runs the entire test suite. For small fixes, a more targeted validation might be better.

## Learnings
- When using pre-built images in a multi-architecture environment (AMD64 vs ARM64), always specify the `platform` in Docker Compose if the host might differ from the image.
