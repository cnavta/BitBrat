# Retro – sprint-253-a2b3c4

## What worked
- Quick alignment with `architecture.yaml` source of truth.
- Transitioning `auth` service to use the routing slip pattern (`this.next()`) as suggested by the user, which simplifies topic management.
- Integration tests caught the need for multiple topic support in `event-router`.

## What didn’t work
- Initial assumption that `auth` would publish to a static topic was corrected during the approval phase.
- `auth-service.ts` had a hard skip for subscriptions in Jest, which made testing the new logic slightly more involved than expected.

## Next steps
- Monitor event flow in production to ensure `event-router` handles the increased load of multiple topics.
