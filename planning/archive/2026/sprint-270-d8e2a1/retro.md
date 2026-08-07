# Retro – sprint-270-d8e2a1

## What Worked
- Implementation was straightforward based on standard Discord OAuth2 docs.
- Mocking `fetch` in Jest worked well to test the token exchange logic without network calls.
- `routes.test.ts` provided a good regression check for the generic callback routing.

## What Didn't Work
- Initial `getAuthorizeUrl` was missing `identify` scope, which could lead to missing user information in some flows, though bot flow was the primary focus. Added it for completeness.
- Realized that `permissions` should only be sent if `bot` scope is present to avoid Discord errors for non-bot flows.

## Lessons Learned
- Always check for required scopes beyond just the functional one (`bot`) when integrating new OAuth providers.
- Conditional query parameters based on scope can prevent errors with provider-specific authorization URLs.
