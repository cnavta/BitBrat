# Retro – sprint-142-d6e8f1

## What worked
- Quick identification of the missing `COPY` instruction in the Dockerfile.
- Unit tests quickly caught the regression in `twitch-oauth.ts` once I updated the code to match the actual `architecture.yaml` structure.

## What didn’t
- I initially assumed only `oauth-flow` had issues, but found that Twitch-related code also had a bug in how it traversed the architecture YAML (missing `.resources`).

## Future Improvements
- Add a shared helper to `BaseServer` for common architecture property lookups (like resolving the LB domain) to avoid duplicated path logic across services.
