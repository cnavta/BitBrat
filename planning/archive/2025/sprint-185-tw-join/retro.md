# Retro - sprint-185-tw-join

## What Worked
- Expanding the webhook to `onMessageAdded` provided a robust fallback for the bot joining conversations it might have missed.
- The new integration test suite quickly surfaced critical bugs in the initial implementation.

## Challenges
- Debugging the 404 error in tests revealed that `onHTTPRequest` defaults to `GET` for string paths, which was a subtle but impactful detail.
- The lack of body-parser middleware in `IngressEgressServer` would have caused failures in production signature validation.

## Key Learnings
- Always specify the HTTP method when using `onHTTPRequest` if it's not a standard `GET` debug route.
- Ensure body-parser middleware is present when an app starts handling POST webhooks with payloads.
